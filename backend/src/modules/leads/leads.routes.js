// src/modules/leads/leads.routes.js

const { Router } = require('express');
const ctrl = require('./leads.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',                  ctrl.list);
router.get('/pipeline',          ctrl.pipeline);
router.get('/hot',               ctrl.hotLeads);
router.get('/handoff',           ctrl.handoffQueue);
router.post('/sync-dsp',         authorize('TENANT_ADMIN'), ctrl.syncFromDsp);
router.post('/digest/send',      authorize('TENANT_ADMIN'), ctrl.sendDigest);
router.get('/:id',               ctrl.getOne);
router.post('/',                 ctrl.create);
router.patch('/:id/stage',       ctrl.updateStage);
router.patch('/:id/assign',      ctrl.assign);
router.patch('/:id/deal-value',  ctrl.updateDealValue);
router.post('/:id/notes',        ctrl.addNote);

module.exports = router;
