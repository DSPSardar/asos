// src/modules/campaigns/campaigns.service.js

const prisma  = require('../../config/database');
const logger  = require('../../utils/logger');
const { decrypt } = require('../../utils/crypto');

const META_GRAPH = 'https://graph.facebook.com/v21.0';

// ── Meta API helper ────────────────────────────────────────────
const metaPost = async (token, endpoint, params) => {
  const res  = await fetch(`${META_GRAPH}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...params, access_token: token }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error.message || 'Meta API error';
    logger.warn({ endpoint, code: json.error.code, msg }, 'Meta API error');
    throw Object.assign(new Error(msg), { statusCode: 400, expose: true, metaCode: json.error.code });
  }
  return json;
};

const metaGet = async (token, endpoint, params = {}) => {
  const qs  = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(`${META_GRAPH}/${endpoint}?${qs}`);
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { statusCode: 502, expose: true });
  return json;
};

// objective → Meta optimization_goal + billing_event
const OBJECTIVE_MAP = {
  OUTCOME_LEADS:     { optimization_goal: 'LEAD_GENERATION',     billing_event: 'IMPRESSIONS' },
  OUTCOME_TRAFFIC:   { optimization_goal: 'LINK_CLICKS',         billing_event: 'LINK_CLICKS' },
  OUTCOME_AWARENESS: { optimization_goal: 'REACH',               billing_event: 'IMPRESSIONS' },
  OUTCOME_SALES:     { optimization_goal: 'OFFSITE_CONVERSIONS',  billing_event: 'IMPRESSIONS' },
};

// ── Helpers ────────────────────────────────────────────────────
const loadTenantMeta = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { metaAccessToken: true, metaAdAccountId: true },
  });
  if (!tenant?.metaAccessToken)  throw Object.assign(new Error('Meta access token not configured — go to Settings → Meta Ads'), { statusCode: 400, expose: true });
  if (!tenant?.metaAdAccountId)  throw Object.assign(new Error('Meta Ad Account ID not configured — go to Settings → Meta Ads'), { statusCode: 400, expose: true });
  const token  = decrypt(tenant.metaAccessToken);
  const acctId = tenant.metaAdAccountId.startsWith('act_') ? tenant.metaAdAccountId : `act_${tenant.metaAdAccountId}`;
  return { token, acctId };
};

// ── List campaigns ─────────────────────────────────────────────
const listCampaigns = async (tenantId) =>
  prisma.campaign.findMany({
    where:   { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { leads: true } } },
  });

// ── Get single campaign ────────────────────────────────────────
const getCampaign = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({
    where:   { id: campaignId, tenantId },
    include: {
      leads: {
        take:    20,
        orderBy: { createdAt: 'desc' },
        include: { contact: { select: { name: true, phone: true } } },
        select:  { id: true, stage: true, scoreLabel: true, aiScore: true, dealValue: true, createdAt: true, contact: true },
      },
      _count: { select: { leads: true } },
    },
  });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  return campaign;
};

// ── Create local campaign (no Meta push) ──────────────────────
const createCampaign = async (tenantId, data) =>
  prisma.campaign.create({ data: { tenantId, ...data } });

// ── Update local campaign ──────────────────────────────────────
const updateCampaign = async (tenantId, campaignId, data) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  return prisma.campaign.update({ where: { id: campaignId }, data });
};

// ── Delete campaign ────────────────────────────────────────────
const deleteCampaign = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  await prisma.campaign.delete({ where: { id: campaignId } });
  return { deleted: true, id: campaignId };
};

// ── Launch campaign on Meta (full flow) ───────────────────────
const launchCampaign = async (tenantId, data) => {
  const {
    name,
    objective   = 'OUTCOME_LEADS',
    dailyBudget = 500,
    pageId,
    headline,
    body,
    imageUrl,
    linkUrl,
    ctaType     = 'LEARN_MORE',
    ageMin      = 25,
    ageMax      = 65,
    countries   = ['PK'],
    startDate,
    endDate,
  } = data;

  if (!pageId)   throw Object.assign(new Error('Facebook Page ID is required'), { statusCode: 400, expose: true });
  if (!headline) throw Object.assign(new Error('Ad headline is required'),      { statusCode: 400, expose: true });
  if (!body)     throw Object.assign(new Error('Ad copy body is required'),     { statusCode: 400, expose: true });
  if (!linkUrl)  throw Object.assign(new Error('Destination URL is required'),  { statusCode: 400, expose: true });

  const { token, acctId } = await loadTenantMeta(tenantId);
  const objMap = OBJECTIVE_MAP[objective] || OBJECTIVE_MAP.OUTCOME_LEADS;

  // 1. Campaign
  const metaCampaign = await metaPost(token, `${acctId}/campaigns`, {
    name,
    objective,
    status:                 'PAUSED',
    special_ad_categories:  [],
  });
  logger.info({ tenantId, metaCampaignId: metaCampaign.id }, 'Meta campaign created');

  // 2. Ad Set
  const adsetPayload = {
    name:               `${name} — Ad Set`,
    campaign_id:        metaCampaign.id,
    daily_budget:       String(Math.round(Number(dailyBudget))),
    billing_event:      objMap.billing_event,
    optimization_goal:  objMap.optimization_goal,
    targeting: {
      geo_locations: { countries },
      age_min: ageMin,
      age_max: ageMax,
    },
    status: 'PAUSED',
  };
  if (startDate) adsetPayload.start_time = new Date(startDate).toISOString();
  if (endDate)   adsetPayload.end_time   = new Date(endDate).toISOString();

  const metaAdset = await metaPost(token, `${acctId}/adsets`, adsetPayload);
  logger.info({ tenantId, metaAdsetId: metaAdset.id }, 'Meta ad set created');

  // 3. Ad Creative
  const linkData = {
    message:         body,
    link:            linkUrl,
    name:            headline,
    call_to_action:  { type: ctaType },
  };
  if (imageUrl && imageUrl.trim()) linkData.picture = imageUrl.trim();

  const metaCreative = await metaPost(token, `${acctId}/adcreatives`, {
    name:               `${name} — Creative`,
    object_story_spec: {
      page_id:   pageId,
      link_data: linkData,
    },
  });
  logger.info({ tenantId, metaCreativeId: metaCreative.id }, 'Meta ad creative created');

  // 4. Ad
  const metaAd = await metaPost(token, `${acctId}/ads`, {
    name:     `${name} — Ad`,
    adset_id: metaAdset.id,
    creative: { creative_id: metaCreative.id },
    status:   'PAUSED',
  });
  logger.info({ tenantId, metaAdId: metaAd.id }, 'Meta ad created — all PAUSED, activate in Ads Manager');

  // 5. Save to DB
  const saved = await prisma.campaign.create({
    data: {
      tenantId,
      name,
      metaCampaignId: metaCampaign.id,
      metaAdsetId:    metaAdset.id,
      metaAdId:       metaAd.id,
      budget:         dailyBudget,
      status:         'PAUSED',
      startedAt:      startDate ? new Date(startDate) : new Date(),
      ...(endDate ? { endedAt: new Date(endDate) } : {}),
    },
  });

  const acctNum = acctId.replace('act_', '');
  return {
    campaign:   saved,
    meta: {
      campaignId: metaCampaign.id,
      adsetId:    metaAdset.id,
      creativeId: metaCreative.id,
      adId:       metaAd.id,
      managerUrl: `https://www.facebook.com/adsmanager/manage/campaigns?act=${acctNum}&selected_campaign_ids=${metaCampaign.id}`,
    },
    message: 'Campaign created on Meta as PAUSED — activate it in Meta Ads Manager when ready.',
  };
};

