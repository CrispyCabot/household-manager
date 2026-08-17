import { useState } from 'react';
import { useCreateHousehold, useHouseholds, useSetLastHousehold } from '../api/queries.js';

/**
 * Lets someone start another household without losing the one they're on —
 * the switcher only ever shows a "new household" affordance implicitly (via
 * the empty-state form in Home), so this is the explicit version, reachable
 * from anywhere a household is already selected.
 */
export function NewHouseholdButton({ onCreated }: { onCreated: (householdId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { data } = useHouseholds();
  const createHousehold = useCreateHousehold();
  const setLastHousehold = useSetLastHousehold();

  // Home's own empty-state form already covers "no household yet" — this
  // button is only for adding another one alongside an existing household.
  if ((data?.households.length ?? 0) === 0) return null;

  return (
    <>
      <button
        type="button"
        className="masthead__iconbtn"
        title="New household"
        aria-label="New household"
        onClick={() => setOpen(true)}
      >
        +
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Start a new household</h2>
            <form
              className="create-household"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() === '') return;
                createHousehold.mutate(
                  { name: name.trim() },
                  {
                    onSuccess: ({ household }) => {
                      setName('');
                      setOpen(false);
                      onCreated(household.id);
                      setLastHousehold.mutate(household.id);
                    },
                  },
                );
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Bridewells" autoFocus />
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={createHousehold.isPending}>
                  Create
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
