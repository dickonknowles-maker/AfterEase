'use strict';

// client/state/store.js: preset list operations, settings, and files, with
// an in-memory fs.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const store = require('../../client/state/store');

const A = { x1: 0.3, y1: 0, x2: 0.7, y2: 1 };
const B = { x1: 0.1, y1: 0.5, x2: 0.6, y2: 1.2 };

function memoryFs() {
  const files = new Map();
  return {
    files,
    readFileSync(f) {
      if (!files.has(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(f);
    },
    writeFileSync(f, text) { files.set(f, text); },
    renameSync(from, to) {
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    mkdirSync() {},
  };
}

test('preset list: add, rename, replace, move, remove', () => {
  let list = [];
  list = store.addPreset(list, '  Snappy   one ', A, 'a');
  list = store.addPreset(list, '', B, 'b');
  assert.deepEqual(list.map(p => p.name), ['Snappy one', 'Custom 1']);
  assert.equal(store.uniqueName(list), 'Custom 2');
  list = store.renamePreset(list, 'b', 'Bouncy');
  assert.equal(store.renamePreset(list, 'b', '   ').find(p => p.id === 'b').name, 'Bouncy');
  list = store.replacePreset(list, 'a', B);
  assert.deepEqual(list[0].curve, B);
  list = store.addPreset(list, 'Third', A, 'c');
  assert.deepEqual(store.movePreset(list, 'c', 0).map(p => p.id), ['c', 'a', 'b']);
  assert.deepEqual(store.movePreset(list, 'a', 99).map(p => p.id), ['b', 'c', 'a']);
  assert.deepEqual(store.removePreset(list, 'b').map(p => p.id), ['a', 'c']);
});

test('loading drops broken presets and settings fall back to defaults', () => {
  const presets = store.cleanPresets({ presets: [
    { id: 'a', name: 'Good', curve: A },
    { id: 'a', name: 'Same id', curve: A },
    { id: 'b', name: 'No curve' },
    { id: 'c', name: 'x1 of 0', curve: { x1: 0, y1: 0, x2: 0.5, y2: 1 } },
    null,
  ] });
  assert.deepEqual(presets.map(p => p.name), ['Good']);
  assert.deepEqual(store.cleanSettings({ view: 'speed', scope: 'sideways', live: 'yes', curve: B }),
    { view: 'speed', scope: 'both', applyOnRelease: true, live: false, curve: B });
  assert.deepEqual(store.cleanSettings(null), store.DEFAULT_SETTINGS);
});

test('files: saved, read back, and an unreadable file kept aside', () => {
  const fs = memoryFs();
  const dir = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'AfterEase');
  const s = store.createStore({ fs, path, dir, now: () => 42 });
  assert.deepEqual(s.loadPresets(), []);
  s.savePresets(store.addPreset([], 'Mine', A, 'm'));
  assert.deepEqual(s.loadPresets(), [{ id: 'm', name: 'Mine', curve: A }]);
  s.saveSettings({ view: 'speed', scope: 'in', applyOnRelease: false, live: true, curve: B });
  assert.deepEqual(s.loadSettings(), { view: 'speed', scope: 'in', applyOnRelease: false, live: true, curve: B });
  fs.files.set(path.join(dir, 'presets.json'), '{ not json');
  assert.deepEqual(s.loadPresets(), []);
  assert.equal(fs.files.get(path.join(dir, 'presets.json.unreadable-42')), '{ not json');
  assert.equal(store.folder({ APPDATA: 'C:\\Roaming' }, 'win32', 'C:\\Users\\me', path.win32), 'C:\\Roaming\\AfterEase');
  assert.equal(store.folder({}, 'darwin', '/Users/me', path.posix), '/Users/me/Library/Application Support/AfterEase');
});
