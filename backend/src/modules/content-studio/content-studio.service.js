const axios    = require('axios');
const dns      = require('dns').promises;
const fs       = require('fs');
const path     = require('path');
const { randomUUID } = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const prisma   = require('../../config/database');
const env      = require('../../config/env');
const whatsappService = require('../../services/whatsapp.service');
const logger   = require('../../utils/logger');

/** Structured log key for Content Studio image pipeline */
const CS_IMG = 'content-studio-image';

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
  "industry": "<one of: real_estate | software | ecommerce | saas | finance | education | healthcare | hospitality | retail | agency | manufacturing | other>",
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
- Extract brand DNA for ANY type of business — real estate, e-commerce, SaaS, software, retail, restaurant, agency, anything
- Use null or [] for any field that cannot be determined from the content
- Do NOT invent data — extract only what is clearly present on the page
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
// DETERMINISTIC JSON PARSING
//
// Assistant message prefill (`{ role:'assistant', content:'{' }`) is NOT
// supported by claude-sonnet-4-6. Instead we enforce JSON output via a strong
// end-of-prompt instruction and extract the first valid JSON block from the
// raw response text. This works for every Claude model.
// ─────────────────────────────────────────────────────────────────────────────

const JSON_OBJECT_INSTRUCTION = '\n\nIMPORTANT: Respond with a single raw JSON object only. Start your response with { and end with }. No markdown fences, no prose, no explanation — pure JSON.';
const JSON_ARRAY_INSTRUCTION  = '\n\nIMPORTANT: Respond with a single raw JSON array only. Start your response with [ and end with ]. No markdown fences, no prose, no explanation — pure JSON.';

