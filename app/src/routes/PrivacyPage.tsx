import { Link } from 'react-router';

/**
 * A personal/family project's privacy policy, not a company's — written in
 * plain language about what this specific app actually does, since that's
 * both more honest and (per Google's OAuth consent screen requirements)
 * what's actually being asked for: real detail on data collection and use,
 * not boilerplate.
 */
export function PrivacyPage() {
  return (
    <div className="page privacy-page">
      <p className="back-link-row" style={{ padding: 0, marginBottom: 16 }}>
        <Link to="/" className="back-link">
          ← household-manager
        </Link>
      </p>
      <h1>Privacy policy</h1>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Last updated September 3, 2026.
      </p>

      <h2>What this is</h2>
      <p>
        household-manager is a small, self-hosted household organizer — tasks, checklists, notes, links,
        and a shared calendar for the people in one household. It isn't a company or a commercial product;
        it's a personal project, and this page explains exactly what it does with your data.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> When you sign in, we store your email address and the household(s)
          you belong to.
        </li>
        <li>
          <strong>What you put in a household.</strong> Board content you or another member creates — task
          titles and due dates, checklist items, notes, links — is stored so the household can see and edit
          it.
        </li>
        <li>
          <strong>Invites.</strong> If you invite someone, we store the email address you invited until they
          join or the invite is revoked.
        </li>
        <li>
          <strong>Google Calendar, if you connect it.</strong> Connecting a Google account gives the
          household access to read (and, if you turn on task syncing, write) events on the calendars you
          choose. We store an OAuth refresh token for that connection — encrypted at rest, accessible only
          to this app's own backend, never to other members directly, and never shared with anyone else.
          Calendar events themselves are fetched live and shown in the app; we don't keep a separate copy of
          your calendar's contents.
        </li>
        <li>
          <strong>A paired wall display, if you set one up.</strong> A device you pair gets its own
          credential, unrelated to your Google or sign-in credentials, scoped to read the household's boards
          and complete/check off items — nothing more.
        </li>
      </ul>

      <h2>What we don't do</h2>
      <p>
        No advertising, no analytics, no third-party trackers of any kind — there is nothing else running on
        this site besides the app itself. Your data is not sold, rented, or shared with anyone outside your
        own household, and nothing you create is used to train any model.
      </p>

      <h2>Google user data specifically</h2>
      <p>
        household-manager's use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Calendar data is used only to display it inside your
        household's boards and, if you opt a task board into syncing, to create or update events that mirror
        your tasks — nothing else, by this app or anyone else.
      </p>

      <h2>How to disconnect or delete your data</h2>
      <ul>
        <li>
          Disconnect Google Calendar any time from a calendar board's settings — this deletes the stored
          refresh token immediately.
        </li>
        <li>
          You can also revoke access directly from your Google Account at{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </li>
        <li>Revoke a paired display any time from Settings → Devices.</li>
        <li>To delete your account or a household's data entirely, contact us below.</li>
      </ul>

      <h2>Where data lives</h2>
      <p>
        Everything is stored on Amazon Web Services (DynamoDB and Secrets Manager) in the United States, and
        is only ever accessed by this app's own backend to serve requests from signed-in members of your
        household.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or a request to delete your data:{' '}
        <a href="mailto:cbridewell5@gmail.com">cbridewell5@gmail.com</a>.
      </p>
    </div>
  );
}
