// src/modules/contacts/contacts.routes.js

const { Router } = require('express');
const ctrl = require('./contacts.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',      ctrl.list);
router.post('/',     ctrl.create);
router.get('/:id',   ctrl.getOne);
router.patch('/:id', ctrl.update);
router.delete('/:id',ctrl.remove);

module.exports = router;
