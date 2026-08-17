import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.js';
import { HouseholdSwitcher } from './HouseholdSwitcher.js';
import { NewHouseholdButton } from './NewHouseholdButton.js';

interface MastheadProps {
  selectedHouseholdId: string | null;
  onSelectHousehold: (id: string) => void;
  children: ReactNode;
}

export function Masthead({ selectedHouseholdId, onSelectHousehold, children }: MastheadProps) {
  const { status, signOut } = useAuth();

  return (
    <>
      <header className="masthead">
        <Link to="/">household-manager</Link>
        {status === 'signed-in' && (
          <HouseholdSwitcher selectedId={selectedHouseholdId} onChange={onSelectHousehold} />
        )}
        {status === 'signed-in' && <NewHouseholdButton onCreated={onSelectHousehold} />}
        {status === 'signed-in' && selectedHouseholdId !== null && (
          <Link to={`/households/${selectedHouseholdId}/members`} className="masthead__link">
            Members
          </Link>
        )}
        <span className="masthead__spacer" />
        {status === 'signed-in' && (
          <button type="button" className="btn-small" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </header>
      {children}
    </>
  );
}
