// src/modules/insights/insights.controller.js
const svc = require('./insights.service');
const { success } = require('../../utils/response');

const sentiment = async (req, res, next) => { try { return success(res, await svc.getSentimentTrend(req.tenantId)); } catch (e) { next(e); } };
const signals   = async (req, res, next) => { try { return success(res, await svc.getSignals(req.tenantId, Math.min(50, parseInt(req.query.limit) || 20))); } catch (e) { next(e); } };
const digest    = async (req, res, next) => { try { return success(res, await svc.getDigest(req.tenantId)); } catch (e) { next(e); } };

// Fire this tenant's weekly digest to WhatsApp right now — lets an admin
// verify delivery instead of waiting for Monday. Admin-only: it sends a real
// message to the configured admin phone.
const sendDigestNow = async (req, res, next) => {
  try {
    const digestService = require('../../services/digest.service');
    return success(res, await digestService.sendWeeklyDigest(req.tenantId), 'Digest send attempted');
  } catch (e) { next(e); }
};

module.exports = { sentiment, signals, digest, sendDigestNow };
