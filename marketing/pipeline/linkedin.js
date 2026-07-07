// marketing/pipeline/linkedin.js
// Publishes a Repurposer asset's `linkedin_post` text to LinkedIn via the Posts API
// (the current API — the older `ugcPosts` endpoint this superseded is deprecated for new
// integrations). Text-only: no video/image required, so this is the one auto-postable
// channel in this module with no external rendering step. See marketing/CLAUDE.md for the
// developer-app setup required before ACCESS_TOKEN/AUTHOR_URN exist.

const axios = require('axios');

const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
// Pin a specific version rather than "latest" — LinkedIn versions its REST API by
// year-month and expects this header on every call. Bump deliberately, not silently.
const LINKEDIN_API_VERSION = '202405';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see marketing/.env.example).`);
  return value;
}

// authorUrn: "urn:li:person:xxxx" (personal profile) or "urn:li:organization:xxxx" (company
// page — posting as an organization needs Marketing Developer Platform / Community
// Management API partnership approval from LinkedIn, not just a personal OAuth token).
async function publishLinkedInPost(text, { authorUrn, accessToken } = {}) {
  const token = accessToken || requireEnv('LINKEDIN_ACCESS_TOKEN');
  const author = authorUrn || requireEnv('LINKEDIN_AUTHOR_URN');

  const response = await axios.post(
    `${LINKEDIN_API_BASE}/posts`,
    {
      author,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'Content-Type': 'application/json',
      },
    }
  );

  // LinkedIn returns the new post's URN in the x-restli-id response header, not the body.
  return { postUrn: response.headers['x-restli-id'], status: response.status };
}

module.exports = { publishLinkedInPost };
