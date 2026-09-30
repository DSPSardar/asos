// src/config/constants.js
//
// Business constants shared across the API server and the worker.

// AI Agent Mastery enrolment fee — the only product since the 7-day bootcamp
// was sunset (2026-08). Every CLOSED_WON path (payment confirm, manual stage
// change) and the worker's payment-proof amount check key off this value.
// A USD sale is recorded as this PKR amount at the point of sale — USD is
// never stored on a lead.
//
// vite-app/src/lib/constants.js mirrors this value for the dashboard's fee
// prompts — keep the two in sync when the price changes.
const ENROLMENT_FEE_PKR = 28000;

// handoffReason written when the plan's AI-token cap pauses a conversation.
// The usage tick (services/usageCycle.service.js) matches on it EXACTLY to
// hand those threads back to the AI once there is headroom, and the backlog
// sweep matches on it to leave them alone — change it in one place only.
const TOKEN_LIMIT_HANDOFF_REASON = 'AI token limit reached — plan upgrade required';

module.exports = { ENROLMENT_FEE_PKR, TOKEN_LIMIT_HANDOFF_REASON };
