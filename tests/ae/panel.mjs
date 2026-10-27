// Phase 2 check of the real panel in After Effects. Drives the installed
// AfterEase panel through its DevTools port with real mouse and keyboard
// events, the way a person would, and checks the keys AE ends up with.
//
//   node scripts/ae.mjs start          AE with the AfterEase panel open
//   node tests/ae/panel.mjs
//   node scripts/ae.mjs quit
//
// The user's AfterEase settings and presets files are set aside for the run
// and put back afterwards. Report and screenshots go to tests/ae/phase2/.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PORTS, cdp, evaluate, runJsx, hostCall } from '../../scripts/ae.mjs';

const require = createRequire(import.meta.url);
const segment = require('../../core/segment');
const { kindOf } = require('../../core/apply');
const { BUILT_IN } = require('../../core/presets');
const store = require('../../client/state/store');
const { compareReads } = require('./check');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'tests', 'ae', 'phase2');
const dataDir = store.folder(process.env, process.platform, os.homedir(), path);
const FILES = ['settings.json', 'presets.json'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];

const page = expression => evaluate(PORTS.panel, expression);
const status = () => page("document.getElementById('status').textContent");
const fields = async () => (await page("['x1','y1','x2','y2'].map(k => Number(document.getElementById(k).value))"));
const rect = async selector => page(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }; })()`);

async function mouse(type, x, y, button = 'left', buttons = 0) {
  await cdp(PORTS.panel, 'Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
// Clears the status line, so a wait can't be satisfied by the last action's message.
const clearStatus = () => page("document.getElementById('status').textContent = ''");

async function click(selector, button = 'left') {
  await clearStatus();
  const r = await rect(selector);
  await mouse('mousePressed', r.x, r.y, button, button === 'left' ? 1 : 2);
  await mouse('mouseReleased', r.x, r.y, button, 0);
}
async function key(k, code, vk) {
  await cdp(PORTS.panel, 'Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await cdp(PORTS.panel, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
}
async function screenshot(name) {
  const shot = await cdp(PORTS.panel, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
async function waitForStatus(re, ms = 5000) {
  const t0 = Date.now();
  let s = '';
  while (Date.now() - t0 < ms) {
    s = await status();
    if (re.test(s)) return s;
    await sleep(100);
  }
  throw new Error(`status never matched ${re}: "${s}"`);
}

function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
}

// Largest handle difference from `want` over the written segments of an item.
async function curveError(fx, itemName, want, segments) {
  const item = fx.items.find(i => i.name === itemName);
  const [r] = await hostCall('testRead', { refs: [item.ref] });
  const kind = kindOf(r.valueType);
  let worst = 0;
  for (const s of segments) {
    const changes = segment.change(kind, r.keys[s], r.keys[s + 1]);
    segment.curves(kind, r.keys[s], r.keys[s + 1]).forEach((c, d) => {
      if (changes[d] === 0) return;
      for (const k of ['x1', 'y1', 'x2', 'y2']) worst = Math.max(worst, Math.abs(c[k] - want[k]));
    });
  }
  return { worst, keys: r.keys };
}

async function select(fx, itemName, keys) {
  const item = fx.items.find(i => i.name === itemName);
  await hostCall('testSelect', { compId: fx.compId, select: [{ ref: item.ref, keys }] });
}

// Where a handle is drawn in the value view, from the numbers shown.
async function handlePoint(which) {
  const [x1, y1, x2, y2] = await fields();
  const r = await rect('#curve');
  const lo = Math.min(0, y1, y2) - 0.25;
  const hi = Math.max(1, y1, y2) + 0.25;
  const px = x => r.left + 12 + x * (r.width - 24);
  const py = v => r.top + r.height - 14 - (v - lo) / (hi - lo) * (r.height - 28);
  return which === 'start' ? { x: px(x1), y: py(y1) } : { x: px(x2), y: py(y2) };
}

async function run() {
  // A clean panel: no settings or presets from before.
  for (const f of FILES) if (fs.existsSync(path.join(dataDir, f))) fs.renameSync(path.join(dataDir, f), path.join(dataDir, `${f}.before-test`));
  await cdp(PORTS.panel, 'Page.reload', { ignoreCache: true });
  await sleep(1500);
  const first = await status();
  check('Panel loads and reaches After Effects', /Select keys/.test(first), first);
  for (const f of ['fixture.jsx', 'hostTest.jsx']) await runJsx(path.join(repo, 'tests', 'ae', f));
  const fx = await hostCall('testBuildFixture', { fps: 25, label: '25 (panel test)' });
  await screenshot('1-start');

  // A preset on every key of a 1D property.
  const endMedium = BUILT_IN.find(p => p.id === 'end-medium');
  const opacityRef = fx.items.find(i => i.name === 'Opacity').ref;
  await select(fx, 'Opacity', [1, 2, 3, 4]);
  const [beforePreset] = await hostCall('testRead', { refs: [opacityRef] });
  await click('.tile[data-id="end-medium"]');
  const s1 = await waitForStatus(/Eased/);
  const e1 = await curveError(fx, 'Opacity', endMedium.curve, [0, 1, 2]);
  check('Clicking a preset eases the selected keys', e1.worst < 1e-3, `${s1} Worst handle difference ${e1.worst.toExponential(1)}`);
  await screenshot('2-after-preset');
  // AE doesn't let scripts read the Edit menu's undo text, so check the effect: one undo restores everything.
  await hostCall('testUndo');
  const [undone] = await hostCall('testRead', { refs: [opacityRef] });
  const diffs = compareReads(beforePreset, undone);
  check('One Edit > Undo puts the keys back', diffs.length === 0, diffs.slice(0, 3).join('; '));
  await click('.tile[data-id="end-medium"]');
  await waitForStatus(/Eased/);

  // Dragging a handle applies on release.
  const a = await handlePoint('start');
  await clearStatus();
  await mouse('mousePressed', a.x, a.y, 'left', 1);
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', a.x + 8 * i, a.y - 6 * i, 'left', 1);
  await mouse('mouseReleased', a.x + 40, a.y - 30, 'left', 0);
  const s2 = await waitForStatus(/Eased/);
  const dragged = await fields();
  const want = { x1: dragged[0], y1: dragged[1], x2: dragged[2], y2: dragged[3] };
  const e2 = await curveError(fx, 'Opacity', want, [0, 1, 2]);
  check('Dragging a handle applies on release', e2.worst < 2e-3 && Math.abs(want.x1 - endMedium.curve.x1) > 0.02,
    `${s2} Curve ${dragged.join(', ')}; worst difference from the numbers shown ${e2.worst.toExponential(1)}`);

  // Tab mid-drag switches to the speed view without moving the curve.
  const b = await handlePoint('start');
  await clearStatus();
  await mouse('mousePressed', b.x, b.y, 'left', 1);
  await mouse('mouseMoved', b.x + 6, b.y - 4, 'left', 1);
  const beforeTab = await fields();
  await key('Tab', 'Tab', 9);
  const afterTab = await fields();
  const view = await page("document.querySelector('#view .on').dataset.view");
  await mouse('mouseMoved', b.x + 20, b.y - 4, 'left', 1);
  await mouse('mouseReleased', b.x + 20, b.y - 4, 'left', 0);
  await waitForStatus(/Eased/);
  check('Tab mid-drag switches to the speed view and keeps the curve', view === 'speed' && JSON.stringify(beforeTab) === JSON.stringify(afterTab),
    `view ${view}; ${beforeTab.join(', ')} then ${afterTab.join(', ')}`);
  await screenshot('3-speed-view');
  await click('[data-view="value"]');

  // Read keys: linear keys read as a straight line; eased keys as their curve.
  const opacityCurve = await fields();
  await select(fx, 'Scale', [1, 2]);
  await click('#read');
  const s3 = await waitForStatus(/Read the curve/);
  const lin = await fields();
  const straight = Math.abs(lin[0] - lin[1]) < 2e-3 && Math.abs(lin[2] - lin[3]) < 2e-3;
  await select(fx, 'Opacity', [2, 3]);
  await click('#read');
  await waitForStatus(/Read the curve from Opacity: Opacity, keys 2 to 3/);
  const back = await fields();
  check('Read keys loads the selected curve', straight && back.every((v, i) => Math.abs(v - opacityCurve[i]) < 2e-3),
    `${s3} Linear keys ${lin.join(', ')}; eased keys ${back.join(', ')}`);

  // Scope: In only writes the in side.
  await click('[data-scope="in"]');
  await select(fx, 'Scope in', [1, 2]);
  await click('.tile[data-id="both-medium"]');
  await waitForStatus(/Eased/);
  const e4 = await curveError(fx, 'Scope in', BUILT_IN.find(p => p.id === 'both-medium').curve, []);
  const k1 = e4.keys[0];
  const k2 = e4.keys[1];
  check('Scope In writes only the ease into each key', k1.outType === 'LINEAR' && k2.inType === 'BEZIER' && Math.abs(k2.inEase[0].influence - 60) < 1e-6,
    `key 1 out ${k1.outType}; key 2 in ${k2.inType} at ${k2.inEase[0].influence}%`);
  await click('[data-scope="both"]');

  // Spatial and colour properties.
  for (const [item, id] of [['Position 2D', 'start-strong'], ['Colour', 'both-strong']]) {
    await select(fx, item, [1, 2, 3]);
    await click(`.tile[data-id="${id}"]`);
    await waitForStatus(/Eased/);
    const e = await curveError(fx, item, BUILT_IN.find(p => p.id === id).curve, [0, 1]);
    check(`A preset on ${item}`, e.worst < 1e-3, `worst handle difference ${e.worst.toExponential(1)}`);
  }

  // A user preset: save, name, right-click, delete.
  await click('.tile.add');
  await sleep(200);
  await cdp(PORTS.panel, 'Input.insertText', { text: 'Panel test' });
  await key('Enter', 'Enter', 13);
  await sleep(300);
  const saved = store.createStore({ fs, path, dir: dataDir }).loadPresets();
  check('Saving a preset writes it to the presets file', saved.length === 1 && saved[0].name === 'Panel test', JSON.stringify(saved.map(p => p.name)));
  await click('.user-presets .tile[data-id]', 'right');
  await sleep(200);
  const menuOpen = await page("!document.getElementById('context').hidden");
  await screenshot('4-preset-menu');
  if (menuOpen) await click('#context [data-act="delete"]');
  await sleep(300);
  const left = store.createStore({ fs, path, dir: dataDir }).loadPresets();
  check('Right-click menu deletes a preset', menuOpen && left.length === 0, `menu ${menuOpen ? 'opened' : 'did not open'}; ${left.length} left`);

  await click('#menu-button');
  await sleep(200);
  await screenshot('5-settings');
  await key('Escape', 'Escape', 27);
}

fs.mkdirSync(out, { recursive: true });
try {
  await run();
} catch (e) {
  check('Test run', false, e.message);
} finally {
  // Put the user's files back.
  for (const f of FILES) {
    const file = path.join(dataDir, f);
    fs.rmSync(file, { force: true });
    if (fs.existsSync(`${file}.before-test`)) fs.renameSync(`${file}.before-test`, file);
  }
  await cdp(PORTS.panel, 'Page.reload', { ignoreCache: true }).catch(() => {});
}
const pass = results.every(r => r.pass);
const lines = [`AfterEase phase 2 panel check, ${new Date().toISOString()}`, `Overall: ${pass ? 'PASS' : 'FAIL'}`, '',
  ...results.map(r => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`)];
fs.writeFileSync(path.join(out, 'panel-check.txt'), `${lines.join('\n')}\n`);
console.log(`Overall: ${pass ? 'PASS' : 'FAIL'}. Report and screenshots in tests/ae/phase2/`);
process.exit(pass ? 0 : 1);
