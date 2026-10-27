'use strict';

// "Apply this curve to the selected keys": turns what the host's
// readSelection returned into the plan its writeKeys takes, and checks what
// AE stored against that plan. Pure functions, no host calls.
//
// Which sides get written: a run of selected keys writes every pair in the
// run. A selected key with no selected neighbour writes its own sides of the
// segments either side of it. scope 'in' or 'out' keeps only those sides.

const aeEase = require('./aeEase');
const segment = require('./segment');

const KINDS = {
  OneD: '1d',
  TwoD: 'multi',
  ThreeD: 'multi',
  TwoD_SPATIAL: 'spatial',
  ThreeD_SPATIAL: 'spatial',
  COLOR: 'colour',
};

// Plain-English names for value types that can't be eased.
const TYPE_NAMES = {
  SHAPE: 'Paths',
  TEXT_DOCUMENT: 'Source Text',
  MARKER: 'Markers',
  CUSTOM_VALUE: 'This property',
  LAYER_INDEX: 'Layer pickers',
  MASK_INDEX: 'Mask pickers',
  NO_VALUE: 'This property',
};

function kindOf(valueType) {
  return KINDS[valueType] || null;
}

// Map from segment index s (key s to key s + 1, 0-based) to the sides to
// write: out is key s's out ease, in is key s + 1's in ease.
function targetSegments(keys, scope = 'both') {
  const selected = i => i >= 0 && i < keys.length && !!keys[i].selected;
  const targets = new Map();
  const add = (s, side) => {
    if (s < 0 || s >= keys.length - 1) return;
    if (scope !== 'both' && scope !== side) return;
    const t = targets.get(s) || { out: false, in: false };
    t[side] = true;
    targets.set(s, t);
  };
  for (let i = 0; i < keys.length; i++) {
    if (!selected(i)) continue;
    if (selected(i + 1)) {
      add(i, 'out');
      add(i, 'in');
    } else if (!selected(i - 1)) {
      add(i - 1, 'in');
      add(i, 'out');
    }
  }
  return new Map([...targets].sort((p, q) => p[0] - q[0]));
}

const copyEase = e => ({ speed: e.speed, influence: e.influence });

// Every ease written must be one AE accepts. Untouched sides are written
// back as read, and a Bezier side AE reset to influence 0 comes back as 0.1,
// a handle a thousandth of the segment long.
function settable(e) {
  return { speed: e.speed, influence: Math.min(aeEase.MAX_INFLUENCE, Math.max(aeEase.MIN_INFLUENCE, e.influence)) };
}

function sameSpeeds(inEase, outEase) {
  return inEase.every((e, d) => Math.abs(e.speed - outEase[d].speed) <= 1e-9 * Math.max(1, Math.abs(e.speed)));
}

