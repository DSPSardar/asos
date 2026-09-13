// test/_fakePrisma.js — tiny in-memory Prisma stand-in for tests that need
// the Mastery webhook → automation chain without Postgres. Supports the
// subset of the query API those code paths use. Inject BEFORE requiring any
// module that pulls in src/config/database.js:
//
//   const { installFakePrisma } = require('./_fakePrisma');
//   const db = installFakePrisma();
'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

const MODELS = ['tenant', 'contact', 'lead', 'leadStageHistory', 'activity', 'conversation', 'message',
  'automationRule', 'automationRun', 'aiAgentLog', 'subscription', 'aiConfig', 'inboundMedia'];

const RELATIONS = {
  // model: { field: [relatedModel, localKey, foreignKey, isList] }
  lead: { contact: ['contact', 'contactId', 'id', false], conversations: ['conversation', 'id', 'leadId', true], automationRuns: ['automationRun', 'id', 'leadId', true] },
  conversation: { lead: ['lead', 'leadId', 'id', false], contact: ['contact', 'contactId', 'id', false], messages: ['message', 'id', 'conversationId', true] },
  contact: { leads: ['lead', 'id', 'contactId', true] },
  automationRule: { runs: ['automationRun', 'id', 'ruleId', true] },
};

const cmp = (a, b) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};

