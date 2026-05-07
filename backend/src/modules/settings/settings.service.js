// src/modules/settings/settings.service.js

const prisma = require('../../config/database');
const { encrypt } = require('../../utils/crypto');
const whatsappService = require('../../services/whatsapp.service');
const logger = require('../../utils/logger');

const getSettings = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, slug: true, name: true, plan: true, status: true,
      waPhoneId: true,
      waAccessToken: true,   // needed for mock detection (masked below)
      metaPixelId: true,
      settings: true,
      createdAt: true,
    },
  });

  if (!tenant) return null;

  // Indicate mock mode without exposing the token
  const mock = whatsappService.isMockMode(tenant);

  return {
    ...tenant,
    waAccessToken: undefined,        // never send raw token to frontend
    waTokenSaved:  !!tenant.waAccessToken,
    mockMode:      mock,
  };
};

const updateSettings = async (tenantId, data) => {
  const allowed = ['name', 'settings'];
  const update = {};
  allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });

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

const updateMeta = async (tenantId, { metaPixelId, metaAccessToken }) => {
  const data = {};
  if (metaPixelId)     data.metaPixelId     = metaPixelId;
  if (metaAccessToken) data.metaAccessToken = encrypt(metaAccessToken);

  return prisma.tenant.update({
    where: { id: tenantId },
    data,
    select: { id: true, metaPixelId: true, updatedAt: true },
  });
};

module.exports = { getSettings, updateSettings, updateWhatsApp, verifyWhatsApp, testWhatsApp, updateMeta };
