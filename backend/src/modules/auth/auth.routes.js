// src/modules/auth/auth.routes.js

const { Router } = require('express');
const ctrl = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = Router();

router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.post('/google',   ctrl.googleAuth);
router.post('/refresh',  ctrl.refresh);
router.post('/logout',   authenticate, ctrl.logout);
router.post('/phone',           authenticate, ctrl.savePhone);
router.post('/change-password', authenticate, ctrl.changePassword);
router.get('/me',               authenticate, ctrl.me);

module.exports = router;
