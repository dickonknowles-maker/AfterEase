'use strict';

// Built-in curves: linear, and a slow start, a slow end and both, at three
// strengths. They are named by what they do rather than "ease in" and "ease
// out", which mean opposite things in AE (Easy Ease In slows into a key) and
// in most curve tools (ease-in starts slowly). Strength is how long the slow
// part lasts, as an influence (AE's Easy Ease is 33%).

const STRENGTHS = [['Gentle', 0.33], ['Medium', 0.6], ['Strong', 0.85]];

// Time-reversed: a slow start becomes a slow end.
function reverse(c) {
  return { x1: 1 - c.x2, y1: 1 - c.y2, x2: 1 - c.x1, y2: 1 - c.y1 };
}

// Starts at rest and ends at speed 1 + i (of the segment's average), with a
// short end handle (influence 1/6, like a Linear key in AE).
function slowStart(i) {
  const h = 1 / 6;
  return { x1: i, y1: 0, x2: 1 - h, y2: 1 - (1 + i) * h };
}

const lower = s => s.toLowerCase();

const BUILT_IN = [
  { id: 'linear', name: 'Linear', group: 'Linear', hint: 'Linear: constant speed', curve: { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 } },
  ...STRENGTHS.map(([s, i]) => ({ id: `start-${lower(s)}`, name: s, group: 'Slow start', hint: `Slow start, ${lower(s)}: speeds up from rest`, curve: slowStart(i) })),
  ...STRENGTHS.map(([s, i]) => ({ id: `end-${lower(s)}`, name: s, group: 'Slow end', hint: `Slow end, ${lower(s)}: slows down to rest`, curve: reverse(slowStart(i)) })),
  ...STRENGTHS.map(([s, i]) => ({ id: `both-${lower(s)}`, name: s, group: 'Slow both ends', hint: `Slow both ends, ${lower(s)}: like Easy Ease`, curve: { x1: i, y1: 0, x2: 1 - i, y2: 1 } })),
];

function isCurve(c) {
  return !!c && ['x1', 'y1', 'x2', 'y2'].every(k => typeof c[k] === 'number' && Number.isFinite(c[k])) &&
    c.x1 > 0 && c.x1 <= 1 && c.x2 >= 0 && c.x2 < 1;
}

module.exports = { BUILT_IN, reverse, isCurve };
