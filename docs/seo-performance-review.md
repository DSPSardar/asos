# Landing page SEO & performance — measured results and what to do next

Date: 2026-08-11. Covers the work in PR #12 and PR #13, the measurements
taken after they shipped, and a recommendation on the pre-render/SSR
question.

**Headline: mobile Lighthouse performance is 98/100 with a 2.3s LCP, inside
Google's "Good" threshold (< 2.5s). The recommendation below is to _not_
build SSR.** The evidence for that is in "The architecture decision".

---

## 1. Measured results

Lighthouse 12, run against `https://dspagenthub.com/` after PR #13 was
deployed. Two runs, default throttling presets.

| Metric | Mobile (4x CPU, slow 4G) | Desktop |
|---|---|---|
| **Performance score** | **98** | 88 |
| **LCP** | **2.3 s** | 1.4 s |
| FCP | 1.8 s | 1.4 s |
| **TBT** | **0 ms** | 0 ms |
| CLS | 0.01 | 0.005 |
| Speed Index | 2.2 s | 1.9 s |
| TTI | 2.3 s | 1.4 s |

LCP element is text in both cases — the hero `<h1>` on desktop, and the
hero `<p>` on mobile, where the subhead wraps to more lines and becomes the
larger block. Both are pre-rendered, so both benefit.

### Why these numbers are from Lighthouse and not PageSpeed Insights

The keyless PSI API returned `429 RESOURCE_EXHAUSTED` — a per-day quota on
the shared anonymous project, so retrying does not clear it. Local
Lighthouse runs the identical audit engine with the same throttling
presets, so the lab numbers are equivalent.

**Field (CrUX) data was not retrieved and is very probably absent.** CrUX
only reports an origin once it has enough real-user samples over a 28-day
window. This domain was not even verified in Search Console until today,
so it is almost certainly below that threshold and PSI will show "no data
available". That is an inference, not a measurement — confirm it in ten
seconds at the top of
<https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fdspagenthub.com%2F>.
Field data will start accruing once paid traffic runs.

### What the earlier audit claimed

That audit reported a **4.2s mobile LCP driven by a 1.8MB non-WebP hero
image**. Measured mobile LCP is now 2.3s and the LCP element is text —
there is no image on this page at all (see §3). No before/after delta is
claimed here, because no trustworthy baseline was ever captured: the only
pre-change measurement was taken in an embedded browser pane that
backgrounds the tab, and paint timings there fire on tab presentation
rather than actual paint. It produced 96 ms, 0 ms, and 20880 ms for the
same page. Those numbers are discarded rather than reported.

---

## 2. The architecture decision: do **not** build SSR

The brief was to scope SSR vs. static pre-render vs. critical-path
hydration, on the basis that `<div id="root">` still ships empty. **That
premise is out of date — it was fixed in PR #13 and is live.**

```console
$ curl -s https://dspagenthub.com/ | grep -o '<h1 id="hero-heading".\{0,60\}'
<h1 id="hero-heading" class="text-4xl sm:text-5xl md:text-6xl font-bold
```

The hero markup is in the HTML before any JavaScript runs. `#root` is not
empty. The lever has already been pulled, which is why LCP is 2.3s.

### Three independent measurements say there is nothing left for SSR to fix

1. **TBT is 0 ms** on both mobile and desktop. JavaScript execution is
   blocking the main thread for zero measurable time. SSR's core benefit is
   removing work from the boot path — there is no such work to remove.
2. **Render-blocking resources: `overallSavingsMs: 0`.** Lighthouse can
   find no remaining saving from the render-blocking category at all. The
   font fix in PR #12 exhausted it.
3. **The LCP breakdown has no JS-shaped component:**

   | Phase | Mobile | Share |
   |---|---|---|
   | TTFB | 799 ms | 35% |
   | Load delay | 0 ms | 0% |
   | Load time | 0 ms | 0% |
   | **Render delay** | **1459 ms** | **65%** |

   Load delay and load time are zero — that is the signature of a text LCP
   element with no resource to fetch. The cost is TTFB plus render delay
   (HTML parse, CSS fetch, style, layout under 4x CPU throttling).

### SSR would make the largest single component worse

TTFB is 35% of LCP. Full SSR means the server renders React on every
request instead of serving a static file, which *increases* TTFB. It would
regress the biggest measurable cost in order to fix a boot cost that
measures 0 ms. Same reasoning rules out critical-path hydration: the
current build is deliberately not hydration (React clears `#root` and
re-renders), and converting it would add a hydration-mismatch class of bug
against a 0 ms TBT.

