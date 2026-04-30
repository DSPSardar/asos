const { Router } = require('express');
const ctrl = require('./content-studio.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN', 'AGENT'));

router.post('/extract', ctrl.extract);
router.post('/generate', ctrl.generate);
router.post('/image', ctrl.image);
router.patch('/drafts/:id', ctrl.updateDraft);
router.post('/drafts/:id/publish', ctrl.publish);
router.post('/drafts/:id/send-approval', ctrl.approval);

module.exports = router;
