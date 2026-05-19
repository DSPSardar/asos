// src/modules/leads/leads.service.js

const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const mysql = require('mysql2/promise');
const env = require('../../config/env');

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

const listLeads = async ({ tenantId, stage, scoreLabel, assignedTo, search, fromDsp, page = 1, limit = 20 }) => {
  const where = {
    tenantId,
    ...(stage       && { stage }),
    ...(scoreLabel  && { scoreLabel }),
    ...(assignedTo  && { assignedTo }),
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

  return { pipeline, stats };
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

const createLead = async (tenantId, { contactId, campaignId, stage, dealValue, currency }) => {
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
    },
    include: { contact: { select: { name: true, phone: true } } },
  });
};

// ── Update lead stage ─────────────────────────────────────────────────

const updateStage = async (tenantId, leadId, stage, userId, lostReason) => {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404, expose: true });

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      stage,
      ...(stage === 'CLOSED_WON'  && { closedAt: new Date() }),
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

const normalizePhone = (value = '') => {
  if (!value) return '';
  if (value.startsWith('+')) return `+${value.slice(1).replace(/\D/g, '')}`;
  return value.replace(/\D/g, '');
};

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

  // Delete in dependency order (child rows first)
  await prisma.$transaction([
    prisma.message.deleteMany({
      where: { conversation: { leadId, tenantId } },
    }),
    prisma.aiAgentLog.deleteMany({
      where: { conversation: { leadId, tenantId } },
    }),
    prisma.activity.deleteMany({ where: { leadId, tenantId } }),
    prisma.adsTracking.deleteMany({ where: { leadId, tenantId } }),
    prisma.conversation.deleteMany({ where: { leadId, tenantId } }),
    prisma.lead.delete({ where: { id: leadId } }),
  ]);

  logger.info({ leadId, tenantId }, '🗑 Lead deleted');
  return { deleted: true };
};

module.exports = { listLeads, getPipeline, getLead, createLead, updateStage, assignLead, addNote, updateDealValue, getHotLeads, getHandoffQueue, syncFromDsp, sendDailyHotLeadDigest, deleteLead };
