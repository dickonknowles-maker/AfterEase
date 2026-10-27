// Phase 1 round-trip tests in After Effects. Builds a fixture comp per frame
// rate, applies curves through the real readSelection and writeKeys, and
// checks what AE stored and plays back against core/. Also checks reading a
// selection across layers, undo, and KeySnapshot on every fixture property.
//
//   node scripts/ae.mjs start                      AE with the AfterEase panel open
//   node tests/ae/roundtrip.mjs [23.976 25 29.97 50]
//   node scripts/ae.mjs quit
//
// host/ is loaded from this repo into AE's script engine, not from the
// installed extension. The report goes to tests/ae/phase1/.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { PORTS, evaluate, runJsx, hostCall } from '../../scripts/ae.mjs';

const require = createRequire(import.meta.url);
const { kindOf, planApply, verifyWrite } = require('../../core/apply');
const { TOLERANCE, relativeError, checkApply, compareReads } = require('./check');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// AE's own rates: its 23.976 and 29.97 comps step exactly 1/23.976 s and 1/29.97 s.
const RATES = { '23.976': 23.976, '25': 25, '29.97': 29.97, '50': 50 };

const EASE = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
const SNAPPY = { x1: 0.15, y1: 0.3, x2: 0.7, y2: 1 };
const STRONG = { x1: 0.9, y1: 0, x2: 0.05, y2: 1 };
const OVERSHOOT = { x1: 0.4, y1: -0.4, x2: 0.6, y2: 1.4 };

// keys: 1-based keys to select (default all). notice: what planApply must
// say (default: nothing). exactCurve false: core clipped the curve on purpose.
// untouched: how much unwritten segments may move.
const CASES = [
  { item: 'Opacity', curve: EASE },
  { item: 'Rotation', curve: STRONG },
  { item: 'Scale', curve: SNAPPY },
  { item: 'Position 2D', curve: EASE },
  { item: 'Position 3D', curve: SNAPPY },
  { item: 'X Position', curve: EASE },
  { item: 'Y Position', curve: STRONG },
  { item: 'Colour', curve: SNAPPY },
  { item: 'Hold', curve: EASE, notice: /held segments were left as is/ },
  { item: 'Roving', curve: EASE, notice: /next to roving keys were left as is/ },
  { item: 'Expression', curve: EASE, notice: /has an expression/ },
  { item: 'Time Remap', curve: SNAPPY },
  { item: 'Continuous', curve: EASE },
  { item: 'Pair', keys: [2, 3], curve: EASE },
  { item: 'Lone', keys: [3], curve: SNAPPY },
  { item: 'Scope in', keys: [1, 2], curve: EASE, scope: 'in' },
  { item: 'Scope out', keys: [1, 2], curve: EASE, scope: 'out' },
  { item: 'Overshoot 1D', curve: OVERSHOOT },
  { item: 'Overshoot path', curve: OVERSHOOT, notice: /paths can't overshoot/, exactCurve: false },
  { item: 'Overshoot colour', curve: OVERSHOOT, notice: /colours can't overshoot/, exactCurve: false },
  // Key 2's untouched out side goes from influence 0 to 0.1, AE's minimum.
  { item: 'Bezier zero', keys: [1, 2], curve: EASE, untouched: TOLERANCE },
];

const pct = v => (v === undefined ? '-' : `${(v * 100).toFixed(4)}%`);
// Layer indices shift as layers are added, so a ref's layer is its id.
const sameRef = (p, q) => p.compId === q.compId && p.layerId === q.layerId && JSON.stringify(p.path) === JSON.stringify(q.path);

async function loadHost() {
  const root = repo.replace(/\\/g, '/');
  // A syntax error would leave a modal alert in AE, so parse everything first.
  const jsx = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jsx(path.join(dir, e.name)) : e.name.endsWith('.jsx') ? [path.join(dir, e.name)] : []);
  for (const f of [...jsx(path.join(repo, 'host')), ...jsx(path.join(repo, 'tests', 'ae'))]) {
    parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 3, allowReserved: true });
  }
  const load = `$.evalFile(new File(${JSON.stringify(`${root}/host/main.jsx`)})); AfterEaseLoad(${JSON.stringify(root)})`;
  const r = await evaluate(PORTS.panel, `cep.evalScript(${JSON.stringify(load)})`);
  if (r !== 'ok') throw new Error(`The host layer did not load: ${r}`);
  for (const f of ['fixture.jsx', 'hostTest.jsx']) await runJsx(path.join(repo, 'tests', 'ae', f));
  const ready = await evaluate(PORTS.panel, `cep.evalScript('typeof AfterEase.functions.testBuildFixture + typeof AfterEase.functions.testRead')`);
  if (ready !== 'functionfunction') throw new Error('The test host functions did not load');
}

