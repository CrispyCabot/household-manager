import { useEffect } from 'react';
import type { CustomDashboard } from '../index.js';
import './kitchen-wall.css';

/**
 * Kitchen Wall — "night forest". A dark sage forest floor with maroon light:
 * aurora glowing behind glass cards, fern silhouettes in the corners,
 * fireflies scattered through it all. Nothing loops on purpose — see the
 * performance note at the top of kitchen-wall.css. Pairs with the device's
 * "sage forest, maroon accents" theme (Settings → Devices → Theme).
 */

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&display=swap';

/** Seeded so the fireflies land in the same places on every render. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = seeded(7);
const FIREFLIES = Array.from({ length: 22 }, () => ({
  left: `${(rand() * 100).toFixed(1)}%`,
  top: `${(rand() * 100).toFixed(1)}%`,
  size: `${(2 + rand() * 3).toFixed(1)}px`,
  opacity: 0.25 + rand() * 0.65,
  tone: rand() < 0.7 ? 'sage' : 'gold',
}));

/** A fern frond, generated once: a curved stem with paired leaflets shrinking toward the tip. */
const FERN = (() => {
  const point = (t: number) => {
    // Quadratic Bézier from the base (100,400) through (40,210) to the tip (140,20).
    const x = (1 - t) ** 2 * 100 + 2 * (1 - t) * t * 40 + t ** 2 * 140;
    const y = (1 - t) ** 2 * 400 + 2 * (1 - t) * t * 210 + t ** 2 * 20;
    return { x, y };
  };
  const tangent = (t: number) => {
    const dx = 2 * (1 - t) * (40 - 100) + 2 * t * (140 - 40);
    const dy = 2 * (1 - t) * (210 - 400) + 2 * t * (20 - 210);
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  };
  const stem = 'M100 400 Q40 210 140 20';
  const leaves: string[] = [];
  for (let i = 1; i < 22; i++) {
    const t = i / 22;
    const p = point(t);
    const tan = tangent(t);
    const length = 78 * (1 - t) + 10;
    for (const side of [1, -1]) {
      // Leaflets sweep forward toward the tip, about 55° off the stem.
      const angle = side * 0.95;
      const dir = { x: tan.x * Math.cos(angle) - tan.y * Math.sin(angle), y: tan.x * Math.sin(angle) + tan.y * Math.cos(angle) };
      const perp = { x: -dir.y, y: dir.x };
      const tip = { x: p.x + dir.x * length, y: p.y + dir.y * length };
      const mid = { x: p.x + dir.x * length * 0.5, y: p.y + dir.y * length * 0.5 };
      const w = length * 0.2;
      const f = (n: number) => n.toFixed(1);
      leaves.push(
        `M${f(p.x)} ${f(p.y)}Q${f(mid.x + perp.x * w)} ${f(mid.y + perp.y * w)} ${f(tip.x)} ${f(tip.y)}` +
          `Q${f(mid.x - perp.x * w)} ${f(mid.y - perp.y * w)} ${f(p.x)} ${f(p.y)}Z`,
      );
    }
  }
  return { stem, leaves: leaves.join('') };
})();

function Fern({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 220 400" aria-hidden="true">
      <path d={FERN.stem} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d={FERN.leaves} fill="currentColor" />
    </svg>
  );
}

function Backdrop() {
  // The display font is only ever fetched on this device.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.append(link);
    return () => link.remove();
  }, []);

  return (
    <div className="kw-backdrop" aria-hidden="true">
      <div className="kw-aurora kw-aurora--sage" />
      <div className="kw-aurora kw-aurora--maroon" />
      <div className="kw-aurora kw-aurora--moss" />
      <Fern className="kw-fern kw-fern--left" />
      <Fern className="kw-fern kw-fern--right" />
      <Fern className="kw-fern kw-fern--top" />
      {FIREFLIES.map((fly, i) => (
        <span
          key={i}
          className={`kw-firefly kw-firefly--${fly.tone}`}
          style={{ left: fly.left, top: fly.top, width: fly.size, height: fly.size, opacity: fly.opacity }}
        />
      ))}
      <div className="kw-grain" />
      <div className="kw-vignette" />
    </div>
  );
}

const kitchenWall: CustomDashboard = { slug: 'kitchen-wall', Backdrop };
export default kitchenWall;
