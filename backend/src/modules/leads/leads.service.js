// src/modules/leads/leads.service.js

const prisma = require('../../config/database');
const masteryService = require('../../services/mastery.service');
const sheetsSyncService = require('../../services/sheetsSync.service');
const realtimeService = require('../../services/realtime.service');
const { resolveCurrency } = require('../../utils/currency');
const { ENROLMENT_FEE_PKR } = require('../../config/constants');
const logger = require('../../utils/logger');
const env = require('../../config/env');
const whatsappService = require('../../services/whatsapp.service');

// ── List leads with filters + pagination ──────────────────────────────

const contactClause = (fromDsp, search) => {
  const parts = [];
  if (fromDsp) {
    parts.push({
      customFields: { path: ['source'], equals: 'DSP_CRM' },
    });
  }
  if (search) {
    parts.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (parts.length === 0) return {};
  if (parts.length === 1) return { contact: parts[0] };
  return { contact: { AND: parts } };
};

const listLeads = async ({ tenantId, stage, scoreLabel, assignedTo, search, fromDsp, businessUnit, enrolledOnly, createdSince, page = 1, limit = 20 }) => {
  // createdSince: ISO date string. Lets the client filter by recency on the
  // server instead of slicing an already-paginated page, which used to make
  // "last 24h" / "last 7d" search only the rows that happened to be loaded.
  const createdSinceDate = createdSince ? new Date(createdSince) : null;
  const validCreatedSince = createdSinceDate && !Number.isNaN(createdSinceDate.getTime())
    ? createdSinceDate
    : null;

  const where = {
    tenantId,
    ...(stage       && { stage }),
    ...(scoreLabel  && { scoreLabel }),
    ...(assignedTo  && { assignedTo }),
    ...(businessUnit && { businessUnit }),
    ...(validCreatedSince && { createdAt: { gte: validCreatedSince } }),
    // An enrolled student is one with a recorded fee. CLOSED_WON alone is not
    // enrollment — the AI marks conversations won on its own, so that stage
    // also holds bot-closed leads and internal test threads. Counting those as
    // students inflated the roster by 143.
    ...(enrolledOnly && { dealValue: { not: null } }),
    ...contactClause(fromDsp, search),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      // Newest first. Sorting by aiScore first buried every new lead: an
      // unscored arrival sits at 0, so in a 265-card NEW column it landed
      // below everything the Qualifier had already scored — the pipeline
      // looked frozen a month in the past even as leads poured in. Score is
      // still the tiebreaker within a day, and getHotLeads / AI Insights keep
      // their own score ordering for the "who do I call" lists.
      orderBy: [{ createdAt: 'desc' }, { aiScore: 'desc' }],
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true, tags: true, customFields: true } },
        agent:   { select: { id: true, fullName: true, email: true } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { conversations: true, activities: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, total };
};

// ── Get pipeline (Kanban grouped by stage) ────────────────────────────

const getPipeline = async (tenantId, { fromDsp } = {}) => {
  const stages = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED', 'CLOSED_WON', 'CLOSED_LOST'];

  const openWhere = {
    tenantId,
    stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    ...(fromDsp && {
      contact: { customFields: { path: ['source'], equals: 'DSP_CRM' } },
    }),
  };

  const leads = await prisma.lead.findMany({
    where: openWhere,
    include: {
      contact: { select: { name: true, phone: true, customFields: true } },
      agent:   { select: { fullName: true } },
    },
    orderBy: { aiScore: 'desc' },
  });

  const pipeline = {};
  stages.forEach(stage => { pipeline[stage] = []; });
  leads.forEach(lead => { pipeline[lead.stage]?.push(lead); });

  const statsWhere = {
    tenantId,
    ...(fromDsp && {
      contact: { customFields: { path: ['source'], equals: 'DSP_CRM' } },
    }),
  };

  const stats = await prisma.lead.groupBy({
    by: ['stage'],
    where: statsWhere,
    _count: { id: true },
    _sum: { dealValue: true },
  });

  // Enrolled students, reported separately from the CLOSED_WON stage count.
  // The stage count is correct as "deals won" — it just isn't the student
  // roster, because the AI marks conversations won without a fee ever being
  // recorded.
  const enrolled = await prisma.lead.count({
    where: { ...statsWhere, stage: 'CLOSED_WON', dealValue: { not: null } },
  });

  return { pipeline, stats, enrolled };
};

// ── Get single lead with full detail ─────────────────────────────────

const getLead = async (tenantId, leadId) => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      contact:    { select: { id: true, name: true, phone: true, email: true, tags: true, customFields: true } },
      agent:      { select: { id: true, fullName: true, email: true } },
      campaign:   { select: { id: true, name: true, metaCampaignId: true } },
      adsTracking: true,
      conversations: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, aiEnabled: true, lastMessageAt: true, _count: { select: { messages: true } } },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });
  return lead;
};

