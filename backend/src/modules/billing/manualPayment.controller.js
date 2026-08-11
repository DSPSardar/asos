// manualPayment.controller.js — validation and response shaping for
// bank-transfer payments. Prisma calls live in the service, per the module
// pattern in CLAUDE.md.
const { z } = require('zod');
const service = require('./manualPayment.service');
const { success, created } = require('../../utils/response');

// multipart/form-data delivers every field as a string, so coerce rather than
// declaring z.number() and failing on "5000".
const submitSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero').max(99_999_999),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  paidAt: z.coerce.date().max(new Date(Date.now() + 86_400_000), 'Payment date cannot be in the future'),
  reference: z.string().trim().max(120).optional(),
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']),
  periodMonths: z.coerce.number().int().min(1).max(24).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const reviewSchema = z.object({
  reviewNote: z.string().trim().max(1000).optional(),
});

const submit = async (req, res, next) => {
  try {
    const data = submitSchema.parse(req.body);
    const payment = await service.submitPayment(req.tenantId, { ...data, proof: req.file });
    return created(res, payment, 'Payment submitted for verification');
  } catch (err) { return next(err); }
};

const listMine = async (req, res, next) => {
  try {
    return success(res, await service.listForTenant(req.tenantId));
  } catch (err) { return next(err); }
};

// ── Admin ─────────────────────────────────────────────────────

const listAll = async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    return success(res, await service.listAll({
      status: status || undefined,
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 20, 100),
    }));
  } catch (err) { return next(err); }
};

// Streams the stored screenshot. Not cached: it is financial evidence behind
// a superadmin-only route, and it should not sit in a shared cache.
const getProof = async (req, res, next) => {
  try {
    const proof = await service.getProof(req.params.id);
    if (!proof?.proofImage) {
      return res.status(404).json({ success: false, message: 'No proof image for this payment' });
    }
    res.setHeader('Content-Type', proof.proofMimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    // inline, not attachment — the admin panel renders it in an <img>.
    res.setHeader('Content-Disposition', `inline; filename="${(proof.proofFilename || 'proof').replace(/"/g, '')}"`);
    return res.send(Buffer.from(proof.proofImage));
  } catch (err) { return next(err); }
};

const approve = async (req, res, next) => {
  try {
    return success(res, await service.approve(req.params.id, req.user.id), 'Payment approved — plan activated');
  } catch (err) { return next(err); }
};

const reject = async (req, res, next) => {
  try {
    const { reviewNote } = reviewSchema.parse(req.body || {});
    return success(res, await service.reject(req.params.id, req.user.id, reviewNote), 'Payment rejected');
  } catch (err) { return next(err); }
};

module.exports = { submit, listMine, listAll, getProof, approve, reject };
