// src/modules/campaigns/campaigns.service.js

const prisma = require('../../config/database');
const axios = require('axios');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const listCampaigns = async (tenantId) => {
  return prisma.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { leads: true } } },
  });
};

const getCampaign = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: {
      leads: {
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { contact: { select: { name: true, phone: true } } },
        select: { id: true, stage: true, scoreLabel: true, aiScore: true, dealValue: true, createdAt: true, contact: true },
      },
      _count: { select: { leads: true } },
    },
  });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  return campaign;
};

const createCampaign = async (tenantId, data) => {
  return prisma.campaign.create({
    data: { tenantId, ...data },
  });
};

const updateCampaign = async (tenantId, campaignId, data) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  return prisma.campaign.update({ where: { id: campaignId }, data });
};

// Sync Meta Ads metrics (impressions, clicks, spend)
const syncMetaData = async (tenantId, campaignId) => {
  const [campaign, tenant] = await Promise.all([
    prisma.campaign.findFirst({ where: { id: campaignId, tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId } }),
  ]);

  if (!campaign || !campaign.metaCampaignId) {
    throw Object.assign(new Error('Campaign has no Meta Campaign ID'), { statusCode: 400, expose: true });
  }

  if (!tenant.metaAccessToken) {
    throw Object.assign(new Error('Meta access token not configured'), { statusCode: 400, expose: true });
  }

  try {
    const url = `${env.META_API_URL}/${env.META_API_VERSION}/${campaign.metaCampaignId}/insights`;
    const res = await axios.get(url, {
      params: {
        access_token: tenant.metaAccessToken,
        fields: 'spend,impressions,clicks,cpc,ctr,reach,actions,action_values,conversions',
        date_preset: 'maximum',
      },
      timeout: 10000,
    });

    const data = res.data?.data?.[0];
    if (!data) throw new Error('No insights data returned from Meta');

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        spend:       parseFloat(data.spend || 0),
        impressions: parseInt(data.impressions || 0),
        clicks:      parseInt(data.clicks || 0),
        ctr:         parseFloat(data.ctr || 0),
        cpm:         parseFloat(data.cpm || 0),
        cpl:         parseFloat(data.cpc || 0),
        conversions: parseInt(data.conversions || 0),
      },
    });

    logger.info({ campaignId, spend: updated.spend, impressions: updated.impressions }, 'Meta campaign synced');
    return updated;

  } catch (err) {
    logger.error({ err: err.message, campaignId }, 'Failed to sync Meta campaign data');
    throw Object.assign(new Error('Failed to fetch Meta Ads data'), { statusCode: 502, expose: true });
  }
};

// ROI report for a campaign
const getCampaignROI = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });

  const leads = await prisma.lead.findMany({
    where: { tenantId, campaignId },
    select: { stage: true, dealValue: true, aiScore: true, scoreLabel: true },
  });

  const closedWon   = leads.filter(l => l.stage === 'CLOSED_WON');
  const totalRevenue = closedWon.reduce((sum, l) => sum + parseFloat(l.dealValue || 0), 0);
  const totalSpend   = parseFloat(campaign.spend || 0);
  const roas         = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : null;
  const cpl          = leads.length > 0 && totalSpend > 0 ? (totalSpend / leads.length).toFixed(2) : null;

  return {
    campaign: { id: campaign.id, name: campaign.name, spend: totalSpend, impressions: campaign.impressions, clicks: campaign.clicks },
    leads:    { total: leads.length, hot: leads.filter(l => l.scoreLabel === 'HOT').length, warm: leads.filter(l => l.scoreLabel === 'WARM').length, cold: leads.filter(l => l.scoreLabel === 'COLD').length },
    revenue:  { closedWon: closedWon.length, totalRevenue, roas, cpl },
  };
};

const underperforming = async (tenantId) => {
  const campaigns = await prisma.campaign.findMany({ where: { tenantId } });
  return campaigns
    .filter((c) => Number(c.ctr || 0) < 1 || Number(c.cpl || 0) > 1000)
    .map((c) => ({ id: c.id, name: c.name, reasons: [Number(c.ctr || 0) < 1 ? 'low_ctr' : null, Number(c.cpl || 0) > 1000 ? 'high_cpl' : null].filter(Boolean) }));
};

const recommendations = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  const claudeService = require('../../services/claude.service');
  const out = await claudeService.runCloser({
    aiConfig,
    lead: { id: 'campaign', stage: 'DIAGNOSED' },
    contact: { name: 'Marketer' },
    messageHistory: [],
    newMessage: `Suggest campaign optimization for ${campaign.name} with metrics CTR:${campaign.ctr}, CPM:${campaign.cpm}, CPL:${campaign.cpl}, conversions:${campaign.conversions}`,
    qualifierOutput: { lead_status: 'WARM', score: 7, intent: 'medium', problem_summary: 'campaign optimization', next_action: 'continue_qualifying' },
  });
  return { recommendation: out.reply_message };
};

module.exports = { listCampaigns, getCampaign, createCampaign, updateCampaign, syncMetaData, getCampaignROI, underperforming, recommendations };
