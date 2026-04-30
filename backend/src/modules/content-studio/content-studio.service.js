const axios = require('axios');
const prisma = require('../../config/database');
const env = require('../../config/env');
const claudeService = require('../../services/claude.service');
const whatsappService = require('../../services/whatsapp.service');

const BRAND_SCHEMA = `Return strict JSON only:
{
  "brand_name": "string",
  "tone": "string",
  "products": ["string"],
  "audience": ["string"],
  "colors": ["#hex"],
  "logo_url": "string|null"
}`;

const extractBrandDNA = async ({ tenantId, sourceUrl, language = 'en' }) => {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (!aiConfig) throw Object.assign(new Error('AI config missing'), { statusCode: 400, expose: true });

  const prompt = `Extract brand DNA from this URL context: ${sourceUrl}\nLanguage:${language}\n${BRAND_SCHEMA}`;
  const output = await claudeService.runQualifier({
    aiConfig,
    lead: { id: 'studio', stage: 'NEW', aiScore: 0, qualificationData: {} },
    contact: { name: 'studio' },
    messageHistory: [],
    newMessage: prompt,
  });

  const profile = await prisma.brandProfile.create({
    data: {
      tenantId,
      sourceUrl,
      brandName: 'Brand',
      tone: output.problem_summary || '',
      products: [],
      audience: [],
      colors: [],
      languageDefault: language,
      rawExtraction: output,
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
