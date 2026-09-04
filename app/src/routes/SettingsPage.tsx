import type { Board, Device, Household, Theme } from '@hhm/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  useBoards,
  useClaimDevice,
  useCreateInvite,
  useDeleteDevice,
  useDeleteHousehold,
  useDevices,
  useHouseholds,
  useInvites,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateDevice,
  useUpdateHousehold,
  useUpdateProfileTheme,
} from '../api/queries.js';
import { DashboardLayoutEditor } from '../components/DashboardLayoutEditor.js';
import { DeviceScheduleEditor } from '../components/DeviceScheduleEditor.js';
import { ThemeEditor } from '../components/ThemeEditor.js';

function InviteForm({ householdId }: { householdId: string }) {
  const [email, setEmail] = useState('');
  const createInvite = useCreateInvite(householdId);

  return (
    <form
      className="invite-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() === '') return;
        createInvite.mutate({ email: email.trim() }, { onSuccess: () => setEmail('') });
      }}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Invite by email"
        required
      />
      <button type="submit" className="btn-primary" disabled={createInvite.isPending}>
        Invite
      </button>
      {createInvite.isError && <p className="notice">{createInvite.error.message}</p>}
    </form>
  );
}

function RenameForm({ household }: { household: Household }) {
  const [name, setName] = useState(household.name);
  const updateHousehold = useUpdateHousehold(household.id);

  return (
    <form
      className="invite-form"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed === '' || trimmed === household.name) return;
        updateHousehold.mutate({ name: trimmed, version: household.version });
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <button type="submit" className="btn-primary" disabled={updateHousehold.isPending}>
        Save name
      </button>
      {updateHousehold.isError && <p className="notice">{updateHousehold.error.message}</p>}
    </form>
  );
}

/**
 * The signed-in user's own app-wide theme — every surface except the wall
 * dashboard, which reads its theme from its own device record instead (see
 * `DeviceRow`'s "Theme" tab below), because a kiosk has no signed-in user to
 * carry a theme for.
 */
function AppearanceSection({ theme }: { theme: Theme | null }) {
  const updateTheme = useUpdateProfileTheme();

  return (
    <>
      <h2>Appearance</h2>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Your own theme, wherever you sign in. A wall dashboard has its own theme instead — set that under its "Theme" tab below.
      </p>
      <ThemeEditor theme={theme} saving={updateTheme.isPending} onSave={(next) => updateTheme.mutate(next)} />
    </>
  );
}

function DeleteHouseholdSection({ household }: { household: Household }) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteHousehold = useDeleteHousehold();

  return (
    <>
      <button type="button" className="btn-danger" onClick={() => setConfirmOpen(true)}>
        Delete household
      </button>
      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete "{household.name}"?</h2>
            <p className="notice">This permanently deletes every board, task, and member. This cannot be undone.</p>
            <div className="form-actions">
              <button
                type="button"
                className="btn-danger"
                disabled={deleteHousehold.isPending}
                onClick={() =>
                  deleteHousehold.mutate(household.id, { onSuccess: () => void navigate('/') })
                }
              >
                Delete household
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ClaimDeviceForm({ householdId }: { householdId: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const claim = useClaimDevice(householdId);

  return (
    <form
      className="invite-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() === '' || name.trim() === '') return;
        claim.mutate(
          { code: code.trim().toUpperCase(), name: name.trim() },
          { onSuccess: () => { setCode(''); setName(''); } },
        );
      }}
    >
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pairing code" maxLength={16} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Kitchen wall" maxLength={120} />
      <button type="submit" className="btn-primary" disabled={claim.isPending}>
        Pair
      </button>
      {claim.isError && <p className="notice">{claim.error.message}</p>}
    </form>
  );
}

