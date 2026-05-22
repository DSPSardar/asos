// src/modules/settings/settings.service.js

const prisma = require('../../config/database');
const { encrypt, decrypt } = require('../../utils/crypto');
const whatsappService = require('../../services/whatsapp.service');
const logger = require('../../utils/logger');

const META_GRAPH = 'https://graph.facebook.com/v21.0';

const getSettings = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, slug: true, name: true, plan: true, status: true,
      waPhoneId: true,
      waAccessToken: true,   // needed for mock detection (masked below)
      metaPixelId: true,
      metaAccessToken: true, // masked below
      metaAdAccountId: true,
      settings: true,
      createdAt: true,
    },
  });

  if (!tenant) return null;

  // Indicate mock mode without exposing the token
  const mock = whatsappService.isMockMode(tenant);

  return {
    ...tenant,
    waAccessToken:    undefined,   // never send raw token to frontend
    metaAccessToken:  undefined,   // never send raw token to frontend
    waTokenSaved:     !!tenant.waAccessToken,
    metaTokenSaved:   !!tenant.metaAccessToken,
    mockMode:         mock,
  };
};

const updateSettings = async (tenantId, data) => {
  const update = {};
  if (data.name !== undefined) update.name = data.name;

  // Merge incoming settings keys with existing — never blow away unrelated keys
  if (data.settings !== undefined) {
    const current = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    update.settings = { ...(current?.settings || {}), ...data.settings };
  }

  return prisma.tenant.update({
    where: { id: tenantId },
    data: update,
    select: { id: true, name: true, settings: true, updatedAt: true },
  });
};

const updateWhatsApp = async (tenantId, { waPhoneId, waAccessToken, waAppSecret, waVerifyToken }) => {
  const data = {};
  if (waPhoneId)     data.waPhoneId     = waPhoneId;
  if (waAccessToken) data.waAccessToken = encrypt(waAccessToken);
  if (waAppSecret)   data.waAppSecret   = encrypt(waAppSecret);
  if (waVerifyToken) data.waVerifyToken = waVerifyToken;

  return prisma.tenant.update({
    where: { id: tenantId },
    data,
    select: { id: true, waPhoneId: true, updatedAt: true },
  });
};

const verifyWhatsApp = async (tenant) => {
  // Load full tenant with encrypted token from DB
  const fullTenant = await prisma.tenant.findUnique({
    where: { id: tenant.id },
    select: { id: true, waPhoneId: true, waAccessToken: true },
  });

  if (!fullTenant?.waPhoneId || !fullTenant?.waAccessToken) {
    return {
      ok: false,
      mockMode: true,
      error: 'No WhatsApp credentials saved — running in mock mode',
    };
  }

  const result = await whatsappService.verifyCredentials(fullTenant);
  logger.info({ tenantId: tenant.id, ok: result.ok }, 'WA credentials verified');
  return result;
};

const testWhatsApp = async (tenant, testPhone) => {
  try {
    const msgId = await whatsappService.sendText(
      tenant,
      testPhone,
      '✅ ASOS WhatsApp connection test successful! Your integration is working correctly.'
    );
    logger.info({ tenantId: tenant.id, testPhone, msgId }, 'WA test message sent');
    return { success: true, waMessageId: msgId };
  } catch (err) {
    throw Object.assign(new Error(`WhatsApp test failed: ${err.message}`), { statusCode: 400, expose: true });
  }
};

const updateMeta = async (tenantId, { metaPixelId, metaAccessToken, metaAdAccountId }) => {
  const data = {};
  if (metaPixelId)       data.metaPixelId       = metaPixelId;
  if (metaAccessToken)   data.metaAccessToken   = encrypt(metaAccessToken);
  if (metaAdAccountId !== undefined) data.metaAdAccountId = metaAdAccountId || null;

  return prisma.tenant.update({
    where: { id: tenantId },
    data,
    select: { id: true, metaPixelId: true, metaAdAccountId: true, updatedAt: true },
  });
};

// ── Verify Meta Ads credentials ────────────────────────────────
const verifyMetaAds = async (tenant) => {
  const fullTenant = await prisma.tenant.findUnique({
    where: { id: tenant.id },
    select: { metaAccessToken: true, metaAdAccountId: true },
  });

  if (!fullTenant?.metaAccessToken) {
    return { ok: false, error: 'No Meta access token saved — paste one below and save first' };
  }

  const token = decrypt(fullTenant.metaAccessToken);

  // Verify token by calling /me
  const meRes  = await fetch(`${META_GRAPH}/me?access_token=${token}`);
  const meData = await meRes.json();

  if (meData.error) {
    return { ok: false, error: meData.error.message, code: meData.error.code };
  }

  // Verify ad account if saved
  let adAccount = null;
  if (fullTenant.metaAdAccountId) {
    const acctId  = fullTenant.metaAdAccountId.startsWith('act_') ? fullTenant.metaAdAccountId : `act_${fullTenant.metaAdAccountId}`;
    const acctRes = await fetch(`${META_GRAPH}/${acctId}?fields=name,account_status,currency,amount_spent&access_token=${token}`);
    const acctData = await acctRes.json();
    if (!acctData.error) {
      adAccount = {
        id: acctData.id,
        name: acctData.name,
        status: acctData.account_status === 1 ? 'ACTIVE' : 'INACTIVE',
        currency: acctData.currency,
        amountSpent: acctData.amount_spent,
      };
    }
  }

  logger.info({ tenantId: tenant.id, userId: meData.id }, 'Meta Ads credentials verified');
  return { ok: true, userId: meData.id, userName: meData.name, adAccount };
};

// ── Fetch live campaigns as a connection test ──────────────────
const testMetaAds = async (tenant) => {
  const fullTenant = await prisma.tenant.findUnique({
    where: { id: tenant.id },
    select: { metaAccessToken: true, metaAdAccountId: true },
  });

  if (!fullTenant?.metaAccessToken) {
    throw Object.assign(new Error('No Meta access token saved'), { statusCode: 400, expose: true });
  }
  if (!fullTenant?.metaAdAccountId) {
    throw Object.assign(new Error('No Ad Account ID saved'), { statusCode: 400, expose: true });
  }

  const token   = decrypt(fullTenant.metaAccessToken);
  const acctId  = fullTenant.metaAdAccountId.startsWith('act_') ? fullTenant.metaAdAccountId : `act_${fullTenant.metaAdAccountId}`;

  const res  = await fetch(`${META_GRAPH}/${acctId}/campaigns?fields=name,status,effective_status,objective&limit=10&access_token=${token}`);
  const data = await res.json();

  if (data.error) {
    throw Object.assign(new Error(data.error.message), { statusCode: 400, expose: true });
  }

  return { campaigns: data.data || [], total: data.data?.length || 0 };
};

module.exports = { getSettings, updateSettings, updateWhatsApp, verifyWhatsApp, testWhatsApp, updateMeta, verifyMetaAds, testMetaAds };
