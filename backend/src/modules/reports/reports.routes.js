const { Router } = require('express');
const ctrl = require('./reports.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN', 'AGENT'));

router.get('/', ctrl.list);
router.post('/generate', ctrl.generate);

module.exports = router;
