// src/modules/analytics/analytics.routes.js

const { Router } = require('express');
const ctrl = require('./analytics.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/overview',       ctrl.overview);
router.get('/funnel',         ctrl.funnel);
router.get('/revenue',        ctrl.revenue);
router.get('/ai-performance', ctrl.aiPerf);
router.get('/agents',         ctrl.agents);
router.get('/messages',       ctrl.messages);
router.get('/team-performance', ctrl.teamPerformance);

module.exports = router;
