import { notifiesByApp } from '@hhm/shared';
import type { Clock, NotificationChannel, Theme } from '@hhm/shared';
import { useState } from 'react';
import { analyticsBuiltIn, analyticsOptedOut, setAnalyticsOptOut } from '../analytics.js';
import { useMe, useUpdateClock, useUpdateNotifyVia, useUpdateProfileTheme } from '../api/queries.js';
import { useAuth } from '../auth/AuthProvider.js';
import { ThemeEditor } from '../components/ThemeEditor.js';
import { isAndroidApp } from '../native.js';
import { phoneNotificationsBuiltIn } from '../push.js';

/**
 * The signed-in user's own app-wide theme — every surface except the wall
 * dashboard, which reads its theme from its own device record instead (see
 * `DeviceRow`'s "Theme" tab in SettingsPage.tsx), because a kiosk has no
 * signed-in user to carry a theme for.
 */
function AppearanceSection({ theme }: { theme: Theme | null }) {
  const updateTheme = useUpdateProfileTheme();

  return (
    <>
      <h2>Appearance</h2>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Your own theme, wherever you sign in. A wall dashboard has its own theme instead, set under its "Theme" tab in household settings.
      </p>
      <ThemeEditor theme={theme} saving={updateTheme.isPending} onSave={(next) => updateTheme.mutate(next)} />
    </>
  );
}

function ClockSection({ clock }: { clock: Clock }) {
  const updateClock = useUpdateClock();

  return (
    <>
      <h2>Clock</h2>
      <select
        aria-label="Show times as"
        value={clock}
        disabled={updateClock.isPending}
        onChange={(e) => updateClock.mutate(e.target.value as Clock)}
      >
        <option value="12h">12 hour (5:30 PM)</option>
        <option value="24h">24 hour (17:30)</option>
      </select>
      {updateClock.isError && <p className="notice">{updateClock.error.message}</p>}
    </>
  );
}

const NOTIFY_OPTIONS: { value: NotificationChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'app', label: 'Android app' },
  { value: 'both', label: 'Email and Android app' },
  { value: 'none', label: "Don't send reminders" },
];

function phoneHint(via: NotificationChannel): string | null {
  if (!notifiesByApp(via)) return null;
  if (!isAndroidApp) return 'Phone notifications go to every phone where you sign in to the Android app.';
  if (!phoneNotificationsBuiltIn) return "This copy of the Android app was built without phone notifications, so it can't receive them yet.";
  return 'If Android asks, allow notifications so reminders reach this phone.';
}

function RemindersSection({ notifyVia }: { notifyVia: NotificationChannel }) {
  const updateNotifyVia = useUpdateNotifyVia();
  const hint = phoneHint(notifyVia);

  return (
    <>
      <h2>Task reminders</h2>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        How you hear about tasks that are due, in every household you're in.
      </p>
      <select
        aria-label="Send task reminders by"
        value={notifyVia}
        disabled={updateNotifyVia.isPending}
        onChange={(e) => updateNotifyVia.mutate(e.target.value as NotificationChannel)}
      >
        {NOTIFY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint !== null && (
        <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
          {hint}
        </p>
      )}
      {updateNotifyVia.isError && <p className="notice">{updateNotifyVia.error.message}</p>}
    </>
  );
}

function UsageStatsSection() {
  const [sharing, setSharing] = useState(() => !analyticsOptedOut());

  return (
    <>
      <h2>Usage stats</h2>
      <label className="usage-stats-toggle toggle-switch">
        <input
          type="checkbox"
          checked={sharing}
          onChange={(e) => {
            setSharing(e.target.checked);
            setAnalyticsOptOut(!e.target.checked);
          }}
        />
        <span className="toggle-switch__track">
          <span className="toggle-switch__thumb" />
        </span>
        Share anonymous usage stats from this {isAndroidApp ? 'phone' : 'browser'}
      </label>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Which screens get used and how often things like tasks get done. Never names, emails or what you write.
      </p>
    </>
  );
}

/** Settings that belong to the signed-in person, wherever they sign in and in every household. */
export function ProfilePage() {
  const { data: me } = useMe();
  const { signOut } = useAuth();

  if (me === undefined) return <p className="notice">Loading…</p>;

  return (
    <div className="page">
      <h1>Your profile</h1>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Signed in as {me.email}. These settings are yours alone and apply in every household.
      </p>

      <AppearanceSection theme={me.theme} />

      <ClockSection clock={me.clock} />

      <RemindersSection notifyVia={me.notifyVia} />

      {analyticsBuiltIn && <UsageStatsSection />}

      <h2>Account</h2>
      <button type="button" className="btn-secondary" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
