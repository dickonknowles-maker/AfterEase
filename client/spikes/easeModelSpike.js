'use strict';

// Phase 0 spike 3 harness. buildPlan() turns known curves into AE eases with
// core/aeEase.js; analyse() compares what AE stored and sampled against the
// analytic model. Pure functions, so tests/unit can run them against a fake
// host without After Effects.

const bezier = require('../../core/bezier');
const aeEase = require('../../core/aeEase');
const spatial = require('../../core/spatial');

const SAMPLES_PER_SEGMENT = 20;
const TOLERANCE = 0.001; // 0.1% of the segment's change, and 0.001 on read-back curves
const DEFAULT_EASE = { speed: 0, influence: 100 / 6 };

// fps as AE wants it; frame-aligned key times avoid any snapping.
const FRAME_RATES = { '23.976': 24000 / 1001, '25': 25, '29.97': 30000 / 1001, '50': 50 };
// Object.keys would put '25' and '50' first, as integer-like keys.
const FRAME_RATE_LABELS = ['23.976', '25', '29.97', '50'];

const CASES = [
  {
    name: 'Opacity, ease in-out', kind: '1d', property: 'ADBE Opacity',
    keys: [{ s: 0, value: 0 }, { s: 1, value: 100 }, { s: 2.5, value: 20 }],
    curves: [{ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }],
  },
  {
    name: 'Rotation, strong ease', kind: '1d', property: 'ADBE Rotate Z',
    keys: [{ s: 0, value: 0 }, { s: 1.2, value: 270 }],
    curves: [{ x1: 0.9, y1: 0, x2: 0.05, y2: 1 }],
  },
  {
    name: 'Rotation, overshoot (negative speeds)', kind: '1d', property: 'ADBE Rotate Z',
    keys: [{ s: 0, value: 0 }, { s: 1, value: 90 }],
    curves: [{ x1: 0.4, y1: -0.4, x2: 0.6, y2: 1.4 }],
  },
  {
    name: 'Rotation, handles crossing (x1 > x2)', kind: '1d', property: 'ADBE Rotate Z',
    keys: [{ s: 0, value: 0 }, { s: 1, value: 90 }],
    curves: [{ x1: 0.8, y1: 0.2, x2: 0.2, y2: 0.8 }],
  },
  {
    name: 'Scale, per dimension (Z unchanged)', kind: 'multi', property: 'ADBE Scale',
    keys: [{ s: 0, value: [100, 100, 100] }, { s: 1, value: [40, 180, 100] }, { s: 2, value: [120, 120, 100] }],
    curves: [{ x1: 0.33, y1: 0, x2: 0.2, y2: 1 }, { x1: 0.6, y1: 0, x2: 0.4, y2: 1 }],
  },
  {
    name: 'Position 2D, straight path', kind: 'spatial', property: 'ADBE Position',
    keys: [
      { s: 0, value: [200, 540], inTangent: [0, 0], outTangent: [0, 0] },
      { s: 1.5, value: [1700, 540], inTangent: [0, 0], outTangent: [0, 0] },
    ],
    curves: [{ x1: 0.5, y1: 0, x2: 0.3, y2: 1 }],
  },
  {
    name: 'Position 2D, curved path', kind: 'spatial', property: 'ADBE Position',
    keys: [
      { s: 0, value: [200, 540], inTangent: [0, 0], outTangent: [300, -300] },
      { s: 1, value: [960, 200], inTangent: [-300, 0], outTangent: [300, 0] },
      { s: 2.2, value: [1700, 800], inTangent: [-100, -350], outTangent: [0, 0] },
    ],
    curves: [{ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, { x1: 0.15, y1: 0.3, x2: 0.7, y2: 1 }],
  },
  {
    name: 'Position 3D, curved path', kind: 'spatial', property: 'ADBE Position', threeD: true,
    keys: [
      { s: 0, value: [960, 540, 0], inTangent: [0, 0, 0], outTangent: [200, 0, -300] },
      { s: 1.4, value: [1400, 300, -900], inTangent: [0, 200, 200], outTangent: [0, 0, 0] },
    ],
    curves: [{ x1: 0.3, y1: 0, x2: 0.5, y2: 1 }],
  },
];

const asArray = v => (Array.isArray(v) ? v : [v]);

function frameTime(seconds, fps) {
  return Math.round(seconds * fps) / fps;
}

function segmentChange(kind, a, b) {
  if (kind === 'spatial') {
    return [spatial.arcLength(spatial.controlPoints(a.value, a.outTangent, b.inTangent, b.value))];
  }
  const va = asArray(a.value);
  const vb = asArray(b.value);
  return va.map((v, d) => vb[d] - v);
}

function buildCase(c, fps) {
  const keys = c.keys.map(k => Object.assign({}, k, { time: frameTime(k.s, fps) }));
  const dims = c.kind === 'multi' ? asArray(keys[0].value).length : 1;
  const eases = keys.map(() => ({
    inEase: Array.from({ length: dims }, () => Object.assign({}, DEFAULT_EASE)),
    outEase: Array.from({ length: dims }, () => Object.assign({}, DEFAULT_EASE)),
  }));
  for (let i = 0; i < keys.length - 1; i++) {
    const dt = keys[i + 1].time - keys[i].time;
    segmentChange(c.kind, keys[i], keys[i + 1]).forEach((dv, d) => {
      const e = aeEase.curveToEases(c.curves[i], dt, dv);
      eases[i].outEase[d] = e.out;
      eases[i + 1].inEase[d] = e.in;
    });
  }
  return {
    name: c.name, kind: c.kind, property: c.property, threeD: !!c.threeD,
    keys: keys.map(k => ({ time: k.time, value: k.value, inTangent: k.inTangent, outTangent: k.outTangent })),
    eases, curves: c.curves, samplesPerSegment: SAMPLES_PER_SEGMENT,
  };
}

function buildPlan(fpsLabel) {
  const fps = FRAME_RATES[fpsLabel];
  if (!fps) throw new Error(`Unknown frame rate ${fpsLabel}`);
  return { fps, fpsLabel, duration: 4, cases: CASES.map(c => buildCase(c, fps)) };
}

const relDiff = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
const dist = (p, q) => Math.sqrt(p.reduce((sum, v, i) => sum + (v - q[i]) ** 2, 0));

function analyseSegment(planCase, stored, samples, i) {
  const a = stored[i];
  const b = stored[i + 1];
  const tA = a.time;
  const tB = b.time;
  const dt = tB - tA;
  const curve = planCase.curves[i];
  const r = { segment: i + 1, modelError: 0, pipelineError: 0, readBackError: 0, easeChanges: [], notes: [] };

  // Did AE store what we wrote?
  const sides = [['out', planCase.eases[i].outEase, a.outEase], ['in', planCase.eases[i + 1].inEase, b.inEase]];
  for (const [side, wanted, got] of sides) {
    if (wanted.length !== got.length) {
      r.easeChanges.push(`${side}: wrote ${wanted.length} ease entries, AE stored ${got.length}`);
      continue;
    }
    wanted.forEach((w, d) => {
      if (relDiff(got[d].speed, w.speed) > 1e-6 && Math.abs(got[d].speed - w.speed) > 1e-6) {
        r.easeChanges.push(`${side}[${d}] speed ${w.speed.toFixed(4)} → ${got[d].speed.toFixed(4)}`);
      }
      if (Math.abs(got[d].influence - w.influence) > 1e-6) {
        r.easeChanges.push(`${side}[${d}] influence ${w.influence.toFixed(4)} → ${got[d].influence.toFixed(4)}`);
      }
    });
  }

  if (planCase.kind === 'spatial') {
    const cp = spatial.controlPoints(a.value, a.outTangent, b.inTangent, b.value);
    const table = spatial.lengthTable(cp);
    const L = table[table.length - 1];
    const back = aeEase.easesToCurve(a.outEase[0], b.inEase[0], dt, L);
    r.readBackError = Math.max(...['x1', 'y1', 'x2', 'y2'].map(k => Math.abs(back[k] - curve[k])));
    let altError = 0;
    for (const s of samples) {
      const along = aeEase.analyticValue(a.outEase[0], b.inEase[0], tA, 0, tB, L, s.time);
      const expected = spatial.pointAtLengthFraction(cp, along / L, table);
      const x = (s.time - tA) / dt;
      const piped = spatial.pointAtLengthFraction(cp, bezier.valueAtX(curve, x), table);
      const param = spatial.pointAt(cp, Math.min(1, Math.max(0, along / L)));
      r.modelError = Math.max(r.modelError, dist(s.value, expected) / L);
      r.pipelineError = Math.max(r.pipelineError, dist(s.value, piped) / L);
      altError = Math.max(altError, dist(s.value, param) / L);
    }
    r.notes.push(`path length ${L.toFixed(3)} px; error if AE moved by curve parameter instead of arc length: ${(altError * 100).toFixed(4)}%`);
    return r;
  }

  const va = asArray(a.value);
  const vb = asArray(b.value);
  va.forEach((vA, d) => {
    const vB = vb[d];
    const dv = vB - vA;
    if (dv === 0) {
      const maxAbs = Math.max(...samples.map(s => Math.abs(asArray(s.value)[d] - vA)));
      r.notes.push(`dimension ${d} has no change; max drift ${maxAbs.toExponential(2)}`);
      return;
    }
    const back = aeEase.easesToCurve(a.outEase[d], b.inEase[d], dt, dv);
    r.readBackError = Math.max(r.readBackError, ...['x1', 'y1', 'x2', 'y2'].map(k => Math.abs(back[k] - curve[k])));
    for (const s of samples) {
      const v = asArray(s.value)[d];
      const model = aeEase.analyticValue(a.outEase[d], b.inEase[d], tA, vA, tB, vB, s.time);
      const piped = vA + bezier.valueAtX(curve, (s.time - tA) / dt) * dv;
      r.modelError = Math.max(r.modelError, Math.abs(v - model) / Math.abs(dv));
      r.pipelineError = Math.max(r.pipelineError, Math.abs(v - piped) / Math.abs(dv));
    }
  });
  return r;
}

function analyse(plan, hostResult) {
  const cases = plan.cases.map((planCase, ci) => {
    const got = hostResult.cases[ci] || { errors: ['no result'], keys: [], samples: [] };
    const out = { name: planCase.name, kind: planCase.kind, errors: got.errors.slice(), segments: [] };
    if (got.keys.length !== planCase.keys.length) {
      out.errors.push(`expected ${planCase.keys.length} keys, AE has ${got.keys.length}`);
      out.pass = false;
      return out;
    }
    got.keys.forEach((k, i) => {
      if (Math.abs(k.time - planCase.keys[i].time) > 1e-6) out.errors.push(`key ${i + 1} time moved: ${planCase.keys[i].time} → ${k.time}`);
      if (k.temporalContinuous) out.errors.push(`key ${i + 1} is temporal continuous after writing`);
    });
    out.segments = got.samples.map((samples, i) => analyseSegment(planCase, got.keys, samples, i));
    out.pass = out.errors.length === 0 && out.segments.every(s =>
      s.modelError <= TOLERANCE && s.pipelineError <= TOLERANCE && s.readBackError <= TOLERANCE && s.easeChanges.length === 0);
    return out;
  });
  return { fpsLabel: plan.fpsLabel, cases, pass: cases.every(c => c.pass) };
}

const pct = v => `${(v * 100).toFixed(4)}%`;

function formatReport(analysis, meta = {}) {
  const lines = [];
  lines.push(`AfterEase spike 3: ease model, ${analysis.fpsLabel} fps`);
  if (meta.appVersion) lines.push(`After Effects ${meta.appVersion} on ${meta.os}`);
  lines.push(`Overall: ${analysis.pass ? 'PASS' : 'FAIL'} (tolerance ${pct(TOLERANCE)} of segment change, ${TOLERANCE} on read-back curve)`);
  lines.push('');
  lines.push('model = AE samples vs analytic cubic from the eases AE stored');
  lines.push('pipeline = AE samples vs the curve we asked for');
  lines.push('read-back = largest difference in x1, y1, x2, y2 after reading the eases back');
  for (const c of analysis.cases) {
    lines.push('');
    lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name} [${c.kind}]`);
    for (const e of c.errors) lines.push(`      error: ${e}`);
    for (const s of c.segments) {
      lines.push(`      segment ${s.segment}: model ${pct(s.modelError)}, pipeline ${pct(s.pipelineError)}, read-back ${s.readBackError.toExponential(2)}`);
      for (const e of s.easeChanges) lines.push(`        AE changed ${e}`);
      for (const n of s.notes) lines.push(`        ${n}`);
    }
  }
  return lines.join('\n');
}

module.exports = { FRAME_RATES, FRAME_RATE_LABELS, TOLERANCE, buildPlan, analyse, formatReport };
