// marketing/pipeline/linkedin.js
// Publishes to LinkedIn via the Posts API (the current API — the older `ugcPosts` endpoint
// this superseded is deprecated for new integrations). Supports text-only posts and posts
// with one attached image (uploaded via the Images API first). See marketing/CLAUDE.md for
// the developer-app setup required before ACCESS_TOKEN/AUTHOR_URN exist.

const fs = require('fs');
const axios = require('axios');

const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
// Pin a specific version rather than "latest" — LinkedIn versions its REST API by
// year-month and expects this header on every call, sunsetting versions after ~1 year
// (a 426 NONEXISTENT_VERSION response means this pin has expired — bump it).
// Overridable via env so an expired pin doesn't require a code change to fix.
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see marketing/.env.example).`);
  return value;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_API_VERSION,
    'Content-Type': 'application/json',
  };
}

// Uploads a local image and returns its urn:li:image:... id. Two steps per LinkedIn's
// Images API: initializeUpload (returns a one-time uploadUrl + the image urn), then a raw
// binary PUT to that url. The urn is usable in a post immediately after the PUT succeeds.
async function uploadImage(filePath, { authorUrn, accessToken } = {}) {
  const token = accessToken || requireEnv('LINKEDIN_ACCESS_TOKEN');
  const owner = authorUrn || requireEnv('LINKEDIN_AUTHOR_URN');

  const init = await axios.post(
    `${LINKEDIN_API_BASE}/images?action=initializeUpload`,
    { initializeUploadRequest: { owner } },
    { headers: headers(token) }
  );
  const { uploadUrl, image } = init.data.value;

  await axios.put(uploadUrl, fs.readFileSync(filePath), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity,
  });

  return image; // urn:li:image:...
}

// authorUrn: "urn:li:person:xxxx" (personal profile) or "urn:li:organization:xxxx" (company
// page — posting as an organization needs Marketing Developer Platform / Community
// Management API partnership approval, not just a personal OAuth token).
// opts.imagePath: optional local PNG/JPG to attach (uploaded first via uploadImage).
async function publishLinkedInPost(text, { authorUrn, accessToken, imagePath, imageAltText } = {}) {
  const token = accessToken || requireEnv('LINKEDIN_ACCESS_TOKEN');
  const author = authorUrn || requireEnv('LINKEDIN_AUTHOR_URN');

  let content;
  if (imagePath) {
    const imageUrn = await uploadImage(imagePath, { authorUrn: author, accessToken: token });
    content = { media: { id: imageUrn, ...(imageAltText && { altText: imageAltText }) } };
  }

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
      ...(content && { content }),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
    { headers: headers(token) }
  );

  // LinkedIn returns the new post's URN in the x-restli-id response header, not the body.
  return { postUrn: response.headers['x-restli-id'], status: response.status };
}

module.exports = { publishLinkedInPost, uploadImage };
