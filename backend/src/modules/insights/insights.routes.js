// src/modules/insights/insights.routes.js
// AI Insights aggregations. Readable by every active tenant member —
// same access level as /leads (agents need this on the insights page).
const { Router } = require('express');
const ctrl = require('./insights.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/sentiment', ctrl.sentiment);
router.get('/signals',   ctrl.signals);
router.get('/digest',    ctrl.digest);

module.exports = router;
