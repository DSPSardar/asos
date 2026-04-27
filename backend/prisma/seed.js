// prisma/seed.js
// Run: node prisma/seed.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── 1. Superadmin ─────────────────────────────────────────────────
  const superadminHash = await bcrypt.hash('superadmin123!', 12);
  const superadmin = await prisma.user.upsert({
    where: { email: 'superadmin@asos.io' },
    create: {
      email:        'superadmin@asos.io',
      passwordHash: superadminHash,
      role:         'SUPERADMIN',
      fullName:     'Super Admin',
      tenantId:     null,
    },
    update: {},
  });
  console.log('✅ Superadmin created:', superadmin.email);

  // ── 2. Demo Tenant ────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-empresa' },
    create: {
      slug:   'demo-empresa',
      name:   'Demo Empresa Ltda',
      plan:   'PRO',
      status: 'ACTIVE',
    },
    update: {},
  });
  console.log('✅ Demo tenant created:', tenant.slug);

  // ── 3. Tenant Admin ───────────────────────────────────────────────
  const adminHash = await bcrypt.hash('admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo-empresa.com' },
    create: {
      tenantId:     tenant.id,
      email:        'admin@demo-empresa.com',
      passwordHash: adminHash,
      role:         'TENANT_ADMIN',
      fullName:     'Admin Demo',
    },
    update: {},
  });
  console.log('✅ Tenant admin created:', admin.email);

  // ── 4. Agent ──────────────────────────────────────────────────────
  const agentHash = await bcrypt.hash('agent123!', 12);
  await prisma.user.upsert({
    where: { email: 'agent@demo-empresa.com' },
    create: {
      tenantId:     tenant.id,
      email:        'agent@demo-empresa.com',
      passwordHash: agentHash,
      role:         'AGENT',
      fullName:     'João Agente',
    },
    update: {},
  });
  console.log('✅ Agent created: agent@demo-empresa.com');

  // ── 5. AI Config ──────────────────────────────────────────────────
  await prisma.aiConfig.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      systemPrompt: `Você é Marina, consultora de vendas da Demo Empresa.
Seu objetivo é entender o problema do cliente, apresentar soluções e conduzir ao fechamento.
Seja empática, profissional e objetiva. Faça perguntas abertas para qualificar o lead.
Responda sempre em português brasileiro.`,
      qualificationCriteria: [
        'Qual é o seu principal desafio hoje?',
        'Há quanto tempo enfrenta esse problema?',
        'Já tentou outras soluções? Como foi?',
        'Qual o impacto financeiro desse problema?',
        'Qual é o prazo para resolver isso?',
        'Quem mais está envolvido na decisão?',
      ],
      closingScript: 'Com base no que você me contou, nossa solução resolve exatamente isso. Posso te enviar uma proposta personalizada agora mesmo. Qual horário seria melhor para uma conversa rápida?',
      handoffTriggers: ['falar com humano', 'atendente', 'responsável', 'gerente', 'urgente', 'reclamação'],
      language: 'pt-BR',
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.3,
      maxTokens: 512,
    },
    update: {},
  });
  console.log('✅ AI config created for demo tenant');

  // ── 6. Subscription ───────────────────────────────────────────────
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId:          tenant.id,
      plan:              'PRO',
      status:            'ACTIVE',
      contactsLimit:     5000,
      aiTokensLimit:     5000000,
      messagesLimit:     50000,
      currentPeriodEnd:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });
  console.log('✅ Subscription created');

  // ── 7. Demo Campaign ──────────────────────────────────────────────
  const campaign = await prisma.campaign.create({
    data: {
      tenantId:        tenant.id,
      name:            'Black Friday 2024',
      metaCampaignId:  'meta_camp_001',
      metaAdsetId:     'meta_adset_001',
      metaAdId:        'meta_ad_001',
      budget:          5000,
      spend:           2340.50,
      impressions:     48000,
      clicks:          1240,
      status:          'ACTIVE',
    },
  });
  console.log('✅ Demo campaign created');

  // ── 8. Demo Contacts + Leads ──────────────────────────────────────
  const demoContacts = [
    { phone: '5511999991111', name: 'Carlos Silva',    scoreLabel: 'HOT',  stage: 'PROPOSED',   score: 85 },
    { phone: '5511999992222', name: 'Ana Rodrigues',   scoreLabel: 'WARM', stage: 'QUALIFYING',  score: 55 },
    { phone: '5511999993333', name: 'Pedro Mendes',    scoreLabel: 'COLD', stage: 'NEW',         score: 20 },
    { phone: '5511999994444', name: 'Juliana Costa',   scoreLabel: 'HOT',  stage: 'CLOSED_WON',  score: 92 },
    { phone: '5511999995555', name: 'Roberto Alves',   scoreLabel: 'WARM', stage: 'DIAGNOSED',   score: 70 },
  ];

  for (const demo of demoContacts) {
    const contact = await prisma.contact.create({
      data: { tenantId: tenant.id, phone: demo.phone, name: demo.name, optIn: true },
    });

    const lead = await prisma.lead.create({
      data: {
        tenantId:    tenant.id,
        contactId:   contact.id,
        campaignId:  campaign.id,
        stage:       demo.stage,
        scoreLabel:  demo.scoreLabel,
        aiScore:     demo.score,
        dealValue:   demo.scoreLabel === 'HOT' ? 4500 : demo.scoreLabel === 'WARM' ? 2200 : 0,
        currency:    'BRL',
        closedAt:    demo.stage === 'CLOSED_WON' ? new Date() : null,
        qualificationData: {
          need:      'Aumentar conversão de leads',
          budget:    demo.scoreLabel === 'HOT' ? 'R$ 5.000-10.000' : null,
          timeline:  'Próximo mês',
          authority: 'Decisor',
        },
        metaCampaignId: campaign.metaCampaignId,
        metaAdId:       campaign.metaAdId,
      },
    });

    // Create a conversation
    await prisma.conversation.create({
      data: {
        tenantId:     tenant.id,
        leadId:       lead.id,
        contactId:    contact.id,
        status:       demo.stage === 'CLOSED_WON' ? 'CLOSED' : 'AI_HANDLING',
        aiEnabled:    demo.stage !== 'CLOSED_WON',
        lastMessageAt: new Date(),
      },
    });
  }

  console.log('✅ Demo contacts, leads and conversations created');
  console.log('\n🎉 Seed complete!\n');
  console.log('─────────────────────────────────────────');
  console.log('Superadmin:   superadmin@asos.io    / superadmin123!');
  console.log('Tenant Admin: admin@demo-empresa.com / admin123!');
  console.log('Agent:        agent@demo-empresa.com / agent123!');
  console.log('─────────────────────────────────────────\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
