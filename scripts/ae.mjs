// Drives After Effects for AfterEase's spikes and tests on Dickon's machine, so they
// can run without someone clicking. Needs Node 22 or later (built-in WebSocket).
// tests/ae/roundtrip.mjs imports its helpers.
//
//   node scripts/ae.mjs start          take the lock, launch AE, open the AfterEase panel
//   node scripts/ae.mjs open           open the panel in the running AE (if it isn't open)
//   node scripts/ae.mjs eval "<js>"    evaluate in the panel (DevTools, port 8088) and print the result
//   node scripts/ae.mjs evalfile <f>   the same with the JavaScript in a file
//   node scripts/ae.mjs jsx <f.jsx>    run an ExtendScript file in the panel's engine; prints what it returns
//   node scripts/ae.mjs popup "<js>"   evaluate in the spike 2 popup window (port 8089)
//   node scripts/ae.mjs run <file.jsx> hand a script to AE with -ro
//   node scripts/ae.mjs quit           close the untitled project unsaved, quit AE, release the lock
//
// Other sessions on this machine drive the same After Effects. They agree to take turns
// through D:\Plugins\AE\ae-in-use.txt: AE is free when nobody else holds the lock and no
// AfterFX.exe is running. -ro rather than -r because a docked Copy to Points panel runs a
// script every 0.4 s, and AE refuses a -r script that arrives during one with a modal.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AFTERFX = process.env.AFTERFX || 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
const LOCK = 'D:\\Plugins\\AE\\ae-in-use.txt';
const OWNER = 'AfterEase';
export const PORTS = { panel: 8088, popup: 8089 };
const work = path.join(os.tmpdir(), 'afterease-ae');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);
const say = text => console.log(`${stamp()} ${text}`);

function holder() {
  try { return fs.readFileSync(LOCK, 'utf8').trim(); } catch (e) { return null; }
}
const mine = h => !!h && h.startsWith(OWNER);

// { responding, title } of the running After Effects, or null.
function aeState() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "$p = Get-Process AfterFX -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { $p.Responding.ToString() + '|' + $p.MainWindowTitle }; exit 0"],
  { encoding: 'utf8' }).trim();
  if (!out) return null;
  const [responding, ...title] = out.split('|');
  return { responding: responding === 'True', title: title.join('|') };
}

async function waitFor(what, test, limitMs, everyMs = 2000) {
  const t0 = Date.now();
  while (true) {
    const v = await test();
    if (v) return v;
    if (Date.now() - t0 > limitMs) throw new Error(`${what}: gave up after ${limitMs / 1000} s`);
    await sleep(everyMs);
  }
}

function runScript(file) {
  spawn(AFTERFX, ['-ro', path.resolve(file)], { detached: true, stdio: 'ignore' }).unref();
}

async function devtoolsPage(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return list.find(t => t.webSocketDebuggerUrl && /\.html/.test(t.url)) || list.find(t => t.webSocketDebuggerUrl);
}

