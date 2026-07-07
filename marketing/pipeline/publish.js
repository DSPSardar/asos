#!/usr/bin/env node
// marketing/pipeline/publish.js
// Publishes a finished Repurposer asset (see schema.js RepurposedAsset) to LinkedIn and/or
// TikTok. Not part of the scout->planner->...->repurposer chain in run.js — run this
// separately, by hand, against a repurposer.json you're ready to actually post.
//
// Usage:
//   node pipeline/publish.js --asset=output/dsp/2026-07-07/repurposer.json --linkedin
//   node pipeline/publish.js --asset=output/dsp/2026-07-07/repurposer.json --tiktok --video-url=https://.../clip.mp4

require('dotenv').config();
const fs = require('fs');
const { publishLinkedInPost } = require('./linkedin');
const { publishTikTokVideo } = require('./tiktok');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) { args[match[1]] = match[2]; continue; }
    const flag = arg.match(/^--([^=]+)$/);
    if (flag) args[flag[1]] = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.asset) {
    console.error('Usage: node pipeline/publish.js --asset=<path to repurposer.json> [--linkedin] [--tiktok --video-url=<url>]');
    process.exit(1);
  }
  if (!args.linkedin && !args.tiktok) {
    console.error('Nothing to do — pass --linkedin and/or --tiktok.');
    process.exit(1);
  }

  const asset = JSON.parse(fs.readFileSync(args.asset, 'utf8'));

  if (args.linkedin) {
    if (!asset.linkedin_post) throw new Error(`${args.asset} has no "linkedin_post" field.`);
    console.log('→ posting to LinkedIn...');
    const result = await publishLinkedInPost(asset.linkedin_post);
    console.log(`✓ LinkedIn post published: ${result.postUrn}`);
  }

  if (args.tiktok) {
    if (!args['video-url']) {
      console.error('--tiktok requires --video-url=<public URL of the rendered video>. tiktok_script is a shot list, not a video — see marketing/pipeline/tiktok.js.');
      process.exit(1);
    }
    const caption = asset.tiktok_script?.[0]?.on_screen_text || asset.source_hook || '';
    console.log('→ submitting to TikTok (PULL_FROM_URL)...');
    const result = await publishTikTokVideo(args['video-url'], caption);
    console.log(`✓ TikTok publish job started: ${result.publishId} (poll /post/publish/status/fetch/ for completion)`);
  }
}

main().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
