// src/modules/automations/automations.controller.js
const { z } = require('zod');
const svc = require('./automations.service');
const engine = require('../../services/automation.service');
const { success, created, error } = require('../../utils/response');
const { validateSteps, MAX_STEPS } = require('../../services/automation.steps');

const TRIGGER_TYPES = ['no_reply', 'no_activity', 'stage_entered', 'dsp_phase_changed'];
const STAGES = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED', 'CLOSED_WON', 'CLOSED_LOST'];

const triggerSchema = z.object({
  type:  z.enum(TRIGGER_TYPES),
  delay: z.number().int().min(0).max(365).default(0),
  unit:  z.enum(['minutes', 'hours', 'days']).default('hours'),
  stage: z.enum(STAGES).optional(),
  phase: z.enum(['LEARN', 'BUILD', 'EARN']).optional(),
}).refine((t) => t.type !== 'stage_entered' || t.stage, { message: 'stage is required for stage_entered' })
  .refine((t) => t.type !== 'dsp_phase_changed' || t.phase, { message: 'phase is required for dsp_phase_changed' });

// Approved Meta template used when the lead is outside the 24h window.
// name must match WhatsApp Manager exactly; bodyParams fill {{1}}, {{2}}…
const waTemplateSchema = z.object({
  name:       z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and underscores only'),
  language:   z.string().trim().min(2).max(10).default('en'),
  bodyParams: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
}).nullable().optional();

// One touch of a multi-step sequence. Step 1's delay is ignored (the trigger
// says when it fires); every later step needs delay > 0 AND an approved
// template — services/automation.steps.js validateSteps enforces that.
const stepSchema = z.object({
  delay:      z.number().int().min(0).max(365).default(0),
  unit:       z.enum(['minutes', 'hours', 'days']).default('days'),
  template:   z.string().trim().min(5).max(1000),
  waTemplate: waTemplateSchema,
});

const actionSchema = z.object({
  type:     z.literal('send_whatsapp'),
  template: z.string().trim().min(5).max(1000),
  waTemplate: waTemplateSchema,
  steps:    z.array(stepSchema).min(1).max(MAX_STEPS).optional(),
}).superRefine((a, ctx) => {
  for (const msg of validateSteps(a)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: msg });
});

const ruleSchema = z.object({
  name:      z.string().trim().min(2).max(80),
  trigger:   triggerSchema,
  condition: z.object({ stage: z.enum([...STAGES, 'any']).optional() }).default({}),
  action:    actionSchema,
  tags:      z.array(z.string().trim().min(1).max(24)).max(6).default([]),
});

const parse = (schema, body, res) => {
  const r = schema.safeParse(body);
  if (!r.success) { error(res, 'Validation failed', 422, r.error.flatten().fieldErrors); return null; }
  return r.data;
};

const list = async (req, res, next) => {
  try { return success(res, await svc.listRules(req.tenantId)); } catch (e) { next(e); }
};

const runs = async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    return success(res, await svc.listRuns(req.tenantId, req.params.id || null, limit));
  } catch (e) { next(e); }
};

const create = async (req, res, next) => {
  try {
    const data = parse(ruleSchema, req.body, res);
    if (!data) return undefined;
    return created(res, await svc.createRule(req.tenantId, data), 'Rule created (paused)');
  } catch (e) { next(e); }
};

const update = async (req, res, next) => {
  try {
    const data = parse(ruleSchema.partial(), req.body, res);
    if (!data) return undefined;
    return success(res, await svc.updateRule(req.tenantId, req.params.id, data), 'Rule updated');
  } catch (e) { next(e); }
};

const toggle = async (req, res, next) => {
  try {
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined;
    return success(res, await svc.toggleRule(req.tenantId, req.params.id, enabled), 'Rule toggled');
  } catch (e) { next(e); }
};

const remove = async (req, res, next) => {
  try { await svc.deleteRule(req.tenantId, req.params.id); return success(res, { id: req.params.id }, 'Rule deleted'); } catch (e) { next(e); }
};

const preview = async (req, res, next) => {
  try {
    const rule = await svc.getRule(req.tenantId, req.params.id);
    const matches = await engine.findMatches(rule, { limit: 25, ignoreEnabledAt: true });
    return success(res, {
      wouldSend: matches.length,
      // Only the sample the admin needs to eyeball — never the whole roster.
      sample: matches.slice(0, 10).map((m) => ({
        leadId: m.lead.id, name: m.lead.contact?.name || null, phone: m.lead.contact?.phone,
        stage: m.lead.stage, insideWindow: m.insideWindow,
      })),
      note: 'Dry run only — nothing was sent. Counts use "since rule enabled" = now.',
    });
  } catch (e) { next(e); }
};

module.exports = { list, runs, create, update, toggle, remove, preview };
