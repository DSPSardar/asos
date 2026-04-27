// src/modules/analytics/analytics.controller.js

const svc = require('./analytics.service');
const { success } = require('../../utils/response');

const overview  = async (req, res, next) => { try { return success(res, await svc.getOverview(req.tenantId, req.query)); } catch(e){next(e);} };
const funnel    = async (req, res, next) => { try { return success(res, await svc.getFunnel(req.tenantId, req.query)); } catch(e){next(e);} };
const revenue   = async (req, res, next) => { try { return success(res, await svc.getRevenue(req.tenantId, req.query)); } catch(e){next(e);} };
const aiPerf    = async (req, res, next) => { try { return success(res, await svc.getAIPerformance(req.tenantId, req.query)); } catch(e){next(e);} };
const agents    = async (req, res, next) => { try { return success(res, await svc.getAgentPerformance(req.tenantId, req.query)); } catch(e){next(e);} };
const messages  = async (req, res, next) => { try { return success(res, await svc.getMessageVolume(req.tenantId, req.query)); } catch(e){next(e);} };

module.exports = { overview, funnel, revenue, aiPerf, agents, messages };
