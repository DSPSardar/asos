// src/modules/ai-config/aiConfig.controller.js

const svc = require('./aiConfig.service');
const { success } = require('../../utils/response');

const get    = async (req, res, next) => { try { return success(res, await svc.getConfig(req.tenantId)); } catch(e){next(e);} };
const update = async (req, res, next) => { try { return success(res, await svc.updateConfig(req.tenantId, req.body), 'AI config updated'); } catch(e){next(e);} };
const test   = async (req, res, next) => { try { return success(res, await svc.testConfig(req.tenantId, req.body.message)); } catch(e){next(e);} };
const usage  = async (req, res, next) => { try { return success(res, await svc.getUsage(req.tenantId)); } catch(e){next(e);} };

module.exports = { get, update, test, usage };
