import { useState } from 'react';
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

/**
 * The switcher, "+ new household", members link, and sign-out all live in
 * one collapsible group. Below the `min-width: 600px` breakpoint (see
 * styles.css) it renders as a hamburger-triggered dropdown instead of an
 * inline row — a select plus several buttons never fit a phone's width
 * alongside the brand link, and letting them overflow is what was causing
 * horizontal scroll on mobile.
 */
export function Masthead({ selectedHouseholdId, onSelectHousehold, children }: MastheadProps) {
  const { status, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header className="masthead">
        <Link to="/" onClick={closeMenu}>household-manager</Link>
        <span className="masthead__spacer" />
        {status === 'signed-in' && (
          <button
            type="button"
            className="masthead__toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        )}
        {status === 'signed-in' && (
          <div className={menuOpen ? 'masthead__menu masthead__menu--open' : 'masthead__menu'}>
            <HouseholdSwitcher
              selectedId={selectedHouseholdId}
              onChange={(id) => {
                onSelectHousehold(id);
                closeMenu();
              }}
            />
            <NewHouseholdButton
              onCreated={(id) => {
                onSelectHousehold(id);
                closeMenu();
              }}
            />
            {selectedHouseholdId !== null && (
              <Link to={`/households/${selectedHouseholdId}/members`} className="masthead__link" onClick={closeMenu}>
                Members
              </Link>
            )}
            <button type="button" className="btn-small" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {menuOpen && <div className="masthead__scrim" onClick={closeMenu} />}
      {children}
    </>
  );
}
