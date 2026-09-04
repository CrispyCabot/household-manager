import type { DashboardLayout } from '@hhm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceAuthProvider, useDeviceAuth } from '../auth/DeviceAuthProvider.js';
import { useBoards } from '../api/queries.js';
import { boardTypeUi } from '../boards/registry.js';
import { AlertBanner } from '../components/AlertBanner.js';

/** How long a touch on a sleeping/screensaving display keeps it awake before the schedule takes back over — FEATURE_ANALYSIS.md's "Touch overrides the schedule". */
const WAKE_OVERRIDE_MS = 15 * 60 * 1000;

/** How long the pointer sits still before the cursor hides. */
const CURSOR_IDLE_MS = 3_000;

/**
 * Hides the mouse cursor after a few seconds of no movement — done here in
 * the app rather than relying on a Pi-side tool like `unclutter`, which
 * only ever worked by talking to an X server. Raspberry Pi OS's default
 * desktop (Wayfire/labwc) is Wayland, and a Wayland-native Chromium's own
 * cursor rendering generally isn't affected by an X11 tool at all —
 * `unclutter` can run as a systemd service with no visible effect
 * whatsoever, the same shape of problem as `graphical-session.target` never
 * firing (see pi-agent/README.md). Doing it in CSS/JS here instead works
 * identically regardless of which display server Chromium happens to be
 * using on any given Pi and OS image, and removes a whole moving part from
 * the Pi-side setup.
 */
function useHiddenCursorWhenIdle(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function hide() {
      document.body.classList.add('dashboard-cursor-idle');
    }
    function resetIdleTimer() {
      document.body.classList.remove('dashboard-cursor-idle');
      clearTimeout(timer);
      timer = setTimeout(hide, CURSOR_IDLE_MS);
    }

    resetIdleTimer();
    window.addEventListener('pointermove', resetIdleTimer);
    window.addEventListener('pointerdown', resetIdleTimer);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', resetIdleTimer);
      window.removeEventListener('pointerdown', resetIdleTimer);
      document.body.classList.remove('dashboard-cursor-idle');
    };
  }, []);
}

/**
 * Scales the dashboard's content to exactly fill the viewport — no
 * scrollbar in either direction, ever, without cropping anything out of
 * view. This is a screen, not a document: nothing should ever be one pixel
 * taller or wider than what's actually shown, and the household is
 * expected to size boards in the layout editor knowing the result may be
 * non-uniformly stretched or squeezed to make that true (rather than this
 * trying to preserve aspect ratio and leaving letterboxing, which would
 * just move the "doesn't fill the screen" problem around instead of
 * solving it).
 *
 * How it actually avoids a scrollbar without `overflow: hidden` clipping
 * anything real: the element this ref is attached to keeps its natural,
 * unconstrained height (however tall its content wants to be) and a fixed
 * width of exactly 100vw — that's what makes `clientWidth`/`scrollWidth`/
 * `scrollHeight` measure "how much room does this content actually want"
 * rather than "how much room does it have," which is what a CSS transform
 * needs to scale by. The one `overflow: hidden` in the accompanying CSS
 * (on the fixed, viewport-sized ancestor, not this element) exists only
 * because a CSS `transform` doesn't change an element's *layout* box, only
 * how it's painted — without it, the browser would still reserve scroll
 * space for the content's *pre-scale* size even though every visible pixel
 * of the scaled result already fits inside the viewport. Nothing is
 * actually cropped: the scale factor is computed so the painted result is
 * exactly viewport-sized, on both axes, every time.
 */
function useFitToViewport<T extends HTMLElement>(): (node: T | null) => void {
  // A callback ref, not useRef + useEffect([]) — DashboardContent renders
  // entirely different JSX depending on async state (pairing, offline,
  // on/off/screensaver, then finally the real content), so the element this
  // needs to observe doesn't necessarily exist on the component's first
  // mount. useEffect([]) only ever runs once, tied to that first mount —
  // if the ref was still null at that point, it would stay uninitialized
  // forever, never reattaching once the real content actually appeared. A
  // callback ref doesn't have that problem: React invokes it exactly when
  // the DOM node it's attached to is created or destroyed, regardless of
  // which render that happens on.
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((maybeEl: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (maybeEl === null) return;
    const el = maybeEl; // a fresh binding, so TS keeps this narrowed to T (not T | null) inside recompute below

    function recompute() {
      const scaleX = el.clientWidth > 0 ? el.clientWidth / Math.max(el.scrollWidth, 1) : 1;
      const scaleY = el.scrollHeight > 0 ? window.innerHeight / el.scrollHeight : 1;
      el.style.transform = `scale(${scaleX}, ${scaleY})`;
    }

    recompute();
    // Fires on both a viewport resize and any content-driven size change
    // (boards finishing their initial load, an alert appearing/clearing,
    // a layout edit) — a plain window `resize` listener alone would miss
    // the content-driven cases entirely.
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(el);
    window.addEventListener('resize', recompute);
    cleanupRef.current = () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, []);
}

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
  // Called unconditionally, ahead of every early return below (Rules of
  // Hooks) — harmless before the ref is ever attached to a real element,
  // since the pairing/offline/off/screensaver screens don't use it at all.
  const fitRef = useFitToViewport<HTMLDivElement>();

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
    <div className="dashboard-viewport">
      <div
        ref={fitRef}
        className="dashboard page dashboard-fit-content"
        onClickCapture={(e) => e.preventDefault()}
      >
        <AlertBanner householdId={householdId} />
        <BoardGrid householdId={householdId} layout={device?.layout ?? null} />
      </div>
    </div>
  );
}

/** The wall-mounted kiosk route (FEATURE_ANALYSIS.md's Phase 1) — no Masthead, no household switcher, no settings. Wrapped in its own `DeviceAuthProvider` rather than the app's Cognito `AuthProvider`. */
export function Dashboard() {
  useHiddenCursorWhenIdle();
  return (
    <DeviceAuthProvider>
      <DashboardContent />
    </DeviceAuthProvider>
  );
}
