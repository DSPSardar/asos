const svc = require('./content-studio.service');
const { success, created } = require('../../utils/response');

const extract = async (req, res, next) => {
  try {
    const out = await svc.extractBrandDNA({ tenantId: req.tenantId, sourceUrl: req.body.sourceUrl, language: req.body.language || 'en' });
    return created(res, out, 'Brand DNA extracted');
  } catch (e) { return next(e); }
};

const generate = async (req, res, next) => {
  try {
    const out = await svc.generateVariants({ tenantId: req.tenantId, brandProfileId: req.body.brandProfileId, count: req.body.count || 10, language: req.body.language || 'en' });
    return created(res, out, 'Variants generated');
  } catch (e) { return next(e); }
};

const image = async (req, res, next) => {
  try { return success(res, await svc.generateImage({ prompt: req.body.prompt })); } catch (e) { return next(e); }
};

const updateDraft = async (req, res, next) => {
  try { return success(res, await svc.updateDraft({ tenantId: req.tenantId, draftId: req.params.id, data: req.body }), 'Draft updated'); } catch (e) { return next(e); }
};

const publish = async (req, res, next) => {
  try { return success(res, await svc.publishToMeta({ tenantId: req.tenantId, draftId: req.params.id }), 'Published to Meta'); } catch (e) { return next(e); }
};

const approval = async (req, res, next) => {
  try { return success(res, await svc.sendForApproval({ tenantId: req.tenantId, draftId: req.params.id, phone: req.body.phone }), 'Sent for approval'); } catch (e) { return next(e); }
};

module.exports = { extract, generate, image, updateDraft, publish, approval };