// ── Create lead manually ──────────────────────────────────────────────

const VALID_BUSINESS_UNITS = ['DSP', 'SDC', 'UNKNOWN'];

const createLead = async (tenantId, { contactId, campaignId, stage, dealValue, currency, businessUnit }) => {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) throw Object.assign(new Error('Contact not found'), { statusCode: 404, expose: true });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });

  sheetsSyncService.scheduleSync(tenantId);

  const created = await prisma.lead.create({
    data: {
      tenantId,
      contactId,
      campaignId: campaignId || null,
      stage: stage || 'NEW',
      dealValue: dealValue || null,
      currency: resolveCurrency({ explicit: currency, tenant }),
      // Manually-created leads (e.g. marketing DM handoff) can declare their business unit;
      // otherwise the schema default (UNKNOWN) applies and the Qualifier AI classifies later.
      ...(VALID_BUSINESS_UNITS.includes(businessUnit) && { businessUnit }),
    },
    include: { contact: { select: { name: true, phone: true } } },
  });

  // A creation is as much a pipeline change as a stage move — tell open tabs,
  // otherwise the board sits stale until someone reloads the page.
  await realtimeService.broadcastLeadsRefresh(tenantId);
  await realtimeService.broadcastDashboardUpdate(tenantId);

  return created;
};

// ── Update lead stage ─────────────────────────────────────────────────

