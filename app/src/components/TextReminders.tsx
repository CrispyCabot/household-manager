import { useState } from 'react';
import { useCancelTextCode, useRemoveTextPhone, useSendTextCode, useVerifyTextPhone } from '../api/queries.js';

function formatPhone(e164: string): string {
  const d = e164.slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function NumberForm({ label, onDone }: { label: string; onDone?: () => void }) {
  const [phone, setPhone] = useState('');
  const sendCode = useSendTextCode();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (phone.trim() !== '') sendCode.mutate(phone.trim(), { onSuccess: () => onDone?.() });
      }}
    >
      <label className="settings-field">
        <span className="settings-field__label">{label}</span>
        <input
          className="settings-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 555-5555"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <div className="settings-actions">
        <button type="submit" className="btn-primary" disabled={sendCode.isPending || phone.trim() === ''}>
          Text me a code
        </button>
        {onDone !== undefined && (
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      {sendCode.isError && <p className="notice">{sendCode.error.message}</p>}
    </form>
  );
}

function CodeForm({ phone }: { phone: string }) {
  const [code, setCode] = useState('');
  const verify = useVerifyTextPhone();
  const cancel = useCancelTextCode();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() !== '') verify.mutate(code.trim());
      }}
    >
      <label className="settings-field">
        <span className="settings-field__label">Code texted to {formatPhone(phone)}</span>
        <input
          className="settings-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <div className="settings-actions">
        <button type="submit" className="btn-primary" disabled={verify.isPending || code.trim() === ''}>
          Verify
        </button>
        <button type="button" className="btn-secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          Start over
        </button>
      </div>
      {verify.isError && <p className="notice">{verify.error.message}</p>}
    </form>
  );
}

/** Texts go out on top of whatever "Send reminders by" is set to. */
export function TextReminders({ textPhone, pendingTextPhone }: { textPhone: string | null; pendingTextPhone: string | null }) {
  const [changing, setChanging] = useState(false);
  const remove = useRemoveTextPhone();

  if (pendingTextPhone !== null) return <CodeForm phone={pendingTextPhone} />;

  if (textPhone === null) return <NumberForm label="Also text reminders to" />;

  if (changing) return <NumberForm label="New number for texts" onDone={() => setChanging(false)} />;

  return (
    <>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Reminders are also texted to {formatPhone(textPhone)}. Reply STOP to any text to stop them.
      </p>
      <div className="settings-actions">
        <button type="button" className="btn-secondary" onClick={() => setChanging(true)}>
          Change number
        </button>
        <button type="button" className="btn-secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
          Stop texting me
        </button>
      </div>
      {remove.isError && <p className="notice">{remove.error.message}</p>}
    </>
  );
}
