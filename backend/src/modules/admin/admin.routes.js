// src/modules/admin/admin.routes.js

const { Router } = require('express');
const ctrl = require('./admin.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');

const router = Router();
router.use(authenticate, authorize('SUPERADMIN'));

router.get('/tenants',        ctrl.list);
router.get('/tenants/:id',    ctrl.getOne);
router.patch('/tenants/:id',  ctrl.update);
router.get('/metrics',        ctrl.metrics);

module.exports = router;
