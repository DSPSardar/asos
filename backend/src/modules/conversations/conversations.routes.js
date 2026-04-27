// src/modules/conversations/conversations.routes.js

const { Router } = require('express');
const ctrl = require('./conversations.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',                     ctrl.list);
router.get('/:id',                  ctrl.getOne);
router.post('/:id/messages',        ctrl.sendMessage);
router.patch('/:id/ai',             ctrl.toggleAI);
router.post('/:id/takeover',        ctrl.takeover);
router.post('/:id/handback',        ctrl.handback);
router.post('/:id/close',           ctrl.close);
router.get('/:id/summary',          ctrl.summary);

module.exports = router;
