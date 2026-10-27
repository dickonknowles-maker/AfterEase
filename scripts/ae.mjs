// Drives After Effects for the phase 0 spikes on Dickon's machine, so they can run
// without someone clicking. Needs Node 22 or later (built-in WebSocket).
//
//   node scripts/ae.mjs start          take the lock, launch AE, open the AfterEase panel
//   node scripts/ae.mjs eval "<js>"    evaluate in the panel (DevTools, port 8088) and print the result
//   node scripts/ae.mjs popup "<js>"   the same in the spike 2 popup window (port 8089)
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

const AFTERFX = process.env.AFTERFX || 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX.exe';
const LOCK = 'D:\\Plugins\\AE\\ae-in-use.txt';
const OWNER = 'AfterEase phase 0';
const PORTS = { panel: 8088, popup: 8089 };
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

async function evaluate(port, expression) {
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
  if (reply.result && reply.result.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails, null, 1));
  return reply.result && reply.result.result ? reply.result.result.value : undefined;
}

async function start() {
  const h = holder();
  if (h && !mine(h)) throw new Error(`After Effects is in use: ${h}`);
  if (!h && aeState()) throw new Error('After Effects is already running for someone else');
  fs.writeFileSync(LOCK, `${OWNER} (Claude session) since ${new Date().toISOString()}: running the AfterEase spikes in After Effects 2026\n`);
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

  // Open the panel from its menu item, and note whether the spike launchers are under File > Scripts.
  const report = path.join(work, 'open-panel.txt').replace(/\\/g, '/');
  fs.rmSync(report, { force: true });
  const jsx = path.join(work, 'open-panel.jsx');
  fs.writeFileSync(jsx, [
    '(function () {',
    '    var lines = [];',
    "    var names = ['AfterEase', 'AfterEase Spike Ping.jsx', 'AfterEase Spike Ping', 'AfterEase Spike Popup.jsx', 'AfterEase Spike Popup'];",
    '    for (var i = 0; i < names.length; i += 1) {',
    "        lines.push(names[i] + ' = ' + app.findMenuCommandId(names[i]));",
    '    }',
    "    var id = app.findMenuCommandId('AfterEase');",
    '    if (id) {',
    '        app.executeCommand(id);',
    '    }',
    `    var f = new File(${JSON.stringify(report)});`,
    "    f.encoding = 'UTF-8';",
    "    f.open('w');",
    "    f.write(lines.join('\\n'));",
    '    f.close();',
    '}());',
    '',
  ].join('\n'));
  runScript(jsx);
  say('Handed over open-panel.jsx');
  await waitFor('open-panel.jsx', () => fs.existsSync(report), 10 * 60 * 1000, 1000);
  console.log(fs.readFileSync(report, 'utf8'));
  await waitFor('the panel\'s DevTools port', async () => {
    try { return await devtoolsPage(PORTS.panel); } catch (e) { return null; }
  }, 3 * 60 * 1000, 2000);
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

const [what, arg] = process.argv.slice(2);
try {
  if (what === 'start') await start();
  else if (what === 'eval' && arg) console.log(JSON.stringify(await evaluate(PORTS.panel, arg), null, 1));
  else if (what === 'popup' && arg) console.log(JSON.stringify(await evaluate(PORTS.popup, arg), null, 1));
  else if (what === 'run' && arg) runScript(arg);
  else if (what === 'quit') await quit();
  else {
    console.log('Usage: node scripts/ae.mjs start | eval "<js>" | popup "<js>" | run <file.jsx> | quit');
    process.exit(1);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