// ── Sync Meta Ads metrics ──────────────────────────────────────
const syncMetaData = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign)               throw Object.assign(new Error('Campaign not found'),           { statusCode: 404, expose: true });
  if (!campaign.metaCampaignId) throw Object.assign(new Error('Campaign has no Meta Campaign ID — link one first'), { statusCode: 400, expose: true });

  const { token } = await loadTenantMeta(tenantId);

  const json = await metaGet(token, `${campaign.metaCampaignId}/insights`, {
    fields:      'spend,impressions,clicks,cpc,ctr,cpm,reach,conversions',
    date_preset: 'maximum',
  });

  const ins = json?.data?.[0];
  if (!ins) return { ...campaign, synced: false, message: 'No insights data yet from Meta' };

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      spend:       parseFloat(ins.spend       || 0),
      impressions: parseInt(ins.impressions   || 0),
      clicks:      parseInt(ins.clicks        || 0),
      ctr:         parseFloat(ins.ctr         || 0),
      cpm:         parseFloat(ins.cpm         || 0),
      cpl:         parseFloat(ins.cpc         || 0),
      conversions: parseInt(ins.conversions   || 0),
    },
  });

  logger.info({ campaignId, spend: updated.spend, impressions: updated.impressions }, 'Meta campaign synced');
  return updated;
};

