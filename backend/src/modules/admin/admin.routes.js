// src/modules/admin/admin.routes.js

const { Router } = require('express');
const ctrl = require('./admin.controller');
const manualCtrl = require('../billing/manualPayment.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');

const router = Router();
router.use(authenticate, authorize('SUPERADMIN'));

router.get('/tenants',                    ctrl.list);
router.get('/tenants/:id',                ctrl.getOne);
router.patch('/tenants/:id',              ctrl.update);
router.post('/tenants/:id/approve',       ctrl.approve);
router.post('/tenants/:id/reject',        ctrl.reject);
router.put('/tenants/:id/admin',          ctrl.updateAdmin);
router.delete('/tenants/:id',             ctrl.deleteAccount);
router.get('/metrics',                    ctrl.metrics);

// Bank-transfer payment review. Approving is what activates a plan and sets
// its expiry — see manualPayment.service.js.
router.get('/manual-payments',             manualCtrl.listAll);
router.get('/manual-payments/:id/proof',   manualCtrl.getProof);
router.post('/manual-payments/:id/approve', manualCtrl.approve);
router.post('/manual-payments/:id/reject',  manualCtrl.reject);

module.exports = router;
