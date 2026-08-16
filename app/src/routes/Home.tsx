import { useState } from 'react';
import { boardTypeUi } from '../boards/registry.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useBoards, useCreateHousehold, useHouseholds, useMe } from '../api/queries.js';

function CreateHouseholdForm() {
  const [name, setName] = useState('');
  const createHousehold = useCreateHousehold();

  return (
    <form
      className="create-household"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() === '') return;
        createHousehold.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
      }}
    >
      <h1>Start a household</h1>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Bridewells" />
      <button type="submit" className="btn-primary" disabled={createHousehold.isPending}>
        Create
      </button>
    </form>
  );
}

function BoardGrid({ householdId }: { householdId: string }) {
  const { data, isLoading } = useBoards(householdId);

  if (isLoading) return <p className="notice">Loading…</p>;

  const boards = data?.boards ?? [];

  if (boards.length === 0) {
    return (
      <div className="empty">
        No boards yet. Board types register themselves — none are available
        until a feature (like Tasks) adds one.
      </div>
    );
  }

  return (
    <div className="cardgrid">
      {boards.map((board) => {
        const ui = boardTypeUi(board.type);
        // A board can exist whose type module never loaded client-side —
        // stale data, or a type removed after boards using it were created.
        // Rendering nothing here would look like a bug; naming it does not.
        if (ui === undefined) {
          return (
            <div key={board.id} className="card card--unknown">
              {board.title} — unknown board type "{board.type}"
            </div>
          );
        }
        return <ui.Card key={board.id} board={board} />;
      })}
    </div>
  );
}

export function Home() {
  const { status, signIn } = useAuth();
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const { data: me } = useMe();
  const { data: householdsData, isLoading: householdsLoading } = useHouseholds();

  if (status === 'loading') return <p className="notice">Loading…</p>;

  if (status === 'signed-out') {
    return (
      <div className="page gate">
        <h1>Household management, shared.</h1>
        <button type="button" className="btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
      </div>
    );
  }

  if (householdsLoading || me === undefined) return <p className="notice">Loading…</p>;

  const households = householdsData?.households ?? [];
  const activeId = selectedHouseholdId ?? me.lastHouseholdId ?? households[0]?.id ?? null;

  if (households.length === 0) {
    return (
      <div className="page">
        <CreateHouseholdForm />
      </div>
    );
  }

  return (
    <div className="page">
      {activeId !== null && <BoardGrid householdId={activeId} />}
      {selectedHouseholdId === null && activeId !== null && (
        // Keeps the masthead's switcher in sync on first render, without a
        // second effect duplicating HouseholdSwitcher's own default logic.
        <span style={{ display: 'none' }} ref={() => setSelectedHouseholdId(activeId)} />
      )}
    </div>
  );
}
