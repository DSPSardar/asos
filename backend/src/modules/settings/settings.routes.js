// src/modules/settings/settings.routes.js

const { Router } = require('express');
const ctrl = require('./settings.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/',                  ctrl.get);
router.put('/',                  ctrl.update);
router.put('/whatsapp',          ctrl.updateWA);
router.post('/whatsapp/verify',  ctrl.verifyWA);
router.post('/whatsapp/test',    ctrl.testWA);
router.put('/meta',              ctrl.updateMeta);

module.exports = router;
