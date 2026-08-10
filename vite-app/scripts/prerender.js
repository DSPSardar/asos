// scripts/prerender.js — post-build step. Injects the statically rendered
// nav + hero into dist/index.html's #root so the LCP element (the hero
// <h1>) paints from HTML instead of waiting on the JS bundle.
//
// Runs after both `vite build` and `vite build --config vite.ssr.config.js`.
// Fails loudly: a silent no-op here would ship a slower page while looking
// like it succeeded, which is exactly the failure mode this step exists to
// prevent.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const htmlPath = path.join(root, 'dist', 'index.html');
const bundlePath = path.join(root, 'dist-ssr', 'prerender-entry.js');

for (const [label, p] of [['dist/index.html', htmlPath], ['dist-ssr bundle', bundlePath]]) {
  if (!existsSync(p)) {
    console.error(`[prerender] ${label} not found at ${p} — did the build run?`);
    process.exit(1);
  }
}

const { render } = await import(pathToFileUrl(bundlePath));
const markup = render();

if (!markup || !markup.includes('<h1')) {
  console.error('[prerender] rendered markup is empty or has no <h1> — refusing to write.');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const ROOT_DIV = '<div id="root"></div>';

if (!html.includes(ROOT_DIV)) {
  console.error(`[prerender] could not find ${ROOT_DIV} in dist/index.html.`);
  process.exit(1);
}

writeFileSync(htmlPath, html.replace(ROOT_DIV, `<div id="root">${markup}</div>`), 'utf8');
console.log(`[prerender] injected ${markup.length} bytes of above-the-fold markup into dist/index.html`);

// Node needs a file:// URL to dynamic-import an absolute path on Windows,
// and it is harmless on POSIX.
function pathToFileUrl(p) {
  return new URL(`file://${p}`).href;
}
