/* ==========================================================
   bokskie.ai - backend.js
   The browser half of server.js. Talks to the local backend
   over same-origin routes:

     GET    ./api/health      -> is the server running?
     GET    ./api/status      -> providers, masked keys, models
     POST   ./api/keys        -> add a key (saved server-side)
     POST   ./api/keys/remove -> delete a store-sourced key
     POST   ./api/chat        -> SSE stream of normalized deltas

   Keys never touch this file: the server owns them. When no
   backend answers (static hosting, file://), `on()` stays
   false and llm.js keeps using its direct browser->provider
   path instead.
   ========================================================== */
(function (global) {
  "use strict";

  var state = { probed: false, up: false, info: null, probing: null };

  function apiUrl(path) {
    /* Relative to index.html so the site works when server.js
       serves it from any root (localhost, LAN, tunnel). */
    return String(path);
  }

  async function json(method, path, body) {
    var res = await global.fetch(apiUrl(path), {
      method: method,
      headers: { "Content-Type": "application/json", "x-bokskie-client": "bokskie-ui" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    var text = "";
    try { text = await res.text(); } catch (e) { /* ignore */ }
    var j = null;
    try { j = JSON.parse(text); } catch (e) { /* not json */ }
    if (!res.ok) {
      var err = new Error((j && j.error) || ("HTTP " + res.status + " from " + path));
      err.status = res.status;
      err.needKey = j && j.needKey;
      err.mismatch = j && j.mismatch;
      err.payload = j;
      throw err;
    }
    return j;
  }

  /** One probe per page load; `force` re-checks (e.g. after starting the server). */
  function probe(timeoutMs, force) {
    if (state.probing) return state.probing;
    if (state.probed && !force) return Promise.resolve(state);

    state.probing = (async function () {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = ctrl
        ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } }, timeoutMs || 1500)
        : null;
      try {
        var res = await global.fetch(apiUrl("./api/health"), ctrl ? { signal: ctrl.signal } : undefined);
        var j = null;
        try { j = await res.json(); } catch (e) { j = null; }
        state.up = !!(res.ok && j && j.ok);
        state.info = state.up ? j : null;
      } catch (e) {
        /* Static host, file://, or the server is not running:
           that is a normal state, not an error worth showing. */
        state.up = false;
        state.info = null;
      } finally {
        if (timer) clearTimeout(timer);
        state.probing = null;
        state.probed = true;
        try {
          global.dispatchEvent(new CustomEvent("bokskie:backend", { detail: state }));
        } catch (e) { /* older browsers */ }
      }
      return state;
    })();

    return state.probing;
  }

  function on() { return !!state.up; }

  function status() { return json("GET", "./api/status"); }

  /** { provider, key, label, force } -> { ok, entry, status, warning } */
  function addKey(opts) {
    return json("POST", "./api/keys", {
      provider: opts && opts.provider,
      key: opts && opts.key,
      label: opts && opts.label,
      force: !!(opts && opts.force)
    });
  }

  /** { provider, id } -> { ok, status } - only keys saved via the UI. */
  function removeKey(provider, id) {
    return json("POST", "./api/keys/remove", { provider: provider, id: id });
  }

  /* Same contract as LLM.stream: an async generator of text deltas.
     The server speaks a normalized SSE dialect ({delta},{done},{error}),
     so one reader covers every provider. */
  async function* stream(settings, history, signal) {
    var payload = {
      provider: settings.provider,
      model: settings.model,
      system: settings.system,
      temperature: settings.temperature,
      baseUrl: settings.baseUrl,
      maxTokens: settings.maxTokens,
      messages: (history || []).map(function (m) {
        return { role: m.role, content: m.content };
      })
    };

    var res;
    try {
      res = await global.fetch(apiUrl("./api/chat"), {
        method: "POST",
        signal: signal,
        headers: { "Content-Type": "application/json", "x-bokskie-client": "bokskie-ui" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      if (e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")))) throw e;
      var down = new Error(
        "Could not reach the bokskie server on this machine. " +
        "Start it with `node server.js --open`, then press Retry."
      );
      down.status = 0;
      throw down;
    }

    if (!res.ok) {
      var body = "";
      try { body = await res.text(); } catch (e) { /* ignore */ }
      var j = null;
      try { j = JSON.parse(body); } catch (e) { /* not json */ }
      var bad = new Error((j && j.error) || ("HTTP " + res.status + " from the server."));
      bad.status = res.status;
      bad.needKey = j && j.needKey;
      throw bad;
    }

    if (!res.body || !res.body.getReader) {
      var naive = new Error("This browser cannot read streaming responses.");
      naive.status = 0;
      throw naive;
    }

    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    try {
      while (true) {
        var step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.charAt(0) === ":" || line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (!data) continue;
          var ev;
          try { ev = JSON.parse(data); } catch (e) { continue; }   // malformed frame: skip
          if (ev.delta) {
            yield ev.delta;
          } else if (ev.done) {
            return;
          } else if (ev.error) {
            var err = new Error(ev.error.message || "The server reported an error.");
            err.status = ev.error.status;
            err.provider = ev.error.provider;
            err.detail = ev.error.detail;
            throw err;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (e) { /* ignore */ }
    }
  }

  global.Backend = {
    state: state,
    probe: probe,
    on: on,
    status: status,
    addKey: addKey,
    removeKey: removeKey,
    stream: stream
  };

  /* Auto-probe as soon as the page can. app.js listens for the
     "bokskie:backend" event to flip the UI into backend mode. */
  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", function () { probe(); });
    } else {
      setTimeout(function () { probe(); }, 0);
    }
  }
})(window);
