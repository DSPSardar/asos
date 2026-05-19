// src/modules/knowledge-gaps/knowledge-gaps.controller.js

const svc = require('./knowledge-gaps.service');
const { success } = require('../../utils/response');

const list   = async (req, res, next) => {
  try {
    return success(res, await svc.listGaps(req.tenantId, req.query));
  } catch (e) { next(e); }
};

const answer = async (req, res, next) => {
  try {
    return success(res, await svc.answerGap(req.tenantId, req.params.id, req.body), 'Answer saved');
  } catch (e) { next(e); }
};

const remove = async (req, res, next) => {
  try {
    return success(res, await svc.deleteGap(req.tenantId, req.params.id), 'Deleted');
  } catch (e) { next(e); }
};

module.exports = { list, answer, remove };
