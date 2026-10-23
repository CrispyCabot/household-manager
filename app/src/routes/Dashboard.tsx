import type { DashboardLayout, Device } from '@hhm/shared';
import { useEffect, useRef, useState } from 'react';
import { DeviceAuthProvider, useDeviceAuth } from '../auth/DeviceAuthProvider.js';
import { apiFetch } from '../api/client.js';
import { useBoards } from '../api/queries.js';
import { boardTypeUi } from '../boards/registry.js';
import { AlertBanner } from '../components/AlertBanner.js';
import { ThemeScope } from '../components/ThemeScope.js';

/** How long a touch on a sleeping/screensaving display keeps it awake before the schedule takes back over — FEATURE_ANALYSIS.md's "Touch overrides the schedule". */
const WAKE_OVERRIDE_MS = 15 * 60 * 1000;

/** How long the pointer sits still before the cursor hides. */
const CURSOR_IDLE_MS = 3_000;

/** How often a kiosk tab checks whether a new build has been deployed. */
const RELOAD_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Hides the mouse cursor — from the start, and again a few seconds after a
 * mouse stops moving. A touch never brings it back: on a touch-only kiosk
 * the only pointer is the one the desktop parks mid-screen at boot (or, on
 * an X11 session, drags to wherever a finger last landed), and showing it
 * on every tap is what left it stuck on screen. Done here in
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
    function onPointer(e: PointerEvent) {
      clearTimeout(timer);
      if (e.pointerType !== 'mouse') {
        hide();
        return;
      }
      document.body.classList.remove('dashboard-cursor-idle');
      timer = setTimeout(hide, CURSOR_IDLE_MS);
    }

    hide();
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.body.classList.remove('dashboard-cursor-idle');
    };
  }, []);
}

/**
 * Switches off the browser touch gestures a wall touchscreen trips over by
 * accident: pinch-zoom (with no keyboard there's no way to zoom back out),
 * swipe-to-go-back, and long-press text selection and context menus. The
 * kiosk unit's Chromium flags in pi-agent/README.md cover the first two at
 * the browser level too — this half ships with a deploy and needs no
 * Pi-side edit, and also covers the long-press behavior no flag does.
 */
function useKioskTouchGuards(): void {
  useEffect(() => {
    const root = document.documentElement;
    function blockContextMenu(e: Event) {
      e.preventDefault();
    }

    root.classList.add('dashboard-kiosk');
    window.addEventListener('contextmenu', blockContextMenu);
    return () => {
      root.classList.remove('dashboard-kiosk');
      window.removeEventListener('contextmenu', blockContextMenu);
    };
  }, []);
}

/**
 * A wall-mounted kiosk tab is a single browser session that, once loaded,
 * is never navigated again — client-side routing never triggers a real
 * page load, and nothing about a deploy (even though it fully invalidates
 * CloudFront, see .github/workflows/deploy.yml) reaches a tab that's
 * already sitting open. Left alone, a Pi would keep running whatever build
 * happened to be current when it last rebooted, indefinitely.
 *
 * Fixed here rather than on the Pi side: periodically re-fetches `/`
 * (bypassing the browser's own HTTP cache) and does a full reload the
 * moment its content differs from what was loaded at mount. Comparing the
 * raw HTML is enough to detect a new build with no extra plumbing — Vite
 * always references a content-hashed, and therefore build-unique, asset
 * filename from index.html. A failed fetch (network hiccup, briefly
 * offline) is treated as "nothing to report" rather than a difference, so
 * a connectivity blip alone can never trigger a reload.
 */
