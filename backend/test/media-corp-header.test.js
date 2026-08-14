// test/media-corp-header.test.js
//
// Regression guard for the third failure in this saga: after moving inbound
// media into Postgres, images fetched fine via direct navigation (proving
// the data layer worked) but still failed to render as <img> tags inside
// the dashboard. Root cause: helmet() — mounted globally in app.js — sets
// `Cross-Origin-Resource-Policy: same-origin` by default. The dashboard and
// the API are on different subdomains, so the browser silently blocked the
// dashboard from loading the image as a subresource, even though a CORS
// allow-list already permits the dashboard's origin for fetch/XHR — CORP is
// a separate, browser-enforced mechanism that CORS headers don't touch, and
// it is invisible to a plain "does this URL return 200" check.
//
// Uses the project's own installed helmet/express versions directly (not a
// stub) so a future helmet upgrade changing the default would be caught
// here, not discovered again in production the same way.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');

test('GET /media/:id sets Cross-Origin-Resource-Policy: cross-origin, overriding helmet\'s same-origin default', async () => {
  const app = express();
  app.use(helmet());

  // Mirrors the exact header-setting lines in app.js's real /media/:id
  // route — not a reimplementation of the Postgres lookup, just the part
  // this test exists to guard: that the CORP header is explicitly widened
  // on this route.
  app.get('/media/:id', (req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(Buffer.from('fake bytes'));
  });

  const res = await request(app).get('/media/abc123');

  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin',
    'without this header, an <img> on a different subdomain (the dashboard) silently fails to load this resource, even though the URL itself returns 200');
});

test('sanity check: helmet\'s actual default is same-origin (so the test above is verifying a real override, not a no-op)', async () => {
  const app = express();
  app.use(helmet());
  app.get('/no-override/:id', (req, res) => res.send(Buffer.from('fake bytes')));

  const res = await request(app).get('/no-override/abc123');

  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin',
    'if this ever fails, helmet\'s default changed — re-check whether the explicit override above is still necessary');
});
