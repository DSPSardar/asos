// src/middleware/validate.middleware.js
// Zod request validation factory

const { error } = require('../utils/response');

const validate = (schema) => (req, res, next) => {
  try {
    const result = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    req.body   = result.body   ?? req.body;
    req.query  = result.query  ?? req.query;
    req.params = result.params ?? req.params;
    next();
  } catch (err) {
    return error(res, 'Validation failed', 422, err.flatten?.().fieldErrors ?? err.message);
  }
};

module.exports = { validate };
