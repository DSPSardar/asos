// marketing/pipeline/leadsClient.js
// The only file in this module that talks to the real ASOS backend. No new database, no
// new service — reuses backend/src/modules/{auth,contacts,leads}.
//
// Auth model: POST /leads and POST /contacts require a JWT tied to a real tenant/user (see
// backend/src/middleware/auth.middleware.js) — there is no service-account/API-key path.
// We log in once per process with MARKETING_API_EMAIL / MARKETING_API_PASSWORD and cache the
// token. Whichever tenant that user belongs to is the tenant DSP leads land in.

const axios = require('axios');
const { API_BASE_URL, BUSINESS_UNIT } = require('./config');

let cachedToken = null;

const client = axios.create({ baseURL: API_BASE_URL });

async function getToken() {
  if (cachedToken) return cachedToken;

  const email = process.env.MARKETING_API_EMAIL;
  const password = process.env.MARKETING_API_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'MARKETING_API_EMAIL and MARKETING_API_PASSWORD must be set (see marketing/.env.example)'
    );
  }

  const res = await client.post('/auth/login', { email, password });
  cachedToken = res.data.data.accessToken;
  return cachedToken;
}

async function authedRequest(method, url, data) {
  const token = await getToken();
  return client.request({
    method,
    url,
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Finds an existing Contact by phone, or creates one.
 * @param {{phone: ?string, name: ?string, email: ?string, tags?: string[]}} contact
 */
async function findOrCreateContact(contact) {
  if (!contact.phone) {
    throw new Error('contact.phone is required to find-or-create a Contact');
  }

  // /contacts list search is a fuzzy `search` query param, not an exact phone lookup — filter
  // the results for an exact match below.
  const found = await authedRequest('get', `/contacts?search=${encodeURIComponent(contact.phone)}`);
  const existing = found.data.data.find((c) => c.phone === contact.phone);
  if (existing) return existing;

  try {
    const created = await authedRequest('post', '/contacts', {
      phone: contact.phone,
      name: contact.name || undefined,
      email: contact.email || undefined,
      tags: contact.tags || [],
    });
    return created.data.data;
  } catch (err) {
    // Race condition: another process created the same contact between our search and create.
    if (err.response?.status === 409) {
      const retry = await authedRequest('get', `/contacts?search=${encodeURIComponent(contact.phone)}`);
      const match = retry.data.data.find((c) => c.phone === contact.phone);
      if (match) return match;
    }
    throw err;
  }
}

/**
 * Creates a Lead for the given contact, tagged with the DSP business unit.
 * @param {{contactId: string, stage?: string, dealValue?: number, currency?: string}} leadInput
 */
async function createLead(leadInput) {
  const res = await authedRequest('post', '/leads', {
    contactId: leadInput.contactId,
    stage: leadInput.stage || 'NEW',
    dealValue: leadInput.dealValue,
    currency: leadInput.currency,
    businessUnit: BUSINESS_UNIT,
  });
  return res.data.data;
}

/**
 * Full handoff: takes DM Manager's `contact` + `lead` output, resolves the Contact, and
 * creates the Lead. Only call this for hot/warm scores — cold leads should not hit the API.
 * @param {import('./schema').LeadHandoff} handoff
 */
async function submitLeadHandoff(handoff) {
  const contact = await findOrCreateContact(handoff.contact);
  const lead = await createLead({
    contactId: contact.id,
    stage: handoff.lead.stage,
    currency: handoff.lead.currency,
  });
  return { contact, lead };
}

module.exports = { findOrCreateContact, createLead, submitLeadHandoff };
