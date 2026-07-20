const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://asos:password@localhost:5432/asos',
  JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars',
  ANTHROPIC_API_KEY: 'sk-ant-test-key',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'noreply@example.com',
  PASSWORD_RESET_URL: 'https://asos-kappa.vercel.app/reset-password',
});

const state = {
  user: { id: 'user-1', email: 'person@example.com', isActive: true },
  update: null,
  updateMany: null,
  updateManyCount: 1,
  sent: [],
  sendError: null,
};

const prismaMock = {
  user: {
    findUnique: async () => state.user,
    update: async (args) => { state.update = args; return {}; },
    updateMany: async (args) => { state.updateMany = args; return { count: state.updateManyCount }; },
  },
};

const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: prismaMock };

const emailServicePath = require.resolve('../src/services/email.service');
require.cache[emailServicePath] = {
  id: emailServicePath,
  filename: emailServicePath,
  loaded: true,
  exports: {
    isPasswordResetEmailConfigured: () => true,
    sendPasswordResetEmail: async (message) => {
      if (state.sendError) throw state.sendError;
      state.sent.push(message);
      return { id: 'email-1' };
    },
  },
};

const authService = require('../src/modules/auth/auth.service');

test('password reset flow', async (t) => {
  await t.test('stores only a token hash and emails the raw one-time token', async () => {
    state.user = { id: 'user-1', email: 'person@example.com', isActive: true };
    state.update = null;
    state.sent = [];

    const result = await authService.requestPasswordReset('PERSON@example.com');

    assert.deepEqual(result, { requested: true });
    assert.equal(state.sent.length, 1);
    const resetUrl = new URL(state.sent[0].resetUrl);
    const rawToken = resetUrl.searchParams.get('token');
    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.equal(
      state.update.data.passwordResetTokenHash,
      crypto.createHash('sha256').update(rawToken).digest('hex'),
    );
    assert.ok(state.update.data.passwordResetExpiresAt > new Date());
    assert.equal(JSON.stringify(state.update).includes(rawToken), false);
  });

  await t.test('does not disclose whether an account exists', async () => {
    state.user = null;
    state.sent = [];
    const result = await authService.requestPasswordReset('missing@example.com');
    assert.deepEqual(result, { requested: true });
    assert.equal(state.sent.length, 0);
  });

  await t.test('atomically consumes a valid token and revokes refresh sessions', async () => {
    state.updateManyCount = 1;
    state.updateMany = null;
    const rawToken = 'ab'.repeat(32);

    const result = await authService.resetPassword({ token: rawToken, password: 'StrongPassword123!' });

    assert.deepEqual(result, { changed: true });
    assert.equal(
      state.updateMany.where.passwordResetTokenHash,
      crypto.createHash('sha256').update(rawToken).digest('hex'),
    );
    assert.equal(state.updateMany.data.passwordResetTokenHash, null);
    assert.equal(state.updateMany.data.passwordResetExpiresAt, null);
    assert.equal(state.updateMany.data.refreshTokenHash, null);
    assert.equal(await bcrypt.compare('StrongPassword123!', state.updateMany.data.passwordHash), true);
  });

  await t.test('rejects an expired or already-used token', async () => {
    state.updateManyCount = 0;
    await assert.rejects(
      authService.resetPassword({ token: 'cd'.repeat(32), password: 'StrongPassword123!' }),
      /invalid or has expired/i,
    );
  });
});
