// src/modules/ai-config/aiConfig.routes.js

const { Router } = require('express');
const ctrl = require('./aiConfig.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/config',       ctrl.get);
router.put('/config',       ctrl.update);
router.post('/config/test', ctrl.test);
router.get('/usage',        ctrl.usage);

module.exports = router;
