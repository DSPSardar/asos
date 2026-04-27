// src/modules/settings/settings.controller.js

const svc = require('./settings.service');
const { success } = require('../../utils/response');

const get         = async (req, res, next) => { try { return success(res, await svc.getSettings(req.tenantId)); } catch(e){next(e);} };
const update      = async (req, res, next) => { try { return success(res, await svc.updateSettings(req.tenantId, req.body), 'Settings updated'); } catch(e){next(e);} };
const updateWA    = async (req, res, next) => { try { return success(res, await svc.updateWhatsApp(req.tenantId, req.body), 'WhatsApp updated'); } catch(e){next(e);} };
const testWA      = async (req, res, next) => { try { return success(res, await svc.testWhatsApp(req.tenant, req.body.testPhone)); } catch(e){next(e);} };
const updateMeta  = async (req, res, next) => { try { return success(res, await svc.updateMeta(req.tenantId, req.body), 'Meta settings updated'); } catch(e){next(e);} };

module.exports = { get, update, updateWA, testWA, updateMeta };
