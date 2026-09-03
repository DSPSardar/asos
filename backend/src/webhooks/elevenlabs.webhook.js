// src/webhooks/elevenlabs.webhook.js
//
// Tool endpoints for the ElevenLabs WhatsApp agent ("Zara", DSP admissions).
// The agent runs the conversation on Meta's side; these two routes are how it
// writes back into the CRM, so a voice-note lead lands in Leads and Reports
// exactly like a text lead does.
//
//   POST /webhooks/elevenlabs/lead      — upsert contact + lead as the agent qualifies
//   POST /webhooks/elevenlabs/escalate  — hand the conversation to a human
//
// Auth is the same shape as the Mastery webhook: a shared secret header,
// scoped to the single tenant named in MASTERY_TENANT_ID (DSP). Both routes
// run inside runWithSystemScope — without it every query silently returns
// zero rows under forced RLS.
//
// Deliberate limits, so the agent cannot invent revenue:
//   * This endpoint NEVER writes CLOSED_WON. "Won means paid" is verified by
//     the payment-proof flow and the Mastery enrol webhook, not by a caller
//     saying they have paid. stage:'paid' raises a human-verification flag.
//   * It never downgrades a lead that is already CLOSED_WON or CLOSED_LOST.
//   * It never moves a lead backwards through the pipeline.

const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../config/database');
const env = require('../config/env');
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsapp.service');
const notificationService = require('../services/notification.service');
const { runWithSystemScope } = require('../middleware/requestContext.middleware');
const { STAGE_MAP, TERMINAL, resolveStage } = require('./elevenlabs.stages');

const router = Router();

const LeadBody = z.object({
  name:       z.string().trim().min(1).max(120).optional(),
  whatsapp:   z.string().trim().min(6).max(32),
  email:      z.string().email().optional(),
  country:    z.string().trim().max(80).optional(),
  occupation: z.string().trim().max(120).optional(),
  motivation: z.string().trim().max(500).optional(),
  language:   z.enum(['urdu', 'english', 'mixed']).optional(),
  stage:      z.enum(['new', 'qualified', 'objection', 'email_captured', 'link_sent', 'paid']),
  objection:  z.string().trim().max(300).optional(),
  summary:    z.string().trim().min(1).max(1000),
});

const EscalateBody = z.object({
  whatsapp: z.string().trim().min(6).max(32),
  name:     z.string().trim().max(120).optional(),
  reason:   z.enum(['unknown_question', 'payment_issue', 'refund', 'existing_student',
                    'corporate', 'asked_for_sardar', 'upset', 'other']),
  detail:   z.string().trim().min(1).max(1000),
  urgency:  z.enum(['normal', 'high']).default('normal'),
});

