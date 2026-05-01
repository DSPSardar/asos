const { z }  = require('zod');
const svc    = require('./content-studio.service');
const { success, created } = require('../../utils/response');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: ZOD VALIDATION SCHEMAS
// Every inbound body is validated before reaching the service layer.
// ─────────────────────────────────────────────────────────────────────────────

const extractSchema = z.object({
  sourceUrl:    z.string().min(1, 'sourceUrl is required').url('sourceUrl must be a valid URL').max(2048),
  language:     z.enum(['en', 'ur'], { errorMap: () => ({ message: 'language must be "en" or "ur"' }) }).default('en'),
  forceRefresh: z.boolean().default(false),
});

const generateSchema = z.object({
  brandProfileId: z.string().uuid('brandProfileId must be a valid UUID'),
  count:          z.number({ invalid_type_error: 'count must be a number' })
                   .int('count must be an integer')
                   .min(1, 'count must be at least 1')
                   .max(20, 'count cannot exceed 20')     // hard cap
                   .default(10),
  language:       z.enum(['en', 'ur'], { errorMap: () => ({ message: 'language must be "en" or "ur"' }) }).default('en'),
});

const approvalSchema = z.object({
  phone: z.string()
          .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format (e.g. +923001234567)'),
});

// Helper: parse schema, throw 400 with field errors on failure
const validate = (schema, body) => {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw Object.assign(new Error(message), { statusCode: 400, expose: true });
  }
  return result.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

const extract = async (req, res, next) => {
  try {
    const body = validate(extractSchema, req.body);
    const out  = await svc.extractBrandDNA({ tenantId: req.tenantId, ...body });
    return created(res, out, 'Brand DNA extracted');
  } catch (e) { return next(e); }
};

const generate = async (req, res, next) => {
  try {
    const body = validate(generateSchema, req.body);
    const out  = await svc.generateVariants({ tenantId: req.tenantId, ...body });
    return created(res, out, 'Variants generated');
  } catch (e) { return next(e); }
};

const image = async (req, res, next) => {
  try {
    const prompt = z.string().min(1).max(500).parse(req.body?.prompt ?? '');
    return success(res, await svc.generateImage({ prompt }));
  } catch (e) { return next(e); }
};

const draftImage = async (req, res, next) => {
  try {
    // prompt is optional — omit to let service auto-build it from draft + brand profile
    const prompt = req.body?.prompt
      ? z.string().min(1).max(600).parse(req.body.prompt)
      : undefined;
    return success(res, await svc.generateDraftImage({ tenantId: req.tenantId, draftId: req.params.id, prompt }), 'Image generated');
  } catch (e) { return next(e); }
};

const updateDraft = async (req, res, next) => {
  try {
    return success(res, await svc.updateDraft({ tenantId: req.tenantId, draftId: req.params.id, data: req.body }), 'Draft updated');
  } catch (e) { return next(e); }
};

const publish = async (req, res, next) => {
  try {
    return success(res, await svc.publishToMeta({ tenantId: req.tenantId, draftId: req.params.id }), 'Published to Meta');
  } catch (e) { return next(e); }
};

const approval = async (req, res, next) => {
  try {
    const { phone } = validate(approvalSchema, req.body);
    return success(res, await svc.sendForApproval({ tenantId: req.tenantId, draftId: req.params.id, phone }), 'Sent for approval');
  } catch (e) { return next(e); }
};

module.exports = { extract, generate, image, draftImage, updateDraft, publish, approval };
