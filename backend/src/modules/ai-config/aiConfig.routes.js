// src/modules/ai-config/aiConfig.routes.js

const { Router } = require('express');
const multer = require('multer');
const ctrl = require('./aiConfig.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');
const { rehydrateRequestContext } = require('../../middleware/requestContext.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('audio/')),
});

const router = Router();
router.use(authenticate, requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));

router.get('/config',                ctrl.get);
router.put('/config',                ctrl.update);
router.post('/config/test',          ctrl.test);
// rehydrateRequestContext: multer drops the AsyncLocalStorage context, which
// makes the RLS tenant setting empty for the upsert. See requestContext.middleware.
router.post('/config/welcome-voice', upload.single('file'), rehydrateRequestContext, ctrl.uploadWelcomeVoice);
router.get('/usage',                 ctrl.usage);

module.exports = router;
