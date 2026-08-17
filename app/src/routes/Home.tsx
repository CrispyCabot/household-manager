import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState } from 'react';
import { Link } from 'react-router';
import { boardTypeUi } from '../boards/registry.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useBoards, useCreateHousehold, useHouseholds, useReorderBoards } from '../api/queries.js';
import { AlertBanner } from '../components/AlertBanner.js';
import { AddBoardButton } from '../components/AddBoardButton.js';
import { SortableBoardCard } from '../components/SortableBoardCard.js';

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

function BoardGrid({ householdId, reorderMode }: { householdId: string; reorderMode: boolean }) {
  const { data, isLoading } = useBoards(householdId);
  const reorderBoards = useReorderBoards(householdId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const ids = boards.map((b) => b.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    reorderBoards.mutate(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={boards.map((b) => b.id)} strategy={rectSortingStrategy}>
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
            return (
              <SortableBoardCard key={board.id} board={board} reorderMode={reorderMode}>
                <ui.Card board={board} />
              </SortableBoardCard>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function Home({ selectedHouseholdId }: { selectedHouseholdId: string | null }) {
  const { status, signIn } = useAuth();
  const { data: householdsData, isLoading: householdsLoading } = useHouseholds();
  const { data: boardsData } = useBoards(selectedHouseholdId);
  const [reorderMode, setReorderMode] = useState(false);

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

  if (householdsLoading) return <p className="notice">Loading…</p>;

  const households = householdsData?.households ?? [];

  if (households.length === 0) {
    return (
      <div className="page">
        <CreateHouseholdForm />
      </div>
    );
  }

  const boardCount = boardsData?.boards.length ?? 0;

  return (
    <div className="page">
      {selectedHouseholdId !== null ? (
        <>
          <AlertBanner householdId={selectedHouseholdId} />
          <div className="board-toolbar">
            <Link
              to={`/households/${selectedHouseholdId}/settings`}
              className="masthead__iconbtn"
              title="Household settings"
              aria-label="Household settings"
            >
              ⚙
            </Link>
            {boardCount > 1 && (
              <button type="button" className="btn-secondary" onClick={() => setReorderMode((m) => !m)}>
                {reorderMode ? 'Done' : 'Reorder'}
              </button>
            )}
          </div>
          <BoardGrid householdId={selectedHouseholdId} reorderMode={reorderMode} />
          {!reorderMode && <AddBoardButton householdId={selectedHouseholdId} />}
        </>
      ) : (
        <p className="notice">Loading…</p>
      )}
    </div>
  );
}