const callClaudeForObject = async ({ model, max_tokens, temperature, system, userContent }) => {
  const resp = await anthropic.messages.create({
    model,
    max_tokens,
    temperature,
    system,
    messages: [
      { role: 'user', content: userContent + JSON_OBJECT_INSTRUCTION },
    ],
  });

  const raw = resp.content?.[0]?.text || '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Strip markdown fences if present, then find outermost { } block
    const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    const match = stripped.match(/\{[\s\S]*\}/);
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
      { role: 'user', content: userContent + JSON_ARRAY_INSTRUCTION },
    ],
  });

  const raw = resp.content?.[0]?.text || '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Strip markdown fences if present, then find outermost [ ] block
    const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    const match = stripped.match(/\[[\s\S]*\]/);
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

  // 5. Call Claude — deterministic JSON (JSON_OBJECT_INSTRUCTION appended in callClaudeForObject)
  let parsed, usage;
  try {
    ({ parsed, usage } = await callClaudeForObject({
      model:      QUALIFIER_MODEL,
      max_tokens: 900,
      temperature: 0,
      system: `You are a professional brand analyst. Your job is to extract structured brand DNA from any website — real estate, e-commerce, software, SaaS, retail, finance, healthcare, or any other industry. Every legitimate business has a brand and you can extract it.
Return strict JSON only. Never invent data — use null or [] for anything not clearly present in the content. Never refuse to extract — always return the JSON structure with whatever data is available.`,
      userContent,
    }));
  } catch (err) {
    logger.error({ err, tenantId, sourceUrl }, 'Brand DNA extraction failed');
    throw err;
  }

  // 6. Normalize — merge scraped signals with Claude output
  const KNOWN_INDUSTRIES = ['real_estate','software','ecommerce','saas','finance','education','healthcare','hospitality','retail','agency','manufacturing','other'];
  const normalized = {
    brand_name:            parsed.brand_name           || domainToBrand(sourceUrl),
    industry:              KNOWN_INDUSTRIES.includes(parsed.industry) ? parsed.industry : 'other',
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

// Industry-specific copy guidance — adapts channel tone and angle selection
// to the actual type of business, not a generic one-size-fits-all template.
const INDUSTRY_COPY_HINTS = {
  real_estate:  'Focus on location value, ROI, lifestyle uplift, and investment security. For WhatsApp: conversational tone, Urdu-English mix if relevant.',
  software:     'Focus on efficiency gains, time saved, and technical credibility. Avoid jargon — lead with the outcome, not the feature.',
  ecommerce:    'Focus on product benefits, deals, social proof, and ease of purchase. WhatsApp: urgent, deal-driven. Instagram: visual and aspirational.',
  saas:         'Focus on pain elimination, time-to-value, and integrations. Use numbers (e.g. "10x faster") only if stated in brand profile.',
  finance:      'Focus on trust, returns, security, and regulatory credibility. Tone: authoritative but approachable.',
  education:    'Focus on outcomes (career, skills, income), flexibility, and credibility. Tone: motivational and supportive.',
  healthcare:   'Focus on patient outcomes, convenience, and trust. Avoid over-promising. Tone: warm and reassuring.',
  hospitality:  'Focus on experience, comfort, and memorable moments. Visual language. Instagram and Meta are primary channels.',
  retail:       'Focus on product quality, value, and the lifestyle it enables. WhatsApp: promotional/deal-driven.',
  agency:       'Focus on results delivered, client wins, and expertise. Tone: confident but not boastful.',
  manufacturing:'Focus on quality, reliability, and scale. B2B tone: professional, specification-aware.',
  other:        'Use the extracted tone and USPs to guide copy style. Lead with the strongest value proposition.',
};

const buildGenerationPrompt = (profile, count, language) => {
  const raw      = profile.rawExtraction || {};
  const lang     = language === 'ur' ? 'Urdu-English mix (Pakistani urban professional register)' : 'English';
  const industry = raw.industry || 'other';
  const hint     = INDUSTRY_COPY_HINTS[industry] || INDUSTRY_COPY_HINTS.other;

  const brandContext = [
    `Brand: ${profile.brandName}`,
    `Industry: ${industry}`,
    raw.tagline                        && `Tagline: ${raw.tagline}`,
    `Tone: ${profile.tone || 'Professional and trustworthy'}`,
    profile.products?.length           && `Products/Services: ${profile.products.join(', ')}`,
    profile.audience?.length           && `Target Audience: ${profile.audience.join(', ')}`,
    raw.pain_points?.length            && `Pain Points Solved: ${normalizeArray(raw.pain_points).join(', ')}`,
    raw.unique_selling_points?.length  && `USPs: ${normalizeArray(raw.unique_selling_points).join(', ')}`,
    raw.key_messages?.length           && `Key Messages: ${normalizeArray(raw.key_messages).join(', ')}`,
    `Source: ${profile.sourceUrl}`,
  ].filter(Boolean).join('\n');

  return `You are a senior performance marketing copywriter who writes high-converting ad copy for any industry.

BRAND PROFILE:
${brandContext}

INDUSTRY COPY GUIDANCE:
${hint}

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
- Never invent specific numbers or claims not in the brand profile above
- Every variant must open with a completely different hook — no two variants can start similarly
- Copy must feel written specifically for this brand's industry and audience, not generic
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

  // Call Claude Sonnet — deterministic JSON (JSON_ARRAY_INSTRUCTION appended in callClaudeForArray)
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

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GENERATION + LOCAL STORAGE
//
// Images are downloaded and saved to disk at /app/uploads/content-images/
// so they are self-hosted, permanent, and never depend on an external URL.
//
// Generator priority:
//   1. Replicate (default flux-dev) — if REPLICATE_API_TOKEN is set; override with REPLICATE_MODEL
//   2. Pollinations.ai              — free, no token, good quality (~5-15s)
//
// Stored path: /uploads/content-images/{uuid}.{ext}
// Served via:  nginx /uploads/ → /var/www/uploads (shared Docker volume)
// ─────────────────────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'content-images');

const ensureContentImagesDir = () => {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    logger.error({ ev: CS_IMG, phase: 'mkdir-uploads', path: UPLOADS_DIR, err: err.message }, 'cannot create content-images upload dir');
    throw err;
  }
};

const CHANNEL_STYLE = {
  meta_ad:           'Facebook / Instagram ad creative, clean bold design, attention-grabbing',
  whatsapp_message:  'clean lifestyle photo, warm and approachable, mobile-friendly',
  instagram_caption: 'vibrant Instagram visual, lifestyle photography, editorial',
  email:             'professional email header, clean corporate, wide format',
};

const buildImagePrompt = (draft, brandProfile) => {
  const raw       = brandProfile?.rawExtraction || {};
  const brand     = brandProfile?.brandName || 'brand';
  const industry  = raw.industry || 'business';
  const colors    = (Array.isArray(raw.colors) ? raw.colors : []).slice(0, 3).join(', ');
  const anchor    = draft.subject || (draft.body || '').slice(0, 80);
  const style     = CHANNEL_STYLE[draft.channel] || 'professional advertising visual';
  const colorHint = colors ? `, brand colors: ${colors}` : '';
  return `${style} for ${brand} (${industry}), visual concept: "${anchor}"${colorHint}, photorealistic, high quality, 4k, no text overlay`;
};

// Download image bytes from a URL and save to disk.
// Returns the local relative path: /uploads/content-images/{uuid}.{ext}
const downloadAndSave = async (remoteUrl, ext = 'jpg') => {
  ensureContentImagesDir();
  const response = await axios.get(remoteUrl, {
    responseType: 'arraybuffer',
    timeout:      60000,  // Pollinations can take ~15s on first generate
    headers: { 'User-Agent': 'ASOS-ContentStudio/1.0' },
  });
  const contentType = response.headers['content-type'] || '';
  const resolvedExt = contentType.includes('webp') ? 'webp'
                    : contentType.includes('png')  ? 'png'
                    : ext;
  const filename = `${randomUUID()}.${resolvedExt}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(response.data));
  const rel = `/uploads/content-images/${filename}`;
  logger.info({ ev: CS_IMG, phase: 'saved', bytes: Buffer.byteLength(response.data), path: rel }, 'image file written');
  return rel;
};

