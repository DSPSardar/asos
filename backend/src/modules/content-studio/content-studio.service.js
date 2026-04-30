const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../../config/database');
const env = require('../../config/env');
const whatsappService = require('../../services/whatsapp.service');
const logger = require('../../utils/logger');

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const BRAND_SCHEMA = `Return strict JSON only:
{
  "brand_name": "string",
  "tone": "string",
  "products": ["string"],
  "audience": ["string"],
  "colors": ["#hex"],
  "logo_url": "string|null"
}`;

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
};

const safeJson = (text) => {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
};

const domainToBrand = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Brand';
  }
};

const extractBrandDNA = async ({ tenantId, sourceUrl, language = 'en' }) => {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!aiConfig) throw Object.assign(new Error('AI config missing'), { statusCode: 400, expose: true });

  const prompt = [
    `Extract brand DNA from this website URL: ${sourceUrl}`,
    `Output language: ${language}`,
    'Do not return sales qualification fields. Return only brand extraction JSON.',
    BRAND_SCHEMA,
  ].join('\n');

  let parsed = {};
  let usage = {};
  try {
    const resp = await anthropic.messages.create({
      model: env.QUALIFIER_MODEL || 'claude-haiku-4-5',
      max_tokens: 400,
      temperature: 0,
      system: `${aiConfig.systemPrompt}\nYou are a brand analyst. Extract structured brand profile fields.`,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = resp.content?.[0]?.text || '{}';
    parsed = safeJson(raw);
    usage = resp.usage || {};
  } catch (err) {
    logger.error({ err, tenantId, sourceUrl }, 'Brand DNA extraction failed');
    throw Object.assign(new Error('Brand DNA extraction failed'), { statusCode: 503, expose: true });
  }

  const normalized = {
    brand_name: parsed.brand_name || domainToBrand(sourceUrl),
    tone: typeof parsed.tone === 'string' ? parsed.tone.trim() : '',
    products: normalizeArray(parsed.products),
    audience: normalizeArray(parsed.audience),
    colors: normalizeArray(parsed.colors),
    logo_url: parsed.logo_url || null,
  };

  const profile = await prisma.brandProfile.create({
    data: {
      tenantId,
      sourceUrl,
      brandName: normalized.brand_name || 'Brand',
      tone: normalized.tone,
      products: normalized.products,
      audience: normalized.audience,
      colors: normalized.colors,
      logoUrl: normalized.logo_url,
      languageDefault: language,
      rawExtraction: {
        ...normalized,
        _model: env.QUALIFIER_MODEL || 'claude-haiku-4-5',
        _tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
    },
  });
  return profile;
};

const generateVariants = async ({ tenantId, brandProfileId, count = 10, language = 'en' }) => {
  const profile = await prisma.brandProfile.findFirst({ where: { id: brandProfileId, tenantId } });
  if (!profile) throw Object.assign(new Error('Brand profile not found'), { statusCode: 404, expose: true });

  const session = await prisma.contentSession.create({
    data: { tenantId, brandProfileId, sourceUrl: profile.sourceUrl, language, generatedCount: count },
  });

  const drafts = [];
  for (let i = 0; i < count; i += 1) {
    const body = `${language === 'ur' ? 'Aaj hi shuru karein' : 'Start today'} · Variant ${i + 1}`;
    drafts.push({
      tenantId,
      sessionId: session.id,
      brandProfileId,
      channel: i % 3 === 0 ? 'meta_ad' : i % 3 === 1 ? 'post' : 'email',
      language,
      subject: `Variant ${i + 1}`,
      body,
    });
  }
  await prisma.contentDraft.createMany({ data: drafts });
  const saved = await prisma.contentDraft.findMany({ where: { sessionId: session.id, tenantId } });
  return { session, drafts: saved };
};

const generateImage = async ({ prompt }) => {
  if (!env.REPLICATE_API_TOKEN) throw Object.assign(new Error('Replicate token missing'), { statusCode: 400, expose: true });
  const res = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version: env.REPLICATE_MODEL, input: { prompt } },
    { headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` } },
  );
  return res.data;
};

const updateDraft = async ({ tenantId, draftId, data }) => {
  const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, tenantId } });
  if (!draft) throw Object.assign(new Error('Draft not found'), { statusCode: 404, expose: true });
  return prisma.contentDraft.update({ where: { id: draftId }, data });
};

const publishToMeta = async ({ tenantId, draftId }) => {
  const draft = await updateDraft({ tenantId, draftId, data: { status: 'PUBLISHED' } });
  return { draft, published: true };
};

const sendForApproval = async ({ tenantId, draftId, phone }) => {
  const [draft, tenant] = await Promise.all([
    prisma.contentDraft.findFirst({ where: { id: draftId, tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId } }),
  ]);
  if (!draft) throw Object.assign(new Error('Draft not found'), { statusCode: 404, expose: true });
  await whatsappService.sendText(tenant, phone, `Approval request:\n${draft.body}`);
  await prisma.contentDraft.update({ where: { id: draftId }, data: { status: 'SENT_FOR_APPROVAL' } });
  return { sent: true };
};

module.exports = {
  extractBrandDNA,
  generateVariants,
  generateImage,
  updateDraft,
  publishToMeta,
  sendForApproval,
};
