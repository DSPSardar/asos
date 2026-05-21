// src/modules/admin/admin.controller.js

const svc = require('./admin.service');
const { success, paginated } = require('../../utils/response');

const list    = async (req, res, next) => {
  try {
    const { search, plan, status, page = 1, limit = 20 } = req.query;
    const { tenants, total } = await svc.listTenants({ search, plan, status, page: +page, limit: +limit });
    return paginated(res, tenants, total, page, limit);
  } catch(e){ next(e); }
};

const getOne  = async (req, res, next) => { try { return success(res, await svc.getTenant(req.params.id)); } catch(e){next(e);} };
const update  = async (req, res, next) => { try { return success(res, await svc.updateTenant(req.params.id, req.body), 'Tenant updated'); } catch(e){next(e);} };
const metrics = async (req, res, next) => { try { return success(res, await svc.getPlatformMetrics()); } catch(e){next(e);} };

const approve = async (req, res, next) => {
  try {
    const tenant = await svc.approveTenant(req.params.id);
    return success(res, { id: tenant.id, name: tenant.name, status: tenant.status }, `Account "${tenant.name}" approved`);
  } catch(e){ next(e); }
};

const reject = async (req, res, next) => {
  try {
    const tenant = await svc.rejectTenant(req.params.id);
    return success(res, { id: tenant.id, name: tenant.name, status: tenant.status }, `Account "${tenant.name}" rejected`);
  } catch(e){ next(e); }
};

module.exports = { list, getOne, update, metrics, approve, reject };
