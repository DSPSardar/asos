// src/webhooks/mastery.webhook.js
//
// POST /webhooks/mastery — learning events from the DSP AI Agent Mastery
// dashboard (digitalservicesprogram.com). Authenticated by a shared secret,
// scoped to the single tenant named in MASTERY_TENANT_ID.
//
// Body (JSON): { event, email, data? }
//   event: enrolled | module_complete | badge_earned | capstone_submitted | capstone_approved | inactive
//   data : { module, badge, days, full_name, phone, fee, currency } as relevant
//
// "enrolled" from the course's own PKR page creates/updates the CRM record so
// a student who never messaged WhatsApp still shows up in Leads and Reports
// (as CLOSED_WON at the PKR 28,000 list price — any other amount is held at
// PROPOSED for manual verification). Every other event becomes a
// SYSTEM activity that the automation engine's `mastery_event` trigger reads.

const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../utils/logger');
const masteryService = require('../services/mastery.service');
const { ENROLMENT_FEE_PKR } = require('../config/constants');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');

const router = Router();

const Body = z.object({
  event: z.enum(['enrolled', 'module_complete', 'badge_earned', 'capstone_submitted', 'capstone_approved', 'inactive']),
  email: z.string().email(),
  data: z.record(z.any()).optional().default({}),
});

router.post('/', async (req, res) => {
  if (!env.MASTERY_EVENTS_SECRET || !env.MASTERY_TENANT_ID) return res.status(503).json({ error: 'mastery integration not configured' });
  if (req.get('x-mastery-secret') !== env.MASTERY_EVENTS_SECRET) return res.status(401).json({ error: 'unauthorized' });

  let body;
  try { body = Body.parse(JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body)); }
  catch (err) { return res.status(400).json({ error: 'bad request', detail: err.message }); }

  const tenantId = env.MASTERY_TENANT_ID;
  const email = body.email.trim().toLowerCase();

  try {
    await runWithSystemScope(async () => {
      if (body.event === 'enrolled') {
        // Upsert contact + a MASTERY lead. Won means paid at exactly the list
        // price, same rule as the two in-app paths (leads.service /
        // conversations.service): a USD checkout is recorded as PKR 28,000 at
        // the point of sale (USD is never stored), a missing fee from the
        // course's own checkout means list price, and any other amount lands
        // at PROPOSED for a human to verify instead of booking a Won.
        let fee = parseFloat(body.data.fee);
        let currency = body.data.currency || 'PKR';
        if (currency === 'USD') { fee = ENROLMENT_FEE_PKR; currency = 'PKR'; }
        if (!Number.isFinite(fee) || fee <= 0) fee = ENROLMENT_FEE_PKR;
        const wonValid = currency === 'PKR' && fee === ENROLMENT_FEE_PKR;
        let contact = await prisma.contact.findFirst({ where: { tenantId, email: { equals: email, mode: 'insensitive' } } });
        const phone = body.data.phone ? String(body.data.phone).replace(/[^\d+]/g, '') : null;
        if (!contact && phone) contact = await prisma.contact.findFirst({ where: { tenantId, phone } });
        if (!contact) {
          contact = await prisma.contact.create({ data: { tenantId, email, name: body.data.full_name || null,
            phone: phone || `email:${email}` } });
        } else if (!contact.email) {
          contact = await prisma.contact.update({ where: { id: contact.id }, data: { email } });
        }
        const existing = await prisma.lead.findFirst({ where: { tenantId, contactId: contact.id, product: 'MASTERY' }, orderBy: { createdAt: 'desc' } });
        const landing = wonValid
          ? { stage: 'CLOSED_WON', product: 'MASTERY', closedAt: new Date(),
              enrollmentFee: fee, dealValue: fee, currency, businessUnit: 'DSP' }
          : { stage: 'PROPOSED', product: 'MASTERY', businessUnit: 'DSP' };
        const lead = existing
          ? await prisma.lead.update({ where: { id: existing.id }, data: existing.stage === 'CLOSED_WON' ? { product: 'MASTERY' } : landing })
          : await prisma.lead.create({ data: { tenantId, contactId: contact.id, ...landing, qualificationData: { source: body.data.source || 'mastery_site' } } });
        if ((!existing || existing.stage !== 'CLOSED_WON') && existing?.stage !== landing.stage) {
          await prisma.leadStageHistory.create({ data: { tenantId, leadId: lead.id, fromStage: existing?.stage || null, toStage: landing.stage, changedBy: null } }).catch(() => {});
        }
        await prisma.activity.create({ data: { tenantId, leadId: lead.id, type: 'STAGE_CHANGE',
          content: wonValid
            ? `🎓 Enrolled in AI Agent Mastery via ${body.data.source || 'course site'} — ${currency} ${fee}`
            : `⚠️ Mastery enrolment reported at ${currency} ${fee} — not the PKR ${ENROLMENT_FEE_PKR} list price, lead held at PROPOSED for manual verification`,
          metadata: { masteryEvent: 'enrolled', source: body.data.source || 'mastery_site',
            ...(wonValid ? {} : { flag: 'enrolment_fee_mismatch', reportedFee: body.data.fee ?? null, reportedCurrency: body.data.currency ?? null }) } } });
        return;
      }
      const leadId = await masteryService.recordEvent({ tenantId, email, event: body.event, data: body.data });
      if (!leadId) logger.info({ email, event: body.event }, 'Mastery event for unknown contact (no lead) — ignored');
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, event: body.event }, 'Mastery webhook failed');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