const makeDb = () => {
  const tables = Object.fromEntries(MODELS.map((m) => [m, []]));

  const matchValue = (row, model, key, cond) => {
    const rel = RELATIONS[model]?.[key];
    if (rel) {
      const [relModel, localKey, foreignKey, isList] = rel;
      const related = tables[relModel].filter((r) => r[foreignKey] === row[localKey]);
      if (isList) {
        if (cond && typeof cond === 'object' && 'none' in cond) return !related.some((r) => matchWhere(r, relModel, cond.none));
        if (cond && typeof cond === 'object' && 'some' in cond) return related.some((r) => matchWhere(r, relModel, cond.some));
        if (cond && typeof cond === 'object' && 'every' in cond) return related.every((r) => matchWhere(r, relModel, cond.every));
        return false;
      }
      const one = related[0];
      if (cond === null) return !one;
      if (!one) return false;
      return matchWhere(one, relModel, cond);
    }
    const v = row[key];
    if (cond === null) return v == null;
    if (cond instanceof Date || typeof cond !== 'object') return cmp(v, cond) === 0;
    if (Array.isArray(cond)) return JSON.stringify(v) === JSON.stringify(cond);
    // JSON path filter: { path: [...], equals }
    if ('path' in cond) {
      let cur = v;
      for (const p of cond.path) cur = cur == null ? undefined : cur[p];
      return cur === cond.equals;
    }
    for (const [op, arg] of Object.entries(cond)) {
      if (op === 'mode') continue;
      const ci = cond.mode === 'insensitive';
      const sv = ci ? String(v ?? '').toLowerCase() : String(v ?? '');
      const sa = ci ? String(arg ?? '').toLowerCase() : String(arg ?? '');
      if (op === 'equals' && !(ci ? sv === sa : cmp(v, arg) === 0)) return false;
      if (op === 'not' && (arg === null ? v == null : cmp(v, arg) === 0)) return false;
      if (op === 'in' && !arg.some((a) => cmp(v, a) === 0)) return false;
      if (op === 'notIn' && arg.some((a) => cmp(v, a) === 0)) return false;
      if (op === 'gte' && !(v != null && cmp(v, arg) >= 0)) return false;
      if (op === 'gt' && !(v != null && cmp(v, arg) > 0)) return false;
      if (op === 'lte' && !(v != null && cmp(v, arg) <= 0)) return false;
      if (op === 'lt' && !(v != null && cmp(v, arg) < 0)) return false;
      if (op === 'contains' && !sv.includes(sa)) return false;
      if (op === 'endsWith' && !sv.endsWith(sa)) return false;
      if (op === 'startsWith' && !sv.startsWith(sa)) return false;
    }
    return true;
  };

  const matchWhere = (row, model, where = {}) => {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') { if (!cond.every((w) => matchWhere(row, model, w))) return false; continue; }
      if (key === 'OR') { if (!cond.some((w) => matchWhere(row, model, w))) return false; continue; }
      if (key === 'NOT') { if (matchWhere(row, model, cond)) return false; continue; }
      // compound unique keys like tenantId_phone: { tenantId, phone }
      if (key.includes('_') && cond && typeof cond === 'object' && !('in' in cond) && !RELATIONS[model]?.[key] && !(key in row)) {
        if (!matchWhere(row, model, cond)) return false; continue;
      }
      if (!matchValue(row, model, key, cond)) return false;
    }
    return true;
  };

  const orderRows = (rows, orderBy) => {
    if (!orderBy) return rows;
    const list = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [k, dir] = Object.entries(o)[0];
        const c = cmp(a[k], b[k]);
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  };

  // include / select: attach relations (list relations honour orderBy/take/select)
  const shape = (row, model, { include, select } = {}) => {
    if (!row) return row;
    const spec = select || include;
    if (!spec) return { ...row };
    const out = select ? {} : { ...row };
    for (const [k, v] of Object.entries(spec)) {
      if (!v) continue;
      const rel = RELATIONS[model]?.[k];
      if (!rel) { if (select) out[k] = row[k]; continue; }
      const [relModel, localKey, foreignKey, isList] = rel;
      let related = tables[relModel].filter((r) => r[foreignKey] === row[localKey]);
      const sub = typeof v === 'object' ? v : {};
      if (sub.where) related = related.filter((r) => matchWhere(r, relModel, sub.where));
      related = orderRows(related, sub.orderBy);
      if (sub.take) related = related.slice(0, sub.take);
      const shaped = related.map((r) => shape(r, relModel, { select: sub.select, include: sub.include }));
      out[k] = isList ? shaped : (shaped[0] || null);
    }
    return out;
  };

  const withDefaults = (model, data) => {
    const now = new Date();
    const row = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
    if (model === 'message') { row.sentAt = row.sentAt || now; row.direction = row.direction || 'OUTBOUND'; }
    if (model === 'lead') { row.stage = row.stage || 'NEW'; row.qualificationData = row.qualificationData || {}; row.aiScore = row.aiScore ?? 0; }
    if (model === 'conversation') { row.status = row.status || 'ACTIVE'; row.aiEnabled = row.aiEnabled ?? true; row.paymentProofDetected = row.paymentProofDetected ?? false; }
    if (model === 'automationRun') { row.step = row.step ?? 1; }
    if (model === 'contact') { row.optIn = row.optIn ?? false; row.sentWelcomeVoice = row.sentWelcomeVoice ?? false; }
    return row;
  };

  const applyUpdate = (row, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) row[k] = (Number(row[k]) || 0) + Number(v.increment);
      else row[k] = v;
    }
    row.updatedAt = new Date();
    return row;
  };

  const delegate = (model) => ({
    findMany: async ({ where = {}, orderBy, take, skip = 0, select, include, distinct } = {}) => {
      let rows = tables[model].filter((r) => matchWhere(r, model, where));
      rows = orderRows(rows, orderBy);
      if (distinct) { const seen = new Set(); rows = rows.filter((r) => { const k = distinct.map((d) => r[d]).join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); }
      rows = rows.slice(skip, take ? skip + take : undefined);
      return rows.map((r) => shape(r, model, { select, include }));
    },
    findFirst: async (args = {}) => (await delegate(model).findMany({ ...args, take: 1 }))[0] || null,
    findUnique: async (args = {}) => (await delegate(model).findMany({ ...args, take: 1 }))[0] || null,
    count: async ({ where = {} } = {}) => tables[model].filter((r) => matchWhere(r, model, where)).length,
    create: async ({ data, select, include }) => { const row = withDefaults(model, data); tables[model].push(row); return shape(row, model, { select, include }); },
    update: async ({ where, data, select, include }) => {
      const row = tables[model].find((r) => matchWhere(r, model, where));
      if (!row) throw new Error(`fakePrisma: ${model}.update — no row matches ${JSON.stringify(where)}`);
      return shape(applyUpdate(row, data), model, { select, include });
    },
    updateMany: async ({ where = {}, data }) => { const rows = tables[model].filter((r) => matchWhere(r, model, where)); rows.forEach((r) => applyUpdate(r, data)); return { count: rows.length }; },
    upsert: async ({ where, create, update, select, include }) => {
      const row = tables[model].find((r) => matchWhere(r, model, where));
      if (row) return shape(applyUpdate(row, update), model, { select, include });
      const created = withDefaults(model, create); tables[model].push(created); return shape(created, model, { select, include });
    },
    deleteMany: async ({ where = {} } = {}) => { const before = tables[model].length; tables[model] = tables[model].filter((r) => !matchWhere(r, model, where)); return { count: before - tables[model].length }; },
    delete: async ({ where }) => { const i = tables[model].findIndex((r) => matchWhere(r, model, where)); if (i === -1) throw new Error('not found'); return tables[model].splice(i, 1)[0]; },
  });

  const db = { _tables: tables };
  for (const m of MODELS) db[m] = delegate(m);
  db.$transaction = async (fnOrArr) => (typeof fnOrArr === 'function' ? fnOrArr(db) : Promise.all(fnOrArr));
  db.$queryRaw = async () => [];
  db.$disconnect = async () => {};
  db.assertRlsEnforceable = async () => true;
  return db;
};

const installFakePrisma = () => {
  const db = makeDb();
  const dbPath = path.resolve(__dirname, '../src/config/database.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  // redis: the automation engine and sweep only touch it for locks/caches.
  const redisPath = path.resolve(__dirname, '../src/config/redis.js');
  const store = new Map();
  const fakeRedis = {
    status: 'ready',
    get: async (k) => store.get(k) ?? null,
    set: async (k, v, ...rest) => { if (rest.includes('NX') && store.has(k)) return null; store.set(k, v); return 'OK'; },
    del: async (k) => (store.delete(k) ? 1 : 0),
    eval: async () => 1, quit: async () => {}, connect: async () => {}, on: () => {},
    sadd: async () => 1, smembers: async () => [], srem: async () => 1, expire: async () => 1, hgetall: async () => ({}), hset: async () => 1, hdel: async () => 1,
    _store: store,
  };
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: fakeRedis };
  return db;
};

module.exports = { installFakePrisma, makeDb };
