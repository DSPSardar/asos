// src/modules/dev/dev.routes.js
// DEV-ONLY endpoints — only mounted when WHATSAPP_MOCK=true
// Allows injecting fake inbound WhatsApp messages to test the full AI pipeline
// without a real Meta webhook.

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { publishInboundMessage } = require('../../queues/message.queue');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');

const injectSchema = z.object({
  tenantId: z.string().uuid(),
  phone:    z.string().min(6),          // E.164 without +, e.g. 923001234567
  message:  z.string().min(1).max(2000),
  name:     z.string().optional(),
});

/**
 * POST /api/v1/dev/inject-message
 * Simulates an inbound WhatsApp message and pushes it through BullMQ
 * so the worker → Claude pipeline runs exactly as in production.
 *
 * Body: { tenantId, phone, message, name? }
 */
router.post('/inject-message', async (req, res) => {
  try {
    const data = injectSchema.parse(req.body);

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: data.tenantId } });
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const mockWaMessageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const mockPayload = {
      tenantId:    data.tenantId,
      phone:       data.phone.replace(/\D/g, ''),
      contactName: data.name || null,
      waMessageId: mockWaMessageId,
      messageType: 'text',
      content:     data.message,
      timestamp:   Math.floor(Date.now() / 1000).toString(),
      referral:    null,
    };

    await publishInboundMessage(mockPayload);

    logger.info({ tenantId: data.tenantId, phone: data.phone, mockWaMessageId }, '[DEV] Injected mock inbound message');

    return res.json({
      success: true,
      message: 'Message injected — worker will process it within seconds',
      mockWaMessageId,
    });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: err.flatten().fieldErrors });
    }
    logger.error({ err: err.message }, '[DEV] inject-message failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/dev/tenants
 * Quick list of all tenants + their IDs for use in the inject form.
 */
router.get('/tenants', async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  return res.json({ success: true, data: tenants });
});

module.exports = router;
