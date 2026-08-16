import { useEffect, useState } from 'react';
import { useMe, useHouseholds, useSetLastHousehold } from '../api/queries.js';

interface HouseholdSwitcherProps {
  selectedId: string | null;
  onChange: (householdId: string) => void;
}

/**
 * Defaults to `lastHouseholdId` from the profile, then writes back on
 * change (spec §10). The parent owns `selectedId` so a page reload or a
 * direct link can override the default without this component knowing why.
 */
export function HouseholdSwitcher({ selectedId, onChange }: HouseholdSwitcherProps) {
  const { data: me } = useMe();
  const { data: householdsData, isLoading } = useHouseholds();
  const setLastHousehold = useSetLastHousehold();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || me === undefined) return;
    const fallback = me.lastHouseholdId ?? me.households[0]?.id ?? null;
    if (fallback !== null) {
      onChange(fallback);
      setInitialized(true);
    }
  }, [initialized, me, onChange]);

  if (isLoading) return null;

  const households = householdsData?.households ?? [];
  if (households.length === 0) return null;

  return (
    <select
      className="household-switcher"
      value={selectedId ?? ''}
      onChange={(e) => {
        const id = e.target.value;
        onChange(id);
        setLastHousehold.mutate(id);
      }}
    >
      {households.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );
}
