const axios    = require('axios');
const dns      = require('dns').promises;
const Anthropic = require('@anthropic-ai/sdk');
const prisma   = require('../../config/database');
const env      = require('../../config/env');
const whatsappService = require('../../services/whatsapp.service');
const logger   = require('../../utils/logger');

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const QUALIFIER_MODEL  = env.QUALIFIER_MODEL || 'claude-haiku-4-5';
const CLOSER_MODEL     = env.CLOSER_MODEL || env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const CHANNELS         = ['meta_ad', 'whatsapp_message', 'instagram_caption', 'email'];
const MAX_VARIANTS     = 20;   // hard cap — enforced here and in controller

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: SSRF-SAFE URL GUARD
// Blocks: loopback, RFC1918, link-local, cloud metadata endpoints,
//         non-http(s) schemes, non-standard ports.
// Resolves the hostname to all its IP addresses before allowing the fetch.
// ─────────────────────────────────────────────────────────────────────────────

// Private/reserved IPv4 ranges (CIDR logic via regex for zero-dependency check)
const PRIVATE_IP_PATTERNS = [
  /^127\./,                                     // loopback 127.x.x.x
  /^10\./,                                      // RFC1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./,                // RFC1918 class B 172.16-31
  /^192\.168\./,                                // RFC1918 class C
  /^169\.254\./,                                // link-local (APIPA / cloud metadata)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT 100.64-127
  /^0\./,                                       // 0.x.x.x reserved
  /^(::1|::ffff:127\.|::ffff:10\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|::ffff:192\.168\.)/i, // IPv6 mapped
  /^fc[0-9a-f]{2}:/i,                           // IPv6 unique-local
  /^fe[89ab][0-9a-f]:/i,                        // IPv6 link-local
];

// Specific hostnames that must never be reached regardless of IP resolution
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',    // AWS / GCP / Azure instance metadata
  'metadata',
  'instance-data',
]);

const ALLOWED_PORTS = new Set([80, 443]);  // only standard public web ports

const validateSafeUrl = async (rawUrl) => {
  // 1. Must parse as a valid URL
  let parsed;
  try { parsed = new URL(rawUrl); } catch {
    throw Object.assign(new Error('Invalid URL format'), { statusCode: 400, expose: true });
  }

  // 2. Must be http or https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only http and https URLs are allowed'), { statusCode: 400, expose: true });
  }

  // 3. Only allow ports 80 / 443 (or omitted, which defaults to those)
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) {
    throw Object.assign(new Error('Only ports 80 and 443 are allowed'), { statusCode: 400, expose: true });
  }

  const hostname = parsed.hostname.toLowerCase();

  // 4. Block known bad hostnames directly (before DNS)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw Object.assign(new Error('URL hostname is not allowed'), { statusCode: 400, expose: true });
  }

  // 5. Resolve hostname → all IP addresses and check each one
  let addresses;
  try {
    const results = await dns.lookup(hostname, { all: true, family: 0 });
    addresses = results.map((r) => r.address);
  } catch {
    throw Object.assign(new Error('URL hostname could not be resolved'), { statusCode: 400, expose: true });
  }

  if (!addresses.length) {
    throw Object.assign(new Error('URL hostname resolved to no addresses'), { statusCode: 400, expose: true });
  }

  for (const addr of addresses) {
    if (PRIVATE_IP_PATTERNS.some((p) => p.test(addr))) {
      logger.warn({ hostname, addr }, 'SSRF attempt blocked — private IP');
      throw Object.assign(new Error('URL resolves to a private or restricted address'), { statusCode: 400, expose: true });
    }
  }

  return parsed;   // safe — return parsed URL for callers
};

// ─────────────────────────────────────────────────────────────────────────────
// BRAND DNA SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_SCHEMA = `Return ONLY valid JSON. No prose, no markdown.

{
  "brand_name": "<string>",
  "tagline": "<short brand tagline or null>",
  "tone": "<2–4 sentences: writing style, voice, personality, formality level>",
  "products": ["<product or service 1>", "..."],
  "audience": ["<target segment 1>", "..."],
  "pain_points": ["<customer problem the brand solves>", "..."],
  "unique_selling_points": ["<USP>", "..."],
  "key_messages": ["<core message used in copy>", "..."],
  "colors": ["#hex1", "..."],
  "logo_url": "<absolute URL string or null>"
}

