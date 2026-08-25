// src/pages/Automations.jsx — IF/THEN automation rules.
// Demo session → canned walkthrough (AutomationsDemo). Everyone else → the
// real rule engine backed by /api/v1/automations (AutomationsLive).
import { DEMO_ACCESS_TOKEN, useAuthStore } from '@stores/auth.store';
import AutomationsDemo from './AutomationsDemo';
import AutomationsLive from './AutomationsLive';

export default function Automations() {
  const isDemo = useAuthStore((s) => s.token === DEMO_ACCESS_TOKEN);
  return isDemo ? <AutomationsDemo /> : <AutomationsLive />;
}
