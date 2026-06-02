// src/modules/campaigns/campaigns.routes.js

const { Router } = require('express');
const ctrl = require('./campaigns.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/',                       ctrl.list);
router.post('/',                      ctrl.create);
router.post('/launch',                ctrl.launch);          // ← push to Meta
router.get('/underperforming/list',   ctrl.underperforming);
router.get('/:id',                    ctrl.getOne);
router.patch('/:id',                  ctrl.update);
router.delete('/:id',                 ctrl.remove);
router.post('/:id/sync',              ctrl.sync);
router.get('/:id/roi',                ctrl.roi);
router.get('/:id/recommendations',    ctrl.recommendations);

module.exports = router;
