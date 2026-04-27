// src/modules/contacts/contacts.service.js

const prisma = require('../../config/database');

const listContacts = async ({ tenantId, search, tag, page = 1, limit = 20 }) => {
  const where = {
    tenantId,
    ...(tag && { tags: { has: tag } }),
    ...(search && {
      OR: [
        { name:  { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { leads: true, conversations: true } } },
    }),
    prisma.contact.count({ where }),
  ]);

  return { contacts, total };
};

const getContact = async (tenantId, contactId) => {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: {
      leads: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, stage: true, scoreLabel: true, aiScore: true, dealValue: true, createdAt: true },
      },
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        take: 3,
        select: { id: true, status: true, aiEnabled: true, lastMessageAt: true },
      },
    },
  });

  if (!contact) throw Object.assign(new Error('Contact not found'), { statusCode: 404, expose: true });
  return contact;
};

const createContact = async (tenantId, data) => {
  const existing = await prisma.contact.findUnique({
    where: { tenantId_phone: { tenantId, phone: data.phone } },
  });
  if (existing) throw Object.assign(new Error('Contact with this phone already exists'), { statusCode: 409, expose: true });

  return prisma.contact.create({ data: { tenantId, ...data } });
};

const updateContact = async (tenantId, contactId, data) => {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) throw Object.assign(new Error('Contact not found'), { statusCode: 404, expose: true });

  return prisma.contact.update({ where: { id: contactId }, data });
};

const deleteContact = async (tenantId, contactId) => {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) throw Object.assign(new Error('Contact not found'), { statusCode: 404, expose: true });

  // Soft delete — just clear sensitive data
  return prisma.contact.update({
    where: { id: contactId },
    data: { name: '[Deleted]', email: null, phone: `deleted_${Date.now()}`, optIn: false },
  });
};

module.exports = { listContacts, getContact, createContact, updateContact, deleteContact };
