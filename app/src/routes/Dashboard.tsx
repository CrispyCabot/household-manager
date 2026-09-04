import type { DashboardLayout, Device } from '@hhm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/** Debounces a burst of `resize` events (a monitor renegotiating its output on boot, a window manager settling) down to one report, a beat after they stop. */
const SCREEN_SIZE_DEBOUNCE_MS = 1_000;

/**
 * Tells the API this device's own screen size, in CSS pixels — on mount,
 * and again whenever it actually changes (a `resize` listener, for the
 * rare case a Pi's HDMI output renegotiates without a reboot). Read back on
 * `Device.screenWidth`/`screenHeight` by `DashboardLayoutEditor.tsx`, which
 * shapes its editing canvas to match — the layout editor otherwise has no
 * way to know a given device's screen is, say, a 21:9 ultrawide rather
 * than an ordinary 16:9, and a layout arranged without knowing that gets
 * non-uniformly stretched further than necessary by `useFitToViewport`
 * below to fill it.
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
 * unconstrained height (however tall its content wants to be) and, by
 * default, a fixed width of exactly 100vw — that's what makes
 * `clientWidth`/`scrollWidth`/`scrollHeight` measure "how much room does
 * this content actually want" rather than "how much room does it have,"
 * which is what a CSS transform needs to scale by. The one `overflow:
 * hidden` in the accompanying CSS (on the fixed, viewport-sized ancestor,
 * not this element) exists only because a CSS `transform` doesn't change
 * an element's *layout* box, only how it's painted — without it, the
 * browser would still reserve scroll space for the content's *pre-scale*
 * size even though every visible pixel of the scaled result already fits
 * inside the viewport. Nothing is actually cropped: the scale factor is
 * computed so the painted result is exactly viewport-sized, on both axes,
 * every time.
 *
 * `designSize` (a device's `physicalScreenWidth`/`physicalScreenHeight`,
 * when a household has set one — always both or neither) overrides that
 * default on *both* axes at once, and changes what scale even means: the
 * element is pinned to exactly `designSize.width` CSS pixels wide, and
 * *both* scale factors become the fixed ratios `outputSize/designSize`
 * (real viewport size over design size) rather than "whatever it takes to
 * exactly fill the viewport." That's deliberate, not a relaxation of the
 * no-scrollbar rule applied selectively — it's the only way the two scale
 * factors can end up in the *same fixed ratio* to each other that the
 * device's own screen stretches by (see `Device.physicalScreenWidth`'s doc
 * comment): if `scaleY` instead kept tracking actual content height like it
 * does when no override is set, its ratio to `scaleX` would drift with
 * however tall the content on any given day happens to be, and the two
 * distortions (this one, the screen's own) would almost never cancel out
 * by coincidence. The trade a household makes by setting an override is
 * exactly this: content sized close to the design height fills the screen
 * correctly; content that runs short leaves a gap at the bottom instead of
 * exactly filling it, and content that runs long is still clipped by the
 * ancestor's `overflow: hidden` rather than reintroducing a scrollbar.
 * `DashboardLayoutEditor.tsx`'s canvas is shaped to this same design size
 * specifically to help a household land close to it.
 */
