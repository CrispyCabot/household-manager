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
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { boardTypeUi } from '../boards/registry.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useBoards, useCreateHousehold, useHouseholds, useNotifyHouseholdNow, useReorderBoards } from '../api/queries.js';
import { AlertBanner } from '../components/AlertBanner.js';
import { AddBoardButton } from '../components/AddBoardButton.js';
import { BoardMenu } from '../components/BoardMenu.js';
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

/** Split from its result text (rendered separately, below the whole header row) because the button lives inline among icon-sized actions while the result is a full-width notice. */
function useNotifyNow(householdId: string) {
  const notify = useNotifyHouseholdNow(householdId);
  const [result, setResult] = useState<string | null>(null);

  const trigger = () =>
    notify.mutate(undefined, {
      onSuccess: ({ tasksNotified, delivered }) => {
        if (tasksNotified === 0) setResult('Nothing due right now.');
        else if (delivered) setResult(`Sent for ${tasksNotified} task${tasksNotified === 1 ? '' : 's'}.`);
        else setResult('Tried to send, but delivery failed — check back later.');
      },
      onError: () => setResult("Couldn't trigger notifications — try again later."),
    });

  return { trigger, isPending: notify.isPending, result };
}

function HouseholdHeader({
  householdId,
  name,
  boardCount,
  reorderMode,
  setReorderMode,
}: {
  householdId: string;
  name: string;
  boardCount: number;
  reorderMode: boolean;
  setReorderMode: (updater: (m: boolean) => boolean) => void;
}) {
  const { trigger, isPending, result } = useNotifyNow(householdId);

  return (
    <>
      <div className="household-header">
        <h1>{name}</h1>
        <div className="household-header__actions">
          <Link
            to={`/households/${householdId}/settings`}
            className="masthead__iconbtn household-header__settings"
            title="Household settings"
            aria-label="Household settings"
          >
            <Settings size={18} />
          </Link>
          <button type="button" className="btn-secondary" onClick={trigger} disabled={isPending}>
            Notify now
          </button>
          {boardCount > 1 && (
            <button type="button" className="btn-secondary" onClick={() => setReorderMode((m) => !m)}>
              {reorderMode ? 'Done' : 'Reorder'}
            </button>
          )}
        </div>
      </div>
      {result !== null && <p className="notice">{result}</p>}
    </>
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
                {/* Only shown outside reorder mode — it would otherwise sit in
                    the same top-right corner as SortableBoardCard's own drag
                    handle. */}
                {!reorderMode && <BoardMenu householdId={householdId} board={board} />}
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
        <p className="gate__lede">
          household-manager is a shared home base for the people in a household — tasks that repeat and
          remind you, a shopping or checklist board, shared notes, quick links, and a family calendar, all
          in one place everyone in the household can see and edit.
        </p>
        <ul className="gate__features">
          <li><strong>Tasks</strong> — recurring chores and reminders, emailed to whoever's on the household.</li>
          <li><strong>Checklists</strong> — a shared shopping list or to-do, checked off from any device.</li>
          <li><strong>Notes &amp; links</strong> — the household's own reference pages and bookmarks.</li>
          <li><strong>Calendar</strong> — connect a Google Calendar to see it alongside everything else, and optionally sync tasks onto it.</li>
          <li><strong>A wall display</strong> — pair a spare screen to show the household's boards, always on, no sign-in required on the device itself.</li>
        </ul>
        <button type="button" className="btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
        <p className="gate__footer">
          <Link to="/privacy">Privacy policy</Link>
        </p>
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
  const selectedHousehold = households.find((h) => h.id === selectedHouseholdId);

  return (
    <div className="page">
      {selectedHouseholdId !== null ? (
        <>
          <AlertBanner householdId={selectedHouseholdId} />
          <HouseholdHeader
            householdId={selectedHouseholdId}
            name={selectedHousehold?.name ?? 'Household'}
            boardCount={boardCount}
            reorderMode={reorderMode}
            setReorderMode={setReorderMode}
          />
          <BoardGrid householdId={selectedHouseholdId} reorderMode={reorderMode} />
          {!reorderMode && <AddBoardButton householdId={selectedHouseholdId} />}
        </>
      ) : (
        <p className="notice">Loading…</p>
      )}
    </div>
  );
}
