// src/modules/campaigns/campaigns.routes.js

const { Router } = require('express');
const ctrl = require('./campaigns.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/',              ctrl.list);
router.post('/',             ctrl.create);
router.get('/:id',           ctrl.getOne);
router.patch('/:id',         ctrl.update);
router.post('/:id/sync',     ctrl.sync);
router.get('/:id/roi',       ctrl.roi);
router.get('/underperforming/list', ctrl.underperforming);
router.get('/:id/recommendations', ctrl.recommendations);

module.exports = router;
