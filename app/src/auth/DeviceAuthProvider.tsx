import type { Device, PairStatus, ScheduleMode } from '@hhm/shared';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getConfig } from '../config.js';
import { ApiError, apiFetch } from '../api/client.js';

const STORAGE_KEY = 'hhm.device';
// The Pi-side schedule agent (pi-agent/dashboard_agent.py) is a separate OS
// process with no way to see the pairing secret this page just received —
// it's delivered exactly once, over HTTP, straight to this fetch call. This
// is a best-effort side channel handing it a copy; see that script's
// CredentialBridgeHandler for the other half. Failing (e.g. running this
// same app in an ordinary browser, nowhere near a Pi) is expected and safe
// to ignore — nothing here depends on it succeeding.
const CREDENTIAL_BRIDGE_URL = 'http://127.0.0.1:8765/credential';

interface StoredCredential {
  deviceId: string;
  householdId: string;
  deviceSecret: string;
}

function loadCredential(): StoredCredential | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

function saveCredential(cred: StoredCredential): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cred));
  void fetch(CREDENTIAL_BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cred, apiUrl: getConfig().apiUrl }),
  }).catch(() => {
    // No agent listening — normal outside an actual kiosk. See the const's doc comment above.
  });
}

function clearCredential(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

type Status = 'pairing' | 'authenticating' | 'ready' | 'offline';

interface DeviceAuthValue {
  status: Status;
  /** The code to show on screen while `status === 'pairing'`. */
  pairingCode: string | null;
  bearerToken: string | null;
  device: Device | null;
  /** The device's schedule, already evaluated for right now — see `routes/devices.ts`'s `/v1/devices/me`. */
  mode: ScheduleMode;
  householdId: string | null;
}

const DeviceAuthContext = createContext<DeviceAuthValue | null>(null);

// A device token is valid for 15 minutes (deviceToken.ts's
// DEVICE_TOKEN_TTL_SECONDS) — renewing at the half-life leaves a wide
// margin for a slow network without ever operating on an expired token.
const TOKEN_RENEW_MARGIN = 0.5;
const ME_POLL_INTERVAL_MS = 30_000;
const PAIR_POLL_INTERVAL_MS = 3_000;

/**
 * Wraps the wall-dashboard route (`routes/Dashboard.tsx`) only — never
 * mounted globally. Pairs a fresh device (FEATURE_ANALYSIS.md's "Pairing
 * flow"), then keeps a short-lived device JWT renewed for as long as the
 * page stays open. `useOptionalDeviceAuth()` is what lets the existing
 * `app/src/api/queries.ts` hooks work unmodified on the dashboard — they
 * prefer this token over the signed-in user's when both are present.
 */
export function DeviceAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('pairing');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [bearerToken, setBearerToken] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [mode, setMode] = useState<ScheduleMode>('on');
  const [householdId, setHouseholdId] = useState<string | null>(null);

  // Plain refs, not state — these drive timers/polling loops and reading a
  // stale closure value would just mean one extra poll tick, not a bug, so
  // they don't need to trigger re-renders.
  const credentialRef = useRef<StoredCredential | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function exchangeAndSchedule(cred: StoredCredential) {
      try {
        const res = await apiFetch<{ token: string; expiresIn: number }>('/v1/devices/token', '', {
          method: 'POST',
          body: JSON.stringify({ deviceId: cred.deviceId, householdId: cred.householdId, deviceSecret: cred.deviceSecret }),
        });
        if (cancelledRef.current) return;
        setBearerToken(res.token);
        setHouseholdId(cred.householdId);
        setStatus('ready');
        setTimeout(() => void exchangeAndSchedule(cred), res.expiresIn * 1000 * TOKEN_RENEW_MARGIN);
      } catch (err) {
        if (cancelledRef.current) return;
        if (err instanceof ApiError && err.status === 401) {
          // The device record was deleted (revoked from Settings) — start
          // over from a fresh pairing code rather than retrying forever.
          clearCredential();
          credentialRef.current = null;
          setBearerToken(null);
          setStatus('pairing');
          void startPairing();
          return;
        }
        // Network hiccup or the API being briefly unreachable — keep
        // whatever token is still live and retry soon rather than
        // dropping the dashboard to a pairing screen over a blip.
        setStatus('offline');
        setTimeout(() => void exchangeAndSchedule(cred), 15_000);
      }
    }

    async function pollPairing(code: string) {
      if (cancelledRef.current) return;
      try {
        const result = await apiFetch<PairStatus>(`/v1/devices/pair/${code}`, '');
        if (cancelledRef.current) return;
        if (result.status === 'claimed') {
          const cred: StoredCredential = { deviceId: result.deviceId, householdId: result.householdId, deviceSecret: result.deviceSecret };
          saveCredential(cred);
          credentialRef.current = cred;
          setPairingCode(null);
          setStatus('authenticating');
          void exchangeAndSchedule(cred);
          return;
        }
        setTimeout(() => void pollPairing(code), PAIR_POLL_INTERVAL_MS);
      } catch {
        // A 404 here means the code expired before anyone claimed it —
        // request a fresh one rather than polling a dead code forever.
        void startPairing();
      }
    }

    async function startPairing() {
      if (cancelledRef.current) return;
      setStatus('pairing');
      try {
        const pairing = await apiFetch<{ code: string; expiresAt: string }>('/v1/devices/pair', '', { method: 'POST' });
        if (cancelledRef.current) return;
        setPairingCode(pairing.code);
        void pollPairing(pairing.code);
      } catch {
        if (cancelledRef.current) return;
        setStatus('offline');
        setTimeout(() => void startPairing(), 15_000);
      }
    }

    const existing = loadCredential();
    if (existing === null) {
      void startPairing();
    } else {
      credentialRef.current = existing;
      setStatus('authenticating');
      void exchangeAndSchedule(existing);
    }

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Layer 1 of the schedule (FEATURE_ANALYSIS.md's "Two-layer
  // enforcement") — the Pi's own agent (layer 2) drives the actual
  // backlight; this drives what the page itself renders.
  useEffect(() => {
    if (bearerToken === null) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await apiFetch<{ device: Device; mode: ScheduleMode }>('/v1/devices/me', bearerToken!);
        if (cancelled) return;
        setDevice(res.device);
        setMode(res.mode);
      } catch {
        // Leave the last-known device/mode in place — a transient failure
        // here shouldn't flash the dashboard to a black screen.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), ME_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bearerToken]);

  const value: DeviceAuthValue = { status, pairingCode, bearerToken, device, mode, householdId };

  return <DeviceAuthContext.Provider value={value}>{children}</DeviceAuthContext.Provider>;
}

/** Throws outside a `DeviceAuthProvider` — used by `routes/Dashboard.tsx` itself, which is always inside one. */
export function useDeviceAuth(): DeviceAuthValue {
  const ctx = useContext(DeviceAuthContext);
  if (!ctx) throw new Error('useDeviceAuth must be used inside DeviceAuthProvider');
  return ctx;
}

/** Never throws — `null` outside a `DeviceAuthProvider`, which is every route except the dashboard. */
export function useOptionalDeviceAuth(): DeviceAuthValue | null {
  return useContext(DeviceAuthContext);
}
