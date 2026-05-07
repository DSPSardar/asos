// src/pages/Conversations.jsx — WhatsApp-style two-pane conversations view (live API)
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { conversationsAPI } from '@lib/api';

// ─────────────────────────────────────────────────────────────
// Style maps (covers both real DB stages and legacy labels)
// ─────────────────────────────────────────────────────────────
const STAGE_STYLES = {
  NEW:         { label:'New',        cls:'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  QUALIFYING:  { label:'Qualifying', cls:'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  QUALIFIED:   { label:'Qualified',  cls:'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  DIAGNOSED:   { label:'Diagnosed',  cls:'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  PROPOSED:    { label:'Proposal',   cls:'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  PROPOSAL:    { label:'Proposal',   cls:'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  CLOSED_WON:  { label:'Won',        cls:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  WON:         { label:'Won',        cls:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  CLOSED_LOST: { label:'Lost',       cls:'bg-slate-700/30 text-slate-500 border-slate-600/30' },
  LOST:        { label:'Lost',       cls:'bg-slate-700/30 text-slate-500 border-slate-600/30' },
};

const SCORE_STYLES = {
  HOT:  { label:'HOT',  dot:'bg-red-400',    cls:'bg-red-500/15 text-red-300 border-red-500/30' },
  WARM: { label:'WARM', dot:'bg-amber-400',  cls:'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  COLD: { label:'COLD', dot:'bg-sky-400',    cls:'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

// ─────────────────────────────────────────────────────────────
// Data mappers
// ─────────────────────────────────────────────────────────────
function formatWhen(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1)   return 'now';
  if (diffMin < 60)  return `${diffMin}m`;
  if (diffHr  < 24)  return `${diffHr}h`;
  if (diffDay < 7)   return `${diffDay}d`;
  return d.toLocaleDateString('en-PK', { day:'numeric', month:'short' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-PK', { hour:'2-digit', minute:'2-digit', hour12:false });
}

function mapThread(conv) {
  const lastMsg = Array.isArray(conv.messages) ? conv.messages[0] : null;
  const isHumanTakeover = conv.status === 'HUMAN_TAKEOVER' || !conv.aiEnabled;
  const needsHuman = conv.lead?.humanFollowupRequired || false;
  // unread: last message is inbound and status isn't READ
  const unread = lastMsg && lastMsg.direction === 'INBOUND' && lastMsg.status !== 'READ' ? 1 : 0;
  return {
    id:          conv.id,
    name:        conv.contact?.name || conv.contact?.phone || 'Unknown',
    phone:       formatPhone(conv.contact?.phone),
    preview:     lastMsg?.content || '…',
    when:        formatWhen(lastMsg?.sentAt || conv.updatedAt || conv.createdAt),
    unread,
    handler:     isHumanTakeover ? 'Human' : 'AI',
    stage:       conv.lead?.stage || 'NEW',
    score:       conv.lead?.scoreLabel || 'COLD',
    needsHuman,
    aiEnabled:   conv.aiEnabled,
    status:      conv.status,
    leadId:      conv.leadId,
  };
}

function mapMessage(msg) {
  const from = msg.direction === 'INBOUND'
    ? 'contact'
    : msg.sender === 'AI' ? 'ai' : 'human';
  return {
    id:   msg.id,
    from,
    text: msg.content || '',
    ts:   formatTime(msg.sentAt),
    raw:  msg,
  };
}

function formatPhone(phone = '') {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12)
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return `+${digits}`;
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function Conversations() {
  const [threads,    setThreads]    = useState([]);
  const [activeId,   setActiveId]   = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [filter,     setFilter]     = useState('all');
  const [search,     setSearch]     = useState('');
  const [mobileView, setMobileView] = useState('list');

  // ── Load conversation list ──────────────────────────────────
  const loadThreads = useCallback(async () => {
    try {
      const res = await conversationsAPI.list({ limit: 50 });
      const convs = Array.isArray(res.data) ? res.data : (res?.data || []);
      const mapped = convs.map(mapThread);
      setThreads(mapped);
      // Auto-select first on initial load
      setActiveId((prev) => prev || (mapped[0]?.id ?? null));
    } catch (e) {
      console.error('[Conversations] list error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const interval = setInterval(loadThreads, 8000); // poll every 8s
    return () => clearInterval(interval);
  }, [loadThreads]);

  // ── Load messages for active conversation ──────────────────
  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    setMsgLoading(true);
    try {
      const res = await conversationsAPI.get(id);
      const conv = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
      if (conv) {
        setActiveConv(conv);
        setMessages((conv.messages || []).map(mapMessage));
      }
    } catch (e) {
      console.error('[Conversations] get error', e);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId);
    const interval = setInterval(() => loadMessages(activeId), 5000); // poll every 5s
    return () => clearInterval(interval);
  }, [activeId, loadMessages]);

  const activeThread = threads.find((t) => t.id === activeId) || threads[0] || null;

  const visible = useMemo(() => {
    return threads.filter((t) => {
      if (filter === 'unread' && t.unread === 0)       return false;
      if (filter === 'ai'     && t.handler !== 'AI')   return false;
      if (filter === 'needs'  && !t.needsHuman)        return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.name.toLowerCase().includes(q) &&
            !t.preview.toLowerCase().includes(q) &&
            !t.phone.includes(q)) return false;
      }
      return true;
    });
  }, [threads, filter, search]);

  const totalUnread = threads.reduce((s, t) => s + (t.unread || 0), 0);

  const handleSelect = (id) => {
    setActiveId(id);
    setMobileView('detail');
  };

  const handleToggleAI = async (id, enabled) => {
    try {
      await conversationsAPI.toggleAI(id, enabled);
      // optimistic update
      setThreads((prev) => prev.map((t) => t.id === id ? { ...t, handler: enabled ? 'AI' : 'Human', aiEnabled: enabled } : t));
    } catch (e) {
      console.error('[Conversations] toggleAI error', e);
    }
  };

  const handleTakeover = async (id) => {
    try {
      await conversationsAPI.takeover(id);
      setThreads((prev) => prev.map((t) => t.id === id ? { ...t, handler: 'Human', aiEnabled: false } : t));
    } catch (e) {
      console.error('[Conversations] takeover error', e);
    }
  };

  const handleHandback = async (id) => {
    try {
      await conversationsAPI.handback(id);
      setThreads((prev) => prev.map((t) => t.id === id ? { ...t, handler: 'AI', aiEnabled: true } : t));
    } catch (e) {
      console.error('[Conversations] handback error', e);
    }
  };

  const handleSend = async (id, content) => {
    if (!content?.trim()) return;
    try {
      await conversationsAPI.sendMessage(id, content);
      await loadMessages(id);
    } catch (e) {
      console.error('[Conversations] sendMessage error', e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ThreadList
        threads={visible}
        allCount={threads.length}
        activeId={activeId}
        onSelect={handleSelect}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        totalUnread={totalUnread}
        mobileView={mobileView}
      />
      <ConvErrorBoundary resetKey={activeId} mobileView={mobileView}>
        {activeThread ? (
          <ConversationView
            thread={activeThread}
            messages={messages}
            msgLoading={msgLoading}
            mobileView={mobileView}
            onBack={() => setMobileView('list')}
            onToggleAI={(enabled) => handleToggleAI(activeThread.id, enabled)}
            onTakeover={() => handleTakeover(activeThread.id)}
            onHandback={() => handleHandback(activeThread.id)}
            onSend={(content) => handleSend(activeThread.id, content)}
          />
        ) : (
          <section className="hidden min-w-0 flex-1 flex-col items-center justify-center bg-bg md:flex">
            <p className="text-sm text-slate-500">No conversations yet.</p>
          </section>
        )}
      </ConvErrorBoundary>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LEFT — Thread list
// ─────────────────────────────────────────────────────────────
function ThreadList({ threads, allCount, activeId, onSelect, filter, onFilter, search, onSearch, totalUnread, mobileView }) {
  const FILTERS = [
    { id:'all',    label:'All' },
    { id:'unread', label:'Unread', badge: totalUnread || null },
    { id:'ai',     label:'AI-handled' },
    { id:'needs',  label:'Needs human' },
  ];

  return (
    <aside className={`${mobileView === 'list' ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-r border-slate-800/60 bg-surface/30 md:flex md:w-[340px]`}>
      {/* Header */}
      <div className="border-b border-slate-800/60 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Conversations</h2>
          <span className="text-[11px] text-slate-500">{threads.length} of {allCount}</span>
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

// ─────────────────────────────────────────────────────────────
// Error boundary
// ─────────────────────────────────────────────────────────────
class ConvErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){ console.error('[Conversations] right-column render crash:', err, info); }
  componentDidUpdate(prevProps){
    if (prevProps.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }
  render(){
    if (this.state.err) {
      const mv = this.props.mobileView;
      return (
        <section className={`${mv === 'detail' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col items-center justify-center bg-bg p-8 text-center md:flex`}>
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
function ConversationView({ thread, messages, msgLoading, mobileView, onBack, onToggleAI, onTakeover, onHandback, onSend }) {
  const [aiOn,  setAiOn]  = useState(thread.aiEnabled !== false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

  // Sync AI toggle when thread changes
  useEffect(() => {
    setAiOn(thread.aiEnabled !== false);
    setDraft('');
  }, [thread.id, thread.aiEnabled]);

  // Scroll to bottom when messages load/update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, thread.id]);

  const handleToggle = (val) => {
    setAiOn(val);
    onToggleAI(val);
  };

  const handleTakeoverClick = () => {
    setAiOn(false);
    onTakeover();
  };

  const handleHandbackClick = () => {
    setAiOn(true);
    onHandback();
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <section className={`${mobileView === 'detail' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col bg-bg md:flex`}>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-slate-800/60 px-4 py-3.5 md:px-6">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-1 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-surface2/60 hover:text-slate-100 md:hidden"
        >
          <IconBack className="h-5 w-5" />
        </button>
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
        <AiToggle on={aiOn} onChange={handleToggle} />
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <DateDivider label="Today" />
          {msgLoading && messages.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-slate-600 py-8">No messages yet.</p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} m={m} />)
          )}
        </div>
      </div>

      {/* Status bar above composer */}
      <div className={`flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs md:px-6 ${
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
        <button
          onClick={aiOn ? handleTakeoverClick : handleHandbackClick}
          className="text-xs font-medium underline-offset-2 hover:underline"
        >
          {aiOn ? 'Take over →' : 'Hand back to AI →'}
        </button>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800/60 bg-surface/40 px-4 py-3 md:px-6">
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
            onClick={handleSend}
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
          {ai             && <span className="rounded bg-accent/15 px-1 py-px font-semibold text-accent">AI</span>}
          {!incoming && !ai && <span className="rounded bg-violet-300/15 px-1 py-px font-semibold text-violet-300">You</span>}
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
function IconBack(p)     { return <svg {...svgProps(p)}><path d="m15 18-6-6 6-6"/></svg>; }
