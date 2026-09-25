// src/modules/analytics/analytics.routes.js

const { Router } = require('express');
const ctrl = require('./analytics.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');
const { readApiKey, unlessApiKey } = require('../../middleware/readApiKey');

const router = Router();
// readApiKey only acts on requests carrying X-API-Key (GET /overview, which
// backs the /dsp-reports KPIs); everything else goes through the JWT guard
// and the admin role check exactly as before.
router.use(
  readApiKey,
  unlessApiKey(authenticate),
  unlessApiKey(requireActiveTenant),
  unlessApiKey(authorize('TENANT_ADMIN', 'SUPERADMIN')),
);

router.get('/overview',       ctrl.overview);
// Single source of truth for student count + revenue (see
// services/enrollment.definition.js). Students page and DSP Reports both read it.
router.get('/enrollments',    ctrl.enrollments);
router.get('/funnel',         ctrl.funnel);
router.get('/revenue',        ctrl.revenue);
router.get('/ai-performance', ctrl.aiPerf);
router.get('/agents',         ctrl.agents);
router.get('/messages',       ctrl.messages);
router.get('/team-performance', ctrl.teamPerformance);
router.get('/sources',        ctrl.sources);
router.get('/conversions',    ctrl.conversions);
router.get('/hot-by-hour',    ctrl.hotByHour);

module.exports = router;
