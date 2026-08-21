// scripts/change-password.js
// Change any user's password from the terminal — the admin dashboard has no
// change-password UI yet, and the seeded superadmin credential is public in
// the README, so this is the rotation path.
//
//   DATABASE_URL="postgresql://..." node scripts/change-password.js
//
// Email and password are prompted interactively (password input hidden) so
// the password never appears in argv, shell history, or process listings.
// Hashing matches the app exactly: bcryptjs, 12 salt rounds (see
// auth.service.js login/register/reset — all use bcrypt.hash(pw, 12)).
// Existing refresh tokens for the user are revoked, same as the app's own
// password-change flow, so stolen/old sessions die with the old password.

require('dotenv').config();

const readline = require('readline');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const MIN_PASSWORD_LENGTH = 10;

// connection_limit=1 keeps the session-level RLS scope below on the same
// connection as the queries (users is RLS-exempt today, but this keeps the
// script correct if that ever changes).
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'connection_limit=1' } },
});

// One shared readline interface for every prompt, with our own line queue.
// Piped stdin arrives as one chunk and readline emits every line in it
// back-to-back — lines that land between two rl.question() calls are
// silently discarded, so with question() alone the second prompt never got
// its answer. A persistent 'line' listener queues what hasn't been asked
// for yet; each prompt then takes the next queued line or waits for one.
// Terminal mode only on a real TTY (needed for the masking hook below;
// with piped input it also stops the answer callback from ever firing).
const isTTY = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: isTTY });
rl.stdoutMuted = false;
// Hidden-input hook (TTY only): echo '*' per keystroke instead of the
// typed character.
rl._writeToOutput = function (str) {
  if (this.stdoutMuted) this.output.write('*');
  else this.output.write(str);
};

const lineQueue = [];
let waiting = null; // { resolve, reject } of the prompt currently blocked on input
let stdinClosed = false;
rl.on('line', (line) => {
  if (waiting) { const w = waiting; waiting = null; w.resolve(line); }
  else lineQueue.push(line);
});
rl.on('close', () => {
  stdinClosed = true;
  if (waiting) {
    const w = waiting; waiting = null;
    w.reject(new Error('Input ended before the prompt was answered — nothing changed.'));
  }
});

const nextLine = () => {
  if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift());
  if (stdinClosed) return Promise.reject(new Error('Input ended before the prompt was answered — nothing changed.'));
  return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
};

const ask = async (question) => {
  process.stdout.write(question);
  return (await nextLine()).trim();
};

// Masking needs a real terminal; with piped input there is nothing on
// screen to hide anyway.
const askHidden = async (question) => {
  if (!isTTY) return ask(question);
  process.stdout.write(question);
  rl.stdoutMuted = true;
  try {
    return await nextLine();
  } finally {
    rl.stdoutMuted = false;
    process.stdout.write('\n');
  }
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const email = (await ask('Email of the user: ')).toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('That does not look like an email address.');
    process.exit(1);
  }

  const password = await askHidden('New password (hidden): ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const confirm = await askHidden('Repeat new password (hidden): ');
  if (password !== confirm) {
    console.error('Passwords do not match — nothing changed.');
    process.exit(1);
  }

  await prisma.$executeRaw`SELECT set_config('app.rls_scope', 'system', FALSE)`;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
  if (!user) {
    console.error(`No user found with email ${email} — nothing changed.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    // refreshTokenHash: null revokes every existing session, matching the
    // app's own password-change behavior (auth.service.js).
    data: { passwordHash, refreshTokenHash: null },
  });

  console.log(`updated (${user.role} ${user.email} — existing sessions revoked)`);
}

main()
  .catch((e) => { console.error(e.message || e); process.exit(1); })
  .finally(() => { rl.close(); return prisma.$disconnect(); });
