// src/modules/billing/billing.routes.js

const { Router } = require('express');
const ctrl = require('./billing.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/subscription',   ctrl.getSubscription);
router.post('/checkout',      ctrl.createCheckout);
router.post('/portal',        ctrl.createPortal);
router.get('/invoices',       ctrl.listInvoices);
router.post('/cancel',        ctrl.cancelSubscription);

module.exports = router;
