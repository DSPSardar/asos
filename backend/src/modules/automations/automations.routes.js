// src/modules/automations/automations.routes.js
// IF/THEN automation rules. Reading is open to every tenant member (agents
// see what fires on their leads); anything that changes rules or sends a
// message is admin-only — a rule can WhatsApp hundreds of leads.
const { Router } = require('express');
const ctrl = require('./automations.controller');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',               ctrl.list);
router.get('/runs',           ctrl.runs);
router.get('/:id/runs',       ctrl.runs);

router.post('/',              authorize('TENANT_ADMIN'), ctrl.create);
router.patch('/:id',          authorize('TENANT_ADMIN'), ctrl.update);
router.patch('/:id/toggle',   authorize('TENANT_ADMIN'), ctrl.toggle);
router.delete('/:id',         authorize('TENANT_ADMIN'), ctrl.remove);
// Dry run: evaluates the rule against live data and returns who WOULD get
// the message, without sending. Lets an admin sanity-check before enabling.
router.post('/:id/preview',   authorize('TENANT_ADMIN'), ctrl.preview);

module.exports = router;