const updateStage = async (tenantId, leadId, stage, userId, lostReason, { fee, currency } = {}) => {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  // Won means PAID — same rule as confirmPayment. A manual drag to CLOSED_WON
  // must carry a fee (or the lead must already have one), otherwise unpaid
  // "wins" creep back into the funnel and enrollment counts.
  let feeData = {};
  if (stage === 'CLOSED_WON') {
    let amount = fee != null && !Number.isNaN(parseFloat(fee))
      ? parseFloat(fee)
      : (lead.dealValue != null ? parseFloat(lead.dealValue)
        : (lead.enrollmentFee != null ? parseFloat(lead.enrollmentFee) : null));
    if (amount == null || amount <= 0) {
      throw Object.assign(new Error('Enrollment fee is required to mark a lead as Won'),
        { statusCode: 422, expose: true });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    let cur = resolveCurrency({ explicit: currency, existing: lead.currency, tenant });
    // A USD sale is recorded as the PKR list price at the point of sale — USD
    // is never stored on a lead.
    if (cur === 'USD') { amount = ENROLMENT_FEE_PKR; cur = 'PKR'; }
    // Since the bootcamp sunset, Mastery is the only product and its fee is
    // fixed: a lead may only reach CLOSED_WON at exactly PKR 28,000. Any
    // other amount is rejected here, so the lead stays at its current stage
    // (Proposed) for a human to sort out.
    if (cur !== 'PKR' || amount !== ENROLMENT_FEE_PKR) {
      throw Object.assign(
        new Error(`Enrollment fee must be exactly PKR ${ENROLMENT_FEE_PKR} — got ${cur} ${amount}. The lead stays at its current stage.`),
        { statusCode: 422, expose: true });
    }
    feeData = { enrollmentFee: amount, dealValue: amount, currency: cur };
  }

  // ATOMIC TRANSACTION: All or nothing
  const updated = await prisma.$transaction(async (tx) => {
    const updatedLead = await tx.lead.update({
      where: { id: leadId },
      data: {
        stage,
        ...(stage === 'CLOSED_WON'  && { closedAt: new Date(), ...feeData }),
        ...(stage === 'CLOSED_LOST' && { closedAt: new Date(), lostReason }),
      },
    });

    await tx.activity.create({
      data: {
        tenantId,
        leadId,
        userId: userId || null,
        type: 'STAGE_CHANGE',
        content: `Stage updated from ${lead.stage} → ${stage}`,
        metadata: { fromStage: lead.stage, toStage: stage, lostReason },
      },
    });

    if (lead.stage !== stage) {
      await tx.leadStageHistory.create({
        data: { tenantId, leadId, fromStage: lead.stage, toStage: stage, changedBy: userId || null },
      }).catch(() => {}); // history is telemetry, never blocks the update
    }

    return updatedLead;
  });

  // After transaction commits, broadcast and trigger side effects
  await realtimeService.broadcastLeadStageChange(tenantId, leadId, lead.stage, stage);
  await realtimeService.broadcastLeadsRefresh(tenantId);

  // Paid Mastery lead → create their course account (never blocks the stage change).
  if (stage === 'CLOSED_WON') masteryService.enrolIfMasteryAsync({ tenantId, leadId, userId: userId || null });

  sheetsSyncService.scheduleSync(tenantId);

  return updated;
};

// ── Assign lead to agent ──────────────────────────────────────────────

const assignLead = async (tenantId, leadId, agentId, requestingUserId) => {
  const agent = await prisma.user.findFirst({ where: { id: agentId, tenantId, isActive: true }, select: { id: true, fullName: true } });
  if (!agent) throw Object.assign(new Error('Agent not found'), { statusCode: 404, expose: true });

  // The agent check above scopes the assignee, not the lead — the lead id
  // comes straight from req.params and needs its own tenant check.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  // ATOMIC TRANSACTION
  const updated = await prisma.$transaction(async (tx) => {
    const assignedLead = await tx.lead.update({
      where: { id: leadId },
      data: { assignedTo: agentId },
    });

    await tx.activity.create({
      data: {
        tenantId,
        leadId,
        userId: requestingUserId,
        type: 'SYSTEM',
        content: `Lead assigned to ${agent.fullName}`,
        metadata: { assignedTo: agentId, agentName: agent.fullName },
      },
    });

    return assignedLead;
  });

  // Broadcast the change
  await realtimeService.broadcastLeadUpdate(tenantId, updated);

  return updated;
};

// ── Add note to lead ──────────────────────────────────────────────────

const addNote = async (tenantId, leadId, userId, content) => {
  // RLS can't catch a wrong leadId here — the Activity row itself carries the
  // caller's tenantId, so WITH CHECK passes even if leadId belongs elsewhere.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  // ATOMIC TRANSACTION
  const activity = await prisma.$transaction(async (tx) => {
    return await tx.activity.create({
      data: {
        tenantId,
        leadId,
        userId,
        type: 'NOTE',
        content,
        metadata: {},
      },
      include: { user: { select: { fullName: true } } },
    });
  });

  // Broadcast note added
  await realtimeService.broadcast(tenantId, 'lead:note-added', { leadId, activity });

  return activity;
};

// ── Update deal value ─────────────────────────────────────────────────

const updateDealValue = async (tenantId, leadId, dealValue, currency) => {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  // ATOMIC TRANSACTION
  const updated = await prisma.$transaction(async (tx) => {
    return await tx.lead.update({
      where: { id: leadId },
      data: { dealValue, currency },
    });
  });

  // Broadcast the change
  await realtimeService.broadcastLeadUpdate(tenantId, updated);

  return updated;
};

// ── HOT leads feed (newest first, last 24h) ───────────────────────────

const getHotLeads = async (tenantId, limit = 20) => {
  return prisma.lead.findMany({
    where: {
      tenantId,
      scoreLabel: 'HOT',
      stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      contact:  { select: { id: true, name: true, phone: true, email: true } },
      agent:    { select: { id: true, fullName: true } },
      campaign: { select: { id: true, name: true } },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, content: true, createdAt: true, metadata: true },
      },
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          aiEnabled: true,
          lastMessageAt: true,
          // The customer's own last words, plus the Qualifier's reading of
          // them. AI Insights was showing lead.activities[0] instead — the
          // system audit log — so every "buying signal" quoted one of our own
          // lines back at us: "Agent sent message…", "Conversation handed back
          // to AI". A buying signal is what the buyer said.
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { content: true, sentiment: true, signalType: true, sentAt: true },
          },
        },
      },
    },
  });
};