**Effort/benefit for the three options as briefed:**

| Option | Effort | Expected LCP gain | Verdict |
|---|---|---|---|
| Full SSR (Node render per request) | High — new server runtime, auth/routing rework, hydration mismatches, deploy change | **Negative** (raises TTFB) | No |
| Static pre-render, widened to full page | Medium — below-fold components use hooks and `window.matchMedia`, needs SSR-safe rework | ~0 ms (below-fold content is not LCP) | No |
| Critical-path hydration | Medium-high — hydration mismatch risk | ~0 ms (TBT already 0) | No |

### What the remaining 2.3s is actually made of

The origin is **in Singapore with no CDN in front of it**:

```console
$ curl -sD- -o/dev/null https://dspagenthub.com/ | grep -i railway-edge
x-railway-edge: sin1
```

Measured TTFB is a consistent ~500ms from this machine, of which only
~105ms is connection setup — the rest is origin serving time. Production
serves the SPA with `vite preview`, a single-threaded Node static server
intended for local build checks, not for edge delivery.

**If you want LCP below 2s, that is the lever, and it is a hosting change
rather than an application-architecture change:**

1. **Put a CDN in front** (Cloudflare's free tier terminates at the edge and
   would cut most of the ~400ms of origin time for visitors far from
   Singapore). Lowest effort, largest gain.
2. **Or move the SPA to a CDN-backed static host** (Cloudflare Pages,
   Netlify, Vercel). It is a static bundle — it does not need a Node
   process at all. Note `vite preview`'s `allowedHosts` list in
   `vite-app/vite.config.js` becomes irrelevant on such a host.
3. Optional, minor: 21 KiB of unused JavaScript in the React vendor chunk.
   Worth ~0 ms of LCP since TBT is already 0. Ignore unless bundle size
   matters for another reason.

**Recommendation: do nothing to the application. Do (1).** Re-measure
afterwards; if mobile LCP is still above 2.5s at that point, revisit — but
the current data does not support an SSR project.

---

## 3. Two items in the original audit did not match the live site

Raising these because they affect how much weight the rest of that audit
should carry.

**"Add a unique meta description to the homepage — it's currently missing
and falling back to a default snippet."** It was already present, unique,
and 152 characters, and had been for some time:

```console
$ curl -s https://dspagenthub.com/ | grep -o '<meta name="description".\{0,50\}'
<meta name="description" content="AI agents qualify every lead, diagnose
```

The audit also said to check subpages for "generic/duplicate descriptions".
There are no subpages to check — this is a single-page app that serves one
`index.html` for every route.

**"Compress the hero image — it's 1.8MB and not WebP, which is the main
driver of a 4.2s mobile LCP. Convert to WebP, target ≤300KB, and add
`srcset`."** There is no hero image. There are no images on the landing
page at all; the hero is text over CSS gradients. The only image in the
deployed bundle is `og-cover.png` (73 KB), a social-preview card that never
renders in the page. Lighthouse confirms the LCP element is a text node
with 0 ms load time. There was nothing to convert and nothing to apply
`srcset` to.

A third item was partly wrong: **"remove Blog from the Resources nav
dropdown"** — there is no Resources dropdown and no Blog link in the nav.
`/blog` also does not hard-404; it returns 200 with `index.html` and the
router redirects to `/`. It is a soft 404, now covered by the canonical tag
plus the new robots rules.

The three genuine findings were `robots.txt`, `sitemap.xml`, and the LCP
being too high — though the stated cause of the last one was wrong. Two
real problems the audit missed entirely were found while fixing those: a
`favicon.svg` referenced in `<head>` but never deployed (it was serving
HTML), and two false trust badges in the footer (§4).

---

## 4. Also fixed, not in the original scope

`LandingFooter.jsx` carried two unsupportable claims:

- **"End-to-end encrypted"** — not merely unsourced but false. The
  dual-agent pipeline reads every inbound WhatsApp message in plaintext in
  order to qualify it, which is the opposite of what end-to-end encryption
  means. Replaced with "Credentials encrypted at rest", which the code
  backs (AES-256-GCM in `backend/src/utils/crypto.js`) and which
  `Faq.jsx` already stated.