function DeviceRow({ householdId, device, boards }: { householdId: string; device: Device; boards: Board[] }) {
  const [expanded, setExpanded] = useState<'none' | 'schedule' | 'layout' | 'theme'>('none');
  const updateDevice = useUpdateDevice(householdId);
  const deleteDevice = useDeleteDevice(householdId);

  return (
    <div className="device-row">
      <div className="task-row">
        <div>
          <strong>{device.name}</strong>
          <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
            {device.lastSeenAt === null ? 'Never connected' : `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`}
          </p>
          <label className="device-row__screensaver toggle-switch">
            <input
              type="checkbox"
              checked={device.screensaverEnabled}
              disabled={updateDevice.isPending}
              onChange={(e) => updateDevice.mutate({ deviceId: device.id, screensaverEnabled: e.target.checked })}
            />
            <span className="toggle-switch__track">
              <span className="toggle-switch__thumb" />
            </span>
            Screensaver when awake
          </label>
        </div>
        <div className="task-row__actions">
          <button
            type="button"
            className="btn-small"
            onClick={() => setExpanded((v) => (v === 'schedule' ? 'none' : 'schedule'))}
          >
            {expanded === 'schedule' ? 'Hide schedule' : 'Schedule'}
          </button>
          <button
            type="button"
            className="btn-small"
            onClick={() => setExpanded((v) => (v === 'layout' ? 'none' : 'layout'))}
          >
            {expanded === 'layout' ? 'Hide layout' : 'Layout'}
          </button>
          <button
            type="button"
            className="btn-small"
            onClick={() => setExpanded((v) => (v === 'theme' ? 'none' : 'theme'))}
          >
            {expanded === 'theme' ? 'Hide theme' : 'Theme'}
          </button>
          <button
            type="button"
            className="btn-small"
            disabled={deleteDevice.isPending}
            onClick={() => deleteDevice.mutate(device.id)}
          >
            Revoke
          </button>
        </div>
      </div>
      {expanded === 'schedule' && (
        <DeviceScheduleEditor
          schedule={device.schedule}
          saving={updateDevice.isPending}
          onSave={(schedule) => updateDevice.mutate({ deviceId: device.id, schedule })}
        />
      )}
      {expanded === 'layout' && (
        <DashboardLayoutEditor
          device={device}
          boards={boards}
          saving={updateDevice.isPending}
          onSave={(layout) => updateDevice.mutate({ deviceId: device.id, layout })}
        />
      )}
      {expanded === 'theme' && (
        <ThemeEditor
          theme={device.theme}
          saving={updateDevice.isPending}
          onSave={(theme) => updateDevice.mutate({ deviceId: device.id, theme })}
        />
      )}
    </div>
  );
}

function DevicesSection({ householdId }: { householdId: string }) {
  const { data, isLoading } = useDevices(householdId);
  const { data: boardsData } = useBoards(householdId);
  const boards = boardsData?.boards ?? [];
  const devices = data?.devices ?? [];

  return (
    <>
      <h2>Devices</h2>
      <p className="notice" style={{ padding: 0, textAlign: 'left' }}>
        Pair a wall-mounted screen by opening household-manager on it, then entering the code it shows here.
      </p>
      <ClaimDeviceForm householdId={householdId} />
      {!isLoading && devices.length > 0 && (
        <div className="task-list">
          {devices.map((device) => (
            <DeviceRow key={device.id} householdId={householdId} device={device} boards={boards} />
          ))}
        </div>
      )}
    </>
  );
}

export function SettingsPage() {
  const { householdId } = useParams<{ householdId: string }>();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: householdsData } = useHouseholds();
  const { data: membersData, isLoading: membersLoading } = useMembers(householdId ?? '');
  const { data: invitesData, isLoading: invitesLoading } = useInvites(householdId ?? '');
  const removeMember = useRemoveMember(householdId ?? '');
  const revokeInvite = useRevokeInvite(householdId ?? '');

  if (householdId === undefined) return <p className="notice">Household not found.</p>;

  const household = householdsData?.households.find((h) => h.id === householdId);
  const members = membersData?.members ?? [];
  const invites = invitesData?.invites ?? [];
  const isOwner = household !== undefined && me !== undefined && household.createdBy === me.sub;

  return (
    <div className="page">
      <h1>{household?.name ?? 'Household'} settings</h1>

      <AppearanceSection theme={me?.theme ?? null} />

      {household !== undefined && (
        <>
          <h2>Rename</h2>
          <RenameForm household={household} />
        </>
      )}

      <h2>Members</h2>
      <InviteForm householdId={householdId} />

      {membersLoading ? (
        <p className="notice">Loading…</p>
      ) : (
        <div className="task-list">
          {members.map((member) => {
            const isCreator = household !== undefined && household.createdBy === member.sub;
            const isSelf = me !== undefined && me.sub === member.sub;
            return (
              <div key={member.sub} className="task-row">
                <div>
                  <strong>{member.email}</strong>
                  {isSelf && ' (you)'}
                  {isCreator && ' — creator'}
                </div>
                {!isCreator && (
                  <div className="task-row__actions">
                    <button
                      type="button"
                      className="btn-small"
                      disabled={removeMember.isPending}
                      onClick={() =>
                        removeMember.mutate(member.sub, {
                          // Leaving revokes access to this page's own data —
                          // staying here would just show a confusing 403.
                          onSuccess: () => {
                            if (isSelf) void navigate('/');
                          },
                        })
                      }
                    >
                      {isSelf ? 'Leave' : 'Remove'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!invitesLoading && invites.length > 0 && (
        <>
          <h2>Pending invites</h2>
          <div className="task-list">
            {invites.map((invite) => (
              <div key={invite.email} className="task-row">
                <span>{invite.email}</span>
                <div className="task-row__actions">
                  <button
                    type="button"
                    className="btn-small"
                    disabled={revokeInvite.isPending}
                    onClick={() => revokeInvite.mutate(invite.email)}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <DevicesSection householdId={householdId} />

      {isOwner && household !== undefined && (
        <>
          <h2>Danger zone</h2>
          <DeleteHouseholdSection household={household} />
        </>
      )}
    </div>
  );
}
