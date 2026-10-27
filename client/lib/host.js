'use strict';

// Calls into the ExtendScript host layer. Every call is one evalScript round
// trip that returns {"ok":true,"result":...} or {"ok":false,"error":...}.

(function (global) {
  const cep = global.cep;

  const host = {
    async load(root) {
      const r = await cep.evalScript(
        `$.evalFile(new File(${JSON.stringify(root + '/host/main.jsx')})); AfterEaseLoad(${JSON.stringify(root)})`);
      if (r !== 'ok') throw new Error(`Host layer did not load: ${r}`);
    },

    async call(name, args) {
      const raw = await cep.evalScript(
        `AfterEase.call(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args || {}))})`);
      let reply;
      try {
        reply = JSON.parse(raw);
      } catch (e) {
        throw new Error(`Host returned something that is not JSON: ${raw}`);
      }
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
  };

  global.host = host;
}(window));
