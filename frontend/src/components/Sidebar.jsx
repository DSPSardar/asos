// src/components/Sidebar.jsx

const { useState } = React;

const NAV_ITEMS = [
  { id:'dashboard',    icon:'⌂',  label:'Dashboard',       badge: null  },
  { id:'pipeline',     icon:'⬡',  label:'Pipeline',        badge: '87'  },
  { id:'conversations',icon:'◈',  label:'Conversations',   badge: '3'   },
  { id:'ai-insights',  icon:'◎',  label:'AI Insights',     badge: null  },
  { id:'ads',          icon:'⬗',  label:'Ads Performance', badge: null  },
  { id:'analytics',    icon:'◐',  label:'Analytics',       badge: null  },
  { id:'settings',     icon:'◌',  label:'Settings',        badge: null  },
];

const Sidebar = ({ activePage, onNavigate }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="sidebar-gradient flex flex-col transition-all duration-300 relative z-20"
      style={{ width: collapsed ? 64 : 220, minHeight: '100vh', flexShrink: 0 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b"
           style={{ borderColor:'rgba(99,102,241,0.12)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow:'0 0 24px rgba(99,102,241,0.4)' }}>
          <span className="text-white font-bold text-sm">A</span>
        </div>
        {!collapsed && (
          <div className="animate-fade-in overflow-hidden">
            <div className="text-sm font-bold text-white tracking-tight leading-none">getaisales</div>
            <div className="text-[10px] text-indigo-400 font-mono tracking-widest">.com · AI SALES</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 relative group ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
              }`}
              style={isActive ? { boxShadow: 'inset 0 0 20px rgba(99,102,241,0.1)' } : {}}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-indigo-400"
                     style={{ boxShadow: '0 0 8px #818cf8' }} />
              )}

              <span className={`text-base flex-shrink-0 transition-colors ${isActive ? 'text-indigo-400' : ''}`}>
                {item.icon}
              </span>

              {!collapsed && (
                <span className="text-sm font-medium flex-1 truncate animate-fade-in">{item.label}</span>
              )}

              {!collapsed && item.badge && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 font-mono animate-fade-in">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* AI status indicator */}
      {!collapsed && (
        <div className="mx-3 mb-4 p-3 rounded-xl animate-fade-in"
             style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <PulseDot color="#10b981" />
            <span className="text-xs font-semibold text-emerald-400">AI Active</span>
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed">
            Claude processing<br/>3 conversations
          </div>
        </div>
      )}

      {/* Collapse button */}
      <div className="border-t border-slate-800/50 p-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-2 rounded-xl text-slate-600 hover:text-slate-400 hover:bg-slate-800/30 transition-all text-lg"
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* User avatar */}
      {!collapsed && (
        <div className="px-3 pb-4 animate-fade-in">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-800/40 cursor-pointer transition-all">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                 style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              JA
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-medium text-slate-300 truncate">John Admin</div>
              <div className="text-[10px] text-slate-600 truncate">TENANT_ADMIN</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

window.Sidebar = Sidebar;