async function applyCase(fx, c) {
  const item = fx.items.find(i => i.name === c.item);
  const count = (await hostCall('testRead', { refs: [item.ref] }))[0].keys.length;
  const keys = c.keys || Array.from({ length: count }, (_, i) => i + 1);
  await hostCall('testSelect', { compId: fx.compId, select: [{ ref: item.ref, keys }] });
  const [before] = await hostCall('testRead', { refs: [item.ref] });
  const selection = await hostCall('readSelection');
  const problems = [];
  if (selection.properties.length !== 1 || !sameRef(selection.properties[0].ref, item.ref)) {
    problems.push(`readSelection returned ${selection.properties.length} properties`);
  }
  const plan = planApply(selection, c.curve, { scope: c.scope || 'both' });
  const result = await hostCall('writeKeys', plan);
  problems.push(...verifyWrite(plan, result));
  const said = plan.notices.join(' ');
  if (c.notice ? !c.notice.test(said) : plan.notices.length) problems.push(`notices: ${said || 'none'}`);
  const [after] = await hostCall('testRead', { refs: [item.ref] });
  const kind = kindOf(after.valueType);
  const written = plan.writes.length ? plan.writes[0].segments : [];
  const check = checkApply({ kind, before, after, written, curve: c.curve, exactCurve: c.exactCurve !== false, untouched: c.untouched });
  // Keys the plan didn't write keep every attribute.
  const writtenKeys = new Set(plan.writes.flatMap(w => w.keys.map(k => k.index)));
  before.keys.forEach((k, i) => {
    if (writtenKeys.has(i + 1)) return;
    for (const d of compareReads({ keys: [k], samples: [] }, { keys: [after.keys[i]], samples: [] })) problems.push(`unwritten ${d.replace('key 1', `key ${i + 1}`)}`);
  });
  return { name: c.item, kind, pass: check.pass && problems.length === 0, rows: check.rows, problems, notices: plan.notices };
}

async function selectionCase(fx) {
  const pick = [['Opacity', [1, 2]], ['Scale', [2, 3]], ['Position 2D', [1, 2, 3]]];
  const refOf = name => fx.items.find(i => i.name === name).ref;
  await hostCall('testSelect', { compId: fx.compId, select: pick.map(([name, keys]) => ({ ref: refOf(name), keys })) });
  const selection = await hostCall('readSelection');
  const problems = [];
  if (selection.properties.length !== pick.length) problems.push(`${selection.properties.length} properties, not ${pick.length}`);
  for (const [name, keys] of pick) {
    const p = selection.properties.find(q => sameRef(q.ref, refOf(name)));
    if (!p) {
      problems.push(`${name} missing`);
      continue;
    }
    const got = p.keys.map((k, i) => (k.selected ? i + 1 : 0)).filter(Boolean);
    if (JSON.stringify(got) !== JSON.stringify(keys)) problems.push(`${name}: selected keys ${got}, not ${keys}`);
  }
  return { name: 'Selection across three layers', pass: problems.length === 0, problems };
}

async function undoCase(fx) {
  const item = fx.items.find(i => i.name === 'Undo');
  await hostCall('testSelect', { compId: fx.compId, select: [{ ref: item.ref, keys: [1, 2, 3] }] });
  const [before] = await hostCall('testRead', { refs: [item.ref] });
  const plan = planApply(await hostCall('readSelection'), SNAPPY);
  await hostCall('writeKeys', plan);
  const [applied] = await hostCall('testRead', { refs: [item.ref] });
  await hostCall('testUndo');
  const [after] = await hostCall('testRead', { refs: [item.ref] });
  const problems = compareReads(before, after);
  if (!compareReads(before, applied).length) problems.push('the apply changed nothing, so undo proves nothing');
  return { name: 'One undo step restores the keys', pass: problems.length === 0, problems };
}

// Two known AE limits; nothing else may change. A Bezier side at influence 0
// comes back at 0.1 (host/keySnapshot.jsx). A Time Remap value written by
// script is rounded to 1/4096 s, while AE's own end key can hold the exact
// layer duration (10.01001001 s at 23.976 fps). When either applies, the
// samples may move by up to the tolerance.
const TIME_REMAP_STEP = 1 / 4096;

function snapshotDiffs(t) {
  const zeroSides = new Set();
  t.before.keys.forEach((k, i) => {
    for (const side of ['in', 'out']) {
      if (k[`${side}Type`] === 'BEZIER' && k[`${side}Ease`][0].influence < 0.1) zeroSides.add(`key ${i + 1} ${side} ease`);
    }
  });
  const remap = t.before.matchName === 'ADBE Time Remapping';
  const exact = compareReads(t.before, t.after);
  if (!exact.length) return { diffs: [], known: [] };
  const known = new Set();
  const diffs = compareReads({ keys: t.before.keys, samples: [] }, { keys: t.after.keys, samples: [] }).filter(d => {
    const zero = zeroSides.has(d.replace(/ \d+:.*$/, '')) && / then -?[\d.e-]+\/0\.1$/.test(d);
    const m = /^key (\d+) value: (\S+) then (\S+)$/.exec(d);
    const rounded = remap && m && Math.abs(Number(m[3]) - Math.round(Number(m[2]) / TIME_REMAP_STEP) * TIME_REMAP_STEP) < 1e-12;
    if (zero) known.add('Bezier sides at influence 0 came back at 0.1');
    if (rounded) known.add('a Time Remap value was rounded to 1/4096 s');
    return !zero && !rounded;
  });
  const kind = kindOf(t.after.valueType);
  t.after.samples.forEach((seg, s) => {
    const a = t.before.keys[s];
    const b = t.before.keys[s + 1];
    const moved = Math.max(...seg.map((p, j) => relativeError(kind, a, b, p.value, t.before.samples[s][j].value)));
    if (moved > TOLERANCE) diffs.push(`segment ${s + 1} moved ${pct(moved)}`);
  });
  if (!known.size) return { diffs: exact, known: [] };
  return { diffs, known: [...known] };
}

