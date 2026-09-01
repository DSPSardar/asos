// src/modules/automations/automations.service.js
// CRUD for automation rules + run history. The engine that evaluates and
// sends lives in services/automation.service.js.
const prisma = require('../../config/database');
const env = require('../../config/env');

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


// ── DSP AI Agent Mastery nudges ─────────────────────────────────────────────
// Only seeded for the tenant named in MASTERY_TENANT_ID (the DSP EdTech tenant);
// every other tenant never sees these. Triggered by learning events the course
// dashboard posts to /webhooks/mastery. All start paused — flip on in /automations.
const MASTERY_RULES = [
  { name: 'Mastery: Welcome to the dashboard', trigger: { type: 'mastery_event', event: 'enrolled', delay: 5, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'onboarding'],
    action: { template: 'Welcome to DSP AI Agent Mastery, {name}! 🎓 Your sign-in link is in your email — start with Module 1, Lesson 1 today. Setup checklist is in Module 3 — do it the same day. Stuck? Ask here any time, support is free for a year.' } },
  { name: 'Mastery: Day-3 setup nudge', trigger: { type: 'mastery_event', event: 'enrolled', delay: 3, unit: 'days' }, condition: { stage: 'any' }, tags: ['mastery', 'onboarding'],
    action: { template: '{name}, quick check — did you finish the setup checklist in Module 3 (Claude, Console, Claude Code, GitHub, Vercel)? Nothing after Module 3 works without it. If anything is stuck, send a screenshot here.' } },
  { name: 'Mastery: Builder badge', trigger: { type: 'mastery_event', event: 'badge_earned', badge: 'Builder', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'milestone'],
    action: { template: '🏅 Builder badge, {name}! You have a website on GitHub — most people never get here. Phase 2 turns it into an agent. Post a screenshot in the group.' } },
  { name: 'Mastery: Agent Engineer badge', trigger: { type: 'mastery_event', event: 'badge_earned', badge: 'Agent Engineer', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'milestone'],
    action: { template: '🏅 Agent Engineer, {name}! Your agent acts, remembers and connects to real tools. Send me the demo — I want to see it.' } },
  { name: 'Mastery: Production-Ready badge', trigger: { type: 'mastery_event', event: 'badge_earned', badge: 'Production-Ready', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'milestone'],
    action: { template: '🏅 It\'s live, {name}! Send the URL to three people today and tell me what they said.' } },
  { name: 'Mastery: Seller badge', trigger: { type: 'mastery_event', event: 'badge_earned', badge: 'AI Solutions Seller', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'milestone'],
    action: { template: '🏅 AI Solutions Seller, {name}. You have a proposal — send it to the business you wrote it for, and tell the group what happens. Capstone next.' } },
  { name: 'Mastery: Capstone received', trigger: { type: 'mastery_event', event: 'capstone_submitted', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'capstone'],
    action: { template: 'Got your capstone, {name} — the DSP team will review it within a few days. If anything needs fixing you\'ll get specific notes and can resubmit any time.' } },
  { name: 'Mastery: Certificate issued', trigger: { type: 'mastery_event', event: 'capstone_approved', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 'certificate'],
    action: { template: '🎉 Approved, {name}! Your DSP AI Agent Mastery certificate is issued — the verification link is in your dashboard. Add it to LinkedIn and tag DSP. One ask: a 60-second video about your experience?' } },
  { name: 'Mastery: Inactive 7 days', trigger: { type: 'mastery_event', event: 'inactive', delay: 0, unit: 'minutes' }, condition: { stage: 'any' }, tags: ['mastery', 're-engagement'],
    action: { template: '{name}, your progress is saved — lifetime access means no pressure. But the students who finish are the ones who come back in week two. What got in the way? Reply here, I read these.' } },
];

const ensureDefaults = async (tenantId) => {
  const count = await prisma.automationRule.count({ where: { tenantId } });
  if (count > 0) return;
  await prisma.automationRule.createMany({
    data: DEFAULT_RULES.map((r) => ({ ...r, tenantId, enabled: false })),
  });
};

// Idempotent: adds any Mastery rule (by name) the DSP tenant doesn't have yet.
// Called from listRules so the rules appear in /automations without a migration.
const ensureMasteryRules = async (tenantId) => {
  if (!env.MASTERY_TENANT_ID || tenantId !== env.MASTERY_TENANT_ID) return;
  const existing = await prisma.automationRule.findMany({ where: { tenantId, name: { startsWith: 'Mastery:' } }, select: { name: true } });
  const have = new Set(existing.map((r) => r.name));
  const missing = MASTERY_RULES.filter((r) => !have.has(r.name));
  if (missing.length) await prisma.automationRule.createMany({ data: missing.map((r) => ({ ...r, tenantId, enabled: false })) });
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
  const empty = () => ({ sent: 0, failed: 0, skipped: 0, active: 0, cancelled: 0, lastRunAt: null });
  const stats = {};
  for (const g of grouped) {
    const s = stats[g.ruleId] || (stats[g.ruleId] = empty());
    s[g.status.toLowerCase()] = g._count._all;
    if (!s.lastRunAt || g._max.createdAt > s.lastRunAt) s.lastRunAt = g._max.createdAt;
  }
  return rules.map((r) => {
    const s = stats[r.id] || empty();
    // ACTIVE and CANCELLED rows both delivered at least one touch, so they
    // count as reached; a sequence that ends because the lead replied is the
    // rule working, not failing.
    const attempted = s.sent + s.active + s.cancelled + s.failed;
    const reached = s.sent + s.active + s.cancelled;
    return { ...r, stats: { ...s, attempted, reached, successRate: attempted ? Math.round((reached / attempted) * 100) : null } };
  });
};

const listRules = async (tenantId) => {
  await ensureMasteryRules(tenantId);
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

module.exports = { listRules, getRule, createRule, updateRule, toggleRule, deleteRule, listRuns, ensureDefaults, ensureMasteryRules, DEFAULT_RULES, MASTERY_RULES };
