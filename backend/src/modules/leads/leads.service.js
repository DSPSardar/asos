// src/modules/leads/leads.service.js

const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const mysql = require('mysql2/promise');
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

const listLeads = async ({ tenantId, stage, scoreLabel, assignedTo, search, fromDsp, businessUnit, enrolledOnly, page = 1, limit = 20 }) => {
  const where = {
    tenantId,
    ...(stage       && { stage }),
    ...(scoreLabel  && { scoreLabel }),
    ...(assignedTo  && { assignedTo }),
    ...(businessUnit && { businessUnit }),
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
      orderBy: [{ aiScore: 'desc' }, { createdAt: 'desc' }],
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

  return prisma.lead.create({
    data: {
      tenantId,
      contactId,
      campaignId: campaignId || null,
      stage: stage || 'NEW',
      dealValue: dealValue || null,
      currency: currency || 'BRL',
      // Manually-created leads (e.g. marketing DM handoff) can declare their business unit;
      // otherwise the schema default (UNKNOWN) applies and the Qualifier AI classifies later.
      ...(VALID_BUSINESS_UNITS.includes(businessUnit) && { businessUnit }),
    },
    include: { contact: { select: { name: true, phone: true } } },
  });
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
    const amount = fee != null && !Number.isNaN(parseFloat(fee))
      ? parseFloat(fee)
      : (lead.dealValue != null ? parseFloat(lead.dealValue)
        : (lead.enrollmentFee != null ? parseFloat(lead.enrollmentFee) : null));
    if (amount == null || amount <= 0) {
      throw Object.assign(new Error('Enrollment fee is required to mark a lead as Won'),
        { statusCode: 422, expose: true });
    }
    feeData = { enrollmentFee: amount, dealValue: amount,
                currency: currency || lead.currency || 'PKR' };
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      stage,
      ...(stage === 'CLOSED_WON'  && { closedAt: new Date(), ...feeData }),
      ...(stage === 'CLOSED_LOST' && { closedAt: new Date(), lostReason }),
    },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      leadId,
      userId: userId || null,
      type: 'STAGE_CHANGE',
      content: `Stage updated from ${lead.stage} → ${stage}`,
      metadata: { fromStage: lead.stage, toStage: stage, lostReason },
    },
  });

  return updated;
};

// ── Assign lead to agent ──────────────────────────────────────────────

const assignLead = async (tenantId, leadId, agentId, requestingUserId) => {
  const agent = await prisma.user.findFirst({ where: { id: agentId, tenantId, isActive: true } });
  if (!agent) throw Object.assign(new Error('Agent not found'), { statusCode: 404, expose: true });

  // The agent check above scopes the assignee, not the lead — the lead id
  // comes straight from req.params and needs its own tenant check.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { assignedTo: agentId },
  });

  await prisma.activity.create({
    data: {
      tenantId,
      leadId,
      userId: requestingUserId,
      type: 'SYSTEM',
      content: `Lead assigned to ${agent.fullName}`,
      metadata: { assignedTo: agentId, agentName: agent.fullName },
    },
  });

  return updated;
};

// ── Add note to lead ──────────────────────────────────────────────────

