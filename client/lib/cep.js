'use strict';

// The few CEP calls AfterEase needs, straight on window.__adobe_cep__, so
// there is no vendored CSInterface.js. A UXP port replaces this file and
// host.js, nothing else in client/.

(function (global) {
  const native = global.__adobe_cep__;

  function parseData(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return data; }
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