// ── Handoff queue (AI flagged → needs human) ──────────────────────────

const getHandoffQueue = async (tenantId) => {
  const convs = await prisma.conversation.findMany({
    where: {
      tenantId,
      OR: [
        { status: 'HUMAN_TAKEOVER' },
        { lead: { humanFollowupRequired: true, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } },
      ],
    },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      lead: {
        include: {
          contact:  { select: { id: true, name: true, phone: true } },
          agent:    { select: { id: true, fullName: true } },
          campaign: { select: { id: true, name: true } },
        },
      },
    },
  });
  return convs;
};

// Canonical phone form across the whole system is digits-only, because that
// is what the WhatsApp pipeline writes when it creates a contact from an
// inbound message. This used to preserve a leading '+', which meant any
// contact created here (DSP CRM sync, student import) could never match the
// same person's existing WhatsApp contact — it silently made a second one.
// Delegates to the WhatsApp service so there is exactly one definition.
const normalizePhone = (value = '') => whatsappService.normalizePhone(String(value || ''));

const pickContactName = (name, email, phone) => {
  if (name && name.trim()) return name.trim();
  if (email && email.trim()) return email.trim();
  if (phone && phone.trim()) return phone.trim();
  return 'DSP CRM Contact';
};

// ── DSP enrolment sync ────────────────────────────────────────────────
//
// This used to read a `users` table out of a local MariaDB (dsp_crm on
// host.docker.internal). That database was a development fixture — it never
// existed in production, so the button returned 400 on every click and no lead
// ever arrived through it.
//
// The real source is the DSP site's Supabase Postgres (project dsp-mastery).
// mastery_enrol_requests is the table that matters: everyone who submitted the
// PKR enrolment form, with name, email, phone and country. It is the only DSP
// table carrying phone numbers, and phone is what ASOS keys a contact on —
// mastery_profiles has no phone column, so it cannot produce a lead at all.
//
// Reads go over Supabase's REST endpoint rather than opening a second Postgres
// pool: same database, one less connection to hold, and no extra dependency.
const DSP_ENROL_TABLE = 'mastery_enrol_requests';
const DSP_ENROL_COLUMNS = 'full_name,email,phone,country,status,created_at';

const dspConfigured = () => Boolean(env.DSP_SUPABASE_URL && env.DSP_SUPABASE_SERVICE_KEY);

const fetchDspEnrolRequests = async () => {
  const base = String(env.DSP_SUPABASE_URL).replace(/\/+$/, '');
  const url = `${base}/rest/v1/${DSP_ENROL_TABLE}?select=${DSP_ENROL_COLUMNS}&order=created_at.asc`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        apikey: env.DSP_SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.DSP_SUPABASE_SERVICE_KEY}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    logger.error({ err: error }, 'DSP enrolment fetch failed');
    throw Object.assign(
      new Error(`Unable to reach the DSP database (${error.message}) — check DSP_SUPABASE_URL.`),
      { statusCode: 502, expose: true },
    );
  }

  // Deliberately specific: the three failures worth telling an admin apart are
  // a wrong key, a missing table, and everything else.
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(
      new Error('DSP database rejected the key — DSP_SUPABASE_SERVICE_KEY must be the service_role key, not the anon key.'),
      { statusCode: 502, expose: true },
    );
  }
  if (res.status === 404) {
    throw Object.assign(
      new Error(`DSP database has no ${DSP_ENROL_TABLE} table — run supabase/mastery-enrol-requests.sql on the dsp-mastery project.`),
      { statusCode: 502, expose: true },
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`DSP database read failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`),
      { statusCode: 502, expose: true },
    );
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
};

