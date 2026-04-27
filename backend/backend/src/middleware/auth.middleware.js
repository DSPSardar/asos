// src/middleware/auth.middleware.js
// Verifies JWT and attaches user + tenant to req

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/database');
const { error } = require('../utils/response');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Missing or invalid Authorization header', 401);
    }

    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
      return error(res, msg, 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId, isActive: true },
      select: {
        id: true, email: true, role: true,
        fullName: true, tenantId: true,
        tenant: {
          select: {
            id: true, slug: true, name: true,
            plan: true, status: true,
            waPhoneId: true, waAccessToken: true,
            waAppSecret: true, metaPixelId: true, metaAccessToken: true,
          }
        }
      }
    });

    if (!user) return error(res, 'User not found or deactivated', 401);

    req.user = user;
    req.tenantId = user.tenantId;
    req.tenant = user.tenant;
    next();
  } catch (err) {
    next(err);
  }
};

// Role-based access control factory
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return error(res, 'Insufficient permissions', 403);
  }
  next();
};

module.exports = { authenticate, authorize };
