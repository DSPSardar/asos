// src/modules/leads/leads.service.js

const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const mysql = require('mysql2/promise');
const env = require('../../config/env');

// ── List leads with filters + pagination ──────────────────────────────

const listLeads = async ({ tenantId, stage, scoreLabel, assignedTo, search, page = 1, limit = 20 }) => {
  const where = {
    tenantId,
    ...(stage       && { stage }),
    ...(scoreLabel  && { scoreLabel }),
    ...(assignedTo  && { assignedTo }),
    ...(search && {
      contact: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    }),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ aiScore: 'desc' }, { createdAt: 'desc' }],
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true, tags: true } },
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

const getPipeline = async (tenantId) => {
  const stages = ['NEW', 'QUALIFYING', 'DIAGNOSED', 'PROPOSED', 'CLOSED_WON', 'CLOSED_LOST'];

  const leads = await prisma.lead.findMany({
    where: { tenantId, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
    include: {
      contact: { select: { name: true, phone: true } },
      agent:   { select: { fullName: true } },
    },
    orderBy: { aiScore: 'desc' },
  });

  const pipeline = {};
  stages.forEach(stage => { pipeline[stage] = []; });
  leads.forEach(lead => { pipeline[lead.stage]?.push(lead); });

  const stats = await prisma.lead.groupBy({
    by: ['stage'],
    where: { tenantId },
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
      status: 'NEEDS_HUMAN',
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

const syncFromDsp = async (tenantId, requestingUserId) => {
  if (!env.DSP_DB_USER || !env.DSP_DB_PASSWORD) {
    throw Object.assign(
      new Error('DSP DB credentials are not configured'),
      { statusCode: 400, expose: true },
    );
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: env.DSP_DB_HOST,
      port: Number(env.DSP_DB_PORT),
      user: env.DSP_DB_USER,
      password: env.DSP_DB_PASSWORD,
      database: env.DSP_DB_NAME,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect DSP MySQL database');
    throw Object.assign(new Error('Unable to connect DSP CRM database'), { statusCode: 502, expose: true });
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
  } finally {
    await connection.end();
  }
};

module.exports = { listLeads, getPipeline, getLead, createLead, updateStage, assignLead, addNote, updateDealValue, getHotLeads, getHandoffQueue, syncFromDsp };
