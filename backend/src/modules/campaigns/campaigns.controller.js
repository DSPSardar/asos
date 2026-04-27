// src/modules/campaigns/campaigns.controller.js

const svc = require('./campaigns.service');
const { success, created } = require('../../utils/response');

const list    = async (req, res, next) => { try { return success(res, await svc.listCampaigns(req.tenantId)); } catch(e){next(e);} };
const getOne  = async (req, res, next) => { try { return success(res, await svc.getCampaign(req.tenantId, req.params.id)); } catch(e){next(e);} };
const create  = async (req, res, next) => { try { return created(res, await svc.createCampaign(req.tenantId, req.body), 'Campaign created'); } catch(e){next(e);} };
const update  = async (req, res, next) => { try { return success(res, await svc.updateCampaign(req.tenantId, req.params.id, req.body), 'Campaign updated'); } catch(e){next(e);} };
const sync    = async (req, res, next) => { try { return success(res, await svc.syncMetaData(req.tenantId, req.params.id), 'Meta data synced'); } catch(e){next(e);} };
const roi     = async (req, res, next) => { try { return success(res, await svc.getCampaignROI(req.tenantId, req.params.id)); } catch(e){next(e);} };

module.exports = { list, getOne, create, update, sync, roi };
