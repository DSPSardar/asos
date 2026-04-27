// src/modules/leads/leads.routes.js

const { Router } = require('express');
const ctrl = require('./leads.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',                  ctrl.list);
router.get('/pipeline',          ctrl.pipeline);
router.get('/:id',               ctrl.getOne);
router.post('/',                 ctrl.create);
router.patch('/:id/stage',       ctrl.updateStage);
router.patch('/:id/assign',      ctrl.assign);
router.patch('/:id/deal-value',  ctrl.updateDealValue);
router.post('/:id/notes',        ctrl.addNote);

module.exports = router;
