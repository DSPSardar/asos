// src/modules/mcp/mcp.server.js
//
// Builds one MCP server instance for one authenticated request (stateless
// Streamable HTTP — no session to pin to a container, which suits Railway).
// The tenant comes ONLY from the verified API key, never from anything the
// client sends, and every tool runs inside requestContext.run({ tenantId })
// so Postgres RLS sees the tenant on every query — the step the Sheets tick
// once missed and blanked a sheet over.
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const { requestContext, getRequestContext } = require('../../middleware/requestContext.middleware');
const { TOOLS } = require('./mcp.tools');

const SERVER_INFO = { name: 'asos', title: 'ASOS — AI Sales Operating System', version: '1.0.0' };

const INSTRUCTIONS = [
  "ASOS is the owner's WhatsApp sales system: an AI qualifies and closes leads, and a human verifies payments.",
  'This connector is READ-ONLY: it can report, never send messages, change stages or verify payments.',
  "For 'how are sales / what needs me' questions call today_summary first, then needs_me for names.",
  'A lead is only a paid student when payment was received and recorded — never call an unpaid CLOSED_WON a sale.',
  'Customer phones are masked (last 3 digits) and personal data is redacted; do not try to recover it.',
  'Each item has open_in_dashboard — give the owner that link when they need to act.',
].join(' ');

const asText = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

const audit = (tenantId, apiKeyId, tool, ok, error, durationMs) => prisma.mcpCallLog
  .create({ data: { tenantId, apiKeyId, tool, ok, error: error ? String(error).slice(0, 500) : null, durationMs } })
  .catch((err) => logger.warn({ err: err.message, tool }, 'MCP: audit write failed'));

const buildServer = ({ tenantId, apiKeyId = null }) => {
  if (!tenantId) throw new Error('buildServer requires a verified tenantId');
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args = {}) => requestContext.run(
        { requestId: getRequestContext().requestId, tenantId, rlsScope: '' },
        async () => {
          const started = Date.now();
          try {
            const data = await tool.handler(tenantId, args);
            await audit(tenantId, apiKeyId, tool.name, !data?.error, data?.error, Date.now() - started);
            return data?.error ? { ...asText(data), isError: true } : asText(data);
          } catch (err) {
            logger.error({ err: err.message, tool: tool.name }, 'MCP: tool failed');
            await audit(tenantId, apiKeyId, tool.name, false, err.message, Date.now() - started);
            // Never leak internals (SQL, stack) to the assistant.
            return { ...asText({ error: 'ASOS could not complete that request. Try again, or open the dashboard.' }), isError: true };
          }
        },
      ),
    );
  }
  return server;
};

module.exports = { buildServer, SERVER_INFO, INSTRUCTIONS };