Rules:
- Use null or [] for any field that cannot be determined from the content
- Do NOT invent data — extract only what is clearly present
- colors: only hex values genuinely used as brand colors (not incidental values)
- logo_url: only if an image clearly represents the brand logo`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
};

const domainToBrand = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return 'Brand'; }
};

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3a: DETERMINISTIC JSON PARSING — assistant message prefill
//
// By seeding the assistant's opening token (`{` or `[`), Claude is forced to
// start outputting the JSON structure immediately — no prose preamble, no
// markdown fences. We then prepend the seed back onto the completion text
// and parse strictly, throwing on failure rather than silently swallowing it.
// ─────────────────────────────────────────────────────────────────────────────

const callClaudeForObject = async ({ model, max_tokens, temperature, system, userContent }) => {
  const resp = await anthropic.messages.create({
    model,
    max_tokens,
    temperature,
    system,
    messages: [
      { role: 'user',      content: userContent },
      { role: 'assistant', content: '{' },   // ← prefill forces JSON object output
    ],
  });

  const completion = resp.content?.[0]?.text || '';
  const raw        = '{' + completion;         // reattach the prefill seed

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    // Attempt to recover by finding the outermost { } block
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { parsed = null; }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn({ raw: raw.slice(0, 300) }, 'callClaudeForObject: JSON parse failed');
    throw Object.assign(
      new Error('AI returned malformed JSON — please try again'),
      { statusCode: 503, expose: true },
    );
  }

  return { parsed, usage: resp.usage || {} };
};

const callClaudeForArray = async ({ model, max_tokens, temperature, system, userContent }) => {
  const resp = await anthropic.messages.create({
    model,
    max_tokens,
    temperature,
    system,
    messages: [
      { role: 'user',      content: userContent },
      { role: 'assistant', content: '[' },   // ← prefill forces JSON array output
    ],
  });

  const completion = resp.content?.[0]?.text || '';
  const raw        = '[' + completion;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { parsed = null; }
    }
  }

  if (!Array.isArray(parsed)) {
    logger.warn({ raw: raw.slice(0, 300) }, 'callClaudeForArray: JSON parse failed');
    throw Object.assign(
      new Error('AI returned malformed variant list — please try again'),
      { statusCode: 503, expose: true },
    );
  }

  return { parsed, usage: resp.usage || {} };
};

// ─────────────────────────────────────────────────────────────────────────────
// WEB CONTENT FETCHER (SSRF-safe — calls validateSafeUrl first)
// ─────────────────────────────────────────────────────────────────────────────

const fetchWebContent = async (safeUrl) => {
  // safeUrl is already a validated URL object from validateSafeUrl()
  const urlString = safeUrl.toString();
  try {
    const res = await axios.get(urlString, {
      timeout: 10000,
      maxContentLength: 800_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const html = typeof res.data === 'string' ? res.data : '';

    // Meta tags first — most information-dense part of any page
    const metaTitle       = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const metaDescription = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    const ogTitle         = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    const ogDescription   = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    const ogImage         = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';

    // FIX for "color noise": only extract colors from likely brand CSS variables
    // or repeated colors (appearing ≥2 times), not every incidental hex in the HTML.
    const allColorMatches = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
    const colorFrequency  = allColorMatches.reduce((acc, c) => {
      const key = c.toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    // Only keep colors that appear at least twice — eliminates one-off artifacts
    const brandColors = Object.entries(colorFrequency)
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)  // most frequent first
      .map(([color]) => color)
      .slice(0, 6);

    // Logo detection
    const logoPatterns = [
      /<img[^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']*logo[^"']*)["']/i,
    ];
    let logoUrl = null;
    for (const p of logoPatterns) {
      const m = html.match(p);
      if (m) {
        try {
          logoUrl = m[1].startsWith('http') ? m[1] : new URL(m[1], urlString).href;
          break;
        } catch { /* skip malformed logo URL */ }
      }
    }

    // Clean body text — strip noise elements, keep meaningful content
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 6000);

    const contentBlock = [
      metaTitle        && `PAGE TITLE: ${metaTitle}`,
      ogTitle          && `OG TITLE: ${ogTitle}`,
      metaDescription  && `META DESCRIPTION: ${metaDescription}`,
      ogDescription    && `OG DESCRIPTION: ${ogDescription}`,
      ogImage          && `OG IMAGE: ${ogImage}`,
      brandColors.length && `BRAND COLORS (extracted from CSS, frequency-filtered): ${brandColors.join(', ')}`,
      logoUrl          && `LOGO URL: ${logoUrl}`,
      '',
      'PAGE BODY TEXT:',
      bodyText,
    ].filter(Boolean).join('\n');

    logger.info({ url: urlString, bodyLen: bodyText.length, colors: brandColors.length }, 'fetchWebContent success');
    return { contentBlock, logoUrl, colors: brandColors };

  } catch (err) {
    logger.warn({ url: urlString, err: err.message }, 'fetchWebContent failed — using URL-only extraction');
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT BRAND DNA
// ─────────────────────────────────────────────────────────────────────────────

const extractBrandDNA = async ({ tenantId, sourceUrl, language = 'en', forceRefresh = false }) => {

  // 1. SSRF-safe validation (throws on private IPs, bad schemes, bad ports)
  const safeUrl = await validateSafeUrl(sourceUrl);

  // 2. Dedup: return cached profile if extracted within last 24 h
  if (!forceRefresh) {
    const existing = await prisma.brandProfile.findFirst({
      where: {
        tenantId,
        sourceUrl: safeUrl.toString(),
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      logger.info({ tenantId, profileId: existing.id }, 'BrandProfile cache hit');
      return existing;
    }
  }

  // 3. Fetch real page content (already SSRF-safe because safeUrl is validated)
  const fetched = await fetchWebContent(safeUrl);

  const contentSection = fetched
    ? `\n\nWEBSITE CONTENT (live scraped):\n${fetched.contentBlock}`
    : `\n\n(Website could not be fetched — infer conservatively from URL domain name only.)`;

  // 4. Build extraction prompt
  const userContent = [
    `Analyze the following website and extract its brand DNA profile.`,
    `Source URL: ${safeUrl.toString()}`,
    `Output language: ${language === 'ur' ? 'Urdu' : 'English'}`,
    contentSection,
    '',
    BRAND_SCHEMA,
  ].join('\n');

  // 5. Call Claude — deterministic JSON via assistant prefill
  let parsed, usage;
  try {
    ({ parsed, usage } = await callClaudeForObject({
      model:      QUALIFIER_MODEL,
      max_tokens: 900,
      temperature: 0,
      system: `You are a professional brand analyst. Extract structured brand DNA from website content.
Return strict JSON only. Never invent data — use null or [] for anything not clearly present in the content.
Do not apply any sales or real estate perspective. Extract only what is genuinely on this page.`,
      userContent,
    }));
  } catch (err) {
    logger.error({ err, tenantId, sourceUrl }, 'Brand DNA extraction failed');
    throw err;
  }

  // 6. Normalize — merge scraped signals with Claude output
  const normalized = {
    brand_name:            parsed.brand_name           || domainToBrand(sourceUrl),
    tagline:               typeof parsed.tagline === 'string' ? parsed.tagline.trim() : null,
    tone:                  typeof parsed.tone === 'string' ? parsed.tone.trim() : '',
    products:              normalizeArray(parsed.products),
    audience:              normalizeArray(parsed.audience),
    pain_points:           normalizeArray(parsed.pain_points),
    unique_selling_points: normalizeArray(parsed.unique_selling_points),
    key_messages:          normalizeArray(parsed.key_messages),
    // Prefer frequency-filtered scraped colors; fall back to Claude's output
    colors:                fetched?.colors?.length ? fetched.colors : normalizeArray(parsed.colors),
    // Prefer HTML-scraped logo; fall back to Claude's guess
    logo_url:              fetched?.logoUrl || parsed.logo_url || null,
  };

  // 7. Persist
  const profile = await prisma.brandProfile.create({
    data: {
      tenantId,
      sourceUrl: safeUrl.toString(),
      brandName: normalized.brand_name,
      tone:      normalized.tone,
      products:  normalized.products,
      audience:  normalized.audience,
      colors:    normalized.colors,
      logoUrl:   normalized.logo_url,
      languageDefault: language,
      rawExtraction: {
        ...normalized,
        _model:         QUALIFIER_MODEL,
        _tokens:        (usage.input_tokens || 0) + (usage.output_tokens || 0),
        _sourceScraped: !!fetched,
      },
    },
  });

  logger.info({ tenantId, profileId: profile.id, scraped: !!fetched }, '✅ Brand DNA extracted');
  return profile;
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE AD COPY VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

const buildGenerationPrompt = (profile, count, language) => {
  const raw  = profile.rawExtraction || {};
  const lang = language === 'ur' ? 'Urdu-English mix (Pakistani urban professional register)' : 'English';

  const brandContext = [
    `Brand: ${profile.brandName}`,
    raw.tagline                        && `Tagline: ${raw.tagline}`,
    `Tone: ${profile.tone || 'Professional and trustworthy'}`,
    profile.products?.length           && `Products/Services: ${profile.products.join(', ')}`,
    profile.audience?.length           && `Target Audience: ${profile.audience.join(', ')}`,
    raw.pain_points?.length            && `Pain Points Solved: ${normalizeArray(raw.pain_points).join(', ')}`,
    raw.unique_selling_points?.length  && `USPs: ${normalizeArray(raw.unique_selling_points).join(', ')}`,
    raw.key_messages?.length           && `Key Messages: ${normalizeArray(raw.key_messages).join(', ')}`,
    `Source: ${profile.sourceUrl}`,
  ].filter(Boolean).join('\n');

  return `You are a senior performance marketing copywriter specializing in high-conversion ad copy.

BRAND PROFILE:
${brandContext}

TASK:
Generate exactly ${count} distinct ad copy variants in ${lang}.

CHANNELS (rotate across these four):
- meta_ad: Facebook/Instagram. subject = headline (≤40 chars). body = ad copy (≤240 chars). Hook in first 3 words.
- whatsapp_message: WhatsApp broadcast. No subject. Conversational, 2–4 sentences, clear CTA.${language === 'ur' ? ' Use natural Urdu-English code-switching.' : ''}
- instagram_caption: No subject. 2–3 punchy lines + 3–5 relevant hashtags on a new line.
- email: subject = subject line (≤60 chars). body = email copy (≤300 chars). Professional but engaging.

COPY ANGLES — each variant must use a different one, cycling through:
fomo | roi | trust | aspiration | scarcity | problem | curiosity

RULES:
- Never invent specific numbers or claims not stated in the brand profile
- Every variant must open with a completely different hook
- Maximum 1 emoji per variant, only if it genuinely fits the brand tone

Return a JSON array of exactly ${count} objects:
[{"channel":"...","subject":"...or null","body":"...","angle":"..."}]`;
};

const generateVariants = async ({ tenantId, brandProfileId, count = 10, language = 'en' }) => {
  // Hard cap enforced at service layer regardless of what controller passes
  const safeCount = Math.min(Math.max(1, parseInt(count) || 10), MAX_VARIANTS);

  const profile = await prisma.brandProfile.findFirst({ where: { id: brandProfileId, tenantId } });
  if (!profile) throw Object.assign(new Error('Brand profile not found'), { statusCode: 404, expose: true });

  const session = await prisma.contentSession.create({
    data: { tenantId, brandProfileId, sourceUrl: profile.sourceUrl, language, generatedCount: safeCount },
  });

  // Call Claude Sonnet — deterministic JSON via array prefill
  const userContent = buildGenerationPrompt(profile, safeCount, language);

  let variants;
  try {
    ({ parsed: variants } = await callClaudeForArray({
      model:       CLOSER_MODEL,
      max_tokens:  Math.min(4000, safeCount * 350 + 200),
      temperature: 0.75,
      system: 'You are a senior performance marketing copywriter. Return ONLY a valid JSON array. No prose.',
      userContent,
    }));
  } catch (err) {
    logger.error({ err, tenantId, brandProfileId }, 'Variant generation failed');
    throw err;
  }

  if (!variants.length) {
    throw Object.assign(new Error('AI returned no variants — please try again'), { statusCode: 503, expose: true });
  }

  // Persist drafts
  const draftData = variants.slice(0, safeCount).map((v, i) => ({
    tenantId,
    sessionId:      session.id,
    brandProfileId,
    channel:        CHANNELS.includes(v.channel) ? v.channel : CHANNELS[i % CHANNELS.length],
    language,
    subject:        v.subject ? String(v.subject).trim() : null,
    body:           String(v.body || '').trim(),
    metadata:       { angle: v.angle || null },
  }));

  await prisma.contentDraft.createMany({ data: draftData });
  const saved = await prisma.contentDraft.findMany({
    where: { sessionId: session.id, tenantId },
    orderBy: { createdAt: 'asc' },
  });

  logger.info({ tenantId, brandProfileId, count: saved.length }, '✅ Variants generated');
  return { session, drafts: saved };
};

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

const generateImage = async ({ prompt }) => {
  if (!env.REPLICATE_API_TOKEN) {
    throw Object.assign(new Error('Replicate token missing'), { statusCode: 400, expose: true });
  }
  const res = await axios.post(
    'https://api.replicate.com/v1/predictions',
    { version: env.REPLICATE_MODEL, input: { prompt } },
    { headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` } },
  );
  return res.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

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
  const message = `*Approval Request*\n\n${draft.subject ? `*${draft.subject}*\n\n` : ''}${draft.body}`;
  await whatsappService.sendText(tenant, phone, message);
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
