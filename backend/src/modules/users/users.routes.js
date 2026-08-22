// src/modules/users/users.routes.js

const { Router } = require('express');
const ctrl = require('./users.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate);

router.get('/me',            ctrl.me);
router.patch('/me',          ctrl.update);

router.use(requireActiveTenant);

// Any authenticated tenant member can read the user list — AGENT roles need
// it to populate assign dropdowns on the dashboard/handoff queue. The
// controller returns a minimal directory (id + fullName) for non-admins and
// the full detail list for admins.
router.get('/',              ctrl.list);

router.use(authorize('TENANT_ADMIN', 'SUPERADMIN'));
router.post('/invite',       ctrl.invite);
router.patch('/:id/role',    ctrl.updRole);
router.delete('/:id',        ctrl.remove);

module.exports = router;