// Shared guard: config present, secret matches, body parses. Returns the
// parsed body, or null after having already sent the error response.
const authenticate = (req, res, schema) => {
  if (!env.ELEVENLABS_WEBHOOK_SECRET || !env.MASTERY_TENANT_ID) {
    res.status(503).json({ error: 'elevenlabs agent integration not configured' });
    return null;
  }
  if (req.get('x-elevenlabs-secret') !== env.ELEVENLABS_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    return schema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (err) {
    res.status(400).json({ error: 'bad request', detail: err.message });
    return null;
  }
};

// Find the person by phone the same way every other path does: digits-only
// canonical form first, then a tenant-scoped last-10-digit fallback for rows
// stored in local format (0345…) or with a legacy '+'.
const findContact = async (tenantId, phone, email) => {
  let contact = await prisma.contact.findFirst({ where: { tenantId, phone } });
  if (!contact && phone.length >= 10) {
    contact = await prisma.contact.findFirst({ where: { tenantId, phone: { endsWith: phone.slice(-10) } } });
  }
  if (!contact && email) {
    contact = await prisma.contact.findFirst({ where: { tenantId, email: { equals: email, mode: 'insensitive' } } });
  }
  return contact;
};

// Reuse the person's existing pipeline row rather than opening a second one:
// their MASTERY lead, else any won lead (legacy rows predate Lead.product),
// else their most recent lead in any stage. Mirrors mastery.webhook.js.
const findLead = async (tenantId, contactId) =>
  (await prisma.lead.findFirst({ where: { tenantId, contactId, product: 'MASTERY' }, orderBy: { createdAt: 'desc' } })) ||
  (await prisma.lead.findFirst({ where: { tenantId, contactId, stage: 'CLOSED_WON' }, orderBy: { createdAt: 'desc' } })) ||
  (await prisma.lead.findFirst({ where: { tenantId, contactId }, orderBy: { createdAt: 'desc' } }));

// ───────────────────────────── POST /lead ─────────────────────────────
router.post('/lead', async (req, res) => {
  const body = authenticate(req, res, LeadBody);
  if (!body) return undefined;

  const tenantId = env.MASTERY_TENANT_ID;
  const phone = whatsappService.normalizePhone(String(body.whatsapp));
  const email = body.email ? body.email.trim().toLowerCase() : null;
  const target = STAGE_MAP[body.stage];

  try {
    const result = await runWithSystemScope(async () => {
      let contact = await findContact(tenantId, phone, email);
      if (!contact) {
        contact = await prisma.contact.create({
          data: { tenantId, phone, name: body.name || null, email },
        });
      } else {
        // Only fill gaps — never overwrite a name or email a human has curated
        // with whatever the agent heard over a voice note.
        const patch = {};
        if (!contact.name && body.name) patch.name = body.name;
        if (!contact.email && email) patch.email = email;
        if (Object.keys(patch).length) {
          contact = await prisma.contact.update({ where: { id: contact.id }, data: patch });
        }
      }

      const existing = await findLead(tenantId, contact.id);

      // Everything the agent learned, merged onto the lead rather than
      // replacing it — a later call that only knows the stage must not wipe
      // the country and motivation an earlier call captured.
      const captured = {
        ...(body.country    ? { country: body.country } : {}),
        ...(body.occupation ? { occupation: body.occupation } : {}),
        ...(body.motivation ? { motivation: body.motivation } : {}),
        ...(body.language   ? { language: body.language } : {}),
        ...(body.objection  ? { objection: body.objection } : {}),
      };

      let lead;
      let moved = null;

      if (!existing) {
        lead = await prisma.lead.create({
          data: {
            tenantId, contactId: contact.id,
            stage: target, product: 'MASTERY', businessUnit: 'DSP',
            leadTemperature: body.stage === 'link_sent' || body.stage === 'paid' ? 'HOT' : 'WARM',
            qualificationData: { source: 'whatsapp-voice', channel: 'elevenlabs', ...captured },
            humanFollowupRequired: body.stage === 'paid',
          },
        });
        moved = { from: null, to: target };
      } else {
        const current = existing.stage;
        // Terminal leads are read-only here: an enrolled student asking a
        // question must never be dragged back into the pipeline, and a lost
        // lead is reopened by a human, not by an agent's stage guess.
        const { advance } = resolveStage(current, body.stage);
        const data = {
          product: 'MASTERY',
          qualificationData: { ...(existing.qualificationData || {}), ...captured, channel: 'elevenlabs' },
          ...(advance ? { stage: target } : {}),
          ...(body.stage === 'paid' && !TERMINAL.has(current) ? { humanFollowupRequired: true } : {}),
          ...(body.stage === 'link_sent' || body.stage === 'paid' ? { leadTemperature: 'HOT' } : {}),
        };
        lead = await prisma.lead.update({ where: { id: existing.id }, data });
        if (advance) moved = { from: current, to: target };
      }

      if (moved) {
        await prisma.leadStageHistory.create({
          data: { tenantId, leadId: lead.id, fromStage: moved.from, toStage: moved.to, changedBy: null },
        }).catch(() => {});
      }

      await prisma.activity.create({
        data: {
          tenantId, leadId: lead.id,
          type: moved ? 'STAGE_CHANGE' : 'AI_ACTION',
          content: `🎙️ WhatsApp voice agent — ${body.stage.replace(/_/g, ' ')}: ${body.summary}`,
          metadata: {
            channel: 'elevenlabs', reportedStage: body.stage,
            ...(body.objection ? { objection: body.objection } : {}),
            ...(body.stage === 'paid' ? { flag: 'claimed_payment_unverified' } : {}),
          },
        },
      });

      // A caller saying "I've paid" is the moment a human has to look — the
      // proof still has to be matched on the enrol page before it is a win.
      if (body.stage === 'paid' && !TERMINAL.has(existing?.stage || '')) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (tenant) {
          await notificationService.notifyAdmin(tenant, 'needsHuman', {
            contactName: contact.name || body.name, phone,
            reason: 'Voice agent: caller says they have paid — verify the proof',
            conversationUrl: `${env.APP_URL}/leads/${lead.id}`,
          });
        }
      }

      return { leadId: lead.id, contactId: contact.id, stage: lead.stage, moved: Boolean(moved) };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, stage: body.stage }, 'ElevenLabs lead webhook failed');
    return res.status(500).json({ error: 'internal' });
  }
});

// ─────────────────────────── POST /escalate ───────────────────────────
router.post('/escalate', async (req, res) => {
  const body = authenticate(req, res, EscalateBody);
  if (!body) return undefined;

  const tenantId = env.MASTERY_TENANT_ID;
  const phone = whatsappService.normalizePhone(String(body.whatsapp));

  try {
    const result = await runWithSystemScope(async () => {
      let contact = await findContact(tenantId, phone, null);
      if (!contact) {
        contact = await prisma.contact.create({ data: { tenantId, phone, name: body.name || null } });
      }
      let lead = await findLead(tenantId, contact.id);
      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            tenantId, contactId: contact.id, stage: 'NEW', product: 'MASTERY', businessUnit: 'DSP',
            qualificationData: { source: 'whatsapp-voice', channel: 'elevenlabs' },
          },
        });
      }

      // The flag is what puts them in the Today queue; the activity is what
      // tells whoever opens it what was actually asked.
      await prisma.lead.update({ where: { id: lead.id }, data: { humanFollowupRequired: true } });
      await prisma.activity.create({
        data: {
          tenantId, leadId: lead.id, type: 'NOTE',
          content: `🙋 Voice agent escalation (${body.reason.replace(/_/g, ' ')}): ${body.detail}`,
          metadata: { channel: 'elevenlabs', escalation: body.reason, urgency: body.urgency },
        },
      });

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant) {
        await notificationService.notifyAdmin(tenant, 'needsHuman', {
          contactName: contact.name || body.name, phone,
          reason: `${body.reason.replace(/_/g, ' ')} — ${body.detail}`,
          conversationUrl: `${env.APP_URL}/leads/${lead.id}`,
        });
      }

      return { leadId: lead.id, contactId: contact.id };
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, reason: body.reason }, 'ElevenLabs escalate webhook failed');
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