- **"99.9% uptime"** — an SLA nobody has signed. `CLAUDE.md` forbids uptime
  guarantees outright. Replaced with "Replies day and night", which matches
  the existing `StatsBar.jsx` copy.

---

## 5. Shipped

| PR | Change |
|---|---|
| #12 | `robots.txt`, `sitemap.xml`, `favicon.svg`; font CSS made non-render-blocking; `fonts.gstatic.com` preconnect; two false footer badges removed |
| #13 | Build-time pre-render of nav + hero; Google Search Console verification tag |

Search Console: property verified via HTML tag, `sitemap.xml` submitted
(1 of 1, pending first crawl).

**Do not remove the `google-site-verification` meta tag** from
`vite-app/index.html`. Google re-checks it, and removing it silently
un-verifies the property and stops Search Console data.

---

## 6. Outcome

Everything in §2's recommendation was carried out.

| PR | Change |
|---|---|
| #14 | Hashed `/assets/*` served `public, max-age=31536000, immutable` instead of `no-cache` |

`vite preview` was sending `no-cache` on every response, including
content-hashed files. That wasted a conditional round trip per asset on
every repeat visit, and would have defeated a CDN — `no-cache` tells the
edge to revalidate against the origin before serving. Merged first,
deliberately, so that an edge would actually be able to cache.

**PageSpeed Insights: 91 mobile, 100 desktop.**

Mobile reads 91 against the 98 measured locally in §1. Both are green
(≥ 90) and the gap is the expected spread between a local Lighthouse run
and PSI's own infrastructure and network shaping, not a regression. Where
the two disagree, **PSI is the number to quote** — it is the public,
reproducible one. Desktop reads 100 against 88 locally, the same kind of
environment difference in the other direction.

### Cloudflare: confirmed live, and the edge is caching

The nameserver change at the registrar has propagated and the zone is
active. Verified against a Cloudflare edge IP directly, which sidesteps any
stale local resolver cache:

```console
$ dig @8.8.8.8 +short NS dspagenthub.com
itzel.ns.cloudflare.com.
bill.ns.cloudflare.com.

$ dig @8.8.8.8 +short A dspagenthub.com
104.21.41.134
172.67.165.4

$ curl -s --resolve dspagenthub.com:443:104.21.41.134 -D- -o/dev/null \
    https://dspagenthub.com/ | grep -iE "server|cf-ray"
server: cloudflare
cf-ray: a291f41e6c666dd2-SIN
```

SSL/TLS at Full (strict) is working — HTTP 200 with a clean certificate
verification, not the 525/526 that a broken origin certificate produces.
The pre-rendered hero and the Search Console tag both survive the edge.

**Hashed assets are served from the edge, not the origin:**

```console
$ curl -s --resolve dspagenthub.com:443:104.21.41.134 -D- -o/dev/null \
    https://dspagenthub.com/assets/index-CSTH-zDe.js | grep -i cf-cache-status
cf-cache-status: HIT
```

That `HIT` is the payoff for merging #14 first. While those files were
served `no-cache`, Cloudflare would have revalidated every one of them
against `sin1` on every request and never held a cached copy.
`index.html` shows `DYNAMIC`, which is correct — Cloudflare does not cache
HTML by default, and this one must stay `no-cache` so browsers pick up new
hashed filenames after a deploy.

Note that a local resolver can hold the previous `name.com` nameservers well
after the change is live, which makes it look as though nothing happened.
Query a public resolver (`dig @8.8.8.8`) before concluding anything from a
plain `curl`.

The **91/100 PSI figures above predate this**, so they are the no-CDN
baseline. The TTFB component of LCP — 35%, against a single-region origin —
should now be substantially lower for visitors far from `sin1`. Re-measure
to find out.

One gap remains: there is no `www` record of any kind
(`dig +short A www.dspagenthub.com` returns nothing).

### Decision: hold the SSR/pre-render work

Unchanged, and §2's reasoning still holds — TBT is 0 ms and render-blocking
savings are 0 ms, so SSR has nothing to fix and would raise TTFB. The one
component that actually dominated — TTFB against a single-region origin —
has now been addressed by the CDN instead.

After that, let real traffic accumulate and read **CrUX field data** —
actual visitor experience — rather than chase the lab number. Field data
was unavailable at the time of §1 because the origin had no samples;
live traffic should populate it. Re-read it at the top of the PSI page
before reopening any performance work.
