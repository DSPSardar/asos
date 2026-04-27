// src/modules/billing/billing.controller.js

const svc = require('./billing.service');
const { success, created } = require('../../utils/response');

const getSubscription   = async (req, res, next) => { try { return success(res, await svc.getSubscription(req.tenantId)); } catch(e){next(e);} };
const createCheckout    = async (req, res, next) => { try { return created(res, await svc.createCheckout(req.tenantId, req.body.plan, req.body.successUrl, req.body.cancelUrl), 'Checkout session created'); } catch(e){next(e);} };
const createPortal      = async (req, res, next) => { try { return created(res, await svc.createPortal(req.tenantId, req.body.returnUrl), 'Portal session created'); } catch(e){next(e);} };
const listInvoices      = async (req, res, next) => { try { return success(res, await svc.listInvoices(req.tenantId)); } catch(e){next(e);} };
const cancelSubscription= async (req, res, next) => { try { return success(res, await svc.cancelSubscription(req.tenantId), 'Subscription will cancel at period end'); } catch(e){next(e);} };

module.exports = { getSubscription, createCheckout, createPortal, listInvoices, cancelSubscription };