/**
 * Pulls DSP enrolment requests into the pipeline as leads.
 *
 * dryRun reports exactly what a real run would do and writes nothing — worth
 * using before the first live sync, because creating leads can trip the
 * tenant's automation rules and message real people.
 */
const syncFromDsp = async (tenantId, requestingUserId, { dryRun = false } = {}) => {
  if (!dspConfigured()) {
    throw Object.assign(
      new Error('DSP database is not configured — set DSP_SUPABASE_URL and DSP_SUPABASE_SERVICE_KEY.'),
      { statusCode: 400, expose: true },
    );
  }

  const rows = await fetchDspEnrolRequests();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const currency = resolveCurrency({ tenant });

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;
  const sample = [];

  for (const row of rows) {
    const phone = normalizePhone(row.phone || '');
    const email = row.email?.trim() || null;
    const name = pickContactName(row.full_name, email, phone);

    if (!phone) {
      invalid += 1;
      continue;
    }

    const existingContact = await prisma.contact.findFirst({
      where: {
        tenantId,
        OR: [
          { phone },
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (existingContact) {
      skipped += 1;
      continue;
    }

    // Counted as an insert either way, so a dry run's numbers match the real
    // run's — the only difference is whether the rows are written.
    inserted += 1;
    if (sample.length < 20) sample.push({ name, phone, email, status: row.status || null });
    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          tenantId,
          name,
          email,
          phone,
          optIn: true,
          customFields: {
            source: 'DSP_ENROL',
            dspEnrolStatus: row.status || null,
            dspCountry: row.country || null,
          },
        },
      });

      const lead = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          stage: 'NEW',
          scoreLabel: 'COLD',
          aiScore: 0,
          currency,
          // These come off the Mastery enrolment form, so the product is known
          // up front and the Qualifier does not have to guess it.
          product: 'MASTERY',
        },
      });

      await tx.activity.create({
        data: {
          tenantId,
          leadId: lead.id,
          userId: requestingUserId || null,
          type: 'SYSTEM',
          content: 'Lead imported from DSP enrolment requests',
          metadata: {
            source: 'DSP_ENROL',
            enrolStatus: row.status || null,
            requestedAt: row.created_at || null,
          },
        },
      });
    });
  }

  if (!dryRun && inserted > 0) {
    await realtimeService.broadcastLeadsRefresh(tenantId);
    await realtimeService.broadcastDashboardUpdate(tenantId);
  }

  logger.info({ tenantId, dryRun, totalFetched: rows.length, inserted, skipped, invalid }, 'DSP enrolment sync finished');

  return {
    dryRun,
    totalFetched: rows.length,
    inserted,
    skipped,
    invalid,
    sample,
  };
};

const sendDailyHotLeadDigest = async (tenantId) => {
  const hot = await getHotLeads(tenantId, 20);
  const agents = await prisma.user.findMany({ where: { tenantId, isActive: true, role: { in: ['AGENT', 'TENANT_ADMIN'] } } });
  return { sentTo: agents.length, hotLeads: hot.length };
};

// ── Delete a lead and all its related data ────────────────────────────
const deleteLead = async (tenantId, leadId) => {
  // Verify ownership before deleting
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });

  // Use interactive transaction so we can resolve conversationIds first.
  // Array-form $transaction does NOT support nested relation filters in deleteMany.
  await prisma.$transaction(async (tx) => {
    // Step 1 — collect conversation IDs for this lead
    const convs = await tx.conversation.findMany({
      where: { leadId, tenantId },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);

    // Step 2 — delete children of conversations
    if (convIds.length > 0) {
      await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await tx.aiAgentLog.deleteMany({ where: { conversationId: { in: convIds } } });
    }

    // Step 3 — delete direct lead children
    await tx.activity.deleteMany({ where: { leadId, tenantId } });
    await tx.adsTracking.deleteMany({ where: { leadId, tenantId } });
    await tx.conversation.deleteMany({ where: { leadId, tenantId } });

    // Step 4 — delete the lead itself
    await tx.lead.delete({ where: { id: leadId } });
  });

  logger.info({ leadId, tenantId }, '🗑 Lead deleted');
  return { deleted: true };
};


