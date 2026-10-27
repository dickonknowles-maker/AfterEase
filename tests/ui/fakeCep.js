'use strict';

// A fake CEP and After Effects, for working on the panel in an ordinary
// browser: scripts/serve.mjs injects this into client/index.html. Node's
// require is imitated for the panel's own modules, fs keeps its files in
// localStorage, and the host answers readSelection and writeKeys from a
// pretend comp whose keys start selected.

(function () {
  const norm = p => {
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop(); else out.push(s);
    }
    return `/${out.join('/')}`;
  };
  const path = { sep: '/', join: (...parts) => norm(parts.join('/')), dirname: p => norm(`${p}/..`) };
  const fs = {
    readFileSync(f) {
      const v = localStorage.getItem(`fs:${f}`);
      if (v === null) throw Object.assign(new Error(`ENOENT: ${f}`), { code: 'ENOENT' });
      return v;
    },
    writeFileSync(f, text) { localStorage.setItem(`fs:${f}`, text); },
    renameSync(from, to) {
      const v = localStorage.getItem(`fs:${from}`);
      if (v === null) throw new Error(`ENOENT: ${from}`);
      localStorage.setItem(`fs:${to}`, v);
      localStorage.removeItem(`fs:${from}`);
    },
    mkdirSync() {},
  };
  const builtins = { path, fs, os: { homedir: () => '/home/dev' } };
  const cache = {};
  const withJs = f => (f.endsWith('.js') ? f : `${f}.js`);

  function load(file) {
    if (cache[file]) return cache[file].exports;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', file, false);
    xhr.send();
    if (xhr.status !== 200) throw new Error(`Cannot find module ${file}`);
    const module = { exports: {} };
    cache[file] = module;
    const dir = path.dirname(file);
    const req = name => builtins[name] || load(withJs(name.startsWith('.') ? path.join(dir, name) : name));
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', `${xhr.responseText}\n//# sourceURL=${file}`)(module, module.exports, req);
    return module.exports;
  }

  window.cep_node = { require: name => builtins[name] || load(withJs(name)) };
  window.process = { env: {}, platform: 'browser' };

  // --- A pretend comp ---------------------------------------------------------------

  function keys(times, values, selected) {
    const flat = v => (Array.isArray(v) ? v : [v]);
    const avg = (i, j) => flat(values[j]).map((v, d) => (v - flat(values[i])[d]) / (times[j] - times[i]));
    return times.map((time, i) => ({
      time,
      value: values[i],
      selected: selected.includes(i),
      inType: 'LINEAR',
      outType: 'LINEAR',
      inEase: [{ speed: i > 0 ? avg(i - 1, i)[0] : 0, influence: 100 / 6 }],
      outEase: [{ speed: i < times.length - 1 ? avg(i, i + 1)[0] : 0, influence: 100 / 6 }],
      temporalContinuous: false,
      temporalAutoBezier: false,
    }));
  }

  const comp = { id: 1, name: 'Shot 010', frameDuration: 0.04, time: 0 };
  const props = [
    { ref: { compId: 1, layerIndex: 1, layerId: 11, path: [{ index: 2, matchName: 'ADBE Transform Group' }, { index: 11, matchName: 'ADBE Opacity' }] },
      layerName: 'Logo', name: 'Opacity', valueType: 'OneD', expression: false, keys: keys([0, 1, 2.2], [0, 100, 35], [0, 1, 2]) },
    { ref: { compId: 1, layerIndex: 2, layerId: 12, path: [{ index: 2, matchName: 'ADBE Transform Group' }, { index: 10, matchName: 'ADBE Rotate Z' }] },
      layerName: 'Arrow', name: 'Rotation', valueType: 'OneD', expression: false, keys: keys([0, 1.5], [0, 180], [0, 1]) },
  ];
  window.fakeAE = { comp, props };

  const functions = {
    ping: () => ({ appVersion: '26.5 (fake)' }),
    readSelection: () => ({ comp, properties: props.filter(p => p.keys.some(k => k.selected)).map(p => JSON.parse(JSON.stringify(p))) }),
    writeKeys: plan => ({
      properties: plan.writes.map(w => {
        const p = props.find(q => q.ref.layerId === w.ref.layerId);
        for (const k of w.keys) {
          Object.assign(p.keys[k.index - 1], { inType: k.inType, outType: k.outType, inEase: k.inEase, outEase: k.outEase, temporalContinuous: k.temporalContinuous });
        }
        return { keys: w.keys.map(k => JSON.parse(JSON.stringify(p.keys[k.index - 1]))) };
      }),
    }),
  };

  window.fakeAE.calls = [];
  window.__adobe_cep__ = {
    getHostEnvironment: () => JSON.stringify({
      appName: 'AEFT', appVersion: '26.5 (fake)', appId: 'AEFT', appUILocale: 'en_GB',
      appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35 } } },
    }),
    getSystemPath: () => '',
    evalScript(script, callback) {
      setTimeout(() => {
        if (script.includes('AfterEaseLoad')) {
          callback('ok');
          return;
        }
        const m = /^AfterEase\.call\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\)$/.exec(script);
        if (!m) {
          callback('');
          return;
        }
        const name = JSON.parse(m[1]);
        const args = JSON.parse(JSON.parse(m[2]));
        window.fakeAE.calls.push({ name, args });
        try {
          callback(JSON.stringify({ ok: true, result: functions[name](args) }));
        } catch (e) {
          callback(JSON.stringify({ ok: false, error: e.message }));
        }
      }, 15);
    },
    addEventListener() {},
    dispatchEvent() {},
    requestOpenExtension() {},
    closeExtension() {},
    getExtensionId: () => 'com.afterease.panel',
  };
}());
