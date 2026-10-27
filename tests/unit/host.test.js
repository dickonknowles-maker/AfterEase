'use strict';

// Host files run in ExtendScript, which is ES3. These tests parse them as
// ES3 and run the JSON polyfill in a sandbox that has no JSON.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const root = path.join(__dirname, '..', '..');

function jsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsxFiles(p);
    return e.name.endsWith('.jsx') ? [p] : [];
  });
}

test('host and launcher scripts parse as ES3', () => {
  const files = [...jsxFiles(path.join(root, 'host')), ...jsxFiles(path.join(root, 'launchers')), ...jsxFiles(path.join(root, 'tests', 'ae'))];
  assert.ok(files.length >= 5);
  for (const f of files) {
    assert.doesNotThrow(() => acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 3, allowReserved: true }),
      path.relative(root, f));
  }
});

// main.jsx loads the host files with $.evalFile inside AfterEaseLoad(), where
// ExtendScript keeps their vars local to the function (seen in AE 26.5). The
// panel's later calls run at global scope, so AfterEase must end up there.
test('host layer is global when loaded inside a function', () => {
  const sandbox = vm.createContext({});
  vm.runInContext('var $ = { global: this };', sandbox);
  const files = ['json2.jsx', 'adapter.jsx', 'keySnapshot.jsx', 'spikes/easeModel.jsx', 'spikes/popup.jsx'];
  const body = files.map(f => fs.readFileSync(path.join(root, 'host', f), 'utf8')).join('\n');
  vm.runInContext(`(function AfterEaseLoad() {\n${body}\n}());`, sandbox);
  assert.equal(vm.runInContext('typeof AfterEase', sandbox), 'object');
  const reply = JSON.parse(vm.runInContext('AfterEase.call("nope", "{}")', sandbox));
  assert.deepEqual(reply, { ok: false, error: 'Unknown host function: nope' });
  assert.equal(vm.runInContext('typeof AfterEase.functions.spikeEaseModel', sandbox), 'function');
});

test('JSON polyfill round-trips without a native JSON', () => {
  const sandbox = vm.createContext({});
  vm.runInContext('delete this.JSON; var JSON;', sandbox);
  assert.equal(vm.runInContext('typeof JSON', sandbox), 'undefined');
  vm.runInContext(fs.readFileSync(path.join(root, 'host', 'json2.jsx'), 'utf8'), sandbox);

  const value = { a: 1.5, b: [true, false, null, -2e-7], s: 'quote " back\\slash \n tab\t é ✓ \u2028', nested: { empty: [], o: {} } };
  sandbox.input = JSON.stringify(value);
  const out = vm.runInContext('JSON.stringify(JSON.parse(input))', sandbox);
  assert.deepEqual(JSON.parse(out), value);
  assert.equal(vm.runInContext('JSON.stringify({ n: NaN, i: Infinity, u: undefined, f: function () {} })', sandbox), '{"n":null,"i":null}');
  assert.throws(() => vm.runInContext('JSON.parse("alert(1)")', sandbox));
});
