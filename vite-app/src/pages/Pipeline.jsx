// src/pages/Pipeline.jsx — Leads page (route: /leads). Kanban + Table views,
// search/filter, slide-out detail panel, "+ New Lead" modal.
import React, { useMemo, useState, useEffect } from 'react';
import { PageHeader } from '@pages/Layout';

// ─────────────────────────────────────────────────────────────
// Style maps
// ─────────────────────────────────────────────────────────────
const STAGES = [
  { key:'NEW',       label:'New',       color:'#6366f1', accent:'border-indigo-500/40 bg-indigo-500/5' },
  { key:'QUALIFIED', label:'Qualified', color:'#06b6d4', accent:'border-cyan-500/40 bg-cyan-500/5' },
  { key:'PROPOSAL',  label:'Proposal',  color:'#a855f7', accent:'border-violet-500/40 bg-violet-500/5' },
  { key:'WON',       label:'Won',       color:'#10b981', accent:'border-emerald-500/40 bg-emerald-500/5' },
  { key:'LOST',      label:'Lost',      color:'#475569', accent:'border-slate-500/30 bg-slate-500/5' },
];

const SCORE_STYLES = {
  HOT:  { label:'HOT',  dot:'bg-red-400',   pill:'bg-red-500/15 text-red-300 border-red-500/30' },
  WARM: { label:'WARM', dot:'bg-amber-400', pill:'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  COLD: { label:'COLD', dot:'bg-sky-400',   pill:'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

const SOURCES = ['WhatsApp Ads', 'Facebook Ads', 'Instagram', 'Website', 'Referral'];
const SOURCE_COLOR = {
  'WhatsApp Ads': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  'Facebook Ads': 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  'Instagram':    'bg-pink-500/10 text-pink-300 border-pink-500/30',
  'Website':      'bg-slate-500/10 text-slate-300 border-slate-500/30',
  'Referral':     'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

// ─────────────────────────────────────────────────────────────
// MOCK DATA — 25 leads. Each has lastMessages so the slide-out
// panel never goes blank. Timeline is generated from stage.
// ─────────────────────────────────────────────────────────────
const LEADS = [
  // ── NEW (10) ──────────────────────────────────────────────
  { id:'l1',  name:'Ahmed Khan',     phone:'+92 333 4421872', stage:'NEW',       score:'HOT',  source:'WhatsApp Ads', lastActivity:'2m',  value:2500000,  owner:'Saad', notes:'25 lakh entry, looking for income',
    lastMessages:[
      { from:'contact', text:'Assalam o alaikum, BTREIT mein invest karna chahta hoon. Minimum kya hai?', ts:'14:22' },
      { from:'ai',      text:'Walaikum assalam Ahmed! Welcome to Boulevard Tower REIT. Minimum entry PKR 1 lakh hai. Aap ka target ticket size?', ts:'14:22' },
      { from:'contact', text:'Around 25 lakh start karna hai income generation ke liye.', ts:'14:25' },
    ]},
  { id:'l2',  name:'Fatima Sheikh',  phone:'+92 345 9001775', stage:'NEW',       score:'WARM', source:'Facebook Ads', lastActivity:'18m', value:1500000,  owner:'Saad', notes:'Wants Shariah audit certificate before subscribing',
    lastMessages:[
      { from:'contact', text:'Hello, BTREIT ke baare mein info chahiye is hafte.', ts:'13:51' },
      { from:'ai',      text:'Hi Fatima! Bilkul, prospectus aur consultation set kar dete hain. Kis cheez se shuru karein?', ts:'13:51' },
      { from:'contact', text:'Pehle Shariah-compliance certificate dekhna hai.', ts:'13:55' },
    ]},
  { id:'l3',  name:'Imran Sheikh',   phone:'+92 311 6677889', stage:'NEW',       score:'COLD', source:'Website',      lastActivity:'1h',  value:300000,   owner:'Saad', notes:'First-time investor, exploring REIT entry',
    lastMessages:[
      { from:'contact', text:'REIT mein invest karna ho to minimum kya hai?', ts:'13:10' },
      { from:'ai',      text:'Walaikum assalam Imran! BTREIT minimum 1 lakh, quarterly dividends 9–11% target. Aap ka entry level?', ts:'13:11' },
      { from:'contact', text:'Theek hai, dekh ke batata hoon.', ts:'13:14' },
    ]},
  { id:'l4',  name:'Maryam Ali',     phone:'+92 308 1122334', stage:'NEW',       score:'HOT',  source:'Instagram',    lastActivity:'1h',  value:6000000,  owner:'Saad', notes:'60 lakh, ready to subscribe after consultation',
    lastMessages:[
      { from:'contact', text:'Aap ka Instagram post dekha tha BTREIT dividends ka. Detail chahiye.', ts:'12:55' },
      { from:'ai',      text:'Hi Maryam! BTREIT target 9–11% annualized dividends, paid quarterly. Aap ka allocation range?', ts:'12:55' },
      { from:'contact', text:'60 lakh tak. Aaj evening consultation possible hai? 5 PM?', ts:'13:00' },
    ]},
  { id:'l5',  name:'Saad Ali',       phone:'+92 312 5544336', stage:'NEW',       score:'WARM', source:'Referral',     lastActivity:'2h',  value:3200000,  owner:'Saad', notes:'Referred by Hassan Raza (existing investor)',
    lastMessages:[
      { from:'contact', text:'Hassan bhai ne refer kiya hai, BTREIT subscription details chahiye.', ts:'12:00' },
      { from:'ai',      text:'Walaikum assalam Saad! Hassan bhai already mention kar chuke hain. 32 lakh range mein quarterly dividends approximately 72,000–88,000 expected.', ts:'12:01' },
      { from:'contact', text:'Pricing aur subscription form share kar dein.', ts:'12:05' },
    ]},
  { id:'l6',  name:'Hira Ahmed',     phone:'+92 322 8877665', stage:'NEW',       score:'COLD', source:'WhatsApp Ads', lastActivity:'3h',  value:280000,   owner:'Saad', notes:'Just gathering REIT info, no commitment',
    lastMessages:[
      { from:'contact', text:'REIT investment pricing aur returns chahiye Karachi area ke commercial.', ts:'11:00' },
      { from:'ai',      text:'Walaikum assalam Hira! BTREIT holds Boulevard One Karachi commercial. Target ROI 15–18% annual blended (dividend + capital). Interest level?', ts:'11:01' },
      { from:'contact', text:'Sirf research kar rahi hoon abhi.', ts:'11:10' },
    ]},
  { id:'l7',  name:'Faisal Khan',    phone:'+92 301 2244668', stage:'NEW',       score:'WARM', source:'Facebook Ads', lastActivity:'4h',  value:8000000,  owner:'Saad', notes:'80 lakh family savings allocation',
    lastMessages:[
      { from:'contact', text:'Family savings allocate karna hai REIT mein. 80 lakh range.', ts:'10:00' },
      { from:'ai',      text:'Hi Faisal! 80 lakh ke liye BTREIT mein approximately 1.8–2.2 lakh quarterly dividend expected. Consultation interest?', ts:'10:01' },
      { from:'contact', text:'Haan, lekin pehle prospectus PDF share karein.', ts:'10:05' },
    ]},
  { id:'l8',  name:'Tariq Hussain',  phone:'+92 333 9988776', stage:'NEW',       score:'HOT',  source:'Referral',     lastActivity:'5h',  value:12000000, owner:'Saad', notes:'HNW investor, multi-tower allocation',
    lastMessages:[
      { from:'contact', text:'1.2 crore allocation karna hai BTREIT mein. Institutional rate available?', ts:'09:00' },
      { from:'ai',      text:'Walaikum assalam Tariq bhai! 1cr+ HNW band ke liye 0.5% management fee (vs 0.7% standard). Saad bhai consultation karwa dete hain?', ts:'09:01' },
      { from:'contact', text:'Haan jaldi schedule karwa dein.', ts:'09:05' },
    ]},
  { id:'l9',  name:'Noor Fatima',    phone:'+92 345 1122993', stage:'NEW',       score:'WARM', source:'Instagram',    lastActivity:'6h',  value:4200000,  owner:'Saad', notes:'Newlyweds, first joint investment',
    lastMessages:[
      { from:'contact', text:'Hum dono shadi ke baad pehla investment plan kar rahe hain.', ts:'08:00' },
      { from:'ai',      text:'Mubarak ho Noor! Joint investment ke liye BTREIT acha hai — liquid hai, dividends income deti hai. 42 lakh range starter ke liye fit hai.', ts:'08:01' },
      { from:'contact', text:'Hum dono consultation karenge weekend pe.', ts:'08:10' },
    ]},
  { id:'l10', name:'Adnan Malik',    phone:'+92 311 5544221', stage:'NEW',       score:'COLD', source:'Website',      lastActivity:'8h',  value:180000,   owner:'Saad', notes:'Small entry, 1.8 lakh starter ticket',
    lastMessages:[
      { from:'contact', text:'Budget 1.8 lakh hai, REIT mein chal jayega?', ts:'06:00' },
      { from:'ai',      text:'Walaikum assalam Adnan! BTREIT ka minimum 1 lakh hai, 1.8 lakh acha starter hai. Quarterly dividend approximately 4,000–5,000 expected.', ts:'06:01' },
      { from:'contact', text:'Theek hai, sochta hoon.', ts:'06:30' },
    ]},

  // ── QUALIFIED (6) ─────────────────────────────────────────
  { id:'l11', name:'Ayesha Malik',   phone:'+92 321 9870034', stage:'QUALIFIED', score:'HOT',  source:'Facebook Ads', lastActivity:'18m', value:2500000,  owner:'Saad', notes:'Consultation call booked tomorrow 3 PM',
    lastMessages:[
      { from:'contact', text:'Kal 3 PM possible hai consultation?', ts:'13:51' },
      { from:'ai',      text:'Bilkul Ayesha! Confirmed: Kal 3:00 PM advisor call. Calendar invite + Zoom link bhej deti hoon.', ts:'13:51' },
      { from:'contact', text:'Perfect, kal milte hain.', ts:'13:54' },
    ]},
  { id:'l12', name:'Sadia Khan',     phone:'+92 312 4488776', stage:'QUALIFIED', score:'WARM', source:'WhatsApp Ads', lastActivity:'1h',  value:5500000,  owner:'Saad', notes:'Comparing BTREIT vs other REITs',
    lastMessages:[
      { from:'contact', text:'BTREIT aur dusre REITs ka comparison chahiye.', ts:'13:00' },
      { from:'ai',      text:'Hi Sadia! Comparison sheet bhej deti hoon — BTREIT ka dividend yield 9.8% (peer median 7.5%) aur expense ratio 0.7% (peer 1.1%). Shariah-compliant bhi hai.', ts:'13:00' },
      { from:'contact', text:'Sheet receive ho gayi, dekh ke decide karungi.', ts:'13:10' },
    ]},
  { id:'l13', name:'Kamran Iqbal',   phone:'+92 304 7766554', stage:'QUALIFIED', score:'HOT',  source:'Referral',     lastActivity:'3h',  value:9000000,  owner:'Saad', notes:'CEO, premium HNW allocation',
    lastMessages:[
      { from:'contact', text:'Premium HNW allocation options share karein, 90 lakh range.', ts:'11:00' },
      { from:'ai',      text:'Walaikum assalam Kamran sahab! 90 lakh allocation pe institutional rate 0.5% management fee, plus quarterly direct dividend payout. Detailed term sheet bhej dun?', ts:'11:01' },
      { from:'contact', text:'Aaj evening consultation book kar lein.', ts:'11:05' },
    ]},
  { id:'l14', name:'Mehwish Ali',    phone:'+92 322 8855443', stage:'QUALIFIED', score:'WARM', source:'Instagram',    lastActivity:'5h',  value:3800000,  owner:'Saad', notes:'Working professional, monthly SIP-style allocation',
    lastMessages:[
      { from:'contact', text:'Working girl hoon, monthly contribute karna chahti hoon BTREIT mein.', ts:'09:00' },
      { from:'ai',      text:'Mehwish, BTREIT mein you can do monthly top-ups (min 25k). 38 lakh portfolio target ke liye 38 months ka roadmap suggest kar sakti hoon.', ts:'09:01' },
      { from:'contact', text:'Consultation timings batayein.', ts:'09:05' },
    ]},
  { id:'l15', name:'Asad Sheikh',    phone:'+92 333 6677889', stage:'QUALIFIED', score:'COLD', source:'Website',      lastActivity:'1d',  value:6500000,  owner:'Saad', notes:'Slow decision maker, family discussion pending',
    lastMessages:[
      { from:'contact', text:'Prospectus bhej dein, family se discuss karunga.', ts:'Yesterday' },
      { from:'ai',      text:'Asad bhai, BTREIT prospectus + dividend history PDF bhej diya hai. Family meeting ke baad batayein.', ts:'Yesterday' },
      { from:'contact', text:'OK shukria.', ts:'Yesterday' },
    ]},
  { id:'l16', name:'Sara Tariq',     phone:'+92 345 9988770', stage:'QUALIFIED', score:'WARM', source:'WhatsApp Ads', lastActivity:'2d',  value:4000000,  owner:'Saad', notes:'Compared and qualified, parents discussion pending',
    lastMessages:[
      { from:'contact', text:'Returns reasonable lag rahe hain, payouts kab milte hain?', ts:'2 days ago' },
      { from:'ai',      text:'Sara, dividends quarterly milte hain (Mar/Jun/Sep/Dec). 5 lakh starter se subscription possible hai.', ts:'2 days ago' },
      { from:'contact', text:'Theek hai, parents se discuss karke batati hoon.', ts:'2 days ago' },
    ]},

  // ── PROPOSAL (5) ───────────────────────────────────────────
  { id:'l17', name:'Hassan Raza',    phone:'+92 300 7654129', stage:'PROPOSAL',  score:'HOT',  source:'Facebook Ads', lastActivity:'47m', value:42000000, owner:'Saad', notes:'4.2 crore institutional subscription, terms locked, awaiting transfer',
    lastMessages:[
      { from:'contact', text:'Sir 4 cr ka subscription kab tak ho jayega? CDC details bhejen.', ts:'13:21' },
      { from:'human',   text:'Hassan bhai, CDC investor account form + IBFT instructions email kar diye hain. Funds settle hone ke baad units 2 working days mein allot.', ts:'13:18' },
      { from:'contact', text:'Theek hai, terms acceptable hain.', ts:'13:15' },
    ]},
  { id:'l18', name:'Bilal Ahmed',    phone:'+92 312 8866442', stage:'PROPOSAL',  score:'COLD', source:'Referral',     lastActivity:'2h',  value:9000000,  owner:'Saad', notes:'Corporate treasury 9cr allocation, awaiting board approval',
    lastMessages:[
      { from:'contact', text:'Demo ke baad prospectus email kar dein please.', ts:'12:25' },
      { from:'ai',      text:'Bilal bhai, BTREIT prospectus + term sheet PDF bhej diya hai. 5cr+ ticket pe 0.4% management fee waiver applicable.', ts:'12:30' },
      { from:'contact', text:'Board ko forward kiya hai BTREIT prospectus, response next week.', ts:'12:35' },
    ]},
  { id:'l19', name:'Usman Ali',      phone:'+92 333 7711209', stage:'PROPOSAL',  score:'WARM', source:'WhatsApp Ads', lastActivity:'6h',  value:500000,   owner:'Saad', notes:'Subscription payment dispute, treasury reconciling',
    lastMessages:[
      { from:'contact', text:'Hello? Sir urgent hai, paise debit ho gaye but units allot nahi huin!', ts:'15:33' },
      { from:'contact', text:'Sir please jaldi response do, NAV calculation pe loss ho raha hai mera.', ts:'15:14' },
      { from:'contact', text:'Refund chahiye! Account se 5 lakh debit ho gaye but units allot nahi huin!', ts:'15:01' },
    ]},
  { id:'l20', name:'Lubna Khan',     phone:'+92 311 4422889', stage:'PROPOSAL',  score:'HOT',  source:'Instagram',    lastActivity:'1d',  value:18000000, owner:'Saad', notes:'1.8 cr institutional subscription, contract signing tomorrow',
    lastMessages:[
      { from:'contact', text:'1.8 crore institutional rate lock kar lein.', ts:'Yesterday' },
      { from:'ai',      text:'Lubna, 1.8cr par institutional rate confirmed (0.5% mgmt fee). Saad bhai aap se contract ke liye contact karenge.', ts:'Yesterday' },
      { from:'contact', text:'Perfect, kal contract sign karna chahti hoon.', ts:'Yesterday' },
    ]},
  { id:'l21', name:'Junaid Ahmed',   phone:'+92 322 6655443', stage:'PROPOSAL',  score:'WARM', source:'Website',      lastActivity:'3d',  value:7000000,  owner:'Saad', notes:'70 lakh allocation, awaiting spouse approval',
    lastMessages:[
      { from:'contact', text:'Wife ne dekh liya hai term sheet, decide karke batayenge.', ts:'3 days ago' },
      { from:'ai',      text:'Junaid bhai, koi jaldi nahi hai. Allocation slot 2 weeks ke liye reserve hai aap ke naam pe.', ts:'3 days ago' },
      { from:'contact', text:'Shukria, week ke aakhir tak final answer.', ts:'3 days ago' },
    ]},

  // ── WON (3) ───────────────────────────────────────────────
  { id:'l22', name:'Zara Iqbal',     phone:'+92 304 5512983', stage:'WON',       score:'HOT',  source:'Facebook Ads', lastActivity:'5h',  value:6800000,  owner:'Saad', notes:'68 lakh subscribed, units allotted, first dividend 30 June',
    lastMessages:[
      { from:'contact', text:'Subscription confirm ho gayi alhamdulillah. CDC units credit mil gayi. Shukria team!', ts:'13:22' },
      { from:'ai',      text:'Aap ka shukria Zara! Welcome to the Boulevard Tower REIT investor family!', ts:'13:19' },
      { from:'contact', text:'Allahamdulillah. Bohot smooth onboarding tha aap ki team ke saath.', ts:'13:18' },
    ]},
  { id:'l23', name:'Rabia Khan',     phone:'+92 345 2233110', stage:'WON',       score:'WARM', source:'Referral',     lastActivity:'2d',  value:8500000,  owner:'Saad', notes:'85 lakh subscribed, referral fee waiver applied',
    lastMessages:[
      { from:'contact', text:'Subscription transfer ho gayi.', ts:'2 days ago' },
      { from:'ai',      text:'Mubarak ho Rabia! Units 15 May ko allot ho jayegi. Welcome onboarding email bhi bhej diya hai.', ts:'2 days ago' },
      { from:'contact', text:'Shukria!', ts:'2 days ago' },
    ]},
  { id:'l24', name:'Waqas Ali',      phone:'+92 312 9988775', stage:'WON',       score:'HOT',  source:'WhatsApp Ads', lastActivity:'5d',  value:25000000, owner:'Saad', notes:'2.5 cr institutional subscription, biggest ticket this quarter',
    lastMessages:[
      { from:'contact', text:'Sab paperwork done. Units May main allot ho jayengi.', ts:'5 days ago' },
      { from:'human',   text:'Waqas bhai, congrats! Biggest institutional ticket of the quarter from your side. Always available aap ke liye.', ts:'5 days ago' },
      { from:'contact', text:'Aap ki team ki wajah se hua. Future allocations bhi aap ke saath.', ts:'5 days ago' },
    ]},

  // ── LOST (1) ──────────────────────────────────────────────
  { id:'l25', name:'Sana Tariq',     phone:'+92 322 4490012', stage:'LOST',      score:'COLD', source:'Instagram',    lastActivity:'3d',  value:1500000,  owner:'Saad', notes:'Wanted physical property ownership, not REIT shares',
    lastMessages:[
      { from:'contact', text:'I want to OWN a property, REIT shares mein interest nahi filhal.', ts:'3 days ago' },
      { from:'ai',      text:'Theek hai Sana. Aap ke contact ko notebook mein rakh leti hoon, jab hybrid options aayen to notify karungi.', ts:'3 days ago' },
      { from:'contact', text:'Shukria.', ts:'3 days ago' },
    ]},
];

// ─────────────────────────────────────────────────────────────
// Timeline generator — based on stage, builds 3–7 history events
// ─────────────────────────────────────────────────────────────
const TIMELINE_TEMPLATES = {
  NEW:       ['created', 'ai_replied'],
  QUALIFIED: ['created', 'ai_replied', 'qualified'],
  PROPOSAL:  ['created', 'ai_replied', 'qualified', 'prospectus_sent', 'consultation_booked'],
  WON:       ['created', 'ai_replied', 'qualified', 'prospectus_sent', 'consultation_completed', 'subscription_received', 'won'],
  LOST:      ['created', 'ai_replied', 'qualified', 'prospectus_sent', 'lost'],
};

function buildTimeline(lead) {
  const events = TIMELINE_TEMPLATES[lead.stage] || TIMELINE_TEMPLATES.NEW;
  const labels = {
    created:                 { label:`Lead created from ${lead.source}`, kind:'system' },
    ai_replied:              { label:`AI auto-greeted ${lead.name.split(' ')[0]}`, kind:'ai' },
    qualified:               { label:`AI qualified as ${lead.score}`, kind:'ai' },
    prospectus_sent:         { label:`Prospectus + term sheet sent (target ${formatPKR(lead.value)} ticket)`, kind:'ai' },
    consultation_booked:     { label:'Advisor consultation call booked', kind:'system' },
    consultation_completed:  { label:'Consultation completed — KYC + CDC docs collected', kind:'system' },
    subscription_received:   { label:`Subscription received: ${formatPKR(lead.value)}`, kind:'human' },
    won:                     { label:'Subscription confirmed — moved to WON', kind:'system' },
    lost:                    { label:`Marked as LOST: ${lead.notes}`, kind:'system' },
  };
  return events.map((e, i) => ({ id:`tl-${lead.id}-${i}`, ...labels[e], when: i === events.length - 1 ? lead.lastActivity : `${events.length - i}d ago` }));
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Pipeline() {
  const [view, setView] = useState('kanban'); // 'kanban' | 'table'
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const filtered = useMemo(() => {
    return LEADS.filter((l) => {
      if (scoreFilter !== 'all' && l.score !== scoreFilter)   return false;
      if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
      if (dateFilter === '24h' && !/m$|^\d+h$/.test(l.lastActivity)) return false;
      if (dateFilter === '7d'  && /^\d+d$/.test(l.lastActivity) && parseInt(l.lastActivity,10) > 7) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.name.toLowerCase().includes(q) &&
            !l.phone.includes(q) &&
            !l.notes.toLowerCase().includes(q) &&
            !l.lastMessages.some((m) => m.text.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [search, scoreFilter, sourceFilter, dateFilter]);

  const active = activeId ? LEADS.find((l) => l.id === activeId) : null;

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${filtered.length} of ${LEADS.length} · ${formatPKR(filtered.reduce((s,l) => s + l.value, 0))} pipeline`}
        action={
          <button
            onClick={() => setNewOpen(true)}
            className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-transform hover:scale-[1.02]"
          >
            + New Lead
          </button>
        }
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Toolbar: view toggle + search + filters */}
        <Toolbar
          view={view} setView={setView}
          search={search} setSearch={setSearch}
          scoreFilter={scoreFilter} setScoreFilter={setScoreFilter}
          sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
          dateFilter={dateFilter} setDateFilter={setDateFilter}
        />

        {/* View body */}
        {view === 'kanban'
          ? <KanbanView leads={filtered} onSelect={setActiveId} />
          : <TableView  leads={filtered} onSelect={setActiveId} />}
      </div>

      {/* Slide-out detail panel */}
      <DetailPanel lead={active} onClose={() => setActiveId(null)} />

      {/* New lead modal */}
      {newOpen && <NewLeadModal onClose={() => setNewOpen(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────
function Toolbar({ view, setView, search, setSearch, scoreFilter, setScoreFilter, sourceFilter, setSourceFilter, dateFilter, setDateFilter }) {
  return (
    <div className="glass-card flex flex-wrap items-center gap-3 rounded-xl p-3">
      {/* View toggle */}
      <div className="flex items-center rounded-lg border border-slate-700/60 bg-surface/50 p-0.5">
        <button
          onClick={() => setView('kanban')}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Kanban
        </button>
        <button
          onClick={() => setView('table')}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'table' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Table
        </button>
      </div>

      <div className="h-6 w-px bg-slate-800/60" />

      {/* Search */}
      <div className="relative min-w-[220px] flex-1">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, notes, message…"
          className="input-dark w-full rounded-lg py-1.5 pl-8 pr-3 text-sm placeholder-slate-600"
        />
      </div>

      {/* Filters */}
      <Select label="Score"  value={scoreFilter}  onChange={setScoreFilter}
              options={[['all','All scores'], ['HOT','🔥 Hot'], ['WARM','Warm'], ['COLD','Cold']]} />
      <Select label="Source" value={sourceFilter} onChange={setSourceFilter}
              options={[['all','All sources'], ...SOURCES.map((s) => [s, s])]} />
      <Select label="Date"   value={dateFilter}   onChange={setDateFilter}
              options={[['all','All time'], ['24h','Last 24h'], ['7d','Last 7 days']]} />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="hidden sm:inline">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-dark cursor-pointer rounded-lg py-1.5 pl-2.5 pr-7 text-xs text-slate-200"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// Kanban
// ─────────────────────────────────────────────────────────────
function KanbanView({ leads, onSelect }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {STAGES.map((s) => {
        const cards = leads.filter((l) => l.stage === s.key);
        const total = cards.reduce((sum, l) => sum + l.value, 0);
        return (
          <div key={s.key} className={`flex flex-col rounded-xl border ${s.accent}`}>
            <div className="flex items-center justify-between border-b border-slate-800/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">{s.label}</span>
                <span className="text-[10px] tabular-nums text-slate-500">· {cards.length}</span>
              </div>
              <span className="text-[10px] font-semibold tabular-nums text-slate-400">{formatPKR(total)}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              {cards.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-slate-600">No leads</div>
              ) : (
                cards.map((c) => <LeadCard key={c.id} lead={c} onClick={() => onSelect(c.id)} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-lg border border-slate-800/60 bg-surface/40 p-2.5 text-left transition-all hover:border-accent/30 hover:bg-surface2/40"
    >
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-[10px] font-semibold text-slate-200">
          {initials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <span className="truncate text-sm font-medium text-slate-100">{lead.name}</span>
            <ScorePill score={lead.score} />
          </div>
          <div className="text-[10px] tabular-nums text-slate-500">{lead.phone}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <SourceBadge source={lead.source} />
        <span className="text-[11px] font-semibold tabular-nums text-slate-300">{formatPKR(lead.value)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
        <span>{lead.lastActivity} ago</span>
        <span className="text-slate-600 transition-colors group-hover:text-accent">View →</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────
function TableView({ leads, onSelect }) {
  const [sortKey, setSortKey] = useState('lastActivity');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    const arr = [...leads];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [leads, sortKey, sortDir]);

  const headers = [
    ['name',         'Name'],
    ['phone',        'Phone'],
    ['stage',        'Stage'],
    ['score',        'Score'],
    ['source',       'Source'],
    ['lastActivity','Last contact'],
    ['value',        'Value'],
    ['owner',        'Owner'],
  ];

  const onSort = (k) => {
    if (sortKey === k) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  return (
    <div className="glass-card overflow-hidden rounded-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800/60 bg-surface/40 text-left text-[10px] uppercase tracking-wider text-slate-500">
              {headers.map(([k, label]) => (
                <th key={k} onClick={() => onSort(k)} className="cursor-pointer select-none px-3 py-2 font-semibold transition-colors hover:text-slate-200">
                  {label}
                  <span className="ml-1 text-slate-700">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr
                key={l.id}
                onClick={() => onSelect(l.id)}
                className="cursor-pointer border-b border-slate-800/30 transition-colors hover:bg-surface2/40"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-[10px] font-semibold">
                      {initials(l.name)}
                    </div>
                    <span className="text-slate-100">{l.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">{l.phone}</td>
                <td className="px-3 py-2.5"><StagePill stage={l.stage} /></td>
                <td className="px-3 py-2.5"><ScorePill score={l.score} /></td>
                <td className="px-3 py-2.5"><SourceBadge source={l.source} /></td>
                <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">{l.lastActivity} ago</td>
                <td className="px-3 py-2.5 text-xs font-semibold tabular-nums text-slate-200">{formatPKR(l.value)}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{l.owner}</td>
                <td className="px-3 py-2.5 text-right text-[11px] text-accent">View →</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="px-6 py-12 text-center text-sm text-slate-500">No leads match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slide-out detail panel
// ─────────────────────────────────────────────────────────────
function DetailPanel({ lead, onClose }) {
  // ESC to close
  useEffect(() => {
    if (!lead) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lead, onClose]);

  const open = !!lead;
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-slate-800/60 bg-bg shadow-2xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {lead && <DetailContent lead={lead} onClose={onClose} />}
      </aside>
    </>
  );
}

function DetailContent({ lead, onClose }) {
  const timeline = buildTimeline(lead);
  const [stageDraft, setStageDraft] = useState(lead.stage);

  return (
    <>
      {/* Header */}
      <header className="flex items-start gap-3 border-b border-slate-800/60 px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-sm font-semibold text-slate-200">
          {initials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-100">{lead.name}</h3>
            <ScorePill score={lead.score} />
          </div>
          <div className="text-xs tabular-nums text-slate-500">{lead.phone}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-surface2 hover:text-slate-200"
        >
          <IconX className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Quick stats */}
        <section className="grid grid-cols-3 gap-2 border-b border-slate-800/60 px-5 py-4">
          <Stat label="Stage">
            <select
              value={stageDraft}
              onChange={(e) => { setStageDraft(e.target.value); alert(`Demo: would move ${lead.name} to ${e.target.value}`); }}
              className="input-dark w-full cursor-pointer rounded-md px-1.5 py-1 text-xs text-slate-200"
            >
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Stat>
          <Stat label="Value"><div className="text-sm font-semibold text-slate-100">{formatPKR(lead.value)}</div></Stat>
          <Stat label="Owner"><div className="text-sm text-slate-200">{lead.owner}</div></Stat>
        </section>

        {/* Source + notes */}
        <section className="space-y-3 border-b border-slate-800/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Source:</span>
            <SourceBadge source={lead.source} />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Notes</div>
            <p className="text-xs leading-relaxed text-slate-300">{lead.notes}</p>
          </div>
        </section>

        {/* Last 3 messages */}
        <section className="border-b border-slate-800/60 px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[10px] uppercase tracking-wider text-slate-500">Last 3 WhatsApp messages</h4>
            <a href="/conversations" className="text-[11px] text-accent transition-colors hover:underline">Open thread →</a>
          </div>
          <ul className="space-y-2">
            {lead.lastMessages.map((m, i) => (
              <li key={i} className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                m.from === 'contact' ? 'border-slate-800/60 bg-surface2/40 text-slate-200'
                : m.from === 'ai'    ? 'border-accent/20 bg-accent/5 text-accent'
                                     : 'border-violet-400/20 bg-violet-500/10 text-violet-200'}`}>
                <div className="mb-0.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wider">
                  <span className="font-semibold">{m.from === 'contact' ? lead.name.split(' ')[0] : m.from === 'ai' ? 'AI' : 'You'}</span>
                  <span className="text-slate-600">· {m.ts}</span>
                </div>
                <div className="leading-snug">{m.text}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* Timeline */}
        <section className="px-5 py-4">
          <h4 className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Lead history</h4>
          <ol className="relative space-y-3 border-l border-slate-800/60 pl-4">
            {timeline.map((t) => (
              <li key={t.id} className="relative">
                <span className={`absolute -left-[1.4rem] top-0.5 h-2 w-2 rounded-full ring-2 ring-bg ${
                  t.kind === 'ai' ? 'bg-accent' : t.kind === 'human' ? 'bg-violet-400' : 'bg-slate-500'
                }`} />
                <div className="text-xs text-slate-200">{t.label}</div>
                <div className="text-[10px] tabular-nums text-slate-600">{t.when}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Sticky actions */}
      <footer className="grid grid-cols-2 gap-2 border-t border-slate-800/60 bg-surface/40 px-5 py-3">
        <ActionBtn label="Open WhatsApp" onClick={() => alert(`Demo: would open WhatsApp thread with ${lead.name}`)} primary />
        <ActionBtn label="Mark as Won"   onClick={() => alert(`Demo: would mark ${lead.name} as WON`)} />
        <ActionBtn label="Add Note"      onClick={() => alert('Demo: notes UI coming soon')} />
        <ActionBtn label="Reassign"      onClick={() => alert('Demo: reassign UI coming soon')} />
      </footer>
    </>
  );
}

function Stat({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function ActionBtn({ label, onClick, primary = false }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        primary
          ? 'bg-gradient-to-r from-accent to-accent2 text-white shadow-md shadow-accent/20 hover:shadow-accent/30'
          : 'border border-slate-700/60 bg-surface2/40 text-slate-200 hover:bg-surface2/80'
      }`}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// New lead modal (demo: just collects name + phone + source)
// ─────────────────────────────────────────────────────────────
function NewLeadModal({ onClose }) {
  const [name, setName]     = useState('');
  const [phone, setPhone]   = useState('+92 ');
  const [source, setSource] = useState(SOURCES[0]);
  const [score, setScore]   = useState('WARM');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    alert(`Demo: would create lead\nName: ${name}\nPhone: ${phone}\nSource: ${source}\nScore: ${score}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="glass-card w-full max-w-md rounded-2xl p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">New Lead</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-surface2 hover:text-slate-200">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name">
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Asma Khan" className="input-dark w-full rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Phone">
            <input required value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+92 333 1234567" className="input-dark w-full rounded-lg px-3 py-2 text-sm tabular-nums" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <select value={source} onChange={(e) => setSource(e.target.value)} className="input-dark w-full rounded-lg px-3 py-2 text-sm">
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Score">
              <select value={score} onChange={(e) => setScore(e.target.value)} className="input-dark w-full rounded-lg px-3 py-2 text-sm">
                <option value="HOT">HOT</option>
                <option value="WARM">WARM</option>
                <option value="COLD">COLD</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700/60 bg-transparent px-3 py-2 text-xs text-slate-300 hover:bg-surface2/60">
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-accent to-accent2 px-3.5 py-2 text-xs font-medium text-white shadow-md shadow-accent/20">
            Create lead
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// Pills + helpers
// ─────────────────────────────────────────────────────────────
function StagePill({ stage }) {
  const s = STAGES.find((x) => x.key === stage) || STAGES[0];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-700/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-200">
      <span className="h-1 w-1 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

function ScorePill({ score }) {
  if (!score || !SCORE_STYLES[score]) return null;
  const s = SCORE_STYLES[score];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${s.pill}`}>
      <span className={`h-1 w-1 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SourceBadge({ source }) {
  const cls = SOURCE_COLOR[source] || 'bg-slate-500/10 text-slate-300 border-slate-500/30';
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${cls}`}>
      {source}
    </span>
  );
}

function formatPKR(n) {
  if (!n) return 'PKR 0';
  if (n >= 10000000) return `PKR ${(n/10000000).toFixed(n % 10000000 === 0 ? 0 : 2)}cr`;
  if (n >= 100000)   return `PKR ${(n/100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
  return `PKR ${n.toLocaleString()}`;
}

function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}

// Inline icons
function svgProps(p) { return { fill:'none', stroke:'currentColor', strokeWidth:1.75, strokeLinecap:'round', strokeLinejoin:'round', viewBox:'0 0 24 24', ...p }; }
function IconSearch(p){ return <svg {...svgProps(p)}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>; }
function IconX(p)     { return <svg {...svgProps(p)}><path d="M18 6 6 18M6 6l12 12"/></svg>; }
