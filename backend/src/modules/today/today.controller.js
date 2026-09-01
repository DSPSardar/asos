// src/modules/today/today.controller.js
const svc = require('./today.service');
const { success, created } = require('../../utils/response');

const viewerOf = (req) => ({ userId: req.user.id, role: req.user.role });

const queue = async (req, res, next) => {
  try { return success(res, await svc.getQueue(req.tenantId, viewerOf(req), { includeSnoozed: req.query.all === '1' })); } catch (e) { next(e); }
};
const templates = async (req, res, next) => {
  try { return success(res, await svc.listTemplates(req.tenantId)); } catch (e) { next(e); }
};
const context = async (req, res, next) => {
  try { return success(res, await svc.getContext(req.tenantId, req.params.id, viewerOf(req))); } catch (e) { next(e); }
};
const draft = async (req, res, next) => {
  try { return success(res, await svc.getDraft(req.tenantId, req.params.id, viewerOf(req), { force: req.body?.force === true })); } catch (e) { next(e); }
};
const summary = async (req, res, next) => {
  try { return success(res, await svc.getSummary(req.tenantId, req.params.id, viewerOf(req), { force: req.body?.force === true })); } catch (e) { next(e); }
};
const send = async (req, res, next) => {
  try { return created(res, await svc.sendReply(req.tenantId, req.params.id, viewerOf(req), req.body?.content), 'Message sent'); } catch (e) { next(e); }
};
const sendTemplate = async (req, res, next) => {
  try { return created(res, await svc.sendTemplate(req.tenantId, req.params.id, viewerOf(req), String(req.body?.name || '')), 'Template sent'); } catch (e) { next(e); }
};
const skip = async (req, res, next) => {
  try { return success(res, await svc.skip(req.tenantId, req.params.id, viewerOf(req)), 'Hidden until tomorrow'); } catch (e) { next(e); }
};
const unskip = async (req, res, next) => {
  try { return success(res, await svc.unskip(req.tenantId, req.params.id, viewerOf(req)), 'Back in the queue'); } catch (e) { next(e); }
};

const dismiss = async (req, res, next) => {
  try { return success(res, await svc.dismiss(req.tenantId, req.params.id, viewerOf(req)), 'Dismissed until they write again'); } catch (e) { next(e); }
};
const undismiss = async (req, res, next) => {
  try { return success(res, await svc.undismiss(req.tenantId, req.params.id), 'Back in the queue'); } catch (e) { next(e); }
};

module.exports = { queue, templates, context, draft, summary, send, sendTemplate, skip, unskip, dismiss, undismiss };
