// src/modules/today/today.routes.js
// Today's Queue — the morning approval inbox. Every tenant member can read
// it (AGENTs see their own + unassigned leads, enforced in the service) and
// act on rows they can see. Nothing here sends without an explicit request.
const { Router } = require('express');
const ctrl = require('./today.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveTenant } = require('../../middleware/tenant.middleware');

const router = Router();
router.use(authenticate, requireActiveTenant);

router.get('/',                      ctrl.queue);
router.get('/templates',             ctrl.templates);
router.get('/:id/context',           ctrl.context);
// POST, not GET: these may spend AI tokens (once per thread state; cached).
router.post('/:id/draft',            ctrl.draft);
router.post('/:id/summary',          ctrl.summary);
router.post('/:id/send',             ctrl.send);
router.post('/:id/send-template',    ctrl.sendTemplate);
router.post('/:id/skip',             ctrl.skip);
router.delete('/:id/skip',           ctrl.unskip);
router.post('/:id/dismiss',          ctrl.dismiss);
router.delete('/:id/dismiss',        ctrl.undismiss);

module.exports = router;
