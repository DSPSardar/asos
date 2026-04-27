// src/modules/users/users.controller.js

const svc = require('./users.service');
const { success, created } = require('../../utils/response');

const list    = async (req, res, next) => { try { return success(res, await svc.listUsers(req.tenantId)); } catch(e){next(e);} };
const invite  = async (req, res, next) => { try { return created(res, await svc.inviteUser(req.tenantId, req.body), 'User invited'); } catch(e){next(e);} };
const updRole = async (req, res, next) => { try { return success(res, await svc.updateRole(req.tenantId, req.params.id, req.body.role), 'Role updated'); } catch(e){next(e);} };
const remove  = async (req, res, next) => { try { await svc.removeUser(req.tenantId, req.params.id, req.user.id); return success(res, {}, 'User removed'); } catch(e){next(e);} };
const me      = async (req, res, next) => { try { return success(res, { id: req.user.id, email: req.user.email, fullName: req.user.fullName, role: req.user.role, tenant: req.tenant }); } catch(e){next(e);} };
const update  = async (req, res, next) => { try { return success(res, await svc.updateProfile(req.user.id, req.body), 'Profile updated'); } catch(e){next(e);} };

module.exports = { list, invite, updRole, remove, me, update };
