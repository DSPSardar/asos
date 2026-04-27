// src/modules/contacts/contacts.controller.js

const svc = require('./contacts.service');
const { success, created, paginated } = require('../../utils/response');

const list = async (req, res, next) => {
  try {
    const { search, tag, page = 1, limit = 20 } = req.query;
    const { contacts, total } = await svc.listContacts({ tenantId: req.tenantId, search, tag, page: +page, limit: +limit });
    return paginated(res, contacts, total, page, limit);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const contact = await svc.getContact(req.tenantId, req.params.id);
    return success(res, contact);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const contact = await svc.createContact(req.tenantId, req.body);
    return created(res, contact, 'Contact created');
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const contact = await svc.updateContact(req.tenantId, req.params.id, req.body);
    return success(res, contact, 'Contact updated');
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await svc.deleteContact(req.tenantId, req.params.id);
    return success(res, {}, 'Contact deleted');
  } catch (err) { next(err); }
};

module.exports = { list, getOne, create, update, remove };
