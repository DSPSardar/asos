const crypto = require('crypto');
const env = require('../config/env');

const isPasswordResetEmailConfigured = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

// Same Resend credentials, different purpose — named separately so callers
// read as intent rather than piggybacking on the password-reset check.
const isDigestEmailConfigured = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const buildPasswordResetHtml = (resetUrl) => {
  const safeUrl = escapeHtml(resetUrl);
  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#030712;font-family:Arial,sans-serif;color:#e2e8f0">
        <div style="max-width:560px;margin:0 auto;padding:40px 20px">
          <div style="background:#0f172a;border:1px solid #273449;border-radius:20px;padding:32px">
            <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:24px">ASOS</div>
            <h1 style="font-size:24px;line-height:1.3;color:#fff;margin:0 0 12px">Reset your password</h1>
            <p style="font-size:15px;line-height:1.7;color:#94a3b8;margin:0 0 24px">
              We received a request to reset your ASOS password. This secure link expires in 60 minutes and can only be used once.
            </p>
            <a href="${safeUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px">
              Choose a new password
            </a>
            <p style="font-size:13px;line-height:1.6;color:#64748b;margin:24px 0 0">
              If you did not request this, you can safely ignore this email. Your password will not change.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
};

const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  if (!isPasswordResetEmailConfigured()) {
    throw new Error('Password reset email is not configured');
  }

  const idempotencyKey = `password-reset-${crypto.createHash('sha256').update(resetUrl).digest('hex')}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: `ASOS <${env.EMAIL_FROM}>`,
      to: [to],
      subject: 'Reset your ASOS password',
      html: buildPasswordResetHtml(resetUrl),
      text: `Reset your ASOS password using this secure link (valid for 60 minutes): ${resetUrl}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error(`Resend rejected password reset email (${response.status})`);
  }

  return { id: payload.id };
};

const buildDigestHtml = ({ brandName, bullets, dashboardUrl }) => {
  const items = bullets.length
    ? bullets.map((b) => `<li style="margin:0 0 10px;line-height:1.65">${escapeHtml(b)}</li>`).join('')
    : '<li style="margin:0;line-height:1.65">No classified activity in the last 7 days yet.</li>';

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#030712;font-family:Arial,sans-serif;color:#e2e8f0">
        <div style="max-width:600px;margin:0 auto;padding:40px 20px">
          <div style="background:#0f172a;border:1px solid #273449;border-radius:20px;padding:32px">
            <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:6px">ASOS</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:24px">${escapeHtml(brandName)} — week to ${new Date().toISOString().slice(0, 10)}</div>
            <h1 style="font-size:24px;line-height:1.3;color:#fff;margin:0 0 20px">Your weekly digest</h1>
            <ul style="font-size:15px;color:#cbd5e1;padding-left:20px;margin:0 0 28px">${items}</ul>
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px">
              Open the dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  `;
};

const sendDigestEmail = async ({ to, brandName, bullets = [], dashboardUrl }) => {
  if (!isDigestEmailConfigured()) {
    throw new Error('Digest email is not configured (RESEND_API_KEY / EMAIL_FROM)');
  }

  // One digest per recipient per day, regardless of retries or a manual
  // "send now" landing on the same day as the cron.
  const day = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `digest-${crypto.createHash('sha256').update(`${to}-${day}`).digest('hex')}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: `ASOS <${env.EMAIL_FROM}>`,
      to: [to],
      subject: `Weekly digest — ${brandName}`,
      html: buildDigestHtml({ brandName, bullets, dashboardUrl }),
      text: `Weekly digest — ${brandName}\n\n${bullets.map((b) => `• ${b}`).join('\n') || 'No classified activity in the last 7 days yet.'}\n\n${dashboardUrl}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error(`Resend rejected digest email (${response.status})`);
  }

  return { id: payload.id };
};

// Same Resend credentials again — see isDigestEmailConfigured for why the
// checks are named per purpose instead of shared.
const isAlertEmailConfigured = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

const buildAlertHtml = ({ brandName, title, lines, ctaUrl, ctaLabel }) => {
  const items = lines
    .map((l) => `<p style="font-size:15px;line-height:1.65;color:#cbd5e1;margin:0 0 8px">${escapeHtml(l)}</p>`)
    .join('');
  const cta = ctaUrl
    ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px">${escapeHtml(ctaLabel || 'Open the dashboard')}</a>`
    : '';
  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;background:#030712;font-family:Arial,sans-serif;color:#e2e8f0">
        <div style="max-width:600px;margin:0 auto;padding:40px 20px">
          <div style="background:#0f172a;border:1px solid #273449;border-radius:20px;padding:32px">
            <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:6px">ASOS</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:24px">${escapeHtml(brandName)}</div>
            <h1 style="font-size:22px;line-height:1.3;color:#fff;margin:0 0 20px">${escapeHtml(title)}</h1>
            ${items}
            ${cta}
          </div>
        </div>
      </body>
    </html>
  `;
};

// Real-time admin alert (hot lead / handoff) — the email fallback for when
// the WhatsApp copy couldn't be delivered. Unlike the digest this may fire
// several times a day, so the idempotency key buckets to the minute: retries
// of the same alert dedupe, distinct alerts don't.
const sendAlertEmail = async ({ to, brandName, subject, lines = [], ctaUrl = null, ctaLabel = 'Open the dashboard' }) => {
  if (!isAlertEmailConfigured()) {
    throw new Error('Alert email is not configured (RESEND_API_KEY / EMAIL_FROM)');
  }

  const bucket = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const idempotencyKey = `alert-${crypto.createHash('sha256').update(`${to}-${subject}-${bucket}`).digest('hex')}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: `ASOS <${env.EMAIL_FROM}>`,
      to: [to],
      subject,
      html: buildAlertHtml({ brandName, title: subject, lines, ctaUrl, ctaLabel }),
      text: `${lines.join('\n')}${ctaUrl ? `\n\n${ctaUrl}` : ''}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw new Error(`Resend rejected alert email (${response.status})`);
  }

  return { id: payload.id };
};

module.exports = {
  isPasswordResetEmailConfigured, sendPasswordResetEmail,
  isDigestEmailConfigured, sendDigestEmail,
  isAlertEmailConfigured, sendAlertEmail,
};
