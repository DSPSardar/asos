// src/lib/api.js
// API client + rich mock data for ASOS dashboard

const BASE_URL = 'http://localhost:3000/api/v1';

// ── Auth token management ─────────────────────────────────────────────
const getToken = () => localStorage.getItem('asos_token') || 'demo-token';

const apiClient = {
  get: async (path) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch {
      return null; // Fall back to mock data when backend not available
    }
  },
  post: async (path, body) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    } catch { return null; }
  },
  patch: async (path, body) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    } catch { return null; }
  },
};

// ── Mock Data ─────────────────────────────────────────────────────────

const MOCK = {
  overview: {
    leads:          { total: 1284, hot: 87, closedWon: 142, closedLost: 63 },
    revenue:        { total: 487600 },
    conversionRate: '11.1%',
    aiHandlingRate: '78.4%',
    messages:       { total: 8920, aiHandled: 6993 },
    contacts:       { total: 1284 },
    usage: { aiTokensUsed: 3_420_000, aiTokensLimit: 5_000_000, messagesUsed: 8920, messagesLimit: 50000 },
  },

  funnelData: [
    { stage: 'NEW',        count: 1284, rate: null,    color: '#475569' },
    { stage: 'QUALIFYING', count: 891,  rate: '69.4%', color: '#6366f1' },
    { stage: 'DIAGNOSED',  count: 534,  rate: '59.9%', color: '#8b5cf6' },
    { stage: 'PROPOSED',   count: 287,  rate: '53.7%', color: '#a78bfa' },
    { stage: 'CLOSED_WON', count: 142,  rate: '49.5%', color: '#10b981' },
  ],

  revenueTimeline: [
    { date:'Jan', revenue:38400,  leads:89  },
    { date:'Feb', revenue:52100,  leads:112 },
    { date:'Mar', revenue:44800,  leads:98  },
    { date:'Apr', revenue:61200,  leads:134 },
    { date:'May', revenue:58900,  leads:127 },
    { date:'Jun', revenue:72400,  leads:158 },
    { date:'Jul', revenue:68100,  leads:149 },
    { date:'Aug', revenue:79600,  leads:173 },
    { date:'Sep', revenue:84200,  leads:184 },
    { date:'Oct', revenue:91800,  leads:201 },
    { date:'Nov', revenue:87400,  leads:193 },
    { date:'Dec', revenue:97600,  leads:212 },
  ],

  aiPerformance: [
    { name:'Mon', score:7.2, handoffs:3, messages:142 },
    { name:'Tue', score:7.8, handoffs:2, messages:168 },
    { name:'Wed', score:8.1, handoffs:1, messages:154 },
    { name:'Thu', score:7.5, handoffs:4, messages:189 },
    { name:'Fri', score:8.4, handoffs:2, messages:201 },
    { name:'Sat', score:7.9, handoffs:3, messages:134 },
    { name:'Sun', score:8.2, handoffs:1, messages:98  },
  ],

  // ── v1.5 Dual Agent — leads now carry intent / problemSummary / humanFollowupRequired ──
  leads: [
    { id:'l1', stage:'NEW',        name:'Ahmed Raza',      phone:'923001111111', score:22, label:'COLD', campaign:'Eid ul-Fitr Sale', value:0,     created:'2h ago',  intent:'low',    problemSummary:'Browsing pricing, no clear need yet', nextAction:'nurture',             humanFollowupRequired:false },
    { id:'l2', stage:'NEW',        name:'Sana Malik',      phone:'923002222222', score:18, label:'COLD', campaign:'Eid ul-Fitr Sale', value:0,     created:'3h ago',  intent:'low',    problemSummary:'Asked about features, vague timeline',  nextAction:'continue_qualifying', humanFollowupRequired:false },
    { id:'l3', stage:'QUALIFYING', name:'Usman Tariq',     phone:'923003333333', score:58, label:'WARM', campaign:'23rd March Drive',  value:2200,  created:'1d ago',  intent:'medium', problemSummary:'Slow WhatsApp response time hurting sales', nextAction:'continue_qualifying', humanFollowupRequired:false },
    { id:'l4', stage:'QUALIFYING', name:'Ayesha Khan',     phone:'923004444444', score:62, label:'WARM', campaign:'Eid ul-Fitr Sale', value:3100,  created:'1d ago',  intent:'medium', problemSummary:'Wants to automate lead qualification',     nextAction:'continue_qualifying', humanFollowupRequired:false },
    { id:'l5', stage:'DIAGNOSED',  name:'Bilal Hussain',   phone:'923005555555', score:74, label:'WARM', campaign:'23rd March Drive',  value:5400,  created:'2d ago',  intent:'medium', problemSummary:'Losing 70% of leads from Meta Ads',         nextAction:'send_proposal',       humanFollowupRequired:false },
    { id:'l6', stage:'DIAGNOSED',  name:'Fatima Sheikh',   phone:'923006666666', score:81, label:'HOT',  campaign:'Eid ul-Fitr Sale', value:7800,  created:'2d ago',  intent:'high',   problemSummary:'200 leads/mo, only 30 close — needs AI now', nextAction:'send_proposal',       humanFollowupRequired:true  },
    { id:'l7', stage:'PROPOSED',   name:'Zain Ahmed',      phone:'923007777777', score:88, label:'HOT',  campaign:'23rd March Drive',  value:12000, created:'3d ago',  intent:'high',   problemSummary:'Has $15k budget, wants to close this week', nextAction:'close_deal',          humanFollowupRequired:true  },
    { id:'l8', stage:'PROPOSED',   name:'Hira Baig',       phone:'923008888888', score:91, label:'HOT',  campaign:'Eid ul-Fitr Sale', value:9500,  created:'3d ago',  intent:'high',   problemSummary:'Decision-maker, comparing vs ManyChat',     nextAction:'close_deal',          humanFollowupRequired:true  },
    { id:'l9', stage:'CLOSED_WON', name:'Omar Farooq',     phone:'923009999999', score:95, label:'HOT',  campaign:'Eid ul-Fitr Sale', value:15000, created:'5d ago',  intent:'high',   problemSummary:'Closed — onboarding scheduled',             nextAction:'close_deal',          humanFollowupRequired:false },
  ],

  conversations: [
    {
      id:'c1', contactName:'Fatima Sheikh', phone:'+92 300 666-6666',
      status:'AI_HANDLING', aiScore:81, label:'HOT', lastSeen:'2 min ago',
      messages:[
        { id:'m1', sender:'CONTACT', content:'Hi! I saw your Instagram ad about sales automation. I want to know more!', time:'14:22', status:'READ' },
        { id:'m2', sender:'AI',      content:'Hello! So glad you reached out 😊 I\'m Alex, a sales consultant at ASOS. Tell me — what\'s your biggest sales challenge right now?', time:'14:22', status:'READ' },
        { id:'m3', sender:'CONTACT', content:'We lose a lot of leads because we can\'t respond fast enough. They go cold before we get back to them.', time:'14:23', status:'READ' },
        { id:'m4', sender:'AI',      content:'I totally get that! Response speed is critical — leads contacted within 5 minutes are 9× more likely to convert. How long has this been a problem, and roughly how many leads do you get per month?', time:'14:23', status:'READ' },
        { id:'m5', sender:'CONTACT', content:'About 6 months now. We get around 200 leads a month but only close about 30 of them.', time:'14:25', status:'READ' },
        { id:'m6', sender:'AI',      content:'200 leads closing only 30 — that\'s roughly $50-80k/month in missed opportunities! 🔥 Our AI responds in under 30 seconds, 24/7. Have you tried any automation tools before?', time:'14:25', status:'DELIVERED' },
        { id:'m7', sender:'CONTACT', content:'Tried ManyChat but it felt too robotic. No personality at all.', time:'14:27', status:'READ' },
        { id:'m8', sender:'AI',      content:'That makes total sense! The difference with ASOS is we use Claude AI — the most advanced model available. It feels human, qualifies leads automatically, and only escalates to an agent when they\'re hot. Want me to show you a demo right now?', time:'14:27', status:'SENT' },
      ]
    },
    {
      id:'c2', contactName:'Zain Ahmed', phone:'+92 300 777-7777',
      status:'HUMAN_TAKEOVER', aiScore:88, label:'HOT', lastSeen:'15 min ago',
      messages:[
        { id:'m1', sender:'CONTACT', content:'I need to close this week. What\'s your implementation timeline?', time:'13:45', status:'READ' },
        { id:'m2', sender:'AI',      content:'Great news! Implementation takes 2 business days — includes AI training on your product and full WhatsApp integration. What budget are you working with?', time:'13:45', status:'READ' },
        { id:'m3', sender:'CONTACT', content:'I have up to $15k to close this deal.', time:'13:47', status:'READ' },
        { id:'m4', sender:'SYSTEM',  content:'🤖 Lead transferred to human agent — score 88/100, budget confirmed $15k', time:'13:47', status:'READ' },
        { id:'m5', sender:'AGENT',   content:'Hi Zain! I\'m John, your account executive. Great news on the timeline! I\'ll send you a personalized proposal right now. What\'s the best email to reach you?', time:'13:50', status:'READ' },
      ]
    },
    {
      id:'c3', contactName:'Ayesha Khan', phone:'+92 300 333-3333',
      status:'ACTIVE', aiScore:58, label:'WARM', lastSeen:'1h ago',
      messages:[
        { id:'m1', sender:'CONTACT', content:'How does pricing work?', time:'11:30', status:'READ' },
        { id:'m2', sender:'AI',      content:'We have monthly plans with no lock-in, and annual plans with 25% off. What\'s the size of your operation so I can recommend the best fit?', time:'11:30', status:'READ' },
      ]
    },
  ],

  campaigns: [
    { id:'camp1', name:'Eid ul-Fitr Sale 2024',  status:'ACTIVE',  spend:8420,  revenue:47800,  leads:284, roas:5.68, cpl:29.65, impressions:124000, clicks:3280, ctr:'2.64%' },
    { id:'camp2', name:'23rd March Drive',        status:'ACTIVE',  spend:3140,  revenue:21600,  leads:142, roas:6.88, cpl:22.11, impressions:58000,  clicks:1840, ctr:'3.17%' },
    { id:'camp3', name:'Independence Day Aug',    status:'PAUSED',  spend:2100,  revenue:8400,   leads:87,  roas:4.00, cpl:24.14, impressions:89000,  clicks:980,  ctr:'1.10%' },
    { id:'camp4', name:'Eid ul-Adha Leads',       status:'ACTIVE',  spend:1840,  revenue:14200,  leads:98,  roas:7.72, cpl:18.78, impressions:41000,  clicks:1540, ctr:'3.76%' },
  ],

  adsSpend: [
    { date:'Mon', spend:980,  revenue:5840  },
    { date:'Tue', spend:1240, revenue:7200  },
    { date:'Wed', spend:1100, revenue:6100  },
    { date:'Thu', spend:1380, revenue:9800  },
    { date:'Fri', spend:1520, revenue:11200 },
    { date:'Sat', spend:980,  revenue:5400  },
    { date:'Sun', spend:760,  revenue:4200  },
  ],

  aiInsights: {
    overallScore: 74,
    weakPoints: [
      { area:'Response Speed',      score:62, issue:'Average response delay 4.2min on evenings', fix:'Enable 24/7 AI mode — configure off-hours automation' },
      { area:'Qualification Depth', score:71, issue:'Budget question asked too late in conversation', fix:'Adjust BANT order — surface budget question at message #3' },
      { area:'Closing Rate',        score:68, issue:'HOT leads sitting in PROPOSED stage 3+ days', fix:'Add automated urgency trigger after 48h in PROPOSED' },
      { area:'Campaign Targeting',  score:81, issue:'Independence Day Aug CPL 31% above benchmark', fix:'Pause Independence Day Aug, reallocate budget to Eid ul-Adha Leads' },
    ],
    opportunities: [
      '23rd March Drive showing 6.88 ROAS — scale budget by 40%',
      '87 HOT leads with no follow-up in 24h — AI can auto-nurture',
      'Friday 14:00-18:00 peak window — highest conversion time slot',
      'Avg deal value R$ 8,400 — upsell potential on 23 existing clients',
    ],
    forecast: { thisMonth: 94200, nextMonth: 112800, confidence: '78%' },
  },

  settings: {
    tenant:        { name:'Demo Empresa Ltda', slug:'demo-empresa', plan:'PRO' },
    whatsapp:      { phoneId:'551199999-demo', connected:true, number:'+55 11 99999-0000' },
    meta:          { pixelId:'1234567890', connected:true },
    billing:       { plan:'PRO', nextBilling:'Jan 1, 2025', amount:'R$ 297/mês' },
  },
};

// ── Hooks ─────────────────────────────────────────────────────────────

const useData = (key, apiPath) => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      const live = apiPath ? await apiClient.get(apiPath) : null;
      await new Promise(r => setTimeout(r, 600)); // Simulate load for demo
      setData(live?.data || MOCK[key]);
      setLoading(false);
    };
    load();
  }, [key, apiPath]);

  return { data, loading };
};

const useCounter = (target, duration = 1200) => {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!target) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
      else setCount(target);
    };
    requestAnimationFrame(tick);
  }, [target]);
  return count;
};

// Export to window
Object.assign(window, { MOCK, apiClient, useData, useCounter });
