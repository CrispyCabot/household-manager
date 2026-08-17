import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  useCreateInvite,
  useHouseholds,
  useInvites,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
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

export function MembersPage() {
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

  return (
    <div className="page">
      <h1>{household?.name ?? 'Household'} members</h1>

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
    </div>
  );
}
