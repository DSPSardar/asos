// src/modules/users/users.routes.js

const { Router } = require('express');
const ctrl = require('./users.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate);

router.get('/me',            ctrl.me);
router.patch('/me',          ctrl.update);

router.use(requireActiveTenant, authorize('TENANT_ADMIN', 'SUPERADMIN'));
router.get('/',              ctrl.list);
router.post('/invite',       ctrl.invite);
router.patch('/:id/role',    ctrl.updRole);
router.delete('/:id',        ctrl.remove);

module.exports = router;