function planProperty(prop, curve, scope, notices) {
  const label = `${prop.layerName}: ${prop.name}`;
  const kind = kindOf(prop.valueType);
  if (!kind || !prop.keys) {
    notices.push(`${label}: ${TYPE_NAMES[prop.valueType] || 'This property'} can't be eased, so it was left as is.`);
    return null;
  }
  const keys = prop.keys;
  const work = keys.map(k => ({ inEase: k.inEase.map(copyEase), outEase: k.outEase.map(copyEase), inWritten: false, outWritten: false }));
  const flags = new Set();
  const segments = [];

  for (const [s, sides] of targetSegments(keys, scope)) {
    const a = keys[s];
    const b = keys[s + 1];
    if (a.outType === 'HOLD') {
      flags.add('hold');
      continue;
    }
    if (a.roving || b.roving) {
      flags.add('roving');
      continue;
    }
    const dt = b.time - a.time;
    segment.change(kind, a, b).forEach((dv, d) => {
      const e = aeEase.curveToEases(curve, dt, dv);
      if (e.clamped) flags.add('clamped');
      // Spatial and colour speeds are magnitudes along the path: no overshoot.
      if (kind === 'spatial' || kind === 'colour') {
        for (const side of [e.out, e.in]) {
          if (side.speed < 0) {
            side.speed = 0;
            flags.add('overshoot');
          }
        }
      }
      if (sides.out) work[s].outEase[d] = e.out;
      if (sides.in) work[s + 1].inEase[d] = e.in;
    });
    if (sides.out) work[s].outWritten = true;
    if (sides.in) work[s + 1].inWritten = true;
    segments.push({ index: s, tA: a.time, tB: b.time, sides: { out: sides.out, in: sides.in } });
  }

  if (flags.has('hold')) notices.push(`${label}: held segments were left as is.`);
  if (flags.has('roving')) notices.push(`${label}: segments next to roving keys were left as is.`);
  if (flags.has('clamped')) notices.push(`${label}: AE allows influences from 0.1% to 100%, so the curve was clamped to fit.`);
  if (flags.has('overshoot')) notices.push(`${label}: ${kind === 'colour' ? 'colours' : 'paths'} can't overshoot, so the curve was clipped at its ends.`);
  if (!segments.length) return null;
  if (prop.expression) notices.push(`${label}: has an expression, which may change what plays.`);

  const writes = [];
  keys.forEach((k, i) => {
    const w = work[i];
    if (!w.inWritten && !w.outWritten) return;
    const inEase = w.inEase.map(settable);
    const outEase = w.outEase.map(settable);
    writes.push({
      index: i + 1,
      time: k.time,
      inType: w.inWritten ? 'BEZIER' : k.inType,
      outType: w.outWritten ? 'BEZIER' : k.outType,
      inEase,
      outEase,
      // AE forces matching speeds on continuous keys, and recalculates eases
      // on auto-bezier ones.
      temporalContinuous: !!k.temporalContinuous && sameSpeeds(inEase, outEase),
      temporalAutoBezier: false,
    });
  });
  return { ref: prop.ref, label, kind, keys: writes, segments };
}

// selection: readSelection's result. curve: { x1, y1, x2, y2 }.
// Returns { undoName, writes, notices }: writes go to writeKeys as they are;
// each also carries its kind and the segments written, for checking.
function planApply(selection, curve, { scope = 'both', undoName = 'AfterEase: apply curve' } = {}) {
  const notices = [];
  const writes = [];
  if (!selection || !selection.comp) {
    notices.push('Open a composition and select some keys first.');
    return { undoName, writes, notices };
  }
  for (const prop of selection.properties) {
    const w = planProperty(prop, curve, scope, notices);
    if (w) writes.push(w);
  }
  if (!writes.length && !notices.length) notices.push('Select at least one key first.');
  return { undoName, writes, notices };
}

// Compares what writeKeys reports AE stored with the plan. Returns notices
// for anything AE changed or refused.
function verifyWrite(plan, result) {
  const notices = [];
  const close = (x, y) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
  plan.writes.forEach((w, p) => {
    const got = result.properties[p];
    if (!got || got.error) {
      notices.push(`${w.label}: not changed. ${got ? got.error : 'No reply from After Effects.'}`);
      return;
    }
    w.keys.forEach((k, i) => {
      const s = got.keys[i];
      for (const side of ['in', 'out']) {
        const type = k[`${side}Type`];
        if (s[`${side}Type`] !== type) notices.push(`${w.label}, key ${k.index}: AE made the ${side} side ${s[`${side}Type`]}, not ${type}.`);
        if (type !== 'BEZIER') continue;
        const changed = k[`${side}Ease`].some((e, d) => {
          const stored = s[`${side}Ease`][d];
          return !stored || !close(stored.speed, e.speed) || !close(stored.influence, e.influence);
        });
        if (changed) notices.push(`${w.label}, key ${k.index}: AE stored a different ${side} ease than the one written.`);
      }
    });
  });
  return notices;
}

module.exports = { kindOf, targetSegments, planApply, verifyWrite };
