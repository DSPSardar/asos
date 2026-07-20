// Public Vercel Function used by the same-origin rewrites in vercel.json.
const ALLOWED_ROOTS = new Set(['api/v1', 'webhooks', 'uploads']);
const REQUEST_HEADER_BLOCKLIST = new Set([
  'connection',
  'content-length',
  'host',
  'origin',
  'transfer-encoding',
]);
const RESPONSE_HEADER_BLOCKLIST = new Set([
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'connection',
  'content-length',
  'transfer-encoding',
]);

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

function queryValue(value) {
  if (Array.isArray(value)) return value.join('/');
  return typeof value === 'string' ? value : '';
}

function safePath(value) {
  return queryValue(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function copyRequestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase()) || value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  headers.set('x-forwarded-host', String(req.headers?.host || 'asos-kappa.vercel.app'));
  headers.set('x-forwarded-proto', 'https');
  return headers;
}

function copyResponseHeaders(upstream, res) {
  for (const [key, value] of upstream.headers.entries()) {
    if (RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase()) || key.toLowerCase() === 'set-cookie') continue;
    res.setHeader(key, value);
  }

  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) res.setHeader('set-cookie', cookies);
}

export default async function handler(req, res) {
  const backendOrigin = String(process.env.ASOS_BACKEND_ORIGIN || '').trim().replace(/\/+$/, '');
  const root = queryValue(req.query?._asosRoot);

  if (!backendOrigin || !ALLOWED_ROOTS.has(root)) {
    res.status(503).json({ success: false, message: 'ASOS backend is not configured.' });
    return;
  }

  let origin;
  try {
    origin = new URL(backendOrigin);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') throw new Error('Unsupported protocol');
  } catch {
    res.status(503).json({ success: false, message: 'ASOS backend configuration is invalid.' });
    return;
  }

  const path = safePath(req.query?._asosPath);
  const target = new URL(`/${root}${path ? `/${path}` : ''}`, `${origin.origin}/`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '_asosRoot' || key === '_asosPath') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item != null) target.searchParams.append(key, String(item));
    }
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: copyRequestHeaders(req),
      body: await readBody(req),
      redirect: 'manual',
      signal: AbortSignal.timeout(125_000),
    });

    res.statusCode = upstream.status;
    copyResponseHeaders(upstream, res);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).json({ success: false, message: 'ASOS backend is temporarily unavailable.' });
  }
}
