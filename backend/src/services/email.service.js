const crypto = require('crypto');
const env = require('../config/env');

const isPasswordResetEmailConfigured = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

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

module.exports = { isPasswordResetEmailConfigured, sendPasswordResetEmail };
