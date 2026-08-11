// src/modules/billing/billing.routes.js

const { Router } = require('express');
const multer = require('multer');
const ctrl = require('./billing.controller');
const manualCtrl = require('./manualPayment.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

// Payment screenshots. Images only, and small — the file is stored in Postgres
// because Railway's filesystem does not survive a redeploy, so the cap is what
// keeps rows sane. See manualPayment.service.js.
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Proof must be a PNG, JPEG, WebP or PDF'), { statusCode: 400, expose: true }));
    }
    return cb(null, true);
  },
});

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/subscription',   ctrl.getSubscription);
router.post('/checkout',      ctrl.createCheckout);
router.post('/portal',        ctrl.createPortal);
router.get('/invoices',       ctrl.listInvoices);
router.post('/cancel',        ctrl.cancelSubscription);

// Bank transfer + screenshot. This is the live billing path for Pakistani
// clients; the Stripe routes above cannot take their money.
router.post('/manual-payments', proofUpload.single('proof'), manualCtrl.submit);
router.get('/manual-payments',  manualCtrl.listMine);

module.exports = router;
