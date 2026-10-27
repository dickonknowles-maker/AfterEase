'use strict';

// The few CEP calls AfterEase needs, straight on window.__adobe_cep__, so
// there is no vendored CSInterface.js. A UXP port replaces this file and
// host.js, nothing else in client/.

(function (global) {
  const native = global.__adobe_cep__;

  // CEP 12 in AE 26.5 delivers event data base64-encoded, whether a panel or
  // ExtendScript sent it, with a line break every 76 characters. Anything
  // that isn't valid base64 of UTF-8 is kept as it came.
  function decodeBase64(text) {
    const compact = text.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4) return text;
    try {
      const bytes = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return text;
    }
  }

  function parseData(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { /* not JSON as sent */ }
    const text = decodeBase64(data);
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  const cep = {
    available: !!native,

    nodeRequire: global.cep_node ? global.cep_node.require : global.require,

    hostEnvironment() {
      return JSON.parse(native.getHostEnvironment());
    },

    extensionPath() {
      let p = decodeURI(native.getSystemPath('extension'));
      p = p.replace(/^file:\/\/\/(?=[A-Za-z]:)/, '').replace(/^file:\/\//, '');
      return p.replace(/\\/g, '/');
    },

    evalScript(script) {
      return new Promise(resolve => native.evalScript(script, resolve));
    },

    // handler(data, rawEvent); data is parsed from JSON when it can be.
    on(type, handler) {
      native.addEventListener(type, event => {
        const e = typeof event === 'string' ? parseData(event) : event;
        handler(parseData(e && e.data), e);
      });
    },

    dispatch(type, data) {
      native.dispatchEvent({
        type,
        scope: 'APPLICATION',
        appId: cep.hostEnvironment().appId,
        extensionId: native.getExtensionId ? native.getExtensionId() : '',
        data: typeof data === 'string' ? data : JSON.stringify(data),
      });
    },

    openExtension(id, params = '') {
      native.requestOpenExtension(id, params);
    },

    closeThisExtension() {
      native.closeExtension();
    },
  };

  global.cep = cep;
}(window));
