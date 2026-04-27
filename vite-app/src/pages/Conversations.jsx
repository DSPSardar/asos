// src/pages/Conversations.jsx — WhatsApp-style two-pane conversations view
import React, { useMemo, useRef, useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────
// Style maps
// ─────────────────────────────────────────────────────────────
const STAGE_STYLES = {
  NEW:       { label:'New',       cls:'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  QUALIFIED: { label:'Qualified', cls:'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  PROPOSAL:  { label:'Proposal',  cls:'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  WON:       { label:'Won',       cls:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  LOST:      { label:'Lost',      cls:'bg-slate-700/30 text-slate-500 border-slate-600/30' },
};

const SCORE_STYLES = {
  HOT:  { label:'HOT',  dot:'bg-red-400',    cls:'bg-red-500/15 text-red-300 border-red-500/30' },
  WARM: { label:'WARM', dot:'bg-amber-400',  cls:'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  COLD: { label:'COLD', dot:'bg-sky-400',    cls:'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

// ─────────────────────────────────────────────────────────────
// MOCK DATA — 8 threads matching the requested spec exactly:
//   2 unread (1 msg / 3 msgs) · 1 Needs human · 2 Human takeover · 5 AI
//   Stages: 2 New · 2 Qualifying · 2 Proposal · 1 Won · 1 Lost
//   Scores: 3 Hot · 3 Warm · 2 Cold
// ─────────────────────────────────────────────────────────────
const THREADS = [
  // 1 — Fractional unit inquiry, freshly arrived (the "1 message unread")
  { id:'c1', name:'Ahmed Khan',    phone:'+92 333 4421872', preview:'Assalam o alaikum, Boulevard Tower REIT mein 1 unit means kya? 100 sft? Itna chota?',
    when:'2m',  unread:1, handler:'AI',    stage:'NEW',       score:'WARM', needsHuman:false },

  // 2 — Comparing buying options, went silent
  { id:'c2', name:'Bilal Ahmed',   phone:'+92 312 8866442', preview:'Studio vs 1-bed vs fractional — return same hai ya different?',
    when:'2h',  unread:0, handler:'AI',    stage:'NEW',       score:'COLD', needsHuman:false },

  // 3 — Consultation call booked, AI handled smoothly (PSX listing horizon)
  { id:'c3', name:'Ayesha Malik',  phone:'+92 321 9870034', preview:'Kal 3 PM consultation confirm. PSX listing aur 18,000 sft starter discuss karenge.',
    when:'18m', unread:0, handler:'AI',    stage:'QUALIFIED', score:'HOT',  needsHuman:false },

  // 4 — Approvals / paperwork question, human took over
  { id:'c4', name:'Fatima Sheikh', phone:'+92 345 9001775', preview:'OK sir RDA aur CDC approval ke documents ka wait karti hoon.',
    when:'1h',  unread:0, handler:'Human', stage:'QUALIFIED', score:'WARM', needsHuman:false },

  // 5 — HNW shop unit + sharing basis, human handling
  { id:'c5', name:'Hassan Raza',   phone:'+92 300 7654129', preview:'Sir 4 cr ke shop units + sharing basis ke terms confirm karwa dein.',
    when:'47m', unread:0, handler:'Human', stage:'PROPOSAL',  score:'HOT',  needsHuman:false },

  // 6 — Payment dispute — Needs Human (the "3 messages unread")
  { id:'c6', name:'Usman Ali',     phone:'+92 333 7711209', preview:'Hello? Sir urgent hai, downpayment debit ho gayi but allotment letter nahi mila!',
    when:'6h',  unread:3, handler:'AI',    stage:'PROPOSAL',  score:'WARM', needsHuman:true  },

  // 7 — Closed investor thanking after booking confirmation
  { id:'c7', name:'Zara Iqbal',    phone:'+92 304 5512983', preview:'Booking confirm ho gayi alhamdulillah. Allotment letter mil gaya. Shukria team!',
    when:'5h',  unread:0, handler:'AI',    stage:'WON',       score:'HOT',  needsHuman:false },

  // 8 — Cold lead, wanted ready-to-move property, not pre-listing REIT
  { id:'c8', name:'Sana Tariq',    phone:'+92 322 4490012', preview:'PSX listing 3 saal door hai. Mujhe ready property chahiye, REIT mein interest nahi filhal.',
    when:'3d',  unread:0, handler:'AI',    stage:'LOST',      score:'COLD', needsHuman:false },
];

// Detailed message history for every thread. Demo data; replace with real
// API calls in a later pass. Every thread has 1–10 messages so the right
// column never has to fall back to placeholder content.
const MESSAGES = {
  // c1 — Ahmed Khan: fractional unit size question, AI hasn't replied yet (the unread)
  c1: [
    { id:'c1m1', from:'contact', text:'Assalam o alaikum, Boulevard Tower REIT mein 1 unit means kya? 100 sft? Itna chota?', ts:'14:22' },
  ],

  // c2 — Bilal Ahmed: comparing buying options (studio / 1-bed / fractional)
  c2: [
    { id:'c2m1', from:'contact', text:'Hello, Boulevard Tower REIT mein interest hai. Studio vs 1-bed vs fractional — return same hai ya different?',          ts:'12:10' },
    { id:'c2m2', from:'ai',      text:'Walaikum assalam Bilal sir! Projected IRR 31% aur capital appreciation 30-50% — yeh entire project ke liye hai. Studio, 1-bed, 2-bed, shop ya fractional units (100 sft) — sab unhi numbers pe ride karte hain. Difference sirf ticket size aur exit flexibility ka hota hai.', ts:'12:11' },
    { id:'c2m3', from:'contact', text:'Theek hai. Mera budget 60-80 lakh ke beech hai. Best option kya hogi?',                                                  ts:'12:18' },
    { id:'c2m4', from:'ai',      text:'Aap ke range mein studio apartment ya 1-bedroom dono fit hote hain — entire unit aap ke naam pe. 20% downpayment + 42 monthly installments structure hai. Sharing basis bhi option hai agar flexibility chahiye.',          ts:'12:19' },
    { id:'c2m5', from:'contact', text:'PDF brochure email kar dein please, partner ke saath review karna hai.',                                                ts:'12:25' },
    { id:'c2m6', from:'ai',      text:'Done — brochure aur payment plan PDF bhej diya hai. Sardar Group (Centaurus banane wale) ka project hai, Arif Habib REIT manage kar rahe hain — partner ko credibility convince karne mein madad milegi.',           ts:'12:26' },
    { id:'c2m7', from:'contact', text:'OK partner se discuss karke next week reply karta hoon.',                                                                ts:'12:35' },
  ],

  // c3 — Ayesha Malik: PSX listing horizon question, consultation call booked
  c3: [
    { id:'c3m1', from:'contact', text:'Assalam o alaikum',                                                                                                ts:'10:14' },
    { id:'c3m2', from:'ai',      text:'Walaikum assalam Ayesha! Welcome to Boulevard Tower REIT. Aap I-14 Islamabad ke iss project ke baare mein info chahti hain ya consultation book karni hai?', ts:'10:14' },
    { id:'c3m3', from:'contact', text:'PSX listing 3 saal mein? Pehle exit ka option hai?',                                                              ts:'10:16' },
    { id:'c3m4', from:'ai',      text:'Bilkul fair question madam. Pre-listing phase mein hum hain — PSX registration 3 saal ke andar plan hai. Tab tak share trading available nahi hai, investors units directly hold karte hain. Iss period mein 31% projected IRR aur 30-50% capital appreciation milega.', ts:'10:16' },
    { id:'c3m5', from:'contact', text:'Starting investment kya hai?',                                                                                     ts:'10:18' },
    { id:'c3m6', from:'ai',      text:'Starting size 18,000 sft hai (yeh 180 fractional units ke barabar — 1 unit = 100 sft). Payment plan: 20% down + 42 monthly installments. Aap ka budget range share kar dein to advisor consultation set kar deti hoon.', ts:'10:18' },
    { id:'c3m7', from:'contact', text:'Budget 35-40 lakh ke around. Kal 3 PM possible hai consultation?',                                                  ts:'10:21' },
    { id:'c3m8', from:'ai',      text:'Bilkul Ayesha! Confirmed: Kal 3:00 PM advisor call. Calendar invite + Zoom link bhej deti hoon. RDA/CDC/SECP approvals aur 18,000 sft starter plan ki full breakdown discuss karenge.',         ts:'10:21' },
  ],

  // c4 — Fatima Sheikh: AI handed off to human for approvals documentation request
  c4: [
    { id:'c4m1', from:'contact', text:'Hello, Boulevard Tower REIT ke baare mein info chahiye.',                                                                ts:'11:02' },
    { id:'c4m2', from:'ai',      text:'Walaikum assalam Fatima madam! Bilkul. Brochure aur consultation set kar deti hoon. Kis cheez se shuru karein?',                      ts:'11:02' },
    { id:'c4m3', from:'contact', text:'I-14 location confirm hai? Aur RDA, CDC approvals ki copies chahiye — formal review karna hai.',                                  ts:'11:08' },
    { id:'c4m4', from:'ai',      text:'Jee madam, project I-14 ke saath adjacent hai aur RDA, CDC, SECP teeno se approved hai, all NOCs in place. Original approval letters share karne ke liye main hamare documentation lead ko forward kar deti hoon. Saad bhai please respond.', ts:'11:09' },
    { id:'c4m5', from:'human',   text:'Hi Fatima madam — Saad from Boulevard Tower REIT documentation desk. RDA, CDC aur SECP approval letters PDF mein bhej raha hoon. Sardar Group ke previous projects (Centaurus included) ki list bhi attach kar deta hoon.', ts:'11:18' },
    { id:'c4m6', from:'contact', text:'OK sir RDA aur CDC approval ke documents ka wait karti hoon.',                                                              ts:'11:24' },
    { id:'c4m7', from:'human',   text:'Sent. Documents receive ho jayen to confirmation karein. Aap ke liye consultation slot Tuesday 3 PM block kar diya hai.', ts:'11:25' },
  ],

  // c5 — Hassan Raza: HNW shop unit + sharing basis structure, Saad took over
  c5: [
    { id:'c5m1', from:'contact', text:'Sir aap ka follow-up message mila tha. Boulevard Tower REIT mein significant allocation karna chahta hoon.',                       ts:'09:31' },
    { id:'c5m2', from:'ai',      text:'Walaikum assalam Hassan bhai! Bohot acha. Aap ka ticket range aur preferred option kya hai? Shop units, entire 2-bed apartments ya sharing basis pe multiple buyers — sab options possible hain.', ts:'09:31' },
    { id:'c5m3', from:'contact', text:'Around 4 crore. Shop units mein interest hai, sharing basis bhi consider kar sakta hoon partners ke saath.',                                                  ts:'09:38' },
    { id:'c5m4', from:'ai',      text:'4 crore ticket size large allocation band mein aata hai. Main aap ki request hamare senior advisor ko forward kar deti hoon. Saad bhai, please personally handle karein — shop units + sharing basis structure walk-through.', ts:'09:39' },
    { id:'c5m5', from:'human',   text:'Hi Hassan bhai, Saad here from Boulevard Tower REIT. 4 crore ticket pe multiple shop units possible hain — aap pure khareed sakte hain ya sharing basis pe partners ke saath split. 20% down + 42 monthly installments standard structure hai. Projected IRR 31% aur capital appreciation 30-50% — yeh same applies.', ts:'09:48' },
    { id:'c5m6', from:'contact', text:'Theek hai. Sharing basis pe kitne partners hote hain ek unit mein? Aur allotment letter kab milta hai?',                                ts:'09:55' },
    { id:'c5m7', from:'human',   text:'Sharing basis usually 2-4 partners hote hain ek unit mein, mutual agreement ke saath. Allotment letter 20% downpayment receive hone ke baad jari hota hai. Term sheet email kar deta hoon — partners ke names aur split percentage finalize karein.', ts:'09:57' },
    { id:'c5m8', from:'contact', text:'Sir 4 cr ke shop units + sharing basis ke terms confirm karwa dein.',                                                   ts:'10:04' },
  ],

  // c6 — Usman Ali: downpayment debited but allotment letter not received, AI escalated
  c6: [
    { id:'c6m1',  from:'contact', text:'Sir maine kal 18 lakh transfer kiye Boulevard Tower REIT account mein 20% downpayment ke liye',                     ts:'09:42' },
    { id:'c6m2',  from:'ai',      text:'Walaikum assalam Usman bhai. Booking ke liye shukria. Aap ki transfer receipt ya bank slip share karein — main accounts team se confirmation karwati hoon.', ts:'09:43' },
    { id:'c6m3',  from:'contact', text:'Receipt kal raat hi WhatsApp pe bheji thi.',                                                                       ts:'09:55' },
    { id:'c6m4',  from:'ai',      text:'Jee bilkul, mil gayi. Main ne accounts ko forward kar di hai — bank reconciliation mein 10-15 minute lagte hain. Hold karein please.', ts:'09:56' },
    { id:'c6m5',  from:'ai',      text:'Update: Accounts team ka kehna hai abhi tak fund project account mein reflect nahi hua. Aap apna IBFT reference share kar sakte hain?', ts:'10:14' },
    { id:'c6m6',  from:'contact', text:'IBFT reference: HBL-9988772211. Mere account se 18 lakh debit ho chuke hain. Bank statement screenshot bhi bhej deta hoon.', ts:'10:18' },
    { id:'c6m7',  from:'ai',      text:'Screenshot received. Reference verify ho raha hai. Is matter ko main hamare senior advisor Saad ko escalate kar rahi hoon — woh aap ko personally call karenge next 30 minutes mein. Allotment letter issue karwane mein madad karenge.', ts:'10:22' },
    { id:'c6m8',  from:'contact', text:'Refund chahiye! Account se 18 lakh debit ho gaye but allotment letter nahi mila! Ye kya scene hai?',                     ts:'15:01' },
    { id:'c6m9',  from:'contact', text:'Sir please jaldi response do, mujhe written confirmation chahiye downpayment receive hone ki.',                                          ts:'15:14' },
    { id:'c6m10', from:'contact', text:'Hello? Sir urgent hai, downpayment debit ho gayi but allotment letter nahi mila!',                                            ts:'15:33' },
  ],

  // c7 — Zara Iqbal: closed investor, downpayment confirmed, allotment letter received
  c7: [
    { id:'c7m1', from:'contact', text:'Hi, kal 20% downpayment transfer ho gayi Boulevard Tower REIT account mein.',                                                        ts:'13:05' },
    { id:'c7m2', from:'ai',      text:'Walaikum assalam Zara madam! Jee bilkul, downpayment received and confirmed. Allotment letter email aur WhatsApp dono pe bhej di hai. Mubarak ho!', ts:'13:05' },
    { id:'c7m3', from:'contact', text:'Pehli monthly installment kab start hogi?',                                                                                    ts:'13:11' },
    { id:'c7m4', from:'ai',      text:'First monthly installment 1 May 2026 se start hogi, total 42 installments hain. Auto-debit setup karwana ho ya manual transfer prefer karti hain — aap decide kar sakti hain. Reminder schedule bhi share kar deti hoon.', ts:'13:11' },
    { id:'c7m5', from:'contact', text:'Allahamdulillah. Bohot smooth process tha aap ki team ke saath.',                                                ts:'13:18' },
    { id:'c7m6', from:'ai',      text:'Aap ka shukria Zara madam! Sardar Group + Arif Habib team ki taraf se shukria. Welcome to the Boulevard Tower REIT investor family!',   ts:'13:19' },
    { id:'c7m7', from:'contact', text:'Booking confirm ho gayi alhamdulillah. Allotment letter mil gaya. Shukria team!',                              ts:'13:22' },
  ],

  // c8 — Sana Tariq: lost lead, wanted ready-to-move property, not pre-listing REIT
  c8: [
    { id:'c8m1', from:'contact', text:'Salam, real estate investment options dekh rahi thi.',                                                              ts:'10:30' },
    { id:'c8m2', from:'ai',      text:'Walaikum assalam Sana madam! Boulevard Tower REIT — I-14 Islamabad ka project, Sardar Group (Centaurus banane wale) ka, Arif Habib manage kar rahe hain. RDA/CDC/SECP approved. 100 sft (1 unit) se start kar sakti hain. Interest hai?', ts:'10:30' },
    { id:'c8m3', from:'contact', text:'PSX listing kab hogi?',                                                                                              ts:'10:38' },
    { id:'c8m4', from:'ai',      text:'PSX registration 3 saal ke andar plan hai. Tab tak pre-listing phase hai — units directly hold karte hain, share trading available nahi. Projected IRR 31% aur capital appreciation 30-50% iss period mein.', ts:'10:39' },
    { id:'c8m5', from:'contact', text:'Hmm 3 saal lamba hai. Mujhe ready property chahiye jo kal se rent pe lag jaye.',                                  ts:'10:45' },
    { id:'c8m6', from:'ai',      text:'Bilkul samajh sakti hoon madam. Boulevard Tower REIT under-construction phase mein hai, ready-to-move nahi. Future mein agar pre-listing project consider karein to main updates bhej dungi.', ts:'10:46' },
    { id:'c8m7', from:'contact', text:'PSX listing 3 saal door hai. Mujhe ready property chahiye, REIT mein interest nahi filhal.',                                                  ts:'10:48' },
  ],
};

// Defensive fallback — should never trigger now that every thread has explicit
// messages, but kept so a future thread without a key still renders something.
const FALLBACK_MESSAGES = (t) => [
  { id:'f1', from:'contact', text:t.preview, ts:t.when },
  { id:'f2', from:'ai',      text:'(No detailed thread for this contact yet.)', ts:t.when },
];

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Conversations() {
  // Default to the Needs-Human thread so the AI→human handoff is the first thing visible
  const [activeId, setActiveId] = useState('c6');
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');

  const visible = useMemo(() => {
    return THREADS.filter((t) => {
      if (filter === 'unread'   && t.unread === 0)        return false;
      if (filter === 'ai'       && t.handler !== 'AI')    return false;
      if (filter === 'needs'    && !t.needsHuman)         return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) &&
            !t.preview.toLowerCase().includes(q) &&
            !t.phone.includes(q)) return false;
      }
      return true;
    });
  }, [filter, search]);

  const active   = THREADS.find((t) => t.id === activeId) || THREADS[0];
  const messages = MESSAGES[active.id] || FALLBACK_MESSAGES(active);

  return (
    <div className="flex h-full">
      <ThreadList
        threads={visible}
        activeId={activeId}
        onSelect={setActiveId}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        totalUnread={THREADS.reduce((s, t) => s + (t.unread || 0), 0)}
      />
      <ConvErrorBoundary resetKey={active.id}>
        <ConversationView thread={active} messages={messages} />
      </ConvErrorBoundary>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LEFT — Thread list
// ─────────────────────────────────────────────────────────────
function ThreadList({ threads, activeId, onSelect, filter, onFilter, search, onSearch, totalUnread }) {
  const FILTERS = [
    { id:'all',    label:'All' },
    { id:'unread', label:'Unread', badge: totalUnread || null },
    { id:'ai',     label:'AI-handled' },
    { id:'needs',  label:'Needs human' },
  ];

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-800/60 bg-surface/30">
      {/* Header */}
      <div className="border-b border-slate-800/60 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Conversations</h2>
          <span className="text-[11px] text-slate-500">{threads.length} of {THREADS.length}</span>
        </div>
        {/* Search */}
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by name, phone, message…"
            className="input-dark w-full rounded-lg py-2 pl-8 pr-3 text-sm placeholder-slate-600"
          />
        </div>
        {/* Filter chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-slate-700/60 bg-transparent text-slate-400 hover:bg-surface2/60 hover:text-slate-200'
              }`}
            >
              {f.label}
              {f.badge ? <span className="rounded-full bg-accent/20 px-1.5 text-[9px] font-semibold text-accent">{f.badge}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">No conversations match.</div>
        ) : (
          <ul>
            {threads.map((t) => (
              <ThreadRow key={t.id} thread={t} active={t.id === activeId} onClick={() => onSelect(t.id)} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ThreadRow({ thread, active, onClick }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors ${
          active
            ? 'border-accent bg-accent/10'
            : 'border-transparent hover:bg-surface2/40'
        }`}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold text-slate-200">
            {initials(thread.name)}
          </div>
          {thread.needsHuman && (
            <span
              title="Needs human"
              className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-bg bg-red-500"
            />
          )}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`truncate text-sm ${thread.unread ? 'font-semibold text-slate-100' : 'font-medium text-slate-200'}`}>
              {thread.name}
            </span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">{thread.when}</span>
          </div>
          <div className="mt-0.5">
            <p className={`truncate text-xs ${thread.unread ? 'text-slate-200' : 'text-slate-500'}`}>{thread.preview}</p>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <HandlerBadge handler={thread.handler} />
            <StagePill stage={thread.stage} />
            <ScorePill score={thread.score} />
            {thread.unread > 0 && (
              <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-bold text-white tabular-nums">
                {thread.unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function HandlerBadge({ handler }) {
  const isAI = handler === 'AI';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
        isAI ? 'border-accent/30 bg-accent/10 text-accent' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
      }`}
    >
      <span className={`inline-block h-1 w-1 rounded-full ${isAI ? 'bg-accent' : 'bg-amber-300'}`} />
      {handler}
    </span>
  );
}

function StagePill({ stage }) {
  const s = STAGE_STYLES[stage] || STAGE_STYLES.NEW;
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${s.cls}`}>
      {s.label}
    </span>
  );
}

function ScorePill({ score }) {
  if (!score || !SCORE_STYLES[score]) return null;
  const s = SCORE_STYLES[score];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${s.cls}`}>
      <span className={`inline-block h-1 w-1 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// Tiny error boundary so the right column never goes fully blank if a render
// throws — shows a readable fallback with the contact name + message count.
class ConvErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){ console.error('[Conversations] right-column render crash:', err, info); }
  componentDidUpdate(prevProps){
    // Reset on thread change so a different thread can recover
    if (prevProps.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }
  render(){
    if (this.state.err) {
      return (
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center bg-bg p-8 text-center">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-5 text-sm text-red-300 max-w-md">
            <div className="font-semibold mb-1">Couldn't render this conversation</div>
            <div className="text-xs text-red-300/80">{String(this.state.err?.message || this.state.err)}</div>
            <div className="mt-2 text-[11px] text-slate-500">Pick another thread, or reload the page.</div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────
// RIGHT — Conversation view
// ─────────────────────────────────────────────────────────────
function ConversationView({ thread, messages }) {
  const [aiOn, setAiOn]   = useState(thread.handler === 'AI');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

  // Reset toggle + draft + scroll when switching threads
  useEffect(() => { setAiOn(thread.handler === 'AI'); setDraft(''); }, [thread.id, thread.handler]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.id]);

  const onSend = () => {
    if (!draft.trim()) return;
    alert(`Demo: would send "${draft.trim()}" to ${thread.name}`);
    setDraft('');
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-bg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-slate-800/60 px-6 py-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent2/30 text-xs font-semibold text-slate-200">
          {initials(thread.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-100">{thread.name}</span>
            <StagePill stage={thread.stage} />
            <ScorePill score={thread.score} />
            {thread.needsHuman && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-300">
                <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-red-400" />
                Needs human
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{thread.phone}</div>
        </div>
        <AiToggle on={aiOn} onChange={setAiOn} />
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <DateDivider label="Today" />
          {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
        </div>
      </div>

      {/* Status bar above composer */}
      <div className={`flex items-center justify-between border-t px-6 py-2.5 text-xs ${
        aiOn
          ? 'border-accent/20 bg-accent/5 text-accent'
          : 'border-amber-400/20 bg-amber-400/5 text-amber-300'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-accent animate-pulse' : 'bg-amber-300'}`} />
          {aiOn
            ? 'AI is handling this conversation. Replies are auto-sent.'
            : 'You have taken over. AI is paused for this thread.'}
        </div>
        <button onClick={() => setAiOn((v) => !v)} className="text-xs font-medium underline-offset-2 hover:underline">
          {aiOn ? 'Take over →' : 'Hand back to AI →'}
        </button>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800/60 bg-surface/40 px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <button
            type="button"
            onClick={() => alert('Attachments coming soon.')}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-surface2 hover:text-slate-300"
            title="Attach (coming soon)"
          >
            <IconPaperclip className="h-4 w-4" />
          </button>
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={aiOn ? 'AI is replying… type to take over' : `Message ${thread.name}…`}
            className="input-dark flex-1 resize-none rounded-lg px-3 py-2.5 text-sm placeholder-slate-600"
            style={{ maxHeight: 140 }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!draft.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-accent2 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            Send
            <IconSend className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function AiToggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        on
          ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/20'
          : 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
      }`}
      title={on ? 'AI is replying — click to take over' : 'You are replying — click to hand back to AI'}
    >
      <span className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-amber-400'}`}>
        <span className={`absolute top-0.5 inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${on ? 'translate-x-3' : 'translate-x-0.5'}`} />
      </span>
      {on ? 'AI handling' : 'You handling'}
    </button>
  );
}

function MessageBubble({ m }) {
  const incoming = m.from === 'contact';
  const ai       = m.from === 'ai';
  const human    = m.from === 'human';

  return (
    <div className={`flex w-full ${incoming ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[78%] flex-col ${incoming ? 'items-start' : 'items-end'}`}>
        <div
          className={`whitespace-pre-line rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm ${
            incoming
              ? 'rounded-tl-sm bg-surface2/80 text-slate-100'
              : ai
                ? 'rounded-tr-sm bg-gradient-to-br from-accent to-accent2 text-white shadow-accent/20'
                : 'rounded-tr-sm bg-violet-500/30 text-slate-50 ring-1 ring-violet-300/20'
          }`}
        >
          {m.text}
        </div>
        <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-slate-500">
          {ai    && <span className="rounded bg-accent/15 px-1 py-px font-semibold text-accent">AI</span>}
          {human && <span className="rounded bg-violet-300/15 px-1 py-px font-semibold text-violet-300">You</span>}
          <span className="tabular-nums">{m.ts}</span>
        </div>
      </div>
    </div>
  );
}

function DateDivider({ label }) {
  return (
    <div className="my-2 flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-600">
      <span className="h-px flex-1 bg-slate-800/60" />
      {label}
      <span className="h-px flex-1 bg-slate-800/60" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// helpers + icons
// ─────────────────────────────────────────────────────────────
function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}
function svgProps(p) { return { fill:'none', stroke:'currentColor', strokeWidth:1.75, strokeLinecap:'round', strokeLinejoin:'round', viewBox:'0 0 24 24', ...p }; }
function IconSearch(p)   { return <svg {...svgProps(p)}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>; }
function IconPaperclip(p){ return <svg {...svgProps(p)}><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 1 1 5 5L10.5 19a2 2 0 0 1-3-3l8-8"/></svg>; }
function IconSend(p)     { return <svg {...svgProps(p)}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>; }
