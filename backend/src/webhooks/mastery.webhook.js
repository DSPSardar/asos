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
// (as CLOSED_WON, product MASTERY, with the fee). Every other event becomes a
// SYSTEM activity that the automation engine's `mastery_event` trigger reads.

const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../utils/logger');
const masteryService = require('../services/mastery.service');
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
        // Upsert contact + a CLOSED_WON MASTERY lead. Won means paid: the fee is required
        // exactly like the two in-app paths (leads.service / conversations.service).
        const fee = parseFloat(body.data.fee);
        const currency = body.data.currency || 'PKR';
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
        const won = { stage: 'CLOSED_WON', product: 'MASTERY', closedAt: new Date(),
          ...(Number.isFinite(fee) && fee > 0 ? { enrollmentFee: fee, dealValue: fee, currency } : {}), businessUnit: 'DSP' };
        const lead = existing
          ? await prisma.lead.update({ where: { id: existing.id }, data: existing.stage === 'CLOSED_WON' ? { product: 'MASTERY' } : won })
          : await prisma.lead.create({ data: { tenantId, contactId: contact.id, ...won, qualificationData: { source: body.data.source || 'mastery_site' } } });
        if (!existing || existing.stage !== 'CLOSED_WON') {
          await prisma.leadStageHistory.create({ data: { tenantId, leadId: lead.id, fromStage: existing?.stage || null, toStage: 'CLOSED_WON', changedBy: null } }).catch(() => {});
        }
        await prisma.activity.create({ data: { tenantId, leadId: lead.id, type: 'STAGE_CHANGE',
          content: `🎓 Enrolled in AI Agent Mastery via ${body.data.source || 'course site'}${Number.isFinite(fee) ? ` — ${currency} ${fee}` : ''}`,
          metadata: { masteryEvent: 'enrolled', source: body.data.source || 'mastery_site' } } });
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
