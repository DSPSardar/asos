const fs = require('fs');
const path = require('path');
const prisma = require('../../config/database');
const env = require('../../config/env');
const claudeService = require('../../services/claude.service');
const whatsappService = require('../../services/whatsapp.service');

const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };

const aggregate = async (tenantId, from, to) => {
  const range = { gte: new Date(from), lte: new Date(to) };
  const [campaigns, leadCount, conversationCount] = await Promise.all([
    prisma.campaign.findMany({ where: { tenantId }, select: { name: true, spend: true, ctr: true, cpm: true, cpl: true, conversions: true } }),
    prisma.lead.count({ where: { tenantId, createdAt: range } }),
    prisma.message.count({ where: { tenantId, direction: 'INBOUND', sentAt: range } }),
  ]);
  return { campaigns, leadCount, conversationCount };
};

const buildReport = async ({ tenantId, periodType, from, to, language = 'en', sendPhone }) => {
  const data = await aggregate(tenantId, from, to);
  const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId } });
  const summaryObj = await claudeService.runCloser({
    aiConfig,
    lead: { id: 'report', stage: 'DIAGNOSED' },
    contact: { name: 'Client' },
    messageHistory: [],
    newMessage: `Create ${periodType} performance summary in ${language} with this data: ${JSON.stringify(data)}`,
    qualifierOutput: { lead_status: 'HOT', score: 9, intent: 'high', problem_summary: 'report', next_action: 'continue_qualifying' },
  });

  const reportsDir = path.resolve(process.cwd(), env.REPORTS_DIR);
  ensureDir(reportsDir);
  const filename = `report-${tenantId}-${Date.now()}.pdf`;
  const reportPath = path.join(reportsDir, filename);
  fs.writeFileSync(reportPath, Buffer.from(`ASOS REPORT\n\n${summaryObj.reply_message}`));

  const report = await prisma.clientReport.create({
    data: {
      tenantId,
      periodType,
      language,
      reportFrom: new Date(from),
      reportTo: new Date(to),
      summary: summaryObj.reply_message,
      pdfPath: reportPath,
      sentToPhone: sendPhone || null,
      sentAt: sendPhone ? new Date() : null,
      metadata: data,
    },
  });

  if (sendPhone) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    await whatsappService.sendText(tenant, sendPhone, `${language === 'ur' ? 'Report tayar hai' : 'Report is ready'}: ${filename}`);
  }

  return report;
};

const listReports = async (tenantId) => prisma.clientReport.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });

module.exports = { buildReport, listReports };