const addNote = async (tenantId, leadId, userId, content) => {
  // RLS can't catch a wrong leadId here — the Activity row itself carries the
  // caller's tenantId, so WITH CHECK passes even if leadId belongs elsewhere.
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  return prisma.activity.create({
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
};

// ── Update deal value ─────────────────────────────────────────────────

const updateDealValue = async (tenantId, leadId, dealValue, currency) => {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  return prisma.lead.update({
    where: { id: leadId },
    data: { dealValue, currency },
  });
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
        select: { id: true, status: true, aiEnabled: true, lastMessageAt: true },
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

/** Maps mysql2/network errors to a safe tenant-facing hint (does not expose secrets). */
const dspMysqlConnectHint = (error) => {
  const errno = typeof error.errno === 'number' ? error.errno : error.code;

  // mysql2 codes: ER_ACCESS_DENIED_ERROR etc.; Node: ECONNREFUSED, ETIMEDOUT …
  if (errno === 'ECONNREFUSED' || error.code === 'ECONNREFUSED') {
    return 'Unable to reach MySQL — connection refused on host/port. Confirm DSP_DB_HOST, DSP_DB_PORT and that mysqld listens (not only on 127.0.0.1).';
  }
  if (errno === 'ENOTFOUND' || error.code === 'ENOTFOUND') {
    return 'Unable to resolve MySQL host — check DSP_DB_HOST.';
  }
  if (errno === 'ETIMEDOUT' || error.code === 'ETIMEDOUT') {
    return 'Timed out reaching MySQL — firewall/security group blocking port 3306 from this server.';
  }
  if (
    errno === 1045
    || error.code === 'ER_ACCESS_DENIED_ERROR'
    || (typeof error.sqlMessage === 'string' && error.sqlMessage.includes('Access denied'))
  ) {
    return (
      'MySQL refused login — verify DSP_DB_USER and DSP_DB_PASSWORD, and that the user is granted '
      + 'from this Docker host (e.g. GRANT SELECT ON your_crm.* TO user@\'172.17.%\' IDENTIFIED BY ...).'
    );
  }
  if (errno === 1049 || error.code === 'ER_BAD_DB_ERROR') {
    return `Unknown database "${env.DSP_DB_NAME}" — set DSP_DB_NAME to the CRM schema name on MySQL.`;
  }
  if (
    errno === 'ER_CANT_CREATE'
    || (typeof error.sqlMessage === 'string'
      && (error.sqlMessage.includes('doesn\'t exist') || error.sqlMessage.includes("doesn't exist")))
  ) {
    return 'MySQL rejected the schema or privileges — verify DSP_DB_NAME and user grants.';
  }
  if (error.sqlMessage && error.code && String(error.code).startsWith('ER_')) {
    return `DSP MySQL error: ${error.sqlMessage}`;
  }
  const short = typeof error.message === 'string' ? error.message.split('\n')[0] : 'Unknown error';
  return `Unable to connect DSP CRM database (${short})`;
};

const syncFromDsp = async (tenantId, requestingUserId) => {
  if (!env.DSP_DB_USER || !env.DSP_DB_PASSWORD) {
    throw Object.assign(
      new Error('DSP DB credentials are not configured'),
      { statusCode: 400, expose: true },
    );
  }

  const dspConnectionConfig = {
    host: env.DSP_DB_HOST,
    port: Number(env.DSP_DB_PORT),
    user: env.DSP_DB_USER,
    password: env.DSP_DB_PASSWORD,
    database: env.DSP_DB_NAME,
  };

  let connection;
  try {
    connection = await mysql.createConnection(dspConnectionConfig);
  } catch (error) {
    logger.error(
      {
        err: error,
        dspHost: env.DSP_DB_HOST,
        dspPort: dspConnectionConfig.port,
        dspDb: env.DSP_DB_NAME,
        dspUser: env.DSP_DB_USER,
      },
      'Failed to connect DSP MySQL database',
    );
    const msg = dspMysqlConnectHint(error);
    throw Object.assign(new Error(msg), { statusCode: 502, expose: true });
  }

  try {
    const [rows] = await connection.execute(
      `SELECT name, email, phone_number, is_phone_verified
       FROM users`,
    );

    let inserted = 0;
    let skipped = 0;
    let invalid = 0;

    for (const row of rows) {
      const phone = normalizePhone(row.phone_number || '');
      const email = row.email?.trim() || null;
      const name = pickContactName(row.name, email, phone);

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

      await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.create({
          data: {
            tenantId,
            name,
            email,
            phone,
            optIn: Boolean(row.is_phone_verified),
            customFields: {
              source: 'DSP_CRM',
              dspPhoneVerified: Boolean(row.is_phone_verified),
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
            currency: 'PKR',
          },
        });

        await tx.activity.create({
          data: {
            tenantId,
            leadId: lead.id,
            userId: requestingUserId || null,
            type: 'SYSTEM',
            content: 'Lead imported from DSP CRM',
            metadata: {
              source: 'DSP_CRM',
              isPhoneVerified: Boolean(row.is_phone_verified),
            },
          },
        });
      });

      inserted += 1;
    }

    return {
      totalFetched: rows.length,
      inserted,
      skipped,
      invalid,
    };
  } catch (runErr) {
    logger.error({ err: runErr }, 'DSP sync query failed');
    const extra = runErr.sqlMessage || runErr.message || 'query failed';
    throw Object.assign(
      new Error(`DSP CRM read failed: ${extra}`),
      { statusCode: 502, expose: true },
    );
  } finally {
    await connection.end();
  }
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
        select: { id: true, stage: true },
      });

      if (existingLead) {
        await tx.lead.update({
          where: { id: existingLead.id },
          data: {
            stage: 'CLOSED_WON',
            dealValue: fee || undefined,
            currency: 'PKR',
            closedAt: enrolledAt,
            dspPhase: phase,
          },
        });
        updated += 1;
      } else {
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

  return { received: students.length, created, updated, invalid };
};

module.exports = { listLeads, getPipeline, getLead, createLead, updateStage, assignLead, addNote, updateDealValue, getHotLeads, getHandoffQueue, syncFromDsp, sendDailyHotLeadDigest, deleteLead, importStudents };
