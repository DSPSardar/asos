// prisma/seed-dsp.js
// Creates the DSP (Digital Skills Platform) tenant with 300 mock Pakistani leads.
//
// Run AFTER running the schema migration:
//   npx prisma migrate dev --name add_dsp_fields
//   node prisma/seed-dsp.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => +(Math.random() * (max - min) + min).toFixed(2);
const daysAgo = (n) => new Date(Date.now() - n * 86400 * 1000);
const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000);

// ── Pakistani names pool ──────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Ahmed', 'Ali', 'Muhammad', 'Usman', 'Hassan', 'Bilal', 'Zain', 'Omar', 'Hamza', 'Fahad',
  'Arslan', 'Talha', 'Imran', 'Asad', 'Khalid', 'Saad', 'Jawad', 'Faisal', 'Rizwan', 'Danish',
  'Ayesha', 'Fatima', 'Sana', 'Zara', 'Nadia', 'Hira', 'Amna', 'Maryam', 'Sara', 'Rabia',
  'Maham', 'Iqra', 'Rida', 'Laiba', 'Komal', 'Nimra', 'Uzma', 'Aisha', 'Sidra', 'Kiran',
  'Waqas', 'Naeem', 'Shahid', 'Tariq', 'Adeel', 'Shoaib', 'Kamran', 'Junaid', 'Zahid', 'Irfan',
];
const LAST_NAMES = [
  'Khan', 'Ahmed', 'Ali', 'Sheikh', 'Malik', 'Qureshi', 'Chaudhry', 'Butt', 'Iqbal', 'Siddiqui',
  'Hussain', 'Baig', 'Mirza', 'Abbasi', 'Ansari', 'Raza', 'Naqvi', 'Zaidi', 'Hashmi', 'Aslam',
  'Tariq', 'Nawaz', 'Raja', 'Bhatti', 'Gondal', 'Niazi', 'Awan', 'Dar', 'Cheema', 'Rajput',
];

// ── Cities with realistic distribution ───────────────────────────────────────
const CITIES = [
  { name: 'Karachi', weight: 30 },
  { name: 'Lahore', weight: 25 },
  { name: 'Islamabad', weight: 20 },
  { name: 'Rawalpindi', weight: 10 },
  { name: 'Faisalabad', weight: 7 },
  { name: 'Peshawar', weight: 5 },
  { name: 'Multan', weight: 3 },
];
const CITIES_WEIGHTED = CITIES.flatMap(c => Array(c.weight).fill(c.name));

// ── Lead sources ──────────────────────────────────────────────────────────────
const SOURCES = [
  { utm: 'facebook_ad',      label: 'Facebook Ads',  weight: 35 },
  { utm: 'instagram_ad',     label: 'Instagram Ads', weight: 25 },
  { utm: 'whatsapp_organic', label: 'WhatsApp',      weight: 20 },
  { utm: 'referral',         label: 'Referral',      weight: 12 },
  { utm: 'organic',          label: 'Organic',       weight: 8  },
];
const SOURCES_WEIGHTED = SOURCES.flatMap(s => Array(s.weight).fill(s));

// ── Age groups ────────────────────────────────────────────────────────────────
const AGE_GROUPS = [
  { group: '18-24', weight: 40 },
  { group: '25-30', weight: 35 },
  { group: '31-35', weight: 15 },
  { group: '36+',   weight: 10 },
];
const AGE_WEIGHTED = AGE_GROUPS.flatMap(a => Array(a.weight).fill(a.group));

// ── Stage distribution (total = 100) ─────────────────────────────────────────
// Mapped to ASOS enum: NEW=New, QUALIFYING=Contacted, DIAGNOSED=Interested,
// PROPOSED=Enrolled, CLOSED_WON=Paid/Active, CLOSED_LOST=Dropped
const STAGE_DISTRIBUTION = [
  { stage: 'NEW',         count: 60, score: [5,30],  label: 'COLD' },
  { stage: 'QUALIFYING',  count: 70, score: [30,55], label: 'COLD' },
  { stage: 'DIAGNOSED',   count: 60, score: [45,65], label: 'WARM' },
  { stage: 'PROPOSED',    count: 50, score: [60,80], label: 'WARM' },
  { stage: 'CLOSED_WON',  count: 40, score: [75,98], label: 'HOT'  },
  { stage: 'CLOSED_LOST', count: 20, score: [10,40], label: 'COLD' },
];