async function snapshotCase(fx) {
  const problems = [];
  const notes = new Set();
  let keys = 0;
  for (const item of fx.items) {
    const trips = await hostCall('testSnapshotRoundTrip', { ref: item.ref });
    keys += trips.length;
    for (const t of trips) {
      const { diffs, known } = snapshotDiffs(t);
      for (const d of diffs) problems.push(`${item.name}, key ${t.key}: ${d}`);
      for (const k of known) notes.add(`${item.name}: ${k}, as expected`);
    }
  }
  return {
    name: `KeySnapshot: remove and restore each of ${keys} keys on ${fx.items.length} properties`,
    pass: problems.length === 0,
    problems,
    notices: [...notes],
  };
}

function caseLines(r) {
  const lines = [`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.kind ? ` [${r.kind}]` : ''}`];
  for (const row of r.rows || []) {
    lines.push(`      segment ${row.segment} (${row.written === 'no' ? 'not written' : `wrote ${row.written}`}): model ${pct(row.model)}` +
      `${row.pipeline !== undefined ? `, pipeline ${pct(row.pipeline)}` : ''}` +
      `${row.readBack !== undefined ? `, read-back ${row.readBack.toExponential(1)}` : ''}` +
      `${row.unchanged !== undefined ? `, moved ${pct(row.unchanged)}` : ''}` +
      `${row.problems.length ? `  <- ${row.problems.join(', ')}` : ''}`);
  }
  for (const n of r.notices || []) lines.push(`      notice: ${n}`);
  for (const p of (r.problems || []).slice(0, 12)) lines.push(`      problem: ${p}`);
  if ((r.problems || []).length > 12) lines.push(`      … and ${r.problems.length - 12} more`);
  return lines;
}

async function main(labels) {
  await loadHost();
  const info = await hostCall('ping', {});
  const lines = [
    `AfterEase phase 1 round trip, ${new Date().toISOString()}`,
    `After Effects ${info.appVersion} on ${info.os}`,
    `Tolerance: ${pct(TOLERANCE)} of each segment's change; ${TOLERANCE} on read-back curves.`,
    'model = AE samples vs core/segment.js from the stored keys; pipeline = vs the curve asked for;',
    'read-back = largest handle difference from the curve asked for; moved = change in unwritten segments.',
  ];
  const report = { rates: {} };
  let allPass = true;
  for (const label of labels) {
    const fx = await hostCall('testBuildFixture', { fps: RATES[label], label });
    const results = [];
    for (const c of CASES) {
      try {
        results.push(await applyCase(fx, c));
      } catch (e) {
        results.push({ name: c.item, pass: false, problems: [`threw: ${e.message}`] });
      }
    }
    for (const run of [selectionCase, undoCase, snapshotCase]) {
      try {
        results.push(await run(fx));
      } catch (e) {
        results.push({ name: run.name, pass: false, problems: [`threw: ${e.message}`] });
      }
    }
    const pass = results.every(r => r.pass);
    allPass = allPass && pass;
    lines.push('', `== ${label} fps (frame ${fx.frameDuration} s): ${pass ? 'PASS' : 'FAIL'}, ${results.filter(r => r.pass).length} of ${results.length}`);
    for (const r of results) lines.push(...caseLines(r));
    report.rates[label] = results;
    console.log(`${label} fps: ${pass ? 'PASS' : 'FAIL'} (${results.filter(r => r.pass).length} of ${results.length})`);
  }
  lines.splice(2, 0, `Overall: ${allPass ? 'PASS' : 'FAIL'}`);
  const out = path.join(repo, 'tests', 'ae', 'phase1');
  fs.mkdirSync(out, { recursive: true });
  const name = `roundtrip-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  fs.writeFileSync(path.join(out, `${name}.txt`), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`Report: tests/ae/phase1/${name}.txt`);
  return allPass;
}

const labels = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RATES);
for (const l of labels) if (!RATES[l]) throw new Error(`Unknown frame rate ${l}; use ${Object.keys(RATES).join(', ')}`);
process.exit((await main(labels)) ? 0 : 1);
