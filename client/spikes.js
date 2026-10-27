'use strict';

// Phase 0 diagnostics page (client/spikes.html, reached from the panel's menu):
// ExtendScript round trip plus the three spikes in SPEC.md.
// Everything the spikes find goes into the log, which "Save log and reports"
// writes to Documents/AfterEase spike reports for SPIKES.md.

(function () {
  const $ = id => document.getElementById(id);
  const cep = window.cep;
  const host = window.host;

  const logLines = [];
  const reports = {};
  let hostInfo = null;

  function stamp() {
    return new Date().toISOString().slice(11, 23);
  }

  function log(text) {
    logLines.push(`${stamp()}  ${text}`);
    $('log').textContent = logLines.join('\n');
    $('log').scrollTop = $('log').scrollHeight;
  }

  function fail(where, err) {
    log(`${where} failed: ${err && err.message ? err.message : err}`);
  }

  if (!cep.available) {
    $('env').textContent = 'Not running inside After Effects: CEP is not available.';
    return;
  }

  const nodeRequire = cep.nodeRequire;
  const root = cep.extensionPath();
  const path = nodeRequire('path');
  const fs = nodeRequire('fs');
  const os = nodeRequire('os');
  const spike = nodeRequire(path.join(root, 'client/spikes/easeModelSpike.js'));
  const { CursorReader } = nodeRequire(path.join(root, 'client/lib/cursor.js'));
  const cursor = new CursorReader();

  // Match AE's panel colour.
  function applySkin() {
    const skin = cep.hostEnvironment().appSkinInfo;
    const c = skin && skin.panelBackgroundColor && skin.panelBackgroundColor.color;
    if (c) document.documentElement.style.setProperty('--bg', `rgb(${c.red | 0}, ${c.green | 0}, ${c.blue | 0})`);
  }

  // --- Connection ---------------------------------------------------------

  async function ping() {
    const sent = { hello: 'from the panel', unicode: 'é – ✓', nested: { list: [1, 2.5, -3], flag: true, none: null } };
    const started = performance.now();
    try {
      const r = await host.call('ping', sent);
      const ms = (performance.now() - started).toFixed(1);
      const same = JSON.stringify(r.echo) === JSON.stringify(sent);
      hostInfo = r;
      $('ping-result').textContent = `${same ? 'OK' : 'Echo differs'}, ${ms} ms`;
      $('ping-result').className = same ? 'pass' : 'fail';
      log(`Round trip ${same ? 'OK' : 'ECHO DIFFERS'} in ${ms} ms. AE ${r.appVersion} (${r.buildName}), ${r.os}, ` +
        `ExtendScript ${r.extendScriptVersion}, native JSON before polyfill: ${r.hasNativeJSON}`);
    } catch (e) {
      $('ping-result').textContent = 'Failed';
      $('ping-result').className = 'fail';
      fail('Round trip', e);
    }
  }

  // --- Spike 1: hotkey ----------------------------------------------------

  let hotkeyCount = 0;

  function onLauncher(data) {
    hotkeyCount += 1;
    const delay = data && data.sentAt ? Date.now() - data.sentAt : NaN;
    const command = data && data.command ? data.command : String(data);
    $('hotkey-status').textContent = `Received ${hotkeyCount} event(s). Last: “${command}” after ${delay} ms.`;
    $('hotkey-status').className = 'pass';
    log(`Spike 1: launcher event “${command}” received ${delay} ms after the script sent it`);
    if (command === 'popup') openPopupAtCursor(0);
  }

  // --- Spike 2: popup at cursor --------------------------------------------

  let pendingPlacement = null;

  async function readCursorTimes() {
    const times = [];
    try {
      let last;
      for (let i = 0; i < 10; i++) {
        last = await cursor.read();
        times.push(last.ms);
      }
      const first = times[0].toFixed(1);
      const rest = times.slice(1);
      const avg = (rest.reduce((a, b) => a + b, 0) / rest.length).toFixed(1);
      log(`Spike 2: cursor read on ${process.platform}: first ${first} ms, then ${avg} ms on average; ` +
        `last position ${last.x}, ${last.y}; devicePixelRatio ${window.devicePixelRatio}`);
    } catch (e) {
      fail('Spike 2 cursor read', e);
    }
  }

  async function openPopupAtCursor(delayMs) {
    const route = $('popup-route').value;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    let p;
    try {
      p = await cursor.read();
    } catch (e) {
      fail('Spike 2 cursor read', e);
      return;
    }
    log(`Spike 2: cursor at ${p.x}, ${p.y} (read in ${p.ms.toFixed(1)} ms); opening ${route}`);
    if (route === 'scriptui') {
      try {
        const r = await host.call('spikeScriptUIPopup', { x: p.x, y: p.y });
        log(`Spike 2: ScriptUI palette asked for ${r.requested.join(', ')}, location now ${r.location.join(', ')}, ` +
          `frame bounds ${r.frameBounds.join(', ')}`);
      } catch (e) {
        fail('Spike 2 ScriptUI palette', e);
      }
    } else {
      pendingPlacement = { x: p.x, y: p.y, at: Date.now() };
      cep.openExtension('com.afterease.popup');
      // If the window is already open it will not send "ready" again.
      cep.dispatch('com.afterease.popup.place', pendingPlacement);
    }
  }

  function onPopupReady() {
    log('Spike 2: CEP popup window loaded');
    if (pendingPlacement) cep.dispatch('com.afterease.popup.place', pendingPlacement);
  }

  function onPopupReport(r) {
    if (!r || !r.requested) return;
    pendingPlacement = null;
    log(`Spike 2: CEP popup asked for ${r.requested.x}, ${r.requested.y}; screenX/Y before ${r.before.x}, ${r.before.y}, ` +
      `after moveTo ${r.after.x}, ${r.after.y}; window ${r.outer.w}×${r.outer.h}; devicePixelRatio ${r.dpr}; ` +
      `${Date.now() - r.requested.at} ms from cursor read to placed`);
  }

  // --- Spike 3: ease model -------------------------------------------------

  async function runEase(fpsLabel) {
    const plan = spike.buildPlan(fpsLabel);
    log(`Spike 3: running ${plan.cases.length} cases at ${fpsLabel} fps`);
    try {
      const started = performance.now();
      const result = await host.call('spikeEaseModel', plan);
      const analysis = spike.analyse(plan, result);
      const report = spike.formatReport(analysis, hostInfo || {});
      reports[fpsLabel] = { report, result };
      $('ease-report').hidden = false;
      $('ease-report').textContent = report;
      log(`Spike 3: ${fpsLabel} fps ${analysis.pass ? 'PASS' : 'FAIL'} (${(performance.now() - started).toFixed(0)} ms, comp “${result.compName}”)`);
    } catch (e) {
      fail(`Spike 3 at ${fpsLabel} fps`, e);
    }
  }

  async function runEaseAll() {
    for (const label of spike.FRAME_RATE_LABELS) await runEase(label);
    $('ease-report').textContent = Object.keys(reports).map(k => reports[k].report).join('\n\n');
  }

  // --- Saving ----------------------------------------------------------------

  function saveAll() {
    try {
      const dir = path.join(os.homedir(), 'Documents', 'AfterEase spike reports');
      fs.mkdirSync(dir, { recursive: true });
      const name = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(dir, `spikes-${name}.txt`);
      const parts = ['AfterEase phase 0 log', '', logLines.join('\n')];
      for (const k of Object.keys(reports)) parts.push('', '', reports[k].report);
      fs.writeFileSync(file, parts.join('\n'), 'utf8');
      // Raw host results, in case the analysis itself needs checking later.
      fs.writeFileSync(path.join(dir, `spike3-raw-${name}.json`),
        JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, v.result])), null, 1), 'utf8');
      $('log-saved').textContent = `Saved to ${file}`;
      log(`Saved to ${file}`);
    } catch (e) {
      fail('Save', e);
    }
  }

  // --- Start-up ----------------------------------------------------------------

  async function start() {
    applySkin();
    const env = cep.hostEnvironment();
    $('env').textContent = `${env.appName} ${env.appVersion}, extension at ${root}`;
    log(`Panel loaded: ${env.appName} ${env.appVersion}, locale ${env.appUILocale}, extension at ${root}`);

    for (const label of spike.FRAME_RATE_LABELS) {
      const o = document.createElement('option');
      o.value = label;
      o.textContent = `${label} fps`;
      if (label === '25') o.selected = true;
      $('ease-fps').appendChild(o);
    }

    $('ping').onclick = ping;
    $('cursor-read').onclick = readCursorTimes;
    $('popup-open').onclick = () => openPopupAtCursor(2000);
    $('ease-run').onclick = () => runEase($('ease-fps').value);
    $('ease-run-all').onclick = runEaseAll;
    $('log-save').onclick = saveAll;
    for (const b of document.querySelectorAll('.verdict')) {
      b.onclick = () => log(`Spike 2: user says route “${$('popup-route').value}” → ${b.dataset.verdict}`);
    }

    cep.on('com.afterease.launcher', onLauncher);
    cep.on('com.afterease.popup.ready', onPopupReady);
    cep.on('com.afterease.popup.report', onPopupReport);
    cep.on('com.adobe.csxs.events.ThemeColorChanged', applySkin);
    window.addEventListener('unload', () => cursor.stop());

    try {
      await host.load(root);
      log('Host layer loaded');
      await ping();
    } catch (e) {
      fail('Start-up', e);
    }
  }

  start();
}());
