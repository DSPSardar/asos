// src/modules/analytics/analytics.controller.js

const svc = require('./analytics.service');
const { success } = require('../../utils/response');

const overview  = async (req, res, next) => { try { return success(res, await svc.getOverview(req.tenantId, req.query)); } catch(e){next(e);} };
const funnel    = async (req, res, next) => { try { return success(res, await svc.getFunnel(req.tenantId, req.query)); } catch(e){next(e);} };
const revenue   = async (req, res, next) => { try { return success(res, await svc.getRevenue(req.tenantId, req.query)); } catch(e){next(e);} };
const aiPerf    = async (req, res, next) => { try { return success(res, await svc.getAIPerformance(req.tenantId, req.query)); } catch(e){next(e);} };
const agents    = async (req, res, next) => { try { return success(res, await svc.getAgentPerformance(req.tenantId, req.query)); } catch(e){next(e);} };
const messages  = async (req, res, next) => { try { return success(res, await svc.getMessageVolume(req.tenantId, req.query)); } catch(e){next(e);} };
const teamPerformance  = async (req, res, next) => { try { return success(res, await svc.getTeamPerformance(req.tenantId, req.query)); } catch(e){next(e);} };

const sources     = async (req, res, next) => { try { return success(res, await svc.getLeadSources(req.tenantId, req.query)); } catch (e) { next(e); } };
const conversions = async (req, res, next) => { try { return success(res, await svc.getDailyConversions(req.tenantId, req.query)); } catch (e) { next(e); } };
const hotByHour   = async (req, res, next) => { try { return success(res, await svc.getHotByHour(req.tenantId)); } catch (e) { next(e); } };

module.exports = { sources, conversions, hotByHour, overview, funnel, revenue, aiPerf, agents, messages, teamPerformance };
