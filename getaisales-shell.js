// getaisales — shared nav + footer injector
(function () {
  const navHTML = `
<nav class="top">
  <div class="nav-inner">
    <a href="getaisales-Landing.html" class="brand" aria-label="getaisales home">
      <div class="brand-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="white" opacity="0.95"/>
          <circle cx="12" cy="12" r="2.5" fill="white" opacity="0.4"/>
        </svg>
      </div>
    </a>
    <div class="nav-links">
      <a href="getaisales-Landing.html#features" class="nav-link">Features</a>
      <a href="getaisales-Landing.html#how" class="nav-link">How it Works</a>
      <a href="getaisales-Landing.html#pricing" class="nav-link">Pricing</a>
      <a href="getaisales-Landing.html#testimonials" class="nav-link">Reviews</a>
    </div>
    <a href="ASOS-Auth.html" class="btn btn-primary">Start Free Trial</a>
  </div>
</nav>`;

  const footerHTML = `
<footer>
  <div class="footer-inner">
    <div class="footer-top">
      <div class="footer-brand-block">
        <div class="footer-brand-row">
          <div class="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="white" opacity="0.95"/>
              <circle cx="12" cy="12" r="2.5" fill="white" opacity="0.4"/>
            </svg>
          </div>
        </div>
        <p class="footer-desc">AI-powered sales automation via WhatsApp and Meta Ads. Close deals while you sleep.</p>
      </div>
      <div class="footer-col">
        <h4>Product</h4>
        <a href="getaisales-Landing.html#features">Features</a>
        <a href="getaisales-Landing.html#pricing">Pricing</a>
        <a href="getaisales-Landing.html#how">How it Works</a>
        <a href="ASOS-Dashboard.html">Dashboard</a>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="about.html">About</a>
        <a href="blog.html">Blog</a>
        <a href="careers.html">Careers</a>
        <a href="contact.html">Contact</a>
      </div>
      <div class="footer-col">
        <h4>Legal</h4>
        <a href="privacy.html">Privacy Policy</a>
        <a href="terms.html">Terms of Service</a>
        <a href="cookies.html">Cookie Policy</a>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="footer-copy">© 2026 getaisales.com · All rights reserved</div>
      <div class="footer-soc">
        <a href="#" aria-label="Twitter">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a href="#" aria-label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11.01-4.13 2.06 2.06 0 01-.01 4.13zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>
        </a>
        <a href="#" aria-label="GitHub">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
        </a>
      </div>
    </div>
  </div>
</footer>`;

  // Inject nav + footer into placeholders
  document.addEventListener('DOMContentLoaded', () => {
    const navMount = document.getElementById('site-nav');
    const footerMount = document.getElementById('site-footer');
    if (navMount) navMount.outerHTML = navHTML;
    if (footerMount) footerMount.outerHTML = footerHTML;

    // Highlight current page in nav (works after injection)
    const path = location.pathname.split('/').pop();
    document.querySelectorAll('.nav-link').forEach(a => {
      if (a.getAttribute('href').includes(path) && path) a.classList.add('active');
    });
  });
})();