// Low-level: generate image, download it, return local path.
const generateImage = async ({ prompt }) => {
  if (env.REPLICATE_API_TOKEN) {
    // Replicate Models API — default model flux-dev (same input shape as flux-schnell: prompt, aspect_ratio, output_*)
    const [owner, model] = (env.REPLICATE_MODEL || 'black-forest-labs/flux-dev').split('/');
    logger.info({ ev: CS_IMG, phase: 'replicate-start', owner, model, promptLen: String(prompt || '').length }, 'Replicate prediction create');

    let prediction;
    try {
      const createRes = await axios.post(
        `https://api.replicate.com/v1/models/${owner}/${model}/predictions`,
        { input: { prompt, aspect_ratio: '1:1', output_format: 'webp', output_quality: 80 } },
        { headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      );
      prediction = createRes.data;
    } catch (err) {
      const detail = err.response?.data || err.message;
      logger.error({ ev: CS_IMG, phase: 'replicate-create', status: err.response?.status, detail }, 'Replicate create request failed');
      throw Object.assign(new Error('Replicate create failed — check token and model'), { statusCode: 502, expose: true });
    }

    logger.info({ ev: CS_IMG, phase: 'replicate-created', predictionId: prediction.id, status: prediction.status }, 'Replicate prediction created');

    // Poll until succeeded or failed (flux-dev can exceed schnell; max ~90s, 3s intervals)
    for (let i = 0; i < 30 && ['starting', 'processing'].includes(prediction.status); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await axios.get(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }, timeout: 10000 },
      );
      prediction = pollRes.data;
      logger.info({ ev: CS_IMG, phase: 'replicate-poll', predictionId: prediction.id, status: prediction.status, i }, 'Replicate poll');
    }

    if (prediction.status !== 'succeeded') {
      logger.error({
        ev:            CS_IMG,
        phase:         'replicate-final',
        predictionId:  prediction.id,
        status:        prediction.status,
        replicateErr:  prediction.error,
      }, 'Replicate did not succeed');
      throw Object.assign(new Error('Replicate image generation failed or timed out'), { statusCode: 503, expose: true });
    }
    const remoteUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    logger.info({ ev: CS_IMG, phase: 'replicate-output', predictionId: prediction.id, outputType: typeof remoteUrl }, 'Replicate succeeded; downloading');
    try {
      return await downloadAndSave(remoteUrl, 'webp');
    } catch (err) {
      logger.error({ ev: CS_IMG, phase: 'download-replicate-output', err: err.message, remoteUrl: String(remoteUrl).slice(0, 120) }, 'download Replicate output failed');
      throw err;
    }
  }

  // Free fallback: Pollinations.ai — triggers image generation on first fetch
  logger.info({ ev: CS_IMG, phase: 'pollinations', promptLen: String(prompt || '').length }, 'Pollinations image (no Replicate token)');
  const seed      = Math.floor(Math.random() * 999999);
  const pollinUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  return downloadAndSave(pollinUrl, 'jpg');
};

// High-level: generate image for a specific draft, save to disk, persist path to DB.
const generateDraftImage = async ({ tenantId, draftId, prompt }) => {
  logger.info({ ev: CS_IMG, phase: 'draft-request', tenantId, draftId, hasCustomPrompt: !!(typeof prompt === 'string' && prompt.trim()) }, 'draft image endpoint');

  const draft = await prisma.contentDraft.findFirst({
    where: { id: draftId, tenantId },
    include: { brandProfile: true },
  });
  if (!draft) throw Object.assign(new Error('Draft not found'), { statusCode: 404, expose: true });

  const imagePrompt = (typeof prompt === 'string' && prompt.trim()) ? prompt.trim()
                    : buildImagePrompt(draft, draft.brandProfile);

  let imageUrl;
  try {
    imageUrl = await generateImage({ prompt: imagePrompt }); // local path
  } catch (err) {
    logger.error({ ev: CS_IMG, phase: 'draft-generate-failed', tenantId, draftId, err: err.message }, 'generateImage threw');
    throw err;
  }

  const updated = await prisma.contentDraft.update({
    where: { id: draftId },
    data:  { imageUrl },
  });

  const base = env.PUBLIC_UPLOADS_BASE ? String(env.PUBLIC_UPLOADS_BASE).replace(/\/+$/, '') : '';
  const imageAbsoluteUrl = base ? `${base}${imageUrl}` : undefined;

  logger.info({
    ev:       CS_IMG,
    phase:    'draft-done',
    tenantId,
    draftId,
    imageUrl,
    imageAbsoluteUrl: imageAbsoluteUrl || null,
    provider:         env.REPLICATE_API_TOKEN ? 'replicate' : 'pollinations',
  }, '🎨 Draft image generated and saved');

  return { draft: updated, imageUrl, ...(imageAbsoluteUrl ? { imageAbsoluteUrl } : {}), prompt: imagePrompt };
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
  generateDraftImage,
  updateDraft,
  publishToMeta,
  sendForApproval,
};
