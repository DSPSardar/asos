// marketing/pipeline/config.js
// Model, paths, and DSP constants shared across the pipeline scripts.

const path = require('path');

const MARKETING_ROOT = path.resolve(__dirname, '..');

module.exports = {
  // The spec that originated this module asked for "claude-sonnet-4-6", which is not a
  // valid/current Anthropic model id. Defaulting to the real current Sonnet model instead;
  // override via CLAUDE_MARKETING_MODEL if a different model is preferred.
  MODEL: process.env.CLAUDE_MARKETING_MODEL || 'claude-sonnet-5',
  MAX_TOKENS: 4096,

  BUSINESS_UNIT: 'DSP',

  PATHS: {
    root: MARKETING_ROOT,
    agents: path.join(MARKETING_ROOT, 'agents'),
    knowledge: path.join(MARKETING_ROOT, 'knowledge', 'dsp'),
    output: path.join(MARKETING_ROOT, 'output', 'dsp'),
  },

  KNOWLEDGE_FILES: ['voice.md', 'offers.md', 'winners.md'],

  // Pipeline order — matches agents/01..05. DM Manager (06) and Sales/Closer (07) run
  // standalone via dm-manager.js; Analyst (08) runs standalone via analyst.js.
  PIPELINE_STEPS: [
    { step: 'scout', agentFile: '01-scout.md' },
    { step: 'planner', agentFile: '02-planner.md' },
    { step: 'hook-writer', agentFile: '03-hook-writer.md' },
    { step: 'content-writer', agentFile: '04-content-writer.md' },
    { step: 'repurposer', agentFile: '05-repurposer.md' },
  ],

  DM_MANAGER_AGENT_FILE: '06-dm-manager.md',
  SALES_CLOSER_AGENT_FILE: '07-sales-closer.md',
  ANALYST_AGENT_FILE: '08-analyst.md',

  // Integration with the real ASOS backend (see leadsClient.js).
  API_BASE_URL: process.env.MARKETING_API_BASE_URL || 'http://localhost:3000/api/v1',
};
