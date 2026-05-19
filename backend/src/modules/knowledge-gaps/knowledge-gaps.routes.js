// src/modules/knowledge-gaps/knowledge-gaps.routes.js

const { Router } = require('express');
const ctrl = require('./knowledge-gaps.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/',           ctrl.list);           // GET  /ai/knowledge-gaps
router.patch('/:id',      ctrl.answer);          // PATCH /ai/knowledge-gaps/:id  { answer }
router.delete('/:id',     ctrl.remove);          // DELETE /ai/knowledge-gaps/:id

module.exports = router;
