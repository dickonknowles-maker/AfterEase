'use strict';

// client/lib/cep.js against a fake __adobe_cep__ that delivers events the way
// CEP 12 does in AE 26.5: an object whose data is base64.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'lib', 'cep.js'), 'utf8');

function load() {
  const listeners = {};
  const window = {
    __adobe_cep__: {
      addEventListener(type, fn) { listeners[type] = fn; },
    },
  };
  vm.runInNewContext(source, { window, atob, TextDecoder });
  return { cep: window.cep, fire: (type, event) => listeners[type](event) };
}

const base64 = text => Buffer.from(text, 'utf8').toString('base64');

test('event data is decoded from base64 and parsed', () => {
  const { cep, fire } = load();
  const got = [];
  cep.on('t', data => got.push(data));

  // From ExtendScript's CSXSEvent: extensionId and appId come through empty.
  fire('t', { type: 't', scope: 'APPLICATION', appId: '', extensionId: '', data: base64('{"command":"ping","sentAt":1793093836619}') });
  // From another panel, with text outside ASCII.
  fire('t', { type: 't', data: base64('{"x":-12,"label":"é – ✓"}') });
  // Longer data comes wrapped at 76 characters with CRLF.
  const long = { requested: { x: 1680, y: 1351, at: 1793094047243 }, before: { x: 2458, y: 1036 }, after: { x: 2458, y: 1036 }, dpr: 1 };
  fire('t', { type: 't', data: base64(JSON.stringify(long)).replace(/.{76}/g, '$&\r\n') });
  // Plain text that is not JSON.
  fire('t', { type: 't', data: base64('probe') });
  // Data sent without encoding, in case a later CEP stops encoding.
  fire('t', { type: 't', data: '{"x":1}' });
  fire('t', { type: 't', data: 'abcd' });

  // Through JSON, since objects parsed in the sandbox have its prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [
    { command: 'ping', sentAt: 1793093836619 },
    { x: -12, label: 'é – ✓' },
    long,
    'probe',
    { x: 1 },
    'abcd',
  ]);
});