// ── Bulk student import (manual enrollments closed outside ASOS) ─────
// DSP's real sales motion: inquiry lands in ASOS/WhatsApp, but students
// call/text the team's personal numbers and pay a human. Those enrollments
// never touch the pipeline — this lets an admin upload the student list
// (CSV on the frontend) and record them as CLOSED_WON with real fees.
const importStudents = async (tenantId, students = [], requestingUserId = null) => {
  if (!Array.isArray(students) || students.length === 0) {
    throw Object.assign(new Error('No students provided'), { statusCode: 400, expose: true });
  }
  if (students.length > 500) {
    throw Object.assign(new Error('Max 500 students per import — split the file'), { statusCode: 400, expose: true });
  }

  const VALID_PHASES = ['LEARN', 'BUILD', 'EARN'];
  let created = 0;
  let updated = 0;
  let phaseChanged = 0;
  let invalid = 0;

  for (const row of students) {
    const phone = normalizePhone(row.phone);
    if (!phone) { invalid += 1; continue; }

    const name  = String(row.name || '').trim() || phone;
    const email = String(row.email || '').trim() || null;
    const fee   = Math.max(0, parseFloat(row.fee) || 0);
    const enrolledAt = row.enrolledAt && !Number.isNaN(Date.parse(row.enrolledAt))
      ? new Date(row.enrolledAt) : new Date();
    const phase = VALID_PHASES.includes(String(row.phase || '').toUpperCase())
      ? String(row.phase).toUpperCase() : 'LEARN';

    // eslint-disable-next-line no-await-in-loop
    await prisma.$transaction(async (tx) => {
      let contact = await tx.contact.findFirst({
        where: { tenantId, OR: [{ phone }, ...(email ? [{ email }] : [])] },
        select: { id: true },
      });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            tenantId, name, email, phone, optIn: false,
            customFields: { source: 'MANUAL_IMPORT' },
          },
          select: { id: true },
        });
      }

      const existingLead = await tx.lead.findFirst({
        where: { tenantId, contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, stage: true, dspPhase: true },
      });

      if (existingLead) {
        // Only stamp dspPhaseChangedAt on a real move. Re-importing the same
        // roster must not look like a phase change to the automation engine.
        const phaseMoved = (existingLead.dspPhase || 'LEARN') !== phase;
        await tx.lead.update({
          where: { id: existingLead.id },
          data: {
            stage: 'CLOSED_WON',
            dealValue: fee || undefined,
            currency: 'PKR',
            closedAt: enrolledAt,
            dspPhase: phase,
            ...(phaseMoved ? { dspPhaseChangedAt: new Date() } : {}),
          },
        });
        if (phaseMoved) phaseChanged += 1;
        updated += 1;
      } else {
        // A brand-new import is an initial state, not a phase change —
        // dspPhaseChangedAt stays null so bulk onboarding never fires
        // milestone automations for the whole batch.
        const lead = await tx.lead.create({
          data: {
            tenantId, contactId: contact.id,
            stage: 'CLOSED_WON', scoreLabel: 'HOT', aiScore: 100,
            dealValue: fee || undefined, currency: 'PKR',
            closedAt: enrolledAt, dspPhase: phase,
          },
          select: { id: true },
        });
        await tx.activity.create({
          data: {
            tenantId, leadId: lead.id, userId: requestingUserId,
            type: 'SYSTEM',
            content: 'Student imported — enrolled outside ASOS (direct/human sale)',
            metadata: { source: 'MANUAL_IMPORT', fee },
          },
        });
        created += 1;
      }
    });
  }

  return { received: students.length, created, updated, phaseChanged, invalid };
};

module.exports = { listLeads, getPipeline, getLead, createLead, updateStage, assignLead, addNote, updateDealValue, getHotLeads, getHandoffQueue, syncFromDsp, sendDailyHotLeadDigest, deleteLead, importStudents };
