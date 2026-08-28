// src/services/googleSheets.service.js
//
// Thin Google Sheets API v4 client.
//
// Auth is a single service account shared by all tenants: the tenant creates a
// Sheet, shares it with the service account address as Editor, and pastes the
// URL into Settings → Integrations. That avoids a per-tenant OAuth consent
// screen and Google app verification, at the cost of one manual share step.
//
// Credentials come from env (set on Railway, never committed):
//   GOOGLE_SA_CLIENT_EMAIL  — service account address
//   GOOGLE_SA_PRIVATE_KEY   — PEM private key ("\n" escapes are unescaped here)
// Both unset = integration cleanly disabled; nothing throws on boot.

const { JWT } = require('google-auth-library');
const axios = require('axios');
const logger = require('../utils/logger');

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const clientEmail = (process.env.GOOGLE_SA_CLIENT_EMAIL || '').trim();

// PEM keys rarely survive a copy-paste through a dashboard intact. Depending on
// where the value was copied from it can arrive with literal "\n" escapes, with
// surrounding JSON quotes, with CRLF line endings, or — the case that produces
// OpenSSL's opaque "DECODER routines::unsupported" — with every newline
// flattened to a space, leaving the base64 body as one unbroken line. Normalise
// all of those back into a well-formed PEM rather than making a human re-paste
// a secret until the formatting happens to be right.
const normalisePrivateKey = (raw) => {
  if (!raw) return '';

  let key = String(raw).trim();

  // Strip wrapping quotes if the JSON quoting came along for the ride.
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Literal backslash-n escapes → real newlines; normalise CRLF.
  key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const match = key.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return key.trim() ? `${key.trim()}\n` : '';

  const label = match[1];
  // Re-wrap the body at 64 chars regardless of how it arrived. This is a no-op
  // for a correctly formatted key and the repair for a flattened one.
  const body = match[2].replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
};

const privateKey = normalisePrivateKey(process.env.GOOGLE_SA_PRIVATE_KEY);

const isConfigured = () => Boolean(clientEmail && privateKey);

const serviceAccountEmail = () => clientEmail || null;

let cachedClient = null;

const getClient = () => {
  if (!isConfigured()) return null;
  if (!cachedClient) {
    cachedClient = new JWT({ email: clientEmail, key: privateKey, scopes: SCOPES });
  }
  return cachedClient;
};

const authHeader = async () => {
  const client = getClient();
  if (!client) throw new Error('Google Sheets is not configured on this server');
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Could not obtain a Google access token');
  return { Authorization: `Bearer ${token}` };
};

// Accepts a full Sheet URL or a bare ID and returns the ID.
const extractSpreadsheetId = (input) => {
  if (!input) return null;
  const str = String(input).trim();
  const match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // A bare ID: Google IDs are long and have no slashes.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(str)) return str;
  return null;
};

// Confirms the sheet exists and the service account can reach it. Returns the
// spreadsheet title so the UI can show the user which file it connected to.
const verifyAccess = async (spreadsheetId) => {
  const headers = await authHeader();
  const res = await axios.get(`${SHEETS_API}/${spreadsheetId}`, {
    headers,
    params: { fields: 'properties.title,sheets.properties.title' },
    timeout: 15000,
  });
  return {
    title: res.data?.properties?.title || 'Untitled',
    tabs: (res.data?.sheets || []).map((s) => s.properties?.title).filter(Boolean),
  };
};

// Creates a tab if it isn't already there. Safe to call every sync.
const ensureTab = async (spreadsheetId, tabName) => {
  const headers = await authHeader();
  const meta = await axios.get(`${SHEETS_API}/${spreadsheetId}`, {
    headers,
    params: { fields: 'sheets.properties.title' },
    timeout: 15000,
  });

  const exists = (meta.data?.sheets || [])
    .some((s) => s.properties?.title === tabName);
  if (exists) return false;

  await axios.post(
    `${SHEETS_API}/${spreadsheetId}:batchUpdate`,
    { requests: [{ addSheet: { properties: { title: tabName } } }] },
    { headers, timeout: 15000 }
  );
  logger.info({ spreadsheetId, tabName }, 'Created Google Sheet tab');
  return true;
};

// Replaces the tab's contents with `rows` (first row = header).
//
// Clear-then-write rather than an incremental diff: the sync is a full mirror
// of the leads table, so a rewrite can never leave the sheet half-updated or
// drift out of order. Row 1 is frozen so headers stay visible while scrolling.
const replaceTabContents = async (spreadsheetId, tabName, rows) => {
  const headers = await authHeader();
  const range = `${tabName}!A:ZZ`;

  await axios.post(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    {}, { headers, timeout: 20000 });

  if (!rows.length) return { updatedRows: 0 };

  const res = await axios.put(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1`)}`,
    { values: rows },
    { headers, params: { valueInputOption: 'RAW' }, timeout: 60000 }
  );

  return { updatedRows: res.data?.updatedRows || rows.length };
};

module.exports = {
  isConfigured,
  serviceAccountEmail,
  extractSpreadsheetId,
  verifyAccess,
  ensureTab,
  replaceTabContents,
};
