// marketing/pipeline/schema.js
// JSDoc typedefs for the shapes passed between pipeline steps.
// This repo has no TypeScript tooling (no tsconfig.json, no typescript dependency in
// backend/ or vite-app/), so these are documentation + editor hints, not compiled types.
// See marketing/CLAUDE.md for why plain JS was chosen over adding a TS toolchain.

/**
 * @typedef {Object} ContentBrief
 * One calendar day, as produced by Planner (agents/02-planner.md) and consumed by
 * Hook Writer (agents/03-hook-writer.md).
 * @property {"Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun"} day
 * @property {string} date - YYYY-MM-DD
 * @property {"awareness"|"proof"|"enrollment_push"} cycle_phase
 * @property {"instagram_reel"|"instagram_carousel"|"linkedin"} platform
 * @property {number} opportunity_rank_used
 * @property {string} content_goal
 * @property {string} cta
 * @property {string} notes_for_hook_writer
 */

/**
 * @typedef {Object} ContentAsset
 * A finished, publish-ready asset as produced by Content Writer (agents/04-content-writer.md)
 * or Repurposer (agents/05-repurposer.md).
 * @property {"reel"|"carousel"|"post"} format
 * @property {"instagram_reel"|"instagram_carousel"|"linkedin"} platform
 * @property {string} hook
 * @property {Object} body
 * @property {Array<{shot: number, visual: string, voiceover_or_caption: string}>} body.reel_script
 * @property {Array<{slide: number, text: string, visual_note: string}>} body.carousel_slides
 * @property {string} body.post_text
 * @property {string} cta_line
 * @property {string[]} hashtags
 */

/**
 * @typedef {Object} RepurposedAsset
 * Output of Repurposer (agents/05-repurposer.md). `linkedin.js` posts `linkedin_post`
 * directly (text, no video needed); `tiktok.js` needs an actual rendered video file at a
 * public URL — `tiktok_script` is a shot list for a human/video tool to produce that file
 * from, not a video itself. See marketing/CLAUDE.md "Auto-posting to LinkedIn and TikTok".
 * @property {string} source_hook
 * @property {Array<{shot: number, visual: string, voiceover_or_caption: string}>} reel_script
 * @property {Array<{slide: number, text: string, visual_note: string}>} carousel_slides
 * @property {string} whatsapp_status_text
 * @property {{subject: string, body: string}} short_email
 * @property {string} linkedin_post
 * @property {Array<{shot: number, visual: string, voiceover_or_caption: string, on_screen_text: string}>} tiktok_script
 */

/**
 * @typedef {Object} LeadHandoff
 * Output of DM Manager (agents/06-dm-manager.md) that leadsClient.js turns into real
 * Contact + Lead records via the backend API.
 * @property {string} suggested_reply
 * @property {"hot"|"warm"|"cold"} lead_score
 * @property {string} score_reasoning
 * @property {{phone: ?string, name: ?string, email: ?string, tags: string[]}} contact
 * @property {{businessUnit: string, stage: string, currency: string, source_note: string}} lead
 */

module.exports = {};