// ── DSP phases for active students ────────────────────────────────────────────
const DSP_PHASES = ['LEARN', 'LEARN', 'BUILD', 'EARN'];

// ── Sample conversation messages ──────────────────────────────────────────────
const INBOUND_MSGS = [
  'Assalamualaikum, AI course ke baare mein batayein?',
  'Bhai yeh course kab start ho raha hai?',
  'Kya yeh course beginners ke liye bhi hai?',
  'Fee kya hai aur payment plan kya hai?',
  'Job milne ke chances kitne hain?',
  'Main engineering student hun, kya AI seekh sakta hun?',
  'Certificate milta hai kya?',
  'Online hai ya physical class?',
  'Kitne ghante daily dene padte hain?',
  'Pehle se coding ata nahi, phir bhi ho sakta hai?',
  'Dollar mein earn karna chahta hun, kaise possible hai?',
  'Freelancing start karne mein kitna time lagta hai?',
  'DSP ke baare mein kisi dost ne bataya tha',
  'Instagram pe ad dekha tha, interest hai',
  'Sardar Group ka program hai? Trustworthy lagta hai',
];

const AI_RESPONSES = [
  'Walaikum assalam! DSP ka Agentic AI Mastery program 14 din ka intensive hai. Beginners se advanced tak — koi background nahi chahiye.',
  'Aap bilkul theek jagah aaye hain! Hum har batch mein sirf 30 students lete hain taake quality maintain ho sake.',
  'Haan bilkul! Hum specifically design kiya hai un logon ke liye jo technical background nahi rakhte. Step by step seedhte hain.',
  'Program mein aap real AI agents banayenge jo clients ke liye kaam kar sakein — yahi dollar income ka rasta hai.',
  'SECP certified certificate milta hai jo international platforms pe value rakhta hai. LinkedIn aur Upwork dono pe kaam aata hai.',
  'Daily 2-3 ghante kaafi hain. Live sessions ke recordings bhi milti hain toh aap apne schedule ke hisaab se seekh sakte hain.',
  'Freelancing start karne mein generally 4-6 hafte lagte hain. Humara program aapko pehla client dhundhne mein bhi help karta hai.',
];

const LOST_REASONS = [
  'Budget issue — abhi afford nahi kar sakta',
  'Time nahi hai abhi',
  'Doosre program mein enroll ho gaya',
  'Family approval nahi mili',
  'Job chhod nahi sakta aur time nahi milega',
];

// ── AI system prompt for DSP ──────────────────────────────────────────────────
const DSP_SYSTEM_PROMPT = `You are Zara, an AI sales consultant for DSP (Digital Skills Platform) — a premium AI education program by Sardar Group.

Your goal is to help prospective students understand the Agentic AI Mastery program and guide them toward enrollment.

PROGRAM FACTS (use ONLY these):
- 14-day intensive live program
- Learn AI tools, prompt engineering, automation, and building AI agents
- No technical background required — complete beginners welcome
- SECP certified certificate issued on completion
- Private WhatsApp community
- Lifetime recording access
- Limited to 30 students per batch
- Target: students, freelancers, job seekers, professionals wanting dollar income

COMMUNICATION STYLE:
- Mix Urdu/Roman Urdu and English naturally (Pakistani urban professional)
- Greet "Walaikum assalam" if they open with salam
- Be warm, encouraging, and professional
- Address common concerns: Can I learn without coding? Will I get a job? Is it worth it?
- Create urgency around limited batch seats

QUALIFY ON:
1. Current occupation (student/job/business)
2. Why they want to learn AI
3. Available time per day
4. Budget/payment concern
5. Timeline urgency

ALWAYS:
- Lead with outcomes (dollar income, freelancing, automation)
- Reference Sardar Group credibility
- Mention SECP certification
- Offer a quick 10-minute call for serious leads
- Highlight the 30-seat limit`;

