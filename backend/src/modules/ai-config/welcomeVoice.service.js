// src/modules/ai-config/welcomeVoice.service.js
// Converts an admin-uploaded audio file to OGG/Opus, uploads it to WhatsApp's
// media API, and keeps the stored media id fresh (WA media ids expire ~30 days).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');

const prisma = require('../../config/database');
const whatsappService = require('../../services/whatsapp.service');
const logger = require('../../utils/logger');

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'welcome-voice');
const MAX_MEDIA_AGE_MS = 25 * 24 * 60 * 60 * 1000; // refresh before WA's ~30-day expiry

const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
};

const convertToOpus = (inputPath, outputPath) =>
  new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', inputPath, '-c:a', 'libopus', '-avoid_negative_ts', 'make_zero', outputPath],
      (err, stdout, stderr) => {
        if (err) return reject(Object.assign(new Error('Audio conversion failed'), { cause: stderr || err.message }));
        resolve();
      }
    );
  });

// Converts the uploaded buffer to OGG/Opus, persists it under uploads/welcome-voice/
// (so a media-id refresh never needs the admin to re-upload), pushes it to WhatsApp,
// and stores the returned media id on AiConfig.
const uploadWelcomeVoice = async (tenantId, buffer, originalFilename) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, expose: true });

  ensureUploadsDir();
  const inputExt = path.extname(originalFilename || '') || '.mp3';
  const tempInputPath = path.join(os.tmpdir(), `${randomUUID()}${inputExt}`);
  const outputPath = path.join(UPLOADS_DIR, `${tenantId}.ogg`);

  try {
    fs.writeFileSync(tempInputPath, buffer);
    await convertToOpus(tempInputPath, outputPath);

    const oggBuffer = fs.readFileSync(outputPath);
    const mediaId = await whatsappService.uploadMedia(tenant, oggBuffer, 'audio/ogg', 'welcome-voice.ogg');

    return prisma.aiConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        systemPrompt: '',
        welcomeVoiceMediaId: mediaId,
        welcomeVoiceFilePath: `/uploads/welcome-voice/${tenantId}.ogg`,
        welcomeVoiceUploadedAt: new Date(),
      },
      update: {
        welcomeVoiceMediaId: mediaId,
        welcomeVoiceFilePath: `/uploads/welcome-voice/${tenantId}.ogg`,
        welcomeVoiceUploadedAt: new Date(),
      },
    });
  } finally {
    fs.rm(tempInputPath, { force: true }, () => {});
  }
};

// Re-uploads the already-converted .ogg on disk to get a fresh media id,
// without re-running ffmpeg.
const refreshMedia = async (tenant, aiConfig) => {
  if (!aiConfig.welcomeVoiceFilePath) {
    throw new Error('No stored welcome voice file to re-upload');
  }
  const filePath = path.resolve(process.cwd(), aiConfig.welcomeVoiceFilePath.replace(/^\//, ''));
  const oggBuffer = fs.readFileSync(filePath);
  const mediaId = await whatsappService.uploadMedia(tenant, oggBuffer, 'audio/ogg', 'welcome-voice.ogg');

  return prisma.aiConfig.update({
    where: { tenantId: tenant.id },
    data: { welcomeVoiceMediaId: mediaId, welcomeVoiceUploadedAt: new Date() },
  });
};

const ensureFreshMedia = async (tenant, aiConfig) => {
  const age = aiConfig.welcomeVoiceUploadedAt ? Date.now() - aiConfig.welcomeVoiceUploadedAt.getTime() : Infinity;
  if (age < MAX_MEDIA_AGE_MS) return aiConfig;
  logger.info({ tenantId: tenant.id, ageDays: Math.round(age / 86400000) }, 'welcome voice media aging out — refreshing');
  return refreshMedia(tenant, aiConfig);
};

const isInvalidMediaError = (err) => {
  const apiError = err.response?.data?.error;
  return apiError?.code === 131053 || /media/i.test(apiError?.message || '');
};

// Ensures the media id is fresh, sends the voice note, and — if WhatsApp
// rejects the id as invalid/expired — refreshes once and retries once.
// Returns the outbound WA message id.
const sendWelcomeVoice = async (tenant, aiConfig, toPhone) => {
  let config = await ensureFreshMedia(tenant, aiConfig);
  try {
    return await whatsappService.sendAudioByMediaId(tenant, toPhone, config.welcomeVoiceMediaId);
  } catch (err) {
    if (!isInvalidMediaError(err)) throw err;
    logger.warn({ tenantId: tenant.id, err: err.message }, 'welcome voice media id rejected — refreshing and retrying once');
    config = await refreshMedia(tenant, config);
    return await whatsappService.sendAudioByMediaId(tenant, toPhone, config.welcomeVoiceMediaId);
  }
};

module.exports = { uploadWelcomeVoice, ensureFreshMedia, sendWelcomeVoice };
