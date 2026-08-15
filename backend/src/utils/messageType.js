// src/utils/messageType.js
//
// Maps a raw WhatsApp inbound event type (msg.type from the webhook — text,
// image, audio, video, document, reaction, location, button, sticker,
// contacts, order, system, unknown, ...) to a value the database's
// MessageType enum actually accepts.
//
// The enum only has TEXT, IMAGE, AUDIO, DOCUMENT, TEMPLATE, INTERACTIVE —
// notably no VIDEO, LOCATION, or REACTION, even though WhatsApp sends all
// of those as real inbound event types. conversation.worker.js used to
// write messageType.toUpperCase() straight into that column; for anything
// outside the enum, Prisma throws "Invalid value for argument `type`.
// Expected MessageType." — a deterministic error, so every BullMQ retry
// fails identically and the message is dropped for good. Confirmed as the
// cause of leads going unanswered after sending an emoji reaction
// (2026-08-14, worker logs 06:01-06:06 UTC).
//
// content already has a safe human-readable fallback for every type (see
// extractMessageContent's `default: [${msg.type}]` in whatsapp.service.js
// — that's literally where "[reaction]" came from), so falling back to
// TEXT here for anything unrecognized loses nothing: the message still
// saves, still shows up in the dashboard with its bracketed placeholder
// text, and — critically — never takes the whole job down with it.

const KNOWN_MESSAGE_TYPES = new Set(['TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'TEMPLATE', 'INTERACTIVE']);

const toDbMessageType = (rawType) => {
  const upper = rawType?.toUpperCase();
  return KNOWN_MESSAGE_TYPES.has(upper) ? upper : 'TEXT';
};

module.exports = { toDbMessageType, KNOWN_MESSAGE_TYPES };