// ── Main seed function ────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding DSP tenant...\n');

  // ── 1. Create DSP Tenant ──────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'dsp-pakistan' },
    create: {
      slug:   'dsp-pakistan',
      name:   'DSP — Digital Skills Platform',
      plan:   'ENTERPRISE',
      status: 'ACTIVE',
      settings: {
        currency:         'PKR',
        currencySymbol:   'Rs.',
        industry:         'EdTech / AI Training',
        brandColor:       '#1d4ed8',
        brandColorLight:  '#3b82f6',
        country:          'Pakistan',
        timezone:         'Asia/Karachi',
        enrollmentFee:    10000,
        whatsappNumber:   '923001234567',
      },
    },
    update: {
      settings: {
        currency:         'PKR',
        currencySymbol:   'Rs.',
        industry:         'EdTech / AI Training',
        brandColor:       '#1d4ed8',
        brandColorLight:  '#3b82f6',
        country:          'Pakistan',
        timezone:         'Asia/Karachi',
        enrollmentFee:    10000,
        whatsappNumber:   '923001234567',
      },
    },
  });
  console.log(`✅ DSP tenant: ${tenant.id}`);

  // ── 2. Admin user ─────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('dsp-admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@dsp.pk' },
    create: {
      tenantId:     tenant.id,
      email:        'admin@dsp.pk',
      passwordHash: adminHash,
      role:         'TENANT_ADMIN',
      fullName:     'DSP Admin',
    },
    update: {},
  });
  console.log(`✅ DSP admin: ${admin.email}`);

  // ── 3. Agent user ─────────────────────────────────────────────────
  const agentHash = await bcrypt.hash('dsp-agent123!', 12);
  await prisma.user.upsert({
    where: { email: 'agent@dsp.pk' },
    create: {
      tenantId:     tenant.id,
      email:        'agent@dsp.pk',
      passwordHash: agentHash,
      role:         'AGENT',
      fullName:     'Zara — AI Sales Agent',
    },
    update: {},
  });
  console.log('✅ DSP agent created');

  // ── 4. AI Config ──────────────────────────────────────────────────
  await prisma.aiConfig.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId:      tenant.id,
      systemPrompt:  DSP_SYSTEM_PROMPT,
      language:      'en-PK',
      model:         'claude-sonnet-4-6',
      temperature:   0.4,
      maxTokens:     600,
      tone:          'Warm & Encouraging',
      handoffTriggers: ['refund', 'complaint', 'legal', 'guarantee', 'money back'],
      qualificationCriteria: [
        'Aap abhi kya kar rahe hain? Student, job, ya business?',
        'AI kyun seekhna chahte hain — job, freelancing, ya business automation?',
        'Daily kitna time de sakte hain program ke liye?',
        'Koi technical background hai? Coding wagera?',
        'Kab tak start karna chahte hain?',
      ],
    },
    update: {},
  });
  console.log('✅ DSP AI config created');

  // ── 5. Subscription ───────────────────────────────────────────────
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId:         tenant.id,
      plan:             'ENTERPRISE',
      status:           'ACTIVE',
      contactsLimit:    10000,
      aiTokensLimit:    20000000,
      messagesLimit:    200000,
      currentPeriodEnd: new Date(Date.now() + 365 * 86400 * 1000),
    },
    update: {},
  });
  console.log('✅ DSP subscription created');

  // ── 6. Campaigns ──────────────────────────────────────────────────
  const campaigns = await Promise.all([
    prisma.campaign.create({
      data: {
        tenantId:       tenant.id,
        name:           'AI Mastery — Facebook Lead Gen',
        metaCampaignId: 'dsp_fb_camp_001',
        metaAdsetId:    'dsp_fb_adset_001',
        budget:         150000,
        spend:          98500,
        impressions:    245000,
        clicks:         4200,
        ctr:            1.71,
        cpm:            402,
        cpl:            2345,
        conversions:    42,
        status:         'ACTIVE',
        startedAt:      daysAgo(60),
      },
    }),
    prisma.campaign.create({
      data: {
        tenantId:       tenant.id,
        name:           'AI Mastery — Instagram Reels',
        metaCampaignId: 'dsp_ig_camp_001',
        metaAdsetId:    'dsp_ig_adset_001',
        budget:         80000,
        spend:          61200,
        impressions:    380000,
        clicks:         3100,
        ctr:            0.82,
        cpm:            161,
        cpl:            1975,
        conversions:    31,
        status:         'ACTIVE',
        startedAt:      daysAgo(45),
      },
    }),
    prisma.campaign.create({
      data: {
        tenantId:       tenant.id,
        name:           'Referral WhatsApp Blast',
        budget:         20000,
        spend:          12000,
        impressions:    0,
        clicks:         0,
        conversions:    18,
        status:         'ENDED',
        startedAt:      daysAgo(90),
        endedAt:        daysAgo(30),
      },
    }),
  ]);
  console.log(`✅ ${campaigns.length} DSP campaigns created`);

  // ── 7. Generate 300 leads ──────────────────────────────────────────
  console.log('\n📊 Generating 300 mock leads...');

  let leadCount = 0;
  let totalRevenue = 0;

  for (const stageDef of STAGE_DISTRIBUTION) {
    for (let i = 0; i < stageDef.count; i++) {
      const firstName  = pick(FIRST_NAMES);
      const lastName   = pick(LAST_NAMES);
      const fullName   = `${firstName} ${lastName}`;
      const city       = pick(CITIES_WEIGHTED);
      const ageGroup   = pick(AGE_WEIGHTED);
      const source     = pick(SOURCES_WEIGHTED);
      const campaign   = pick(campaigns);
      const aiScore    = rand(...stageDef.score);
      const daysBack   = rand(1, 90);
      const createdAt  = daysAgo(daysBack);

      // Pakistani phone: 92 + 3XX + 7 digits
      const netPrefix  = pick(['300','301','302','303','310','311','312','313','314','315','316','317','318','319','320','321','322','323','330','331','332','333','334','335','340','341','342','345']);
      const phone      = `92${netPrefix}${rand(1000000, 9999999)}`;

      // Contact
      const contact = await prisma.contact.create({
        data: {
          tenantId:  tenant.id,
          phone,
          name:      fullName,
          email:     `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(10,99)}@gmail.com`,
          city,
          ageGroup,
          tags:      [source.utm, ageGroup, city.toLowerCase()],
          optIn:     true,
        },
      });

      // Deal value: Rs 10,000 for enrolled/won
      const isWon    = stageDef.stage === 'CLOSED_WON';
      const isEnrolled = stageDef.stage === 'PROPOSED';
      const dealVal  = isWon ? 10000 : isEnrolled ? 10000 : null;
      if (isWon) totalRevenue += 10000;

      // DSP phase for active students
      const dspPhase = isWon ? pick(DSP_PHASES) : null;

      // Lead
      const lead = await prisma.lead.create({
        data: {
          tenantId:    tenant.id,
          contactId:   contact.id,
          campaignId:  source.utm.includes('organic') || source.utm === 'referral' ? null : campaign.id,
          stage:       stageDef.stage,
          scoreLabel:  stageDef.label,
          aiScore,
          dealValue:   dealVal,
          currency:    'PKR',
          dspPhase,
          enrollmentFee: isWon || isEnrolled ? 10000 : null,
          lostReason:  stageDef.stage === 'CLOSED_LOST' ? pick(LOST_REASONS) : null,
          closedAt:    isWon || stageDef.stage === 'CLOSED_LOST' ? createdAt : null,
          sourceUtm: {
            source:    source.utm,
            medium:    source.utm.includes('ad') ? 'paid' : 'organic',
            campaign:  source.utm.includes('facebook') ? 'dsp_fb_camp_001' : source.utm.includes('instagram') ? 'dsp_ig_camp_001' : null,
          },
          qualificationData: {
            occupation:   pick(['Student', 'Job seeker', 'Freelancer', 'Business owner', 'Working professional']),
            goal:         pick(['Dollar income', 'Freelancing', 'Business automation', 'Career switch', 'Upskilling']),
            timeAvailable: pick(['1-2 hrs/day', '2-3 hrs/day', '3+ hrs/day']),
            techBackground: pick(['None', 'Basic', 'Intermediate']),
          },
          intent:      aiScore >= 70 ? 'high' : aiScore >= 45 ? 'medium' : 'low',
          leadTemperature: stageDef.label,
          createdAt,
          updatedAt:   createdAt,
        },
      });

      // Conversation
      const convStatus = isWon ? 'CLOSED' : stageDef.stage === 'CLOSED_LOST' ? 'CLOSED' : 'AI_HANDLING';
      const conversation = await prisma.conversation.create({
        data: {
          tenantId:      tenant.id,
          leadId:        lead.id,
          contactId:     contact.id,
          status:        convStatus,
          aiEnabled:     !isWon && stageDef.stage !== 'CLOSED_LOST',
          lastMessageAt: hoursAgo(rand(1, 48)),
          createdAt,
        },
      });

      // Add 2-4 messages per conversation
      const msgCount = rand(2, 4);
      for (let m = 0; m < msgCount; m++) {
        const isInbound = m % 2 === 0;
        await prisma.message.create({
          data: {
            tenantId:       tenant.id,
            conversationId: conversation.id,
            waMessageId:    `mock_${phone}_${m}_${Date.now()}_${rand(1000,9999)}`,
            direction:      isInbound ? 'INBOUND' : 'OUTBOUND',
            sender:         isInbound ? 'CONTACT' : 'AI',
            type:           'TEXT',
            content:        isInbound ? pick(INBOUND_MSGS) : pick(AI_RESPONSES),
            status:         'DELIVERED',
            aiTokensUsed:   isInbound ? 0 : rand(150, 400),
            sentAt:         hoursAgo(rand(1, 72)),
          },
        });
      }

      // Activity log
      await prisma.activity.create({
        data: {
          tenantId:  tenant.id,
          leadId:    lead.id,
          type:      'AI_ACTION',
          content:   `Lead ${stageDef.stage === 'NEW' ? 'entered pipeline' : stageDef.stage === 'QUALIFYING' ? 'contacted via AI' : stageDef.stage === 'DIAGNOSED' ? 'showed interest in enrollment' : stageDef.stage === 'PROPOSED' ? 'enrollment proposed — awaiting payment' : isWon ? 'enrolled and payment confirmed' : 'marked as lost'}`,
          metadata:  { source: source.utm, city, ageGroup },
          createdAt,
        },
      });

      leadCount++;
    }

    console.log(`  ✓ ${stageDef.stage}: ${stageDef.count} leads`);
  }

  console.log(`\n✅ ${leadCount} total leads created`);
  console.log(`💰 Mock revenue: Rs. ${totalRevenue.toLocaleString()}`);

  // ── 8. Summary ────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────');
  console.log('DSP Tenant Credentials:');
  console.log('  Admin:  admin@dsp.pk     / dsp-admin123!');
  console.log('  Agent:  agent@dsp.pk     / dsp-agent123!');
  console.log(`  Tenant ID: ${tenant.id}`);
  console.log('─────────────────────────────────────────────────────');
  console.log('\nTo log in:  go to /auth and use the admin credentials above.');
  console.log('To inject a test message (WHATSAPP_MOCK=true):');
  console.log(`  POST /api/v1/dev/inject-message`);
  console.log(`  { "tenantId": "${tenant.id}", "phone": "923001234567", "message": "Salam, AI course ke baare mein batao" }`);
  console.log('\n🎉 DSP seed complete!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
