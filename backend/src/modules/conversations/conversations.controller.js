// src/modules/conversations/conversations.controller.js

const svc = require('./conversations.service');
const { success, created, paginated } = require('../../utils/response');

const list = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const { conversations, total } = await svc.listConversations({ tenantId: req.tenantId, status, page: +page, limit: +limit });
    return paginated(res, conversations, total, page, limit);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const conv = await svc.getConversation(req.tenantId, req.params.id);
    return success(res, conv);
  } catch (err) { next(err); }
};

const sendMessage = async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return require('../../utils/response').error(res, 'content is required', 400);
    const msg = await svc.sendMessage(req.tenantId, req.params.id, req.user.id, content);
    return created(res, msg, 'Message sent');
  } catch (err) { next(err); }
};

const toggleAI = async (req, res, next) => {
  try {
    const { aiEnabled } = req.body;
    const conv = await svc.toggleAI(req.tenantId, req.params.id, Boolean(aiEnabled));
    return success(res, conv, `AI ${aiEnabled ? 'enabled' : 'disabled'}`);
  } catch (err) { next(err); }
};

const takeover = async (req, res, next) => {
  try {
    const conv = await svc.takeover(req.tenantId, req.params.id, req.user.id);
    return success(res, conv, 'Conversation taken over');
  } catch (err) { next(err); }
};

const handback = async (req, res, next) => {
  try {
    const conv = await svc.handback(req.tenantId, req.params.id, req.user.id);
    return success(res, conv, 'Handed back to AI');
  } catch (err) { next(err); }
};

const close = async (req, res, next) => {
  try {
    const conv = await svc.closeConversation(req.tenantId, req.params.id, req.user.id);
    return success(res, conv, 'Conversation closed');
  } catch (err) { next(err); }
};

const summary = async (req, res, next) => {
  try {
    const text = await svc.getSummary(req.tenantId, req.params.id);
    return success(res, { summary: text });
  } catch (err) { next(err); }
};

const suggestion = async (req, res, next) => {
  try {
    const data = await svc.getSuggestedReply(req.tenantId, req.params.id);
    return success(res, data);
  } catch (err) { next(err); }
};

const byClient = async (req, res, next) => {
  try {
    const data = await svc.listByClient({ tenantId: req.tenantId, clientId: req.params.clientId });
    return success(res, data);
  } catch (err) { next(err); }
};

module.exports = { list, getOne, sendMessage, toggleAI, takeover, handback, close, summary, suggestion, byClient };
