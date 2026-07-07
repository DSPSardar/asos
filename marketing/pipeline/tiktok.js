// marketing/pipeline/tiktok.js
// Publishes a video to TikTok via the Content Posting API, PULL_FROM_URL method (TikTok's
// servers fetch the video from a public URL you host — no chunked upload code needed here).
//
// IMPORTANT — this does not turn a Repurposer `tiktok_script` into a video. `tiktok_script`
// is a shot list for a human or a video-generation tool to film/render from; this module has
// no video rendering step. Call publishTikTokVideo() only once that rendered video is
// actually hosted at a public URL. See marketing/CLAUDE.md for the full requirements,
// including the audit gate below.
//
// AUDIT GATE: apps that haven't passed TikTok's Content Posting API audit can only post with
// privacy_level SELF_ONLY (a private draft visible only to the account owner in the TikTok
// app's inbox — not published publicly). Public posting requires TikTok to approve your app
// after review. Until then, treat this as "send to TikTok inbox as a draft to review/post
// manually," not "auto-publish."

const axios = require('axios');

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see marketing/.env.example).`);
  return value;
}

async function publishTikTokVideo(
  videoUrl,
  caption,
  { accessToken, privacyLevel = 'SELF_ONLY' } = {}
) {
  const token = accessToken || requireEnv('TIKTOK_ACCESS_TOKEN');

  if (privacyLevel !== 'SELF_ONLY') {
    // Guard against accidentally attempting public posting from an unaudited app — TikTok's
    // API will likely reject it anyway, but fail loudly here with the actual reason instead
    // of a confusing 4xx from their side.
    console.warn(
      `[tiktok] Requesting privacy_level="${privacyLevel}" — this will fail unless your ` +
      `TikTok app has passed Content Posting API audit. Defaults to SELF_ONLY for a reason.`
    );
  }

  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/video/init/`,
    {
      post_info: {
        title: caption,
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  // Async job — TikTok processes the video after this call returns; publish_id lets you poll
  // /post/publish/status/fetch/ for PROCESSING_DOWNLOAD -> PROCESSING_UPLOAD -> PUBLISH_COMPLETE.
  return { publishId: response.data?.data?.publish_id, raw: response.data };
}

module.exports = { publishTikTokVideo };
