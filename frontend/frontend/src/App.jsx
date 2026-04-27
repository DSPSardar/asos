// src/App.jsx — Main app with router + layout

const { useState, useEffect } = React;

const getPage = (id) => {
  const map = {
    dashboard:     window.DashboardPage,
    pipeline:      window.PipelinePage,
    conversations: window.ConversationsPage,
    'ai-insights': window.AIInsightsPage,
    ads:           window.AdsPerformancePage,
    analytics:     window.AnalyticsPage,
    settings:      window.SettingsPage,
  };
  return map[id] || map.dashboard;
};

const PAGE_TITLES = {
  dashboard:     'Dashboard',
  pipeline:      'Lead Pipeline',
  conversations: 'Conversations',
  'ai-insights': 'AI Insights',
  ads:           'Ads Performance',
  analytics:     'Analytics',
  settings:      'Settings',
};

const TopBar = ({ page, onNavigate, theme, onToggleTheme }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isLight = theme === 'light';

  return (
    <div id="topbar-el" className="flex items-center justify-between px-6 py-3 border-b border-slate-800/60 flex-shrink-0"
         style={{ background: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(10,14,30,0.95)',
                  backdropFilter:'blur(12px)', height:56,
                  borderBottomColor: isLight ? 'rgba(0,0,0,0.08)' : '' }}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-600">getaisales.com</span>
        <span className="text-slate-700">/</span>
        <span className="text-slate-300 font-medium">{PAGE_TITLES[page]}</span>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-4">
        {/* Live clock */}
        <div className="text-xs font-mono text-slate-600">
          {time.toLocaleTimeString('en-US')}
        </div>

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
          style={{
            background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
            border: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.1)',
            color: isLight ? '#1C1C1E' : '#f1f5f9',
          }}
          title="Toggle light/dark theme"
        >
          <span>{isLight ? '☀️' : '🌙'}</span>
          <span>{isLight ? 'Light' : 'Dark'}</span>
        </button>

        {/* AI status */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
             style={{ background: isLight ? 'rgba(0,122,255,0.08)' : 'rgba(99,102,241,0.08)',
                      border: isLight ? '1px solid rgba(0,122,255,0.15)' : '1px solid rgba(99,102,241,0.15)' }}>
          <PulseDot color={isLight ? '#007AFF' : '#818cf8'} />
          <span className="font-medium" style={{ color: isLight ? '#007AFF' : '#818cf8' }}>AI Active</span>
        </div>

        {/* Notifications */}
        <button className="relative w-8 h-8 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-all">
          <span className="text-base">🔔</span>
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
                style={{ boxShadow:'0 0 6px rgba(239,68,68,0.6)' }} />
        </button>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-pointer"
             style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          JA
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [page, setPage] = useState('dashboard');
  const [theme, setTheme] = useState(() => {
    // Default to dark — matches auth page aesthetic
    const saved = localStorage.getItem('asos_theme');
    return saved || 'dark';
  });

  // Apply theme to document root
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('asos_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const PageComponent = getPage(page);

  // Keyboard shortcuts
  useEffect(() => {
    const keys = { '1':'dashboard','2':'pipeline','3':'conversations','4':'ai-insights','5':'ads','6':'analytics','7':'settings' };
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && keys[e.key]) {
        e.preventDefault();
        setPage(keys[e.key]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>

      {/* Sidebar */}
      <Sidebar activePage={page} onNavigate={setPage} />

      {/* Main content area */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>

        {/* Top bar */}
        <TopBar page={page} onNavigate={setPage} theme={theme} onToggleTheme={toggleTheme} />

        {/* Page content — scrollable */}
        <div style={{ flex:1, overflowY:'auto', overflowX:'hidden' }} key={page}>
          <PageComponent />
        </div>

      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
