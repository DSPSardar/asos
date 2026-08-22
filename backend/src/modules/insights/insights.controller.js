// src/modules/insights/insights.controller.js
const svc = require('./insights.service');
const { success } = require('../../utils/response');

const sentiment = async (req, res, next) => { try { return success(res, await svc.getSentimentTrend(req.tenantId)); } catch (e) { next(e); } };
const signals   = async (req, res, next) => { try { return success(res, await svc.getSignals(req.tenantId, Math.min(50, parseInt(req.query.limit) || 20))); } catch (e) { next(e); } };
const digest    = async (req, res, next) => { try { return success(res, await svc.getDigest(req.tenantId)); } catch (e) { next(e); } };

module.exports = { sentiment, signals, digest };
