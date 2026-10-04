/**
 * Shared loading indicators for every board type, so each board's page and
 * card show the same thing while its data loads instead of bare "Loading…"
 * text (or, for cards, nothing — which read as an empty board).
 */

/** A spinner with a label, for a board's full page. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Shimmering placeholder lines, for a card's preview area or a list that is still loading. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        // Staggered widths so it reads as text, not a loading bar.
        <span key={i} className="skeleton" style={{ width: `${[85, 65, 75][i % 3]}%` }} />
      ))}
    </div>
  );
}