// ── ROI report ─────────────────────────────────────────────────
const getCampaignROI = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });

  const leads = await prisma.lead.findMany({
    where:  { tenantId, campaignId },
    select: { stage: true, dealValue: true, aiScore: true, scoreLabel: true },
  });

  const closedWon    = leads.filter((l) => l.stage === 'CLOSED_WON');
  const totalRevenue = closedWon.reduce((s, l) => s + parseFloat(l.dealValue || 0), 0);
  const totalSpend   = parseFloat(campaign.spend || 0);

  return {
    campaign: { id: campaign.id, name: campaign.name, spend: totalSpend, impressions: campaign.impressions, clicks: campaign.clicks },
    leads:    { total: leads.length, hot: leads.filter((l) => l.scoreLabel === 'HOT').length, warm: leads.filter((l) => l.scoreLabel === 'WARM').length, cold: leads.filter((l) => l.scoreLabel === 'COLD').length },
    revenue:  {
      closedWon:    closedWon.length,
      totalRevenue,
      roas:         totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : null,
      cpl:          leads.length > 0 && totalSpend > 0 ? (totalSpend / leads.length).toFixed(2) : null,
    },
  };
};

// ── Underperforming ────────────────────────────────────────────
const underperforming = async (tenantId) => {
  const campaigns = await prisma.campaign.findMany({ where: { tenantId } });
  return campaigns
    .filter((c) => Number(c.ctr || 0) < 1 || Number(c.cpl || 0) > 1000)
    .map((c) => ({
      id:      c.id,
      name:    c.name,
      reasons: [
        Number(c.ctr || 0) < 1   ? 'low_ctr'  : null,
        Number(c.cpl || 0) > 1000 ? 'high_cpl' : null,
      ].filter(Boolean),
    }));
};

// ── AI recommendations ─────────────────────────────────────────
const recommendations = async (tenantId, campaignId) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { statusCode: 404, expose: true });
  const aiConfig      = await prisma.aiConfig.findUnique({ where: { tenantId } });
  const claudeService = require('../../services/claude.service');
  const out = await claudeService.runCloser({
    aiConfig,
    lead:           { id: 'campaign', stage: 'DIAGNOSED' },
    contact:        { name: 'Marketer' },
    messageHistory: [],
    newMessage:     `Suggest campaign optimization for ${campaign.name} with metrics CTR:${campaign.ctr}, CPM:${campaign.cpm}, CPL:${campaign.cpl}, conversions:${campaign.conversions}`,
    qualifierOutput: { lead_status: 'WARM', score: 7, intent: 'medium', problem_summary: 'campaign optimization', next_action: 'continue_qualifying' },
  });
  return { recommendation: out.reply_message };
};

module.exports = {
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  launchCampaign, syncMetaData, getCampaignROI, underperforming, recommendations,
};