function useFitToViewport<T extends HTMLElement>(designSize: { width: number; height: number } | null): (node: T | null) => void {
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
  const recomputeRef = useRef<(() => void) | null>(null);
  // Assigned directly during render (not in an effect) so recompute() —
  // called from ResizeObserver/resize callbacks with no render in between —
  // always reads the latest value rather than whatever designSize was when
  // the callback ref first attached.
  const designSizeRef = useRef(designSize);
  designSizeRef.current = designSize;

  // designSize changing alone (the household editing the override) is not
  // itself a resize the ResizeObserver/window listener below would catch.
  useEffect(() => {
    recomputeRef.current?.();
  }, [designSize]);

  return useCallback((maybeEl: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    recomputeRef.current = null;
    if (maybeEl === null) return;
    const el = maybeEl; // a fresh binding, so TS keeps this narrowed to T (not T | null) inside recompute below

    function recompute() {
      const design = designSizeRef.current;
      el.style.width = design === null ? '' : `${design.width}px`;
      const scaleX =
        design !== null
          ? window.innerWidth / design.width
          : el.clientWidth > 0
            ? el.clientWidth / Math.max(el.scrollWidth, 1)
            : 1;
      const scaleY =
        design !== null
          ? window.innerHeight / design.height
          : el.scrollHeight > 0
            ? window.innerHeight / el.scrollHeight
            : 1;
      el.style.transform = `scale(${scaleX}, ${scaleY})`;
    }

    recompute();
    recomputeRef.current = recompute;
    // Fires on both a viewport resize and any content-driven size change
    // (boards finishing their initial load, an alert appearing/clearing,
    // a layout edit) — a plain window `resize` listener alone would miss
    // the content-driven cases entirely. With an override set, scaleY no
    // longer depends on content height, but scaleX still needs a fresh
    // window.innerWidth on an actual resize.
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
        // A plain `item.kind === 'alerts'` check (not `(item.kind ?? 'board')
        // === 'alerts'`) is deliberate: it both narrows the discriminated
        // union correctly for TypeScript *and* does the right thing at
        // runtime for a layout saved before the alerts panel became
        // placeable — an old item has no `kind` at all, `undefined !==
        // 'alerts'` is `false`, and it falls into the board branch below,
        // exactly where its (always-present) `boardId` says it belongs.
        const content =
          item.kind === 'alerts' ? (
            <AlertBanner householdId={householdId} />
          ) : (() => {
              const board = boardById.get(item.boardId);
              if (board === undefined) return null; // the board was deleted since this layout was saved
              const ui = boardTypeUi(board.type);
              if (ui === undefined) return null;
              return <ui.Card board={board} size={{ w: item.w, h: item.h }} dashboard />;
            })();
        return (
          // Unstyled positioning box, not `.card` — the Card (or
          // AlertBanner) inside already supplies its own visual styling;
          // this only carries the grid placement neither has a prop to
          // accept itself.
          //
          // The inner wrapper's enlargement uses `transform: scale`, not
          // `zoom` — `zoom` was tried first and is wrong here: it changes an
          // element's actual *layout* size, not just how it's painted, so a
          // zoomed tile's own CSS Grid row grew to fit its now-bigger
          // content instead of staying put, pushing every tile below it
          // down and, with it, off the (fixed-height) screen. `overflow:
          // hidden` on this outer div can't stop that — it only clips
          // content that doesn't fit inside a box whose size has already
          // been decided, and with `zoom` the box's size was itself decided
          // by that same inflated content. `transform: scale`, like
          // `useFitToViewport` above already relies on, changes only paint:
          // the inner wrapper's *layout* footprint (and so this row's
          // height) stays exactly what it'd be at contentScale 1, and the
          // now-larger *painted* result is what this div's `overflow:
          // hidden` actually has something to clip.
          <div
            key={item.kind === 'alerts' ? 'alerts' : item.boardId}
            className="dashboard-grid-item"
            style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}
          >
            <div className="dashboard-grid-item__content" style={{ transform: `scale(${item.contentScale ?? 1})` }}>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardContent() {
  const { status, pairingCode, bearerToken, mode, householdId, device } = useDeviceAuth();
  const [wakeUntil, setWakeUntil] = useState<number | null>(null);
  const physicalWidth = device?.physicalScreenWidth ?? null;
  const physicalHeight = device?.physicalScreenHeight ?? null;
  // Memoized on the actual numbers, not on `device` itself — `device` gets
  // a brand-new object reference every ~30s poll (DeviceAuthProvider) even
  // when nothing changed, and useFitToViewport re-runs an effect whenever
  // this object's identity changes.
  const designSize = useMemo(
    () => (physicalWidth !== null && physicalHeight !== null ? { width: physicalWidth, height: physicalHeight } : null),
    [physicalWidth, physicalHeight],
  );
  // Called unconditionally, ahead of every early return below (Rules of
  // Hooks) — harmless before the ref is ever attached to a real element,
  // since the pairing/offline/off/screensaver screens don't use it at all.
  const fitRef = useFitToViewport<HTMLDivElement>(designSize);
  useReportScreenSize(bearerToken, device);

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
  // A custom layout that places the alerts panel itself (BoardGrid renders
  // it inline, at whatever position/size/zoom the household chose) owns
  // showing it — this top-level instance is only the fallback for
  // auto-flow and for a custom layout saved before that was possible.
  const alertsPlacedInLayout = layout !== null && layout.items.some((item) => item.kind === 'alerts');

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
        <div
          ref={fitRef}
          className="dashboard page dashboard-fit-content"
          onClickCapture={(e) => e.preventDefault()}
        >
          {!alertsPlacedInLayout && <AlertBanner householdId={householdId} />}
          <BoardGrid householdId={householdId} layout={layout} />
        </div>
      </div>
    </ThemeScope>
  );
}

/** The wall-mounted kiosk route (FEATURE_ANALYSIS.md's Phase 1) — no Masthead, no household switcher, no settings. Wrapped in its own `DeviceAuthProvider` rather than the app's Cognito `AuthProvider`. */
export function Dashboard() {
  useHiddenCursorWhenIdle();
  useReloadOnNewDeploy();
  return (
    <DeviceAuthProvider>
      <DashboardContent />
    </DeviceAuthProvider>
  );
}
