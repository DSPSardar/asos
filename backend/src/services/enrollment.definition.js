// src/services/enrollment.definition.js
//
// THE single definition of an "enrolled student" and of "revenue".
//
// Every surface that shows a student count or a revenue figure — the Students
// page, the DSP Reports KPIs, the overview cards, the daily digest — must go
// through this module. Before it existed each page carried its own copy of the
// rule and they drifted three ways (Sep 2026: Students said 375 / Rs 4.93M
// while Reports said 373 / Rs 4.80M on the same database):
//
//   • Students page   — all-time, per lead row,       paid = dealValue != null
//   • Reports KPI     — leads CREATED in period, per contact, paid = dealValue OR enrollmentFee
//   • Reports revenue — leads CLOSED  in period, per lead row, dealValue only
//
// The rule, once:
//   student  = a contact with at least one CLOSED_WON lead that has a recorded
//              fee (dealValue or enrollmentFee, > 0). Won without a fee is a
//              claimed win, not a student — see the CLOSED_WON guards in
//              leads.service.
//   date     = closedAt (the enrollment date). Never createdAt — a lead created
//              in June that paid in September is a September enrollment.
//   unit     = distinct contact. One person, one student, however many lead
//              rows their WhatsApp threads opened.
//   revenue  = sum of that person's fee (latest paid won lead per contact).

// Lazy so the pure helpers (paidWonWhere / feeOf / dedupeByContact) can be
// unit-tested without a generated Prisma client or a database.
let _prisma;
const db = () => (_prisma ||= require('../config/database'));

/** Prisma `where` fragment: paid CLOSED_WON leads. Reused by list endpoints. */
const paidWonWhere = (tenantId, extra = {}) => ({
  tenantId,
  stage: 'CLOSED_WON',
  OR: [
    { dealValue: { gt: 0 } },
    { enrollmentFee: { gt: 0 } },
  ],
  ...extra,
});

const feeOf = (lead) => {
  const v = lead.enrollmentFee != null ? Number(lead.enrollmentFee) : Number(lead.dealValue);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Collapse paid won leads to one entry per contact (the most recent closedAt
 * wins, so a re-imported or re-synced student is counted once at their real fee).
 */
const dedupeByContact = (leads) => {
  const byContact = new Map();
  for (const l of leads) {
    const prev = byContact.get(l.contactId);
    if (!prev || (l.closedAt && (!prev.closedAt || l.closedAt > prev.closedAt))) {
      byContact.set(l.contactId, l);
    }
  }
  return [...byContact.values()];
};

/**
 * Enrollment summary for a tenant.
 * @returns {{
 *   allTime: { students: number, revenue: number },
 *   period:  { students: number, revenue: number, from: string|null, to: string|null },
 *   currency: string
 * }}
 */
const getEnrollmentSummary = async (tenantId, { from, to } = {}) => {
  const leads = await db().lead.findMany({
    where: paidWonWhere(tenantId),
    select: { contactId: true, closedAt: true, dealValue: true, enrollmentFee: true, currency: true },
  });

  const students = dedupeByContact(leads);
  const allTime = {
    students: students.length,
    revenue:  students.reduce((s, l) => s + feeOf(l), 0),
  };

  const fromD = from ? new Date(from) : null;
  const toD   = to   ? new Date(to)   : null;
  const inPeriod = students.filter((l) => {
    if (!l.closedAt) return false;
    if (fromD && !Number.isNaN(fromD.getTime()) && l.closedAt < fromD) return false;
    if (toD   && !Number.isNaN(toD.getTime())   && l.closedAt > toD)   return false;
    return true;
  });
  const period = {
    students: inPeriod.length,
    revenue:  inPeriod.reduce((s, l) => s + feeOf(l), 0),
    from: fromD && !Number.isNaN(fromD.getTime()) ? fromD.toISOString() : null,
    to:   toD   && !Number.isNaN(toD.getTime())   ? toD.toISOString()   : null,
  };

  const currency = students.find((l) => l.currency)?.currency || 'PKR';
  return { allTime, period, currency };
};

module.exports = { paidWonWhere, feeOf, dedupeByContact, getEnrollmentSummary };
