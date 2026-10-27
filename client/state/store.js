'use strict';

// The user's presets and the panel's settings, kept as JSON in the user's
// app data folder: %APPDATA%\AfterEase on Windows, ~/Library/Application
// Support/AfterEase on macOS. The list operations are pure functions; file
// access goes through the fs passed to createStore, so tests need no files.

const { isCurve } = require('../../core/presets');

const DEFAULT_SETTINGS = { view: 'value', scope: 'both', applyOnRelease: true, live: false, curve: null };
const VIEWS = ['value', 'speed'];
const SCOPES = ['both', 'in', 'out'];

function folder(env, platform, home, path) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'AfterEase');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'AfterEase');
  return path.join(home, '.afterease');
}

const tidyName = name => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);

function cleanPresets(data) {
  const list = data && Array.isArray(data.presets) ? data.presets : [];
  const seen = new Set();
  return list.filter(p => p && typeof p.id === 'string' && !seen.has(p.id) && seen.add(p.id) && isCurve(p.curve))
    .map(p => ({ id: p.id, name: tidyName(p.name) || 'Untitled', curve: { x1: p.curve.x1, y1: p.curve.y1, x2: p.curve.x2, y2: p.curve.y2 } }));
}

function cleanSettings(data) {
  const s = { ...DEFAULT_SETTINGS };
  if (data && VIEWS.includes(data.view)) s.view = data.view;
  if (data && SCOPES.includes(data.scope)) s.scope = data.scope;
  if (data && typeof data.applyOnRelease === 'boolean') s.applyOnRelease = data.applyOnRelease;
  if (data && typeof data.live === 'boolean') s.live = data.live;
  if (data && isCurve(data.curve)) s.curve = data.curve;
  return s;
}

// "Custom 1", "Custom 2", ...: the first not already taken.
function uniqueName(list, base = 'Custom') {
  const taken = new Set(list.map(p => p.name.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function addPreset(list, name, curve, id) {
  return [...list, { id, name: tidyName(name) || uniqueName(list), curve: { ...curve } }];
}

function renamePreset(list, id, name) {
  const n = tidyName(name);
  return n ? list.map(p => (p.id === id ? { ...p, name: n } : p)) : list;
}

function replacePreset(list, id, curve) {
  return list.map(p => (p.id === id ? { ...p, curve: { ...curve } } : p));
}

function removePreset(list, id) {
  return list.filter(p => p.id !== id);
}

// Moves a preset to position `to` in the list as it is after removal.
function movePreset(list, id, to) {
  const from = list.findIndex(p => p.id === id);
  if (from < 0) return list;
  const rest = list.filter(p => p.id !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), list[from], ...rest.slice(at)];
}

function createStore({ fs, path, dir, now = () => Date.now() }) {
  const file = name => path.join(dir, name);

  // A file that exists but can't be read is kept aside, not overwritten.
  function read(name) {
    let text;
    try {
      text = fs.readFileSync(file(name), 'utf8');
    } catch (e) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      try { fs.renameSync(file(name), file(`${name}.unreadable-${now()}`)); } catch (e2) { /* leave it */ }
      return null;
    }
  }

  function write(name, data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(`${name}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
    fs.renameSync(tmp, file(name));
  }

  return {
    dir,
    loadPresets: () => cleanPresets(read('presets.json')),
    savePresets: list => write('presets.json', { version: 1, presets: list }),
    loadSettings: () => cleanSettings(read('settings.json')),
    saveSettings: settings => write('settings.json', { version: 1, ...cleanSettings(settings) }),
  };
}

module.exports = {
  DEFAULT_SETTINGS, folder, cleanPresets, cleanSettings, uniqueName,
  addPreset, renamePreset, replacePreset, removePreset, movePreset, createStore,
};
