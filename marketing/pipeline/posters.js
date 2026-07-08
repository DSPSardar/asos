#!/usr/bin/env node
// marketing/pipeline/posters.js
// Renders a Repurposer asset into ready-to-post branded poster images:
//   - one 1080x1350 slide per carousel_slides entry (Instagram carousel format)
//   - one 1080x1920 story/status poster from whatsapp_status_text
//
// Deliberately NOT an AI image model: carousel slides are text-first, and image models
// mangle text. Instead each slide is an HTML template in the DSP design system (navy/gold)
// screenshotted by the headless Chrome already installed on this Mac — exact text, exact
// brand, every time. visual_note from the Content Writer is printed on a hidden-in-post
// footer? No — it's for the human editor; we keep slides clean and put notes in a sidecar.
//
// Usage:
//   node pipeline/posters.js                          # today's repurposer.json
//   node pipeline/posters.js --asset=path/to/repurposer.json
//
// Output: <asset dir>/posters/slide-01.png … + status-story.png + posters-notes.md

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { PATHS } = require('./config');

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function findChrome() {
  const found = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Headless Chrome not found — install Google Chrome or set CHROME_BIN.');
  return process.env.CHROME_BIN || found;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shared design tokens — keep in sync with public/styles.css
const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, 'Helvetica Neue', sans-serif;
    background: linear-gradient(160deg, #1b2a4a 0%, #14203a 100%);
    color: #ffffff; width: 100vw; height: 100vh; overflow: hidden;
    display: flex; flex-direction: column; padding: 72px;
  }
  .goldbar { width: 120px; height: 10px; background: #c9a227; border-radius: 5px; margin-bottom: 48px; }
  .slide-text { flex: 1; display: flex; align-items: center; }
  .slide-text h1 { font-weight: 800; line-height: 1.18; letter-spacing: -0.5px; white-space: pre-wrap; }
  .cover h1 { font-size: 88px; }
  .body-slide h1 { font-size: 64px; font-weight: 700; }
  .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 40px; }
  .wordmark { display: flex; align-items: center; gap: 18px; }
  .wordmark .dsp {
    width: 72px; height: 72px; border-radius: 16px; background: #c9a227; color: #14203a;
    display: grid; place-items: center; font-weight: 800; font-size: 26px; letter-spacing: 1px;
  }
  .wordmark .name { font-size: 26px; font-weight: 600; color: #b6c1d8; }
  .counter { font-size: 28px; font-weight: 700; color: #c9a227; }
  .formula { font-size: 30px; color: #93a1bd; margin-top: 20px; font-weight: 500; }
  .accent { color: #c9a227; }
`;

function slideHtml({ text, isCover, index, total, showFormula }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="goldbar"></div>
  <div class="slide-text ${isCover ? 'cover' : 'body-slide'}"><h1>${esc(text)}</h1></div>
  ${showFormula ? `<div class="formula">Agent = <span class="accent">Claude + Job Description + Tools + Loop</span></div>` : ''}
  <div class="footer">
    <div class="wordmark"><div class="dsp">DSP</div><div class="name">Digital Services Program</div></div>
    <div class="counter">${index}/${total}</div>
  </div>
</body></html>`;
}

function storyHtml(text) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  body { padding: 96px 72px; }
  .slide-text h1 { font-size: 92px; }
  </style></head>
<body>
  <div class="goldbar"></div>
  <div class="slide-text cover"><h1>${esc(text)}</h1></div>
  <div class="footer"><div class="wordmark"><div class="dsp">DSP</div><div class="name">digitalservicesprogram.com</div></div></div>
</body></html>`;
}

function render(chrome, html, outPng, { width, height }) {
  const tmp = path.join(os.tmpdir(), `dsp-poster-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${width},${height}`, `--screenshot=${outPng}`, `file://${tmp}`,
    ], { stdio: 'pipe' });
  } finally {
    fs.unlinkSync(tmp);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const assetPath = args.asset || path.join(PATHS.output, date, 'repurposer.json');
  if (!fs.existsSync(assetPath)) {
    console.error(`No asset at ${assetPath} — run the pipeline first or pass --asset=<path>.`);
    process.exit(1);
  }
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
  const outDir = path.join(path.dirname(assetPath), 'posters');
  fs.mkdirSync(outDir, { recursive: true });
  const chrome = findChrome();

  const slides = asset.carousel_slides || [];
  const notes = ['# Poster render notes', '', `Source: ${assetPath}`, ''];

  slides.forEach((slide, i) => {
    const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    render(chrome, slideHtml({
      text: slide.text,
      isCover: i === 0,
      index: i + 1,
      total: slides.length,
      // The formula strip goes on the cover only — body slides stay clean.
      showFormula: i === 0,
    }), file, { width: 1080, height: 1350 });
    notes.push(`- slide-${String(i + 1).padStart(2, '0')}.png — editor note: ${slide.visual_note || '(none)'}`);
    console.log(`✓ ${path.relative(process.cwd(), file)}`);
  });

  if (asset.whatsapp_status_text) {
    const file = path.join(outDir, 'status-story.png');
    render(chrome, storyHtml(asset.whatsapp_status_text), file, { width: 1080, height: 1920 });
    notes.push(`- status-story.png — 1080x1920 for WhatsApp status / IG story`);
    console.log(`✓ ${path.relative(process.cwd(), file)}`);
  }

  // Slideshow reel: the carousel slides as a 1080x1920 vertical MP4, ~2.8s per slide,
  // slides letterboxed onto the navy background. Silent by design — the standard playbook
  // is adding a trending sound inside the TikTok/Instagram app (which also helps reach);
  // baking in licensed-music-free audio would just get replaced anyway.
  // The filmed-with-a-human reel_script remains the primary reel; this is the no-filming
  // fallback so every day has SOME postable vertical video.
  if (slides.length && fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
    const reelPath = path.join(outDir, 'slideshow-reel.mp4');
    try {
      execFileSync('/opt/homebrew/bin/ffmpeg', [
        '-y', '-framerate', '1/2.8',
        '-i', path.join(outDir, 'slide-%02d.png'),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x14203a,format=yuv420p',
        '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        reelPath,
      ], { stdio: 'pipe' });
      notes.push(`- slideshow-reel.mp4 — ${slides.length} slides x 2.8s, silent; add trending audio in-app before posting`);
      console.log(`✓ ${path.relative(process.cwd(), reelPath)}`);
    } catch (err) {
      console.error(`slideshow reel failed (posters unaffected): ${err.message}`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'posters-notes.md'), notes.join('\n') + '\n');
  console.log(`\n${slides.length} carousel slides + story poster → ${path.relative(process.cwd(), outDir)}/`);
}

main();