export async function evaluate(port, expression) {
  const page = await devtoolsPage(port);
  if (!page) throw new Error(`No debuggable page on port ${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const reply = await new Promise(resolve => {
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) resolve(msg);
    };
  });
  ws.close();
  const failed = reply.result && reply.result.exceptionDetails;
  if (failed) throw new Error(failed.exception && failed.exception.description ? failed.exception.description : JSON.stringify(failed));
  return reply.result && reply.result.result ? reply.result.result.value : undefined;
}

// Calls a host function through the panel (AfterEase.call); throws the host's error.
export function hostCall(name, args = {}) {
  return evaluate(PORTS.panel, `host.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
}

// Runs an ExtendScript file through the panel. The file is parsed as ES3 here
// first: a syntax error in AE opens a modal alert that stalls every later call.
export async function runJsx(file) {
  const source = fs.readFileSync(file, 'utf8');
  const { parse } = await import('acorn');
  parse(source, { ecmaVersion: 3, allowReserved: true });
  const target = JSON.stringify(path.resolve(file).replace(/\\/g, '/'));
  return evaluate(PORTS.panel, `cep.evalScript(${JSON.stringify(`$.evalFile(new File(${target}))`)})`);
}

async function start() {
  const h = holder();
  if (h && !mine(h)) throw new Error(`After Effects is in use: ${h}`);
  if (!h && aeState()) throw new Error('After Effects is already running for someone else');
  fs.writeFileSync(LOCK, `${OWNER} (Claude session) since ${new Date().toISOString()}: running AfterEase tests in After Effects 2026\n`);
  say('Lock taken');
  fs.mkdirSync(work, { recursive: true });

  if (!aeState()) {
    say('Launching After Effects');
    // Its HAP and NotchLC output plug-ins write logs to the working folder.
    spawn(AFTERFX, [], { detached: true, stdio: 'ignore', cwd: work }).unref();
  }
  // Wait for the main window to show a project: a script handed over earlier can stall.
  const t0 = Date.now();
  let last = '';
  await waitFor('After Effects start-up', () => {
    const s = aeState();
    const line = s ? `responding ${s.responding}, window "${s.title}"` : 'not running';
    if (line !== last) say(`After Effects: ${line}`);
    last = line;
    return s && s.responding && / - .*\.aep/.test(s.title);
  }, 45 * 60 * 1000, 5000);
  say(`Ready ${((Date.now() - t0) / 1000).toFixed(0)} s after launch`);
  await openPanel();
}

async function panelUp() {
  try { return await devtoolsPage(PORTS.panel); } catch (e) { return null; }
}

// A panel left open in the workspace comes back by itself, and its menu item
// toggles it, so the menu is used only when the panel hasn't appeared.
async function openPanel() {
  try {
    await waitFor('the panel from the workspace', panelUp, 30 * 1000, 2000);
    say(`Panel is up on port ${PORTS.panel} (from the workspace)`);
    return;
  } catch (e) { /* not in the workspace: open it from the menu */ }
  const report = path.join(work, 'open-panel.txt').replace(/\\/g, '/');
  fs.rmSync(report, { force: true });
  const jsx = path.join(work, 'open-panel.jsx');
  fs.writeFileSync(jsx, [
    '(function () {',
    "    var id = app.findMenuCommandId('AfterEase');",
    '    if (id) {',
    '        app.executeCommand(id);',
    '    }',
    `    var f = new File(${JSON.stringify(report)});`,
    "    f.open('w');",
    "    f.write('AfterEase menu command ' + id);",
    '    f.close();',
    '}());',
    '',
  ].join('\n'));
  runScript(jsx);
  say('Handed over open-panel.jsx');
  await waitFor('open-panel.jsx', () => fs.existsSync(report), 10 * 60 * 1000, 1000);
  say(fs.readFileSync(report, 'utf8'));
  await waitFor('the panel\'s DevTools port', panelUp, 3 * 60 * 1000, 2000);
  say(`Panel is up on port ${PORTS.panel}`);
}

async function quit() {
  const s = aeState();
  if (s) {
    // Only ever close the untitled project this tool's turn worked in.
    const r = await evaluate(PORTS.panel, `cep.evalScript(${JSON.stringify(
      "app.project.file ? 'has file: ' + app.project.file.fsName : " +
      "(app.scheduleTask('app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.quit();', 500, false), 'quitting')")})`);
    say(`After Effects: ${r}`);
    if (r !== 'quitting') throw new Error('Not quitting: a saved project is open. Lock kept.');
    try {
      await waitFor('After Effects to quit', () => !aeState(), 2 * 60 * 1000, 2000);
    } catch (e) {
      fs.appendFileSync(LOCK, `STUCK at ${new Date().toISOString()}: After Effects did not quit at the end of an AfterEase turn; waiting for Dickon. Don't force-quit it.\n`);
      throw new Error('After Effects did not quit. Lock kept; it needs a person.');
    }
  }
  if (mine(holder())) fs.rmSync(LOCK, { force: true });
  say('After Effects closed; lock released');
}

async function main(what, arg) {
  if (what === 'start') await start();
  else if (what === 'open') await openPanel();
  else if (what === 'eval' && arg) console.log(JSON.stringify(await evaluate(PORTS.panel, arg), null, 1));
  else if (what === 'evalfile' && arg) console.log(JSON.stringify(await evaluate(PORTS.panel, fs.readFileSync(arg, 'utf8')), null, 1));
  else if (what === 'jsx' && arg) console.log(await runJsx(arg));
  else if (what === 'popup' && arg) console.log(JSON.stringify(await evaluate(PORTS.popup, arg), null, 1));
  else if (what === 'run' && arg) runScript(arg);
  else if (what === 'quit') await quit();
  else {
    console.log('Usage: node scripts/ae.mjs start | open | eval "<js>" | evalfile <f.js> | jsx <f.jsx> | popup "<js>" | run <f.jsx> | quit');
    process.exit(1);
  }
}

// Run as a command, not when imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(...process.argv.slice(2));
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
