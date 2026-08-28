// src/modules/settings/settings.controller.js

const svc = require('./settings.service');
const { success } = require('../../utils/response');

const get         = async (req, res, next) => { try { return success(res, await svc.getSettings(req.tenantId)); } catch(e){next(e);} };
const update      = async (req, res, next) => { try { return success(res, await svc.updateSettings(req.tenantId, req.body), 'Settings updated'); } catch(e){next(e);} };
const updateWA    = async (req, res, next) => { try { return success(res, await svc.updateWhatsApp(req.tenantId, req.body), 'WhatsApp updated'); } catch(e){next(e);} };
const verifyWA    = async (req, res, next) => { try { return success(res, await svc.verifyWhatsApp(req.tenant)); } catch(e){next(e);} };
const testWA      = async (req, res, next) => { try { return success(res, await svc.testWhatsApp(req.tenant, req.body.testPhone)); } catch(e){next(e);} };
const updateMeta     = async (req, res, next) => { try { return success(res, await svc.updateMeta(req.tenantId, req.body), 'Meta settings updated'); } catch(e){next(e);} };
const verifyMetaAds  = async (req, res, next) => { try { return success(res, await svc.verifyMetaAds(req.tenant)); } catch(e){next(e);} };
const testMetaAds    = async (req, res, next) => { try { return success(res, await svc.testMetaAds(req.tenant)); } catch(e){next(e);} };

const getSheets        = async (req, res, next) => { try { return success(res, await svc.getSheetsIntegration(req.tenantId)); } catch(e){next(e);} };
const connectSheets    = async (req, res, next) => { try { return success(res, await svc.connectSheets(req.tenantId, req.body), 'Google Sheet connected'); } catch(e){next(e);} };
const disconnectSheets = async (req, res, next) => { try { return success(res, await svc.disconnectSheets(req.tenantId), 'Google Sheet disconnected'); } catch(e){next(e);} };
const syncSheets       = async (req, res, next) => { try { return success(res, await svc.syncSheetsNow(req.tenantId), 'Sheet synced'); } catch(e){next(e);} };

module.exports = {
  get, update, updateWA, verifyWA, testWA, updateMeta, verifyMetaAds, testMetaAds,
  getSheets, connectSheets, disconnectSheets, syncSheets,
};
