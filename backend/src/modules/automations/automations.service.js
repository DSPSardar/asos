// src/modules/automations/automations.service.js
// CRUD for automation rules + run history. The engine that evaluates and
// sends lives in services/automation.service.js.
const prisma = require('../../config/database');

const notFound = () => Object.assign(new Error('Rule not found'), { statusCode: 404, expose: true });

// The six starter rules every tenant gets, all PAUSED. They match the rules
// the old mock page displayed so nothing "disappears" on upgrade — the admin
// just has to switch each one on deliberately. Templates support {name}.
const DEFAULT_RULES = [
  // The two "quiet lead" rules almost always fire outside Meta's 24h window,
  // so they carry the approved marketing templates (WhatsApp Manager → Asos).
  // The free-text template is what goes out if the lead IS in-window, and is
  // kept in sync with the approved wording.
  { name: 'No-Reply Follow-up', trigger: { type: 'no_reply', delay: 24, unit: 'hours' }, condition: { stage: 'any' }, tags: ['follow-up', 'whatsapp'],
    action: { type: 'send_whatsapp',
      template: 'Assalamualaikum {name}! Ye DSP (Digital Services Program) se hai. Aap ne humare AI Agents course ke baare mein pucha tha aur hum aap ke jawab ka intezaar kar rahe hain. Next batch jald start ho raha hai. Kya aap ka koi sawaal hai? Bas reply karein, hum foran madad karenge.',
      waTemplate: { name: 'dsp_no_reply_followup', language: 'en', bodyParams: ['{name}'] } } },
  { name: 'Unpaid Enrollment Reminder', trigger: { type: 'stage_entered', stage: 'PROPOSED', delay: 48, unit: 'hours' }, condition: { stage: 'PROPOSED' }, tags: ['payment', 'whatsapp'],
    action: { type: 'send_whatsapp', template: 'Salam {name}! Aap ne enrollment ka faisla kiya — great decision! Seat confirm karne ke liye fee submit karein aur screenshot yahin bhej dein. Koi mushkil ho to batayen.' } },
  { name: 'Enrollment Welcome Sequence', trigger: { type: 'stage_entered', stage: 'CLOSED_WON', delay: 0, unit: 'minutes' }, condition: { stage: 'CLOSED_WON' }, tags: ['welcome', 'onboarding'],
    action: { type: 'send_whatsapp', template: '🎉 Mubarak ho {name}! Aap DSP Agentic AI Mastery family mein shamil ho gaye! WhatsApp group invite aap ko jald milega. Pehla session ki details bhi share ki jayengi.' } },
  { name: 'Cold Lead Re-engage (7d)', trigger: { type: 'no_activity', delay: 7, unit: 'days' }, condition: { stage: 'QUALIFYING' }, tags: ['re-engagement', 'cold'],
    action: { type: 'send_whatsapp',
      template: 'Salam {name}! Ye DSP (Digital Services Program) se hai. Aap ne kuch din pehle humare AI Agents course mein interest dikhaya tha. Next batch mein sirf kuch seats bachi hain. Kya aap ab bhi join karna chahte hain? Reply karein aur hum details bhej denge.',
      waTemplate: { name: 'dsp_cold_reengage', language: 'en', bodyParams: ['{name}'] } } },
  { name: 'Certificate Issued Notification', trigger: { type: 'dsp_phase_changed', phase: 'BUILD', delay: 0, unit: 'minutes' }, condition: {}, tags: ['certificate', 'milestone'],
    action: { type: 'send_whatsapp', template: '🏆 {name}, aap ka DSP AI Mastery certificate issue ho gaya! LinkedIn pe add karein aur clients tak apni skills pahunchayen.' } },
  { name: 'Earning Milestone Congratulations', trigger: { type: 'dsp_phase_changed', phase: 'EARN', delay: 0, unit: 'minutes' }, condition: {}, tags: ['earn', 'milestone'],
    action: { type: 'send_whatsapp', template: '💰 Incredible, {name}! Aap Earn phase mein enter ho gaye. Aap ab AI services sell karne ke ready hain. Team aap ke pehle client mein madad ke liye available hai!' } },
];

const ensureDefaults = async (tenantId) => {
  const count = await prisma.automationRule.count({ where: { tenantId } });
  if (count > 0) return;
  await prisma.automationRule.createMany({
    data: DEFAULT_RULES.map((r) => ({ ...r, tenantId, enabled: false })),
  });
};

// Per-rule run stats folded into the list so the page needs one request.
const withStats = async (tenantId, rules) => {
  if (!rules.length) return [];
  const grouped = await prisma.automationRun.groupBy({
    by: ['ruleId', 'status'],
    where: { tenantId, ruleId: { in: rules.map((r) => r.id) } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const stats = {};
  for (const g of grouped) {
    const s = stats[g.ruleId] || (stats[g.ruleId] = { sent: 0, failed: 0, skipped: 0, lastRunAt: null });
    s[g.status.toLowerCase()] = g._count._all;
    if (!s.lastRunAt || g._max.createdAt > s.lastRunAt) s.lastRunAt = g._max.createdAt;
  }
  return rules.map((r) => {
    const s = stats[r.id] || { sent: 0, failed: 0, skipped: 0, lastRunAt: null };
    const attempted = s.sent + s.failed;
    return { ...r, stats: { ...s, attempted, successRate: attempted ? Math.round((s.sent / attempted) * 100) : null } };
  });
};

const listRules = async (tenantId) => {
  await ensureDefaults(tenantId);
  const rules = await prisma.automationRule.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  return withStats(tenantId, rules);
};

const getRule = async (tenantId, id) => {
  const rule = await prisma.automationRule.findFirst({ where: { id, tenantId } });
  if (!rule) throw notFound();
  return rule;
};

const createRule = async (tenantId, data) => {
  // Always born paused — enabling is a deliberate second click.
  const rule = await prisma.automationRule.create({ data: { ...data, tenantId, enabled: false } });
  return (await withStats(tenantId, [rule]))[0];
};

const updateRule = async (tenantId, id, data) => {
  await getRule(tenantId, id);
  const rule = await prisma.automationRule.update({ where: { id }, data });
  return (await withStats(tenantId, [rule]))[0];
};

const toggleRule = async (tenantId, id, enabled) => {
  const current = await getRule(tenantId, id);
  const next = typeof enabled === 'boolean' ? enabled : !current.enabled;
  // enabledAt resets on every enable so re-enabling a rule only sees events
  // from now on — never the backlog that piled up while it was paused.
  const rule = await prisma.automationRule.update({
    where: { id },
    data: { enabled: next, ...(next && !current.enabled ? { enabledAt: new Date() } : {}) },
  });
  return (await withStats(tenantId, [rule]))[0];
};

const deleteRule = async (tenantId, id) => {
  await getRule(tenantId, id);
  await prisma.automationRule.delete({ where: { id } });
};

const listRuns = async (tenantId, ruleId, limit) => prisma.automationRun.findMany({
  where: { tenantId, ...(ruleId ? { ruleId } : {}) },
  orderBy: { createdAt: 'desc' },
  take: limit,
  include: {
    rule: { select: { name: true } },
    lead: { select: { id: true, stage: true, contact: { select: { name: true, phone: true } } } },
  },
});

module.exports = { listRules, getRule, createRule, updateRule, toggleRule, deleteRule, listRuns, ensureDefaults, DEFAULT_RULES };
