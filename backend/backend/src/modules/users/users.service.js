// src/modules/users/users.service.js

const prisma = require('../../config/database');
const bcrypt = require('bcryptjs');

const listUsers = async (tenantId) => {
  return prisma.user.findMany({
    where: { tenantId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
};

const inviteUser = async (tenantId, { email, fullName, role, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw Object.assign(new Error('Email already registered'), { statusCode: 409, expose: true });

  const passwordHash = await bcrypt.hash(password || Math.random().toString(36).slice(-10), 12);

  return prisma.user.create({
    data: { tenantId, email, fullName, role: role || 'AGENT', passwordHash },
    select: { id: true, email: true, fullName: true, role: true, createdAt: true },
  });
};

const updateRole = async (tenantId, userId, role) => {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404, expose: true });
  return prisma.user.update({ where: { id: userId }, data: { role } });
};

const removeUser = async (tenantId, userId, requestingUserId) => {
  if (userId === requestingUserId) throw Object.assign(new Error('Cannot remove yourself'), { statusCode: 400, expose: true });
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404, expose: true });
  return prisma.user.update({ where: { id: userId }, data: { isActive: false } });
};

const updateProfile = async (userId, { fullName, password }) => {
  const data = {};
  if (fullName) data.fullName = fullName;
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, fullName: true, role: true },
  });
};

module.exports = { listUsers, inviteUser, updateRole, removeUser, updateProfile };
