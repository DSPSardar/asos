const svc = require('./reports.service');
const { success, created } = require('../../utils/response');

const generate = async (req, res, next) => {
  try {
    const out = await svc.buildReport({
      tenantId: req.tenantId,
      periodType: req.body.periodType || 'weekly',
      from: req.body.from,
      to: req.body.to,
      language: req.body.language || 'en',
      sendPhone: req.body.sendPhone,
    });
    return created(res, out, 'Report generated');
  } catch (e) { return next(e); }
};

const list = async (req, res, next) => {
  try { return success(res, await svc.listReports(req.tenantId)); } catch (e) { return next(e); }
};

module.exports = { generate, list };