function useReloadOnNewDeploy(): void {
  useEffect(() => {
    let cancelled = false;
    let baseline: string | null = null;

    async function fetchIndexHtml(): Promise<string | null> {
      // A hung request (see api/client.ts's own timeout, same reasoning)
      // would otherwise sit open until the browser's own — potentially very
      // long — default timeout, silently eating one polling cycle after
      // another instead of failing fast and trying again next tick.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch('/', { cache: 'no-store', signal: controller.signal });
        return await res.text();
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    void fetchIndexHtml().then((html) => {
      if (!cancelled) baseline = html;
    });

    const interval = setInterval(() => {
      void fetchIndexHtml().then((html) => {
        if (cancelled || html === null || baseline === null) return;
        if (html !== baseline) window.location.reload();
      });
    }, RELOAD_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
}

/**
 * Reloads the moment this device's `refreshRequestedAt` changes from what it
 * was at mount — the client-side end of Settings' "Refresh now" button.
 * `device` itself already arrives freshly polled roughly every 30s
 * (`DeviceAuthProvider`), so this needs no polling of its own: it just
 * compares against a baseline captured on the first non-null value seen, the
 * same shape as `useReloadOnNewDeploy` above but reacting to an explicit
 * request rather than a differing build.
 */
function useReloadOnRefreshRequest(refreshRequestedAt: string | null | undefined): void {
  const baseline = useRef<string | null>(null);
  const baselineSet = useRef(false);

  useEffect(() => {
    if (refreshRequestedAt === undefined) return;
    if (!baselineSet.current) {
      baseline.current = refreshRequestedAt;
      baselineSet.current = true;
      return;
    }
    if (refreshRequestedAt !== baseline.current) window.location.reload();
  }, [refreshRequestedAt]);
}

/** Debounces a burst of `resize` events (a monitor renegotiating its output on boot, a window manager settling) down to one report, a beat after they stop. */
const SCREEN_SIZE_DEBOUNCE_MS = 1_000;

/**
 * Tells the API this device's own screen size, in CSS pixels — on mount,
 * and again whenever it actually changes (a `resize` listener, for the
 * rare case a Pi's HDMI output renegotiates without a reboot). Read back on
 * `Device.screenWidth`/`screenHeight` by `DashboardLayoutEditor.tsx`, which
 * shapes its editing canvas to match — the layout editor otherwise has no
 * way to know a given device's screen is, say, a 21:9 ultrawide rather
 * than an ordinary 16:9.
 */
function useReportScreenSize(bearerToken: string | null, device: Device | null): void {
  useEffect(() => {
    if (bearerToken === null) return;
    let debounce: ReturnType<typeof setTimeout>;

    function report() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (device !== null && device.screenWidth === width && device.screenHeight === height) return;
      void apiFetch<void>('/v1/devices/me/screen', bearerToken!, {
        method: 'PUT',
        body: JSON.stringify({ width, height }),
      }).catch(() => {
        // Best-effort — the next resize (or the next mount, after a
        // reboot) tries again; nothing about the dashboard's own rendering
        // depends on this succeeding right away.
      });
    }

    function onResize() {
      clearTimeout(debounce);
      debounce = setTimeout(report, SCREEN_SIZE_DEBOUNCE_MS);
    }

    report();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(debounce);
      window.removeEventListener('resize', onResize);
    };
  }, [bearerToken, device]);
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
  // The alerts panel always renders above the grid now (DashboardContent),
  // so an old layout's alerts tile is skipped here, along with any board
  // deleted since the layout was saved. A plain `item.kind === 'alerts'`
  // check is deliberate: an item saved before the alerts tile existed has
  // no `kind` at all, and still counts as a board.
  const placed = layout.items.flatMap((item) => {
    if (item.kind === 'alerts') return [];
    const board = boardById.get(item.boardId);
    const ui = board === undefined ? undefined : boardTypeUi(board.type);
    return board === undefined || ui === undefined ? [] : [{ item, board, ui }];
  });
  const rowOf = compactRows(placed.map(({ item }) => item));

  return (
    <div
      className="dashboard-custom-grid"
      style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowOf.count}, minmax(0, 1fr))` }}
    >
      {placed.map(({ item, board, ui }) => (
        // Unstyled positioning box, not `.card` — the Card inside already
        // supplies its own visual styling; this only carries the grid
        // placement it has no prop to accept itself.
        <div
          key={board.id}
          className="dashboard-grid-item"
          style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${rowOf(item.y) + 1} / span ${item.h}` }}
        >
          <ui.Card board={board} size={{ w: item.w, h: item.h }} dashboard />
        </div>
      ))}
    </div>
  );
}

/**
 * Drops the layout rows no board covers (e.g. where an old alerts tile sat,
 * or space left empty at the bottom) and renumbers the rest, so the rows
 * that remain split the grid's whole height between them — the boards
 * always fill the screen below the alerts. Returns the new row index for an
 * old one, plus how many rows are left.
 */
function compactRows(items: { y: number; h: number }[]): ((row: number) => number) & { count: number } {
  const covered = new Set(items.flatMap((item) => Array.from({ length: item.h }, (_, i) => item.y + i)));
  const sorted = [...covered].sort((a, b) => a - b);
  const index = new Map(sorted.map((row, i) => [row, i]));
  return Object.assign((row: number) => index.get(row) ?? 0, { count: Math.max(1, sorted.length) });
}

function DashboardContent() {
  const { status, pairingCode, bearerToken, mode, householdId, device } = useDeviceAuth();
  const [wakeUntil, setWakeUntil] = useState<number | null>(null);
  useReportScreenSize(bearerToken, device);
  useReloadOnRefreshRequest(device?.refreshRequestedAt);

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

  // A touch always wakes into the real dashboard, bypassing both the
  // schedule and the screensaver toggle for the grace period — someone
  // physically at the screen wants the actual content, not a clock face.
  // Once that grace period lapses, the schedule's mode (`mode`, from
  // `/v1/devices/me`) takes back over, and — only when it says "on" — the
  // device's own `screensaverEnabled` toggle (Settings, switchable any
  // time, no schedule edit required) decides between the real content and
  // the screensaver. "off" always wins over the screensaver: there's no
  // reason to keep the screen lit showing a clock during a scheduled sleep
  // window.
  const wakeActive = wakeUntil !== null && Date.now() < wakeUntil;
  const effectiveMode = wakeActive
    ? 'on'
    : mode === 'off'
      ? 'off'
      : device?.screensaverEnabled === true
        ? 'screensaver'
        : 'on';

  if (effectiveMode === 'off') return <div className="dashboard-off" />;
  if (effectiveMode === 'screensaver') return <Screensaver />;

  // householdId is only null for the instant between "authenticating"
  // finishing and the first /v1/devices/me response landing.
  if (householdId === null) return null;

  const layout = device?.layout ?? null;

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
    <ThemeScope theme={device?.theme ?? null}>
      <div className="dashboard-viewport">
        <div className="dashboard page" onClickCapture={(e) => e.preventDefault()}>
          {/* Renders nothing when there are no due tasks; otherwise sits
              above the boards at full height, and the grid below shrinks
              to fit (see .dashboard.page in styles.css). */}
          <AlertBanner householdId={householdId} />
          <BoardGrid householdId={householdId} layout={layout} />
        </div>
      </div>
    </ThemeScope>
  );
}

/** The wall-mounted kiosk route (FEATURE_ANALYSIS.md's Phase 1) — no Masthead, no household switcher, no settings. Wrapped in its own `DeviceAuthProvider` rather than the app's Cognito `AuthProvider`. */
export function Dashboard() {
  useHiddenCursorWhenIdle();
  useKioskTouchGuards();
  useReloadOnNewDeploy();
  return (
    <DeviceAuthProvider>
      <DashboardContent />
    </DeviceAuthProvider>
  );
}
