import { useEffect, useState } from 'react';
import { DeviceAuthProvider, useDeviceAuth } from '../auth/DeviceAuthProvider.js';
import { useBoards } from '../api/queries.js';
import { boardTypeUi } from '../boards/registry.js';
import { AlertBanner } from '../components/AlertBanner.js';

/** How long a touch on a sleeping/screensaving display keeps it awake before the schedule takes back over — FEATURE_ANALYSIS.md's "Touch overrides the schedule". */
const WAKE_OVERRIDE_MS = 15 * 60 * 1000;

function PairingScreen({ code }: { code: string | null }) {
  return (
    <div className="dashboard-pairing">
      <p className="dashboard-pairing__label">Pair this display</p>
      {code === null ? (
        <p className="dashboard-pairing__hint">Requesting a code…</p>
      ) : (
        <>
          <p className="dashboard-pairing__code">{code}</p>
          <p className="dashboard-pairing__hint">Open household-manager on your phone → Settings → Devices, and enter this code.</p>
        </>
      )}
    </div>
  );
}

function OfflineScreen() {
  return (
    <div className="dashboard-pairing">
      <p className="dashboard-pairing__label">Reconnecting…</p>
      <p className="dashboard-pairing__hint">This screen will come back on its own once the network is back.</p>
    </div>
  );
}

function Screensaver() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-screensaver">
      <span className="dashboard-screensaver__time">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      <span className="dashboard-screensaver__date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
    </div>
  );
}

function BoardGrid({ householdId }: { householdId: string }) {
  const { data, isLoading } = useBoards(householdId);
  if (isLoading) return null;
  const boards = data?.boards ?? [];

  return (
    <div className="cardgrid dashboard-grid">
      {boards.map((board) => {
        const ui = boardTypeUi(board.type);
        if (ui === undefined) return null;
        return (
          <div key={board.id} className="card">
            <ui.Card board={board} />
          </div>
        );
      })}
    </div>
  );
}

function DashboardContent() {
  const { status, pairingCode, mode, householdId } = useDeviceAuth();
  const [wakeUntil, setWakeUntil] = useState<number | null>(null);

  // Any touch anywhere wakes the display, regardless of what's currently
  // shown — the schedule takes back over once the grace period lapses.
  useEffect(() => {
    function wake() {
      setWakeUntil(Date.now() + WAKE_OVERRIDE_MS);
    }
    window.addEventListener('pointerdown', wake);
    return () => window.removeEventListener('pointerdown', wake);
  }, []);

  if (status === 'pairing' || status === 'authenticating') return <PairingScreen code={pairingCode} />;
  if (status === 'offline') return <OfflineScreen />;

  const effectiveMode = wakeUntil !== null && Date.now() < wakeUntil ? 'on' : mode;

  if (effectiveMode === 'off') return <div className="dashboard-off" />;
  if (effectiveMode === 'screensaver') return <Screensaver />;

  // householdId is only null for the instant between "authenticating"
  // finishing and the first /v1/devices/me response landing.
  if (householdId === null) return null;

  return (
    // Every board type's Card (and AlertBanner's own row) renders a
    // react-router Link into its full board page, which sits behind
    // RequireAuth's Cognito-only check — a device has no Cognito session,
    // so following one would dead-end at a sign-in screen. react-router's
    // Link honors `event.defaultPrevented`, so a capture-phase
    // preventDefault here blocks navigation without touching every board
    // type or the plain <button> actions (complete/dismiss/snooze,
    // checklist toggle) nested alongside those links, which keep working
    // normally. Deep board-page navigation from the wall display is future
    // work (see FEATURE_ANALYSIS.md's Phase 4), not a Phase 1 requirement.
    <div className="dashboard page" onClickCapture={(e) => e.preventDefault()}>
      <AlertBanner householdId={householdId} />
      <BoardGrid householdId={householdId} />
    </div>
  );
}

/** The wall-mounted kiosk route (FEATURE_ANALYSIS.md's Phase 1) — no Masthead, no household switcher, no settings. Wrapped in its own `DeviceAuthProvider` rather than the app's Cognito `AuthProvider`. */
export function Dashboard() {
  return (
    <DeviceAuthProvider>
      <DashboardContent />
    </DeviceAuthProvider>
  );
}
