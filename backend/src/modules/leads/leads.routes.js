// src/modules/leads/leads.routes.js

const { Router } = require('express');
const ctrl = require('./leads.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');
const { readApiKey, unlessApiKey } = require('../../middleware/readApiKey');

const router = Router();
// readApiKey only acts on requests carrying X-API-Key (GET /pipeline and
// /hot); everything else goes through the JWT guard exactly as before.
router.use(readApiKey, unlessApiKey(authenticate), unlessApiKey(requireActiveTenant));

router.get('/',                  ctrl.list);
router.get('/pipeline',          ctrl.pipeline);
router.get('/hot',               ctrl.hotLeads);
router.get('/handoff',           ctrl.handoffQueue);
router.post('/sync-dsp',         authorize('TENANT_ADMIN'), ctrl.syncFromDsp);
router.post('/import-students',  authorize('TENANT_ADMIN'), ctrl.importStudents);
router.post('/digest/send',      authorize('TENANT_ADMIN'), ctrl.sendDigest);
router.get('/:id',               ctrl.getOne);
router.post('/',                 ctrl.create);
router.patch('/:id/stage',       ctrl.updateStage);
router.patch('/:id/assign',      ctrl.assign);
router.patch('/:id/deal-value',  ctrl.updateDealValue);
router.post('/:id/notes',        ctrl.addNote);
router.delete('/:id',            authorize('TENANT_ADMIN'), ctrl.deleteLead);

module.exports = router;
