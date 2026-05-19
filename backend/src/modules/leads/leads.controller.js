// src/modules/leads/leads.controller.js

const leadsService = require('./leads.service');
const { success, created, paginated } = require('../../utils/response');

const list = async (req, res, next) => {
  try {
    const { stage, scoreLabel, assignedTo, search, page = 1, limit = 20, fromDsp } = req.query;
    const fromDspFlag = fromDsp === '1' || fromDsp === 'true';
    const { leads, total } = await leadsService.listLeads({
      tenantId: req.tenantId,
      stage, scoreLabel, assignedTo, search,
      fromDsp: fromDspFlag,
      page: parseInt(page), limit: parseInt(limit),
    });
    return paginated(res, leads, total, page, limit);
  } catch (err) { next(err); }
};

const pipeline = async (req, res, next) => {
  try {
    const fromDspFlag = req.query.fromDsp === '1' || req.query.fromDsp === 'true';
    const data = await leadsService.getPipeline(req.tenantId, { fromDsp: fromDspFlag });
    return success(res, data);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const lead = await leadsService.getLead(req.tenantId, req.params.id);
    return success(res, lead);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const lead = await leadsService.createLead(req.tenantId, req.body);
    return created(res, lead, 'Lead created');
  } catch (err) { next(err); }
};

const updateStage = async (req, res, next) => {
  try {
    const { stage, lostReason } = req.body;
    if (!stage) return require('../../utils/response').error(res, 'stage is required', 400);
    const lead = await leadsService.updateStage(req.tenantId, req.params.id, stage, req.user.id, lostReason);
    return success(res, lead, 'Stage updated');
  } catch (err) { next(err); }
};

const assign = async (req, res, next) => {
  try {
    const { agentId } = req.body;
    const lead = await leadsService.assignLead(req.tenantId, req.params.id, agentId, req.user.id);
    return success(res, lead, 'Lead assigned');
  } catch (err) { next(err); }
};

const addNote = async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return require('../../utils/response').error(res, 'content is required', 400);
    const activity = await leadsService.addNote(req.tenantId, req.params.id, req.user.id, content);
    return created(res, activity, 'Note added');
  } catch (err) { next(err); }
};

const updateDealValue = async (req, res, next) => {
  try {
    const { dealValue, currency } = req.body;
    const lead = await leadsService.updateDealValue(req.tenantId, req.params.id, dealValue, currency);
    return success(res, lead, 'Deal value updated');
  } catch (err) { next(err); }
};

const hotLeads = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const leads = await leadsService.getHotLeads(req.tenantId, limit);
    return success(res, leads);
  } catch (err) { next(err); }
};

const handoffQueue = async (req, res, next) => {
  try {
    const convs = await leadsService.getHandoffQueue(req.tenantId);
    return success(res, convs);
  } catch (err) { next(err); }
};

const syncFromDsp = async (req, res, next) => {
  try {
    const result = await leadsService.syncFromDsp(req.tenantId, req.user.id);
    return success(res, result, 'DSP CRM sync completed');
  } catch (err) { next(err); }
};

const sendDigest = async (req, res, next) => {
  try {
    const result = await leadsService.sendDailyHotLeadDigest(req.tenantId);
    return success(res, result, 'Digest dispatched');
  } catch (err) { next(err); }
};

const deleteLead = async (req, res, next) => {
  try {
    const result = await leadsService.deleteLead(req.tenantId, req.params.id);
    return success(res, result, 'Lead deleted');
  } catch (err) { next(err); }
};

module.exports = { list, pipeline, getOne, create, updateStage, assign, addNote, updateDealValue, hotLeads, handoffQueue, syncFromDsp, sendDigest, deleteLead };
