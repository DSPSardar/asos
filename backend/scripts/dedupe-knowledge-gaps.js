#!/usr/bin/env node
// scripts/dedupe-knowledge-gaps.js
//
// One-off cleanup for KnowledgeGap rows logged before questions were cleaned
// and fuzzy-matched. Those rows are the same handful of questions stored in a
// dozen different wordings ("fee amount", "Fee amount is not provided in the
// DSP knowledge base.", "Fee structure is not provided in the DSP knowledge
// base."), which is why the Settings list is full of near-identical cards and
// why answering one of them didn't stop the others coming back.
//
// Merging rules — for each group of matching questions, keep ONE row:
//   • prefer an already-answered row, so no owner answer is ever discarded
//   • sum timesAsked across the group
//   • store the cleaned (boilerplate-free) question text
//   • delete the rest
//
// Dry run by default — nothing is written without --apply:
//   node scripts/dedupe-knowledge-gaps.js               # show what would change
//   node scripts/dedupe-knowledge-gaps.js --apply       # perform the merge
//   node scripts/dedupe-knowledge-gaps.js --apply --tenant <tenantId>

require('dotenv').config();

const prisma = require('../src/config/database');
const { cleanQuestion, isSameQuestion } = require('../src/modules/knowledge-gaps/question-key');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantArgIndex = args.indexOf('--tenant');
const TENANT_ID = tenantArgIndex !== -1 ? args[tenantArgIndex + 1] : null;

const groupGaps = (gaps) => {
  const groups = [];

  for (const gap of gaps) {
    const group = groups.find((g) => isSameQuestion(g[0].question, gap.question));
    if (group) group.push(gap);
    else groups.push([gap]);
  }

  return groups;
};

// Answered rows win — an owner's answer is the one thing here that can't be
// regenerated. Among equals, keep the one asked most often, then the oldest.
const pickKeeper = (group) => [...group].sort((a, b) => {
  if (a.resolved !== b.resolved) return a.resolved ? -1 : 1;
  if (a.timesAsked !== b.timesAsked) return b.timesAsked - a.timesAsked;
  return new Date(a.createdAt) - new Date(b.createdAt);
})[0];

const run = async () => {
  const where = TENANT_ID ? { tenantId: TENANT_ID } : {};
  const gaps = await prisma.knowledgeGap.findMany({ where, orderBy: { createdAt: 'asc' } });

  const byTenant = new Map();
  for (const gap of gaps) {
    if (!byTenant.has(gap.tenantId)) byTenant.set(gap.tenantId, []);
    byTenant.get(gap.tenantId).push(gap);
  }

  let totalMerged = 0;
  let totalRenamed = 0;

  for (const [tenantId, tenantGaps] of byTenant) {
    console.log(`\n── tenant ${tenantId} — ${tenantGaps.length} gap(s)`);

    for (const group of groupGaps(tenantGaps)) {
      const keeper = pickKeeper(group);
      const dropped = group.filter((g) => g.id !== keeper.id);
      const question = cleanQuestion(keeper.question).slice(0, 500);
      const timesAsked = group.reduce((sum, g) => sum + g.timesAsked, 0);

      const needsRename = question !== keeper.question;
      if (!dropped.length && !needsRename) continue;

      if (dropped.length) {
        console.log(`  merge ${group.length} → "${question}" (asked ${timesAsked}×${keeper.resolved ? ', answered' : ''})`);
        for (const gap of dropped) console.log(`    - drop "${gap.question}"`);
        totalMerged += dropped.length;
      } else {
        console.log(`  clean "${keeper.question}" → "${question}"`);
        totalRenamed += 1;
      }

      if (!APPLY) continue;

      await prisma.knowledgeGap.update({
        where: { id: keeper.id },
        data: { question, timesAsked },
      });

      if (dropped.length) {
        await prisma.knowledgeGap.deleteMany({ where: { id: { in: dropped.map((g) => g.id) } } });
      }
    }
  }

  console.log(`\n${APPLY ? 'Merged' : 'Would merge'} ${totalMerged} duplicate row(s); ${APPLY ? 'cleaned' : 'would clean'} ${totalRenamed} question(s).`);
  if (!APPLY) console.log('Dry run — re-run with --apply to write these changes.');
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
