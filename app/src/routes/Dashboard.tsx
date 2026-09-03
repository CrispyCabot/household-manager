import type { DashboardLayout } from '@hhm/shared';
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

/**
 * `layout === null` (a device that has never been customized, or was
 * explicitly reset to "automatic") falls back to the same `.cardgrid` flow
 * every other surface uses — this is the fallback FEATURE_ANALYSIS.md's
 * Phase 4 promises: "a newly paired device looks reasonable before you have
 * arranged anything." A non-null layout switches to CSS Grid, positioning
 * only the boards actually placed in it (a curated view, not an obligation
 * to show everything — see that doc's "the deliberate feature" note) and
 * passing each Card its cell footprint so it can render more when it has
 * more room.
 */
function BoardGrid({ householdId, layout }: { householdId: string; layout: DashboardLayout | null }) {
  const { data, isLoading } = useBoards(householdId);
  if (isLoading) return null;
  const boards = data?.boards ?? [];

  if (layout === null) {
    return (
      // Every board type's own Card already renders its own `.card` root
      // (see e.g. boards/tasks/index.tsx) — no extra wrapper needed here,
      // same as Home.tsx's BoardGrid, which relies on the same thing.
      <div className="cardgrid dashboard-grid">
        {boards.map((board) => {
          const ui = boardTypeUi(board.type);
          if (ui === undefined) return null;
          return <ui.Card key={board.id} board={board} dashboard />;
        })}
      </div>
    );
  }

  const boardById = new Map(boards.map((b) => [b.id, b]));

  return (
    <div className="dashboard-custom-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, 1fr)` }}>
      {layout.items.map((item) => {
        const board = boardById.get(item.boardId);
        if (board === undefined) return null; // the board was deleted since this layout was saved
        const ui = boardTypeUi(board.type);
        if (ui === undefined) return null;
        return (
          // Unstyled positioning box, not `.card` — the Card inside already
          // supplies its own visual card styling; this only carries the
          // grid placement a Card component has no prop to accept itself.
          <div
            key={item.boardId}
            className="dashboard-grid-item"
            style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}
          >
            <ui.Card board={board} size={{ w: item.w, h: item.h }} dashboard />
          </div>
        );
      })}
    </div>
  );
}

function DashboardContent() {
  const { status, pairingCode, mode, householdId, device } = useDeviceAuth();
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
      <BoardGrid householdId={householdId} layout={device?.layout ?? null} />
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
