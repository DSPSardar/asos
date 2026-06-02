// src/modules/campaigns/campaigns.controller.js

const svc = require('./campaigns.service');
const { success, created } = require('../../utils/response');

const list            = async (req, res, next) => { try { return success(res, await svc.listCampaigns(req.tenantId)); } catch(e){next(e);} };
const getOne          = async (req, res, next) => { try { return success(res, await svc.getCampaign(req.tenantId, req.params.id)); } catch(e){next(e);} };
const create          = async (req, res, next) => { try { return created(res, await svc.createCampaign(req.tenantId, req.body), 'Campaign created'); } catch(e){next(e);} };
const update          = async (req, res, next) => { try { return success(res, await svc.updateCampaign(req.tenantId, req.params.id, req.body), 'Campaign updated'); } catch(e){next(e);} };
const remove          = async (req, res, next) => { try { return success(res, await svc.deleteCampaign(req.tenantId, req.params.id), 'Campaign deleted'); } catch(e){next(e);} };
const launch          = async (req, res, next) => { try { return created(res, await svc.launchCampaign(req.tenantId, req.body), 'Campaign launched on Meta'); } catch(e){next(e);} };
const sync            = async (req, res, next) => { try { return success(res, await svc.syncMetaData(req.tenantId, req.params.id), 'Meta data synced'); } catch(e){next(e);} };
const roi             = async (req, res, next) => { try { return success(res, await svc.getCampaignROI(req.tenantId, req.params.id)); } catch(e){next(e);} };
const underperforming = async (req, res, next) => { try { return success(res, await svc.underperforming(req.tenantId)); } catch(e){next(e);} };
const recommendations = async (req, res, next) => { try { return success(res, await svc.recommendations(req.tenantId, req.params.id)); } catch(e){next(e);} };

module.exports = { list, getOne, create, update, remove, launch, sync, roi, underperforming, recommendations };
