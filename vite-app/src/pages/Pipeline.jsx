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
  { id:'l1',  name:'Ahmed Khan',     phone:'+92 333 4421872', stage:'NEW',       score:'HOT',  source:'WhatsApp Ads', lastActivity:'2m',  value:2500000,  owner:'Saad', notes:'Fractional units inquiry, 25 lakh entry budget',
    lastMessages:[
      { from:'contact', text:'Assalam o alaikum, Boulevard Tower REIT mein 1 unit means kya? 100 sft? Itna chota?', ts:'14:22' },
      { from:'ai',      text:'Walaikum assalam Ahmed sir! Jee bilkul, 1 unit = 100 sft hai — yeh smallest entry point hai (fractional). Starting investment size 18,000 sft hai. Aap ka budget range share kar dein?', ts:'14:22' },
      { from:'contact', text:'Around 25 lakh budget hai. Studio entry possible hogi?', ts:'14:25' },
    ]},
  { id:'l2',  name:'Fatima Sheikh',  phone:'+92 345 9001775', stage:'NEW',       score:'WARM', source:'Facebook Ads', lastActivity:'18m', value:1500000,  owner:'Saad', notes:'Wants RDA/CDC approval letters before booking',
    lastMessages:[
      { from:'contact', text:'Hello, Boulevard Tower REIT ke baare mein info chahiye is hafte.', ts:'13:51' },
      { from:'ai',      text:'Hi Fatima madam! Bilkul, brochure aur consultation set kar dete hain. Kis cheez se shuru karein?', ts:'13:51' },
      { from:'contact', text:'Pehle RDA aur CDC approval ke documents dekhna hai.', ts:'13:55' },
    ]},
  { id:'l3',  name:'Imran Sheikh',   phone:'+92 311 6677889', stage:'NEW',       score:'COLD', source:'Website',      lastActivity:'1h',  value:300000,   owner:'Saad', notes:'First-time investor, exploring fractional entry',
    lastMessages:[
      { from:'contact', text:'Boulevard Tower REIT mein invest karna ho to minimum kya hai?', ts:'13:10' },
      { from:'ai',      text:'Walaikum assalam Imran sir! Starting size 18,000 sft hai (1 unit = 100 sft). 20% downpayment + 42 monthly installments. Projected IRR 31%. Aap ka budget range?', ts:'13:11' },
      { from:'contact', text:'Theek hai, dekh ke batata hoon.', ts:'13:14' },
    ]},
  { id:'l4',  name:'Maryam Ali',     phone:'+92 308 1122334', stage:'NEW',       score:'HOT',  source:'Instagram',    lastActivity:'1h',  value:6000000,  owner:'Saad', notes:'60 lakh, ready to book studio after consultation',
    lastMessages:[
      { from:'contact', text:'Aap ka Instagram post dekha tha I-14 Boulevard Tower ka. Detail chahiye.', ts:'12:55' },
      { from:'ai',      text:'Hi Maryam madam! Sardar Group (Centaurus banane wale) ka project hai, Arif Habib REIT manage kar rahe hain. Projected IRR 31%. Aap ka allocation range?', ts:'12:55' },
      { from:'contact', text:'60 lakh tak. Aaj evening consultation possible hai? 5 PM?', ts:'13:00' },
    ]},
  { id:'l5',  name:'Saad Ali',       phone:'+92 312 5544336', stage:'NEW',       score:'WARM', source:'Referral',     lastActivity:'2h',  value:3200000,  owner:'Saad', notes:'Referred by Hassan Raza',
    lastMessages:[
      { from:'contact', text:'Hassan bhai ne refer kiya hai, Boulevard Tower REIT ki details chahiye.', ts:'12:00' },
      { from:'ai',      text:'Walaikum assalam Saad sir! Hassan bhai already mention kar chuke hain. 32 lakh range mein studio ya entire 1-bed unit possible hai, plus fractional bhi option hai.', ts:'12:01' },
      { from:'contact', text:'Pricing aur payment plan share kar dein.', ts:'12:05' },
    ]},
  { id:'l6',  name:'Hira Ahmed',     phone:'+92 322 8877665', stage:'NEW',       score:'COLD', source:'WhatsApp Ads', lastActivity:'3h',  value:280000,   owner:'Saad', notes:'Just gathering info, no commitment',
    lastMessages:[
      { from:'contact', text:'I-14 Islamabad ke project ki info chahiye, returns kya hain?', ts:'11:00' },
      { from:'ai',      text:'Walaikum assalam Hira madam! Boulevard Tower REIT — I-14 adjacent. Projected IRR 31%, capital appreciation 30-50%. RDA/CDC/SECP approved. Interest level?', ts:'11:01' },
      { from:'contact', text:'Sirf research kar rahi hoon abhi.', ts:'11:10' },
    ]},
  { id:'l7',  name:'Faisal Khan',    phone:'+92 301 2244668', stage:'NEW',       score:'WARM', source:'Facebook Ads', lastActivity:'4h',  value:8000000,  owner:'Saad', notes:'80 lakh family savings allocation',
    lastMessages:[
      { from:'contact', text:'Family savings allocate karna hai. 80 lakh range.', ts:'10:00' },
      { from:'ai',      text:'Hi Faisal sir! 80 lakh ke liye entire 2-bed apartment ya multiple shop units fit hote hain. 20% down (16 lakh) + 42 monthly installments. Consultation interest?', ts:'10:01' },
      { from:'contact', text:'Haan, lekin pehle brochure PDF share karein.', ts:'10:05' },
    ]},
  { id:'l8',  name:'Tariq Hussain',  phone:'+92 333 9988776', stage:'NEW',       score:'HOT',  source:'Referral',     lastActivity:'5h',  value:12000000, owner:'Saad', notes:'HNW, multiple shop units interest',
    lastMessages:[
      { from:'contact', text:'1.2 crore allocation karna hai. Multiple shop units possible hain?', ts:'09:00' },
      { from:'ai',      text:'Walaikum assalam Tariq bhai! 1.2 crore ticket size pe multiple shop units ya entire apartment options hain — sharing basis bhi possible hai. Saad bhai consultation karwa dete hain?', ts:'09:01' },
      { from:'contact', text:'Haan jaldi schedule karwa dein.', ts:'09:05' },
    ]},
  { id:'l9',  name:'Noor Fatima',    phone:'+92 345 1122993', stage:'NEW',       score:'WARM', source:'Instagram',    lastActivity:'6h',  value:4200000,  owner:'Saad', notes:'Newlyweds, first joint investment',
    lastMessages:[
      { from:'contact', text:'Hum dono shadi ke baad pehla investment plan kar rahe hain.', ts:'08:00' },
      { from:'ai',      text:'Mubarak ho Noor madam! Joint investment ke liye sharing basis option achi hai — multiple buyers mil ke unit khareed sakte hain. 42 lakh range mein studio ya entire 1-bed fit hote hain.', ts:'08:01' },
      { from:'contact', text:'Hum dono consultation karenge weekend pe.', ts:'08:10' },
    ]},
  { id:'l10', name:'Adnan Malik',    phone:'+92 311 5544221', stage:'NEW',       score:'COLD', source:'Website',      lastActivity:'8h',  value:180000,   owner:'Saad', notes:'Small budget, exploring fractional entry',
    lastMessages:[
      { from:'contact', text:'Budget 1.8 lakh hai, kuch options hain?', ts:'06:00' },
      { from:'ai',      text:'Walaikum assalam Adnan sir! Starting investment size 18,000 sft hai (lowest entry). 1.8 lakh budget mein 20% downpayment ke baad bhi gap reh jayega — sharing basis discuss kar sakte hain.', ts:'06:01' },
      { from:'contact', text:'Theek hai, sochta hoon.', ts:'06:30' },
    ]},

  // ── QUALIFIED (6) ─────────────────────────────────────────
  { id:'l11', name:'Ayesha Malik',   phone:'+92 321 9870034', stage:'QUALIFIED', score:'HOT',  source:'Facebook Ads', lastActivity:'18m', value:2500000,  owner:'Saad', notes:'Consultation booked tomorrow 3 PM — PSX listing horizon',
    lastMessages:[
      { from:'contact', text:'Kal 3 PM possible hai consultation?', ts:'13:51' },
      { from:'ai',      text:'Bilkul Ayesha madam! Confirmed: Kal 3:00 PM advisor call. Calendar invite + Zoom link bhej deti hoon.', ts:'13:51' },
      { from:'contact', text:'Perfect, kal milte hain.', ts:'13:54' },
    ]},
  { id:'l12', name:'Sadia Khan',     phone:'+92 312 4488776', stage:'QUALIFIED', score:'WARM', source:'WhatsApp Ads', lastActivity:'1h',  value:5500000,  owner:'Saad', notes:'Comparing fractional vs entire studio',
    lastMessages:[
      { from:'contact', text:'Studio vs fractional — kis option mein faida zyada hai?', ts:'13:00' },
      { from:'ai',      text:'Hi Sadia madam! Projected IRR 31% aur capital appreciation 30-50% — yeh same applies on both. Difference ticket size aur exit flexibility ka hai. Comparison sheet bhej deti hoon.', ts:'13:00' },
      { from:'contact', text:'Sheet receive ho gayi, dekh ke decide karungi.', ts:'13:10' },
    ]},
  { id:'l13', name:'Kamran Iqbal',   phone:'+92 304 7766554', stage:'QUALIFIED', score:'HOT',  source:'Referral',     lastActivity:'3h',  value:9000000,  owner:'Saad', notes:'CEO, 90 lakh budget, multi-unit interest',
    lastMessages:[
      { from:'contact', text:'Premium options share karein, 90 lakh range.', ts:'11:00' },
      { from:'ai',      text:'Walaikum assalam Kamran sahab! 90 lakh budget mein entire 2-bed apartment ya multiple shop units possible hain. Detailed payment plan PDF bhej dun?', ts:'11:01' },
      { from:'contact', text:'Aaj evening consultation book kar lein.', ts:'11:05' },
    ]},
  { id:'l14', name:'Mehwish Ali',    phone:'+92 322 8855443', stage:'QUALIFIED', score:'WARM', source:'Instagram',    lastActivity:'5h',  value:3800000,  owner:'Saad', notes:'Working professional, monthly installment fit',
    lastMessages:[
      { from:'contact', text:'Working girl hoon, monthly installment kitni hogi 1-bed ke liye?', ts:'09:00' },
      { from:'ai',      text:'Mehwish madam, payment plan: 20% down + 42 monthly installments. Aap ka shortlist size confirm karein to exact installment calculate karke share kar deti hoon.', ts:'09:01' },
      { from:'contact', text:'Consultation timings batayein.', ts:'09:05' },
    ]},
  { id:'l15', name:'Asad Sheikh',    phone:'+92 333 6677889', stage:'QUALIFIED', score:'COLD', source:'Website',      lastActivity:'1d',  value:6500000,  owner:'Saad', notes:'Family discussion pending, slow decision',
    lastMessages:[
      { from:'contact', text:'Brochure bhej dein, family se discuss karunga.', ts:'Yesterday' },
      { from:'ai',      text:'Asad sir, brochure + payment plan PDF bhej diya hai. Sardar Group + Arif Habib + RDA/CDC/SECP approval letters bhi attach hain. Family meeting ke baad batayein.', ts:'Yesterday' },
      { from:'contact', text:'OK shukria.', ts:'Yesterday' },
    ]},
  { id:'l16', name:'Sara Tariq',     phone:'+92 345 9988770', stage:'QUALIFIED', score:'WARM', source:'WhatsApp Ads', lastActivity:'2d',  value:4000000,  owner:'Saad', notes:'Qualified, parents discussion pending',
    lastMessages:[
      { from:'contact', text:'Returns acche lag rahe hain, payment plan kya hai?', ts:'2 days ago' },
      { from:'ai',      text:'Sara madam, 20% downpayment + 42 monthly installments. 40 lakh range mein studio ya 1-bed entire unit fit hote hain.', ts:'2 days ago' },
      { from:'contact', text:'Theek hai, parents se discuss karke batati hoon.', ts:'2 days ago' },
    ]},

  // ── PROPOSAL (5) ───────────────────────────────────────────
  { id:'l17', name:'Hassan Raza',    phone:'+92 300 7654129', stage:'PROPOSAL',  score:'HOT',  source:'Facebook Ads', lastActivity:'47m', value:42000000, owner:'Saad', notes:'4.2 crore, multi shop units + sharing basis, terms locked',
    lastMessages:[
      { from:'contact', text:'Sir 4 cr ke shop units + sharing basis ke terms confirm karwa dein.', ts:'13:21' },
      { from:'human',   text:'Hassan bhai, term sheet email kar diya hai — partners ke names aur split percentage finalize karein. 20% down receive hone par allotment letters issue ho jayenge.', ts:'13:18' },
      { from:'contact', text:'Theek hai, terms acceptable hain.', ts:'13:15' },
    ]},
  { id:'l18', name:'Bilal Ahmed',    phone:'+92 312 8866442', stage:'PROPOSAL',  score:'COLD', source:'Referral',     lastActivity:'2h',  value:9000000,  owner:'Saad', notes:'90 lakh allocation, partner review pending',
    lastMessages:[
      { from:'contact', text:'PDF brochure email kar dein please, partner ke saath review karna hai.', ts:'12:25' },
      { from:'ai',      text:'Bilal sir, brochure + payment plan PDF bhej diya hai. Sardar Group + Arif Habib credibility highlight ki hai partner ke liye.', ts:'12:30' },
      { from:'contact', text:'OK partner se discuss karke next week reply karta hoon.', ts:'12:35' },
    ]},
  { id:'l19', name:'Usman Ali',      phone:'+92 333 7711209', stage:'PROPOSAL',  score:'WARM', source:'WhatsApp Ads', lastActivity:'6h',  value:1800000,  owner:'Saad', notes:'Downpayment debited but allotment letter not received — accounts reconciling',
    lastMessages:[
      { from:'contact', text:'Hello? Sir urgent hai, downpayment debit ho gayi but allotment letter nahi mila!', ts:'15:33' },
      { from:'contact', text:'Sir please jaldi response do, mujhe written confirmation chahiye downpayment receive hone ki.', ts:'15:14' },
      { from:'contact', text:'Refund chahiye! Account se 18 lakh debit ho gaye but allotment letter nahi mila!', ts:'15:01' },
    ]},
  { id:'l20', name:'Lubna Khan',     phone:'+92 311 4422889', stage:'PROPOSAL',  score:'HOT',  source:'Instagram',    lastActivity:'1d',  value:18000000, owner:'Saad', notes:'1.8 cr — entire 2-bed apartment, signing tomorrow',
    lastMessages:[
      { from:'contact', text:'1.8 crore ki entire 2-bed apartment lock kar lein.', ts:'Yesterday' },
      { from:'ai',      text:'Lubna madam, entire 2-bed apartment 1.8 crore par confirmed. Saad bhai aap se booking paperwork ke liye contact karenge.', ts:'Yesterday' },
      { from:'contact', text:'Perfect, kal booking finalize karna chahti hoon.', ts:'Yesterday' },
    ]},
  { id:'l21', name:'Junaid Ahmed',   phone:'+92 322 6655443', stage:'PROPOSAL',  score:'WARM', source:'Website',      lastActivity:'3d',  value:7000000,  owner:'Saad', notes:'70 lakh allocation, awaiting spouse approval',
    lastMessages:[
      { from:'contact', text:'Wife ne dekh liya hai term sheet, decide karke batayenge.', ts:'3 days ago' },
      { from:'ai',      text:'Junaid sir, koi jaldi nahi hai. Allocation 2 weeks ke liye reserve hai aap ke naam pe.', ts:'3 days ago' },
      { from:'contact', text:'Shukria, week ke aakhir tak final answer.', ts:'3 days ago' },
    ]},

  // ── WON (3) ───────────────────────────────────────────────
  { id:'l22', name:'Zara Iqbal',     phone:'+92 304 5512983', stage:'WON',       score:'HOT',  source:'Facebook Ads', lastActivity:'5h',  value:6800000,  owner:'Saad', notes:'68 lakh booked, allotment letter issued, 1st installment 1 May',
    lastMessages:[
      { from:'contact', text:'Booking confirm ho gayi alhamdulillah. Allotment letter mil gaya. Shukria team!', ts:'13:22' },
      { from:'ai',      text:'Aap ka shukria Zara madam! Welcome to the Boulevard Tower REIT investor family!', ts:'13:19' },
      { from:'contact', text:'Allahamdulillah. Bohot smooth process tha aap ki team ke saath.', ts:'13:18' },
    ]},
  { id:'l23', name:'Rabia Khan',     phone:'+92 345 2233110', stage:'WON',       score:'WARM', source:'Referral',     lastActivity:'2d',  value:8500000,  owner:'Saad', notes:'85 lakh booked — entire 1-bed unit, referral lead',
    lastMessages:[
      { from:'contact', text:'Downpayment transfer ho gayi.', ts:'2 days ago' },
      { from:'ai',      text:'Mubarak ho Rabia madam! Allotment letter 15 May ko issue ho jayegi. Welcome onboarding email bhi bhej diya hai.', ts:'2 days ago' },
      { from:'contact', text:'Shukria!', ts:'2 days ago' },
    ]},
  { id:'l24', name:'Waqas Ali',      phone:'+92 312 9988775', stage:'WON',       score:'HOT',  source:'WhatsApp Ads', lastActivity:'5d',  value:25000000, owner:'Saad', notes:'2.5 cr — multiple shop units, biggest ticket this quarter',
    lastMessages:[
      { from:'contact', text:'Sab paperwork done. Allotment letters May main mil jayenge.', ts:'5 days ago' },
      { from:'human',   text:'Waqas bhai, congrats! Biggest shop units ticket of the quarter from your side. Always available aap ke liye.', ts:'5 days ago' },
      { from:'contact', text:'Aap ki team ki wajah se hua. Future allocations bhi aap ke saath.', ts:'5 days ago' },
    ]},

  // ── LOST (1) ──────────────────────────────────────────────
  { id:'l25', name:'Sana Tariq',     phone:'+92 322 4490012', stage:'LOST',      score:'COLD', source:'Instagram',    lastActivity:'3d',  value:1500000,  owner:'Saad', notes:'Wanted ready-to-move property, not pre-listing project',
    lastMessages:[
      { from:'contact', text:'PSX listing 3 saal door hai. Mujhe ready property chahiye, REIT mein interest nahi filhal.', ts:'3 days ago' },
      { from:'ai',      text:'Theek hai Sana madam. Aap ke contact ko notebook mein rakh leti hoon, agar future mein pre-listing projects consider karein to notify karungi.', ts:'3 days ago' },
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
    prospectus_sent:         { label:`Brochure + payment plan sent (target ${formatPKR(lead.value)} ticket)`, kind:'ai' },
    consultation_booked:     { label:'Advisor consultation call booked', kind:'system' },
    consultation_completed:  { label:'Consultation completed — KYC docs collected', kind:'system' },
    subscription_received:   { label:`Downpayment received: ${formatPKR(lead.value * 0.2)} (20%)`, kind:'human' },
    won:                     { label:'Booking confirmed — allotment letter issued', kind:'system' },
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
