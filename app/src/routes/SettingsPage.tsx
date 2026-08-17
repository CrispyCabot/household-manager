import type { Household } from '@hhm/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  useCreateInvite,
  useDeleteHousehold,
  useHouseholds,
  useInvites,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateHousehold,
} from '../api/queries.js';

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

      {isOwner && household !== undefined && (
        <>
          <h2>Danger zone</h2>
          <DeleteHouseholdSection household={household} />
        </>
      )}
    </div>
  );
}
