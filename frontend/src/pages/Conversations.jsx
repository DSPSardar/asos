// src/pages/Conversations.jsx — Premium WhatsApp chat UI

const { useState, useRef, useEffect } = React;

const senderColor = { AI:'#818cf8', AGENT:'#10b981', CONTACT:'#94a3b8', SYSTEM:'#f59e0b' };

const MessageBubble = ({ msg }) => {
  const isContact = msg.sender === 'CONTACT';
  const isSystem  = msg.sender === 'SYSTEM';
  const isAI      = msg.sender === 'AI';

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <div className="text-[10px] px-3 py-1.5 rounded-full font-medium"
             style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', color:'#f59e0b' }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 mb-3 animate-fade-in ${isContact ? 'flex-row' : 'flex-row-reverse'}`}>
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1"
           style={{ background: isContact ? 'rgba(71,85,105,0.5)' : isAI ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(16,185,129,0.2)',
                    color: senderColor[msg.sender] }}>
        {isContact ? '👤' : isAI ? '◎' : '👨'}
      </div>

      <div className={`max-w-[72%] ${isContact ? '' : 'items-end'} flex flex-col gap-1`}>
        {/* Sender label */}
        {!isContact && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-semibold" style={{ color: senderColor[msg.sender] }}>
              {isAI ? '◎ Claude AI' : '👨 Agent'}
            </span>
            {isAI && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono" style={{ background:'rgba(99,102,241,0.15)', color:'#818cf8' }}>AI</span>}
          </div>
        )}

        {/* Bubble */}
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isContact ? 'bubble-user rounded-tl-sm' : isAI ? 'bubble-ai rounded-tr-sm' : 'rounded-tr-sm'
        }`}
        style={!isContact && !isAI ? { background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.2)' } : {}}>
          <p className="text-slate-200">{msg.content}</p>
        </div>

        {/* Time + status */}
        <div className={`flex items-center gap-1.5 px-1 ${isContact ? '' : 'flex-row-reverse'}`}>
          <span className="text-[10px] text-slate-600 font-mono">{msg.time}</span>
          {msg.status === 'READ'      && <span className="text-[10px] text-indigo-400">✓✓</span>}
          {msg.status === 'DELIVERED' && <span className="text-[10px] text-slate-500">✓✓</span>}
          {msg.status === 'SENT'      && <span className="text-[10px] text-slate-600">✓</span>}
        </div>
      </div>
    </div>
  );
};

const ConversationItem = ({ conv, isActive, onClick }) => (
  <div
    className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-all border-b border-slate-800/30 ${
      isActive ? 'bg-indigo-600/10' : 'hover:bg-slate-800/30'
    }`}
    onClick={() => onClick(conv)}
  >
    <div className="relative flex-shrink-0">
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
           style={{ background:'linear-gradient(135deg,#334155,#1e293b)' }}>
        {conv.contactName[0]}
      </div>
      {conv.status === 'AI_HANDLING' && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900"
             style={{ background:'#6366f1' }} title="AI Handling">
          <span className="sr-only">AI</span>
        </div>
      )}
      {conv.status === 'HUMAN_TAKEOVER' && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 bg-emerald-500" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-sm font-semibold text-slate-200 truncate">{conv.contactName}</span>
        <span className="text-[10px] text-slate-600 font-mono flex-shrink-0 ml-2">{conv.lastSeen}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge label={conv.label} size="xs" />
        <span className="text-[10px] text-slate-500 truncate">
          {conv.messages[conv.messages.length - 1]?.content?.slice(0, 36)}…
        </span>
      </div>
    </div>
  </div>
);

const Conversations = () => {
  const { isLight, surfaceBg, surfaceBg2, messageBg, borderColor, accentColor } = useTheme();
  const { data, loading } = useData('conversations', '/conversations');
  const [active, setActive] = useState(null);
  const [message, setMessage] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const chatEndRef = useRef(null);

  const convos = data || MOCK.conversations;

  useEffect(() => {
    if (!active && convos.length) setActive(convos[0]);
  }, [convos]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active]);

  useEffect(() => {
    if (active) setAiEnabled(active.status === 'AI_HANDLING');
  }, [active]);

  return (
    <div className="flex h-full page-enter" style={{ height: 'calc(100vh - 0px)' }}>

      {/* Left: conversation list */}
      <div className="w-72 flex-shrink-0 border-r flex flex-col"
           style={{ background: surfaceBg2, borderColor }}>
        <div className="p-4 border-b border-slate-800/50">
          <div className="text-sm font-bold text-slate-200 mb-3">Conversations</div>
          <input className="input-dark w-full rounded-xl px-3 py-2 text-xs"
                 placeholder="🔍  Search contacts..." />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            [1,2,3].map(i => <Skeleton key={i} className="h-16 mx-4 my-2 rounded-xl" />)
          ) : (
            convos.map(c => (
              <ConversationItem
                key={c.id}
                conv={c}
                isActive={active?.id === c.id}
                onClick={setActive}
              />
            ))
          )}
        </div>
      </div>

      {/* Right: chat window */}
      {active ? (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chat header */}
          <div className="flex items-center justify-between px-6 py-4 border-b"
               style={{ background: surfaceBg, borderColor }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                   style={{ background:'linear-gradient(135deg,#334155,#1e293b)' }}>
                {active.contactName[0]}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-200">{active.contactName}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono">{active.phone}</span>
                  <Badge label={active.label} size="xs" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ScoreRing score={active.aiScore} size={36} />
              <Toggle
                checked={aiEnabled}
                onChange={setAiEnabled}
                label={<span className="text-xs text-slate-400">{aiEnabled ? '◎ AI Active' : '◎ AI Off'}</span>}
              />
              {active.status === 'HUMAN_TAKEOVER' && (
                <Badge label="HUMAN" />
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-1"
               style={{ background: messageBg }}>
            {active.messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="px-6 py-4 border-t"
               style={{ background: surfaceBg, borderColor }}>
            {aiEnabled && (
              <div className="flex items-center gap-2 mb-3 text-xs"
                   style={{ background: isLight?'rgba(0,122,255,0.08)':'rgba(99,102,241,0.08)',
                            border: `1px solid ${isLight?'rgba(0,122,255,0.15)':'rgba(99,102,241,0.15)'}`,
                            color: accentColor,
                            borderRadius:8, padding:'6px 12px' }}>
                <PulseDot color={accentColor} />
                <span>Claude AI is handling this conversation — toggle off to take over</span>
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <input
                  className="input-dark w-full rounded-xl px-4 py-3 text-sm pr-24"
                  placeholder={aiEnabled ? 'AI is responding…' : 'Type a message…'}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  disabled={aiEnabled}
                  onKeyDown={e => e.key === 'Enter' && !aiEnabled && message && setMessage('')}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs font-mono">
                  ↵ Send
                </span>
              </div>
              <Button
                variant="primary"
                onClick={() => setMessage('')}
                disabled={!message || aiEnabled}
              >
                ➤
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon="◈" title="Select a conversation" desc="Choose a conversation from the left" />
        </div>
      )}
    </div>
  );
};

window.ConversationsPage = Conversations;
