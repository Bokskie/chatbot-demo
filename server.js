/* ============================================================
   bokskie.ai - server.js
   ------------------------------------------------------------
   Zero-dependency Node server. Ito ang nagseserb ng website at
   ng API bridge, kaya ang mga keys mo ay nasa server lang
   (keys.local.json / .env) at NEVER sa browser.

   Patakbuhin:
       node server.js                 -> http://localhost:3000
       node server.js --port 4000
       node server.js --host 0.0.0.0  (LAN - mag-ingat!)
       node server.js --open          (bukas agad sa browser)

   Mga key (walang hardcode sa source code):
       keys.local.json   <- i-copy mula sa keys.example.json
       .env              <- i-copy mula sa .env.example
       Settings UI       <- nai-save nang automatico sa keys.local.json
       OPENAI_API_KEY / DEEPSEEK_API_KEY / ANTHROPIC_API_KEY /
       GEMINI_API_KEY    (totoong environment variable)

   Routes:
       GET    /api/health           -> { ok: true }
       GET    /api/status           -> providers, keys (masked), models
       POST   /api/keys             -> { provider, key, label, force }
       POST   /api/keys/remove      -> { provider, id }
       POST   /api/chat             -> SSE stream (normalized deltas)
   ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
    if (require.main === module) mod.main(process.argv.slice(2));
  } else {
    root.BokskieServer = mod;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "2.0.0";

  /* Files na hindi kailanman iseserb sa browser. */
  var PRIVATE = {
    "api.js": true,
    "server.js": true,
    "keys.local.json": true,
    ".env": true,
    ".env.local": true,
    "keys.example.json": true
  };

  var MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm"
  };

  /* ---------- small helpers ---------- */

  /** Byte length, walang Buffer dependency (para testable sa browser). */
  function byteLen(s) {
    if (typeof Buffer !== "undefined" && Buffer.byteLength) return Buffer.byteLength(s);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    return String(s).length;
  }

  function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": byteLen(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(body);
  }

  function sendText(res, status, text, type, origin) {
    var headers = {
      "Content-Type": type || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };
    var c = corsFor(origin);
    Object.keys(c).forEach(function (k) { headers[k] = c[k]; });
    res.writeHead(status, headers);
    res.end(text);
  }

  /** Basahin ang JSON body na may sukat limitasyon. */
  function readBody(req, limit, done) {
    var chunks = [];
    var size = 0;
    var tooBig = false;
    /* Sa Node, siguraduhing text ang chunks para hindi mabiyak ang
       multi-byte na letra sa dulo ng isang chunk. */
    if (typeof req.setEncoding === "function") req.setEncoding("utf8");
    req.on("data", function (c) {
      var s = typeof c === "string" ? c : String(c);
      size += byteLen(s);
      if (size > limit) { tooBig = true; return; }
      chunks.push(s);
    });
    req.on("end", function () {
      if (tooBig) return done(new Error("Request body is too large (limit is " + limit + " bytes)."));
      var raw = chunks.join("");
      if (!raw.trim()) return done(null, {});
      try { done(null, JSON.parse(raw)); }
      catch (e) { done(new Error("Body must be valid JSON.")); }
    });
    req.on("error", done);
  }

  /** Tanging local machine (at file:// = "null") lang ang pinapayagan. */
  function originAllowed(origin) {
    if (!origin) return true;                 /* same-origin, curl, health checks */
    if (origin === "null") return true;       /* naka-open ang index.html bilang file:// */
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(origin);
  }

  function corsFor(origin) {
    if (!origin || !originAllowed(origin)) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-bokskie-client",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    };
  }

  /** "/assets/a.png?x=1" -> safe relative path inside the site root. */
  function safePath(urlPath) {
    var raw = String(urlPath || "/");
    var q = raw.indexOf("?");
    if (q !== -1) raw = raw.slice(0, q);
    var hash = raw.indexOf("#");
    if (hash !== -1) raw = raw.slice(0, hash);
    try { raw = decodeURIComponent(raw); } catch (e) { return null; }
    if (raw.indexOf("\0") !== -1) return null;
    var parts = raw.split(/[\\/]+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || p === ".") continue;
      if (p === "..") return null;
      out.push(p);
    }
    return out.join("/");
  }

  function decSignal() {
    return {
      aborted: false,
      listeners: [],
      add: function (fn) { if (fn) this.listeners.push(fn); },
      abort: function () {
        this.aborted = true;
        var l = this.listeners;
        this.listeners = [];
        for (var i = 0; i < l.length; i++) { try { l[i](); } catch (e) { /* ignore */ } }
      }
    };
  }

  function sseHead(res, origin) {
    var headers = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff"
    };
    var c = corsFor(origin);
    Object.keys(c).forEach(function (k) { headers[k] = c[k]; });
    res.writeHead(200, headers);
  }

  function sseSend(res, payload) {
    res.write("data: " + JSON.stringify(payload) + "\n\n");
  }

  /* ============================================================
     ROUTER - puro logic ito, walang Node-specific na bagay, kaya
     natetest sa browser. Ang I/O ay dumadaan sa `deps`:
       api.status/addKey/removeKey/keyPlan/buildRequest/decoder/...
       readFile(rel) -> Buffer | null
       fetchStream({url, headers, body, onData, signal}) -> Promise
     ============================================================ */

  function createHandler(deps) {
    var api = deps.api;
    var fetchStream = deps.fetchStream;
    var readFile = deps.readFile;
    var log = deps.log || function () { };
    var maxBody = deps.maxBody || 64 * 1024;
    var keepAliveMs = deps.keepAliveMs || 15000;
    /* Optional: ask a local provider whether it is really up. Stubbed
       in tests, wired to a real HTTP probe in main(). */
    var probeLocal = deps.probeLocal || function (base, cb) { cb(false, []); };

    function replyJson(res, status, obj, origin) {
      var body = JSON.stringify(obj);
      var headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": byteLen(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      var c = corsFor(origin);
      Object.keys(c).forEach(function (k) { headers[k] = c[k]; });
      res.writeHead(status, headers);
      res.end(body);
    }

    function serveStatic(req, res, rel, origin) {
      var buf;
      try { buf = readFile(rel); } catch (e) { buf = null; }
      if (!buf) {
        log("WARN", "404 " + rel);
        return replyJson(res, 404, { ok: false, error: "Not found: /" + rel }, origin);
      }
      var dot = rel.lastIndexOf(".");
      var ext = dot === -1 ? "" : rel.slice(dot).toLowerCase();
      var headers = {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": buf.length,
        "X-Content-Type-Options": "nosniff"
      };
      /* Walang caching sa HTML/JS habang ginagawa, para hindi luma
         ang lumalabas pagkatapos mong mag-edit. */
      if (ext === ".html" || ext === ".js" || ext === ".css") {
        headers["Cache-Control"] = "no-cache";
      }
      res.writeHead(200, headers);
      if ((req.method || "GET").toUpperCase() === "HEAD") return res.end();
      res.end(buf);
    }

    return function handler(req, res) {
      var method = (req.method || "GET").toUpperCase();
      var url = String(req.url || "/");
      var origin = (req.headers && req.headers.origin) || "";

      function fail(status, message) {
        log("WARN", method + " " + url + " -> " + status + " " + message);
        replyJson(res, status, { ok: false, error: message }, origin);
      }

      /* Ang browser lang sa parehong makina (o file://) ang puede.
         Iba ang preflight para sa custom header, kaya hindi ito
         kayang gamitin ng ibang website na nakabukas. */
      if (origin && !originAllowed(origin)) {
        log("WARN", "blocked cross-origin " + method + " " + url + " from " + origin);
        return sendText(res, 403, "Cross-origin requests are not allowed.");
      }

      if (method === "OPTIONS") {
        res.writeHead(204, corsFor(origin));
        return res.end();
      }

      var path = (url.split("?")[0] || "/").replace(/\/+$/, "") || "/";

      if (method === "GET" && path === "/api/health") {
        return replyJson(res, 200, { ok: true, backend: "bokskie-server", version: VERSION }, origin);
      }

      if (method === "GET" && path === "/api/status") {
        var st = api.status();
        /* Ollama's "connected" is assumed by api.js, not measured. Swap
           it for a real reachability check so the card can honestly say
           whether Ollama is installed and running. */
        var ollama = st.providers.filter(function (p) { return p.id === "ollama"; })[0];
        var ollamaBase = (ollama && ollama.base) || "http://localhost:11434/v1";
        probeLocal(ollamaBase, function (running, models) {
          if (ollama) {
            ollama.localRunning = running;
            ollama.connected = running;
            ollama.installedModels = models;
          }
          log("INFO", "GET /api/status - connected: " +
            st.providers.filter(function (p) { return p.connected; }).map(function (p) { return p.id; }).join(", ") +
            (ollama ? (running ? "  (ollama running, " + models.length + " models)" : "  (ollama NOT reachable)") : ""));
          replyJson(res, 200, st, origin);
        });
        return;
      }

      if (method === "POST" && path === "/api/keys") {
        return readBody(req, maxBody, function (err, body) {
          if (err) return fail(400, err.message);
          var out = api.addKey(body.provider, body.key, body.label, !!body.force);
          if (!out.ok) return replyJson(res, 400, out, origin);
          log("INFO", "POST /api/keys - added a key for " + body.provider);
          return replyJson(res, 200, { ok: true, warning: out.warning, entry: out.entry, status: api.status() }, origin);
        });
      }

      if (method === "POST" && path === "/api/keys/remove") {
        return readBody(req, maxBody, function (err, body) {
          if (err) return fail(400, err.message);
          var out = api.removeKey(body.provider, body.id);
          if (!out.ok) return replyJson(res, 400, out, origin);
          log("INFO", "POST /api/keys/remove - removed a key for " + body.provider);
          return replyJson(res, 200, { ok: true, status: api.status() }, origin);
        });
      }

      if (method === "POST" && path === "/api/chat") {
        return readBody(req, maxBody, function (err, body) {
          if (err) return fail(400, err.message);
          handleChat(req, res, body, origin);
        });
      }

      if (method === "GET" || method === "HEAD") {
        var rel = safePath(url);
        if (rel === null) return sendText(res, 400, "Bad path", null, origin);
        if (PRIVATE[rel]) {
          return sendText(res, 403, "This file is private. It is never served over HTTP.", null, origin);
        }
        if (!rel) rel = "index.html";
        return serveStatic(req, res, rel, origin);
      }

      return fail(405, method + " is not allowed on " + path);
    };

    /* ============================================================
       CHAT PROXY - isa itong SSE bridge:
       browser -> server -> provider -> normalized deltas -> browser
       Kapag 401/402/429/5xx ang isang key, susubukan ang susunod
       na key (failover) basta wala pang naipadalang text.
       ============================================================ */
    function handleChat(req, res, body, origin) {
      var provider = String(body.provider || "").toLowerCase();
      var info = api.info(provider);

      /* Runs in the browser like demo, so the server never has to know
         about it: there is no upstream to call. */
      if (provider === "demo" || provider === "bokskie-local") {
        return replyJson(res, 400, { ok: false, error: "That provider runs inside the browser, not on the server." }, origin);
      }
      if (!info) {
        return replyJson(res, 400, {
          ok: false,
          error: "Unknown provider \"" + provider + "\". Choose one of: " + api.providers().join(", ") + "."
        }, origin);
      }

      var model = api.resolveModel(provider, body.model) || api.defaultModel(provider);
      var owner = api.providerOfModel(model);
      if (owner && owner !== provider) {
        return replyJson(res, 400, {
          ok: false,
          error: "The model " + model + " belongs to " + api.info(owner).label + ", but the provider is " +
            info.label + ". Pick a " + info.label + " model."
        }, origin);
      }

      var plan = api.keyPlan(provider);
      if (info.auth === "none") {
        plan = [{ key: "", label: "local", source: "none" }];
      } else if (!plan.length) {
        return replyJson(res, 400, {
          ok: false,
          needKey: provider,
          error: "Walang " + info.label + " API key sa server. Ilagay ito sa keys.local.json (" +
            info.keyHint + "), o idagdag sa Settings, tapos subukan ulit."
        }, origin);
      }

      var messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) {
        return replyJson(res, 400, { ok: false, error: "No messages were sent." }, origin);
      }

      var signal = decSignal();
      if (typeof req.on === "function") {
        req.on("close", function () {
          if (!res.writableEnded) signal.abort();
        });
      }

      sseHead(res, origin);
      var keepAlive = keepAliveMs
        ? setInterval(function () {
          if (!res.writableEnded) res.write(": keepalive\n\n");
        }, keepAliveMs)
        : null;

      function finish() {
        if (keepAlive) clearInterval(keepAlive);
        if (!res.writableEnded) res.end();
      }

      function pushEvents(events, state) {
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          if (ev.type === "delta") {
            state.sent++;
            sseSend(res, { delta: ev.text });
          } else if (ev.type === "error") {
            state.err = ev.message;
            sseSend(res, { error: { message: ev.message, provider: provider, status: 200, retryWithAnotherKey: false } });
          } else if (ev.type === "done") {
            sseSend(res, { done: true });
          }
        }
      }

      var attempt = 0;

      function tryNext(lastError) {
        if (signal.aborted) {
          log("INFO", "client disconnected - stopping " + provider);
          return finish();
        }
        if (attempt >= plan.length) {
          sseSend(res, {
            error: lastError || { message: "Failed to reach " + info.label + ".", provider: provider, status: 0 }
          });
          return finish();
        }

        var key = plan[attempt++];
        var built;
        try {
          built = api.buildRequest(provider, {
            model: model,
            messages: messages,
            system: body.system,
            temperature: body.temperature,
            baseUrl: body.baseUrl,
            maxTokens: body.maxTokens
          }, key.key);
        } catch (e) {
          sseSend(res, { error: { message: String((e && e.message) || e), provider: provider, status: 0 } });
          return finish();
        }

        var decoder = api.decoder(provider);
        var state = { sent: 0, err: null };
        log("INFO", "POST /api/chat provider=" + provider + " model=" + model +
          " key=" + api.mask(key.key || "(none)") + " src=" + key.source +
          (plan.length > 1 ? " (key " + attempt + "/" + plan.length + ")" : ""));

        fetchStream({
          url: built.url,
          method: built.method,
          headers: built.headers,
          body: built.json,
          json: built.body,
          timeoutMs: 300000,
          signal: signal,
          onData: function (chunk) {
            pushEvents(decoder.push(chunk), state);
          }
        }).then(function (up) {
          if (signal.aborted) return finish();

          if (up && up.status >= 400) {
            var sum = api.summarizeError(provider, up.status, up.text);
            log("WARN", "provider " + provider + " HTTP " + up.status +
              " key=" + api.mask(key.key || "(none)") + " :: " + sum.detail);
            if (sum.retryWithAnotherKey && attempt < plan.length && !state.sent) {
              log("INFO", "trying the next key for " + provider);
              return tryNext({
                message: sum.message, provider: provider, status: up.status,
                detail: sum.detail, retryWithAnotherKey: true
              });
            }
            sseSend(res, {
              error: {
                message: sum.message, provider: provider, status: up.status,
                detail: sum.detail, retryWithAnotherKey: sum.retryWithAnotherKey
              }
            });
            return finish();
          }

          pushEvents(decoder.flush(), state);

          if (!state.sent && !state.err) {
            sseSend(res, {
              error: {
                message: info.label + " returned an empty response. Subukan ulit, o palitan ang model.",
                provider: provider, status: 200, retryWithAnotherKey: false
              }
            });
          } else if (state.sent) {
            sseSend(res, { done: true });
          }
          finish();
        }).catch(function (e) {
          if (signal.aborted) return finish();
          var aborted = e && (e.name === "AbortError" || /abort/i.test(String((e && e.message) || "")));
          if (aborted) return finish();

          var sum = api.summarizeError(provider, 0, e && e.message);
          log("WARN", "provider " + provider + " network error: " + (e && e.message));
          if (sum.retryWithAnotherKey && attempt < plan.length && !state.sent) {
            return tryNext({
              message: sum.message, provider: provider, status: 0,
              detail: sum.detail, retryWithAnotherKey: true
            });
          }
          sseSend(res, {
            error: { message: sum.message, provider: provider, status: 0, detail: sum.detail }
          });
          finish();
        });
      }

      tryNext(null);

    }

  }

  /* ============================================================
     NODE WIRING - ito lang ang Node-specific na bahagi.
     ============================================================ */

  /* ============================================================
     .ENV LOADER - zero dependency (walang dotenv package).
     Binabasa lang ang .env, hindi ito sinusulatan at hindi
     ito nag-o-override ng totoong environment variables.
     ============================================================ */

  function loadDotEnv(root) {
    var out = {};
    var nodeFs = require("fs");
    var nodePath = require("path");
    var raw;
    try { raw = nodeFs.readFileSync(nodePath.join(root, ".env"), "utf8"); } catch (e) { return out; }
    String(raw).split(/\r?\n/).forEach(function (line) {
      var t = String(line).trim();
      if (!t || t.charAt(0) === "#") return;                    /* comment / blank */
      if (t.indexOf("=") === -1) return;
      var name = t.slice(0, t.indexOf("=")).trim();
      var val = t.slice(t.indexOf("=") + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
      var q = val.charAt(0);
      if (q === '"' || q === "'") {
        /* Quoted: everything after the closing quote is ignored, so
           KEY="abc"   # note   ->  abc                                */
        var close = val.indexOf(q, 1);
        out[name] = close === -1 ? val.slice(1) : val.slice(1, close);
        return;
      }
      out[name] = val.replace(/\s+#.*$/, "").trim();               /* strip trailing comment */
    });
    return out;
  }

  /* ============================================================
     OLLAMA REACHABILITY PROBE
     api.js marks any auth:"none" provider as connected, which is
     right for "needs no key" but wrong for "is it actually up".
     Ollama is a separate program: it may not be installed, or
     installed but not running, and the old card claimed
     "Connected · local" either way. Ask the real thing instead,
     briefly, and cache it so opening Settings does not fire a
     request per card render.
     ============================================================ */

  var localCache = {};        /* base -> { at, ok, models } */
  var PROBE_TTL_MS = 5000;

  function probeOllama(base, callback) {
    var url = base || "http://localhost:11434/v1";
    var hit = localCache[url];
    if (hit && Date.now() - hit.at < PROBE_TTL_MS) {
      return callback(hit.ok, hit.models);
    }

    var target;
    try {
      target = new (require("url").URL)(url.replace(/\/+$/, "") + "/models");
    } catch (e) {
      return callback(false, []);
    }

    var mod = target.protocol === "https:" ? require("https") : require("http");
    var settled = false;
    function finish(ok, models) {
      if (settled) return;
      settled = true;
      localCache[url] = { at: Date.now(), ok: ok, models: models || [] };
      callback(ok, models || []);
    }

    try {
      var req = mod.get({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        timeout: 1200
      }, function (res) {
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function (c) { if (body.length < 40000) body += c; });
        res.on("end", function () {
          if (res.statusCode !== 200) return finish(false, []);
          var models = [];
          try {
            var j = JSON.parse(body);
            if (j && j.data) {
              models = j.data.map(function (m) { return m.id || m.name; }).filter(Boolean);
            }
          } catch (e) { /* reachable, just not the JSON we hoped for */ }
          finish(true, models);
        });
      });
      req.on("error", function () { finish(false, []); });
      req.on("timeout", function () {
        try { req.destroy(); } catch (e) { /* already gone */ }
        finish(false, []);
      });
    } catch (e) {
      finish(false, []);
    }
  }

  function nodeIO(root) {
    var nodeFs = require("fs");
    var nodePath = require("path");
    var dotenv = loadDotEnv(root);
    return {
      readText: function (file) {
        try { return nodeFs.readFileSync(nodePath.join(root, file), "utf8"); } catch (e) { return null; }
      },
      writeText: function (file, text) {
        nodeFs.writeFileSync(nodePath.join(root, file), text, "utf8");
      },
      /* Real env wins over .env - para ma-override mo kahit sa shell. */
      env: function (name) {
        var live = process.env[name];
        if (live !== undefined && live !== "") return live;
        return dotenv[name];
      }
    };
  }

  function makeReadFile(root) {
    var nodeFs = require("fs");
    var nodePath = require("path");
    var base = nodePath.resolve(root);
    return function (rel) {
      var full = nodePath.resolve(base, rel);
      if (full !== base && full.indexOf(base + nodePath.sep) !== 0) return null;
      var st;
      try { st = nodeFs.statSync(full); } catch (e) { return null; }
      if (!st.isFile()) return null;
      try { return nodeFs.readFileSync(full); } catch (e) { return null; }
    };
  }

  /** Tawag sa provider sa pamamagitan ng http/https module (walang deps). */
  function nodeFetchStream(opts) {
    return new Promise(function (resolve, reject) {
      var nodeUrl = require("url");
      var nodeHttp = require("http");
      var nodeHttps = require("https");
      var u = new nodeUrl.URL(opts.url);
      var isHttp = u.protocol === "http:";
      var mod = isHttp ? nodeHttp : nodeHttps;
      var settled = false;

      function done(fn, value) {
        if (settled) return;
        settled = true;
        fn(value);
      }

      var upReq = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttp ? 80 : 443),
        path: u.pathname + u.search,
        method: opts.method || "POST",
        headers: opts.headers
      }, function (up) {
        var status = up.statusCode || 0;
        up.setEncoding("utf8");
        if (status >= 400) {
          var buf = "";
          up.on("data", function (c) { buf += c; });
          up.on("end", function () { done(resolve, { status: status, headers: up.headers, text: buf }); });
          up.on("error", function (e) { done(reject, e); });
          return;
        }
        up.on("data", function (c) { try { opts.onData(c); } catch (e) { /* ignore */ } });
        up.on("end", function () { done(resolve, { status: status, headers: up.headers }); });
        up.on("error", function (e) { done(reject, e); });
      });

      upReq.on("error", function (e) { done(reject, e); });

      if (opts.timeoutMs) {
        upReq.setTimeout(opts.timeoutMs, function () {
          var err = new Error("The provider did not answer within " + Math.round(opts.timeoutMs / 1000) + "s.");
          try { upReq.destroy(); } catch (e) { /* ignore */ }
          done(reject, err);
        });
      }
      if (opts.signal) {
        opts.signal.add(function () {
          try { upReq.destroy(); } catch (e) { /* ignore */ }
          var err = new Error("aborted");
          err.name = "AbortError";
          done(reject, err);
        });
      }

      if (opts.body) upReq.write(opts.body);
      upReq.end();
    });
  }

  /* ============================================================
     CLI
     ============================================================ */

  function parseArgs(argv) {
    var out = { port: 3000, host: "127.0.0.1", open: false, help: false };
    var list = argv || [];
    for (var i = 0; i < list.length; i++) {
      var a = String(list[i]);
      if (a === "--port" || a === "-p") out.port = Number(list[++i]) || out.port;
      else if (a.indexOf("--port=") === 0) out.port = Number(a.slice(7)) || out.port;
      else if (a === "--host") out.host = String(list[++i] || out.host);
      else if (a.indexOf("--host=") === 0) out.host = a.slice(7);
      else if (a === "--open" || a === "-o") out.open = true;
      else if (a === "--help" || a === "-h") out.help = true;
    }
    return out;
  }

  function logLine(level, msg) {
    var t = new Date().toISOString().slice(11, 19);
    var line = "[" + t + "] " + level + " " + msg;
    if (level === "WARN" || level === "ERROR") console.error(line);
    else console.log(line);
  }

  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }

  function openBrowser(url) {
    try {
      var cp = require("child_process");
      if (process.platform === "win32") cp.exec('start "" "' + url + '"');
      else if (process.platform === "darwin") cp.exec('open "' + url + '"');
      else cp.exec('xdg-open "' + url + '"');
    } catch (e) { /* ignore */ }
  }

  function printHelp() {
    console.log([
      "",
      "bokskie.ai server " + VERSION + " - zero dependencies",
      "",
      "  node server.js                http://localhost:3000",
      "  node server.js --port 4000    ibang port",
      "  node server.js --open         buksan agad ang browser",
      "  node server.js --host 0.0.0.0 papuntang LAN (mag-ingat!)",
      "",
      "  Ang mga API keys ay nasa keys.local.json, .env, o environment",
      "  variables (OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY,",
      "  GEMINI_API_KEY). Hindi kailanman ipinapadala sa browser ang keys,",
      "  at walang naka-hardcode sa source code.",
      ""
    ].join("\n"));
  }

  function banner(api, args, root) {
    var st = api.status();
    var url = "http://" + (args.host === "0.0.0.0" ? "localhost" : args.host) + ":" + args.port + "/";
    var lines = [
      "",
      "  bokskie.ai server v" + VERSION + "  (zero dependencies)",
      "  -------------------------------------------------------------",
      "  buksan:  " + url,
      "  root:    " + root,
      "  keys:    .env + " + st.storeFile + " + environment  (never in the source code, never sent to the browser)",
      ""
    ];
    for (var i = 0; i < st.providers.length; i++) {
      var p = st.providers[i];
      var state;
      if (p.local) state = "local - ready";
      else if (p.connected) state = "READY (" + p.keyCount + " key" + (p.keyCount > 1 ? "s" : "") + ")";
      else state = "walang key - ilagay sa keys.local.json";
      lines.push("  " + pad(p.label, 20) + pad(state, 32) + (p.defaultModel || ""));
    }
    if (st.warnings.length) {
      lines.push("");
      lines.push("  warnings:");
      for (var j = 0; j < st.warnings.length; j++) lines.push("   - " + st.warnings[j]);
    }
    if (args.host !== "127.0.0.1" && args.host !== "localhost") {
      lines.push("");
      lines.push("  NOTE: nakabukas sa " + args.host + " - kahit sino sa network na iyon ay");
      lines.push("        makakagamit ng keys mo. Localhost lang ang mas safe.");
    }
    lines.push("");
    console.log(lines.join("\n"));
  }

  function main(argv) {
    var args = parseArgs(argv);
    if (args.help) return printHelp();

    var nodeHttp = require("http");
    var root = __dirname;
    var api = require("./api.js").createAPI(nodeIO(root), { version: VERSION });
    var handler = createHandler({
      api: api,
      fetchStream: nodeFetchStream,
      readFile: makeReadFile(root),
      probeLocal: probeOllama,
      log: logLine
    });

    var server = nodeHttp.createServer(handler);

    server.on("error", function (e) {
      if (e && e.code === "EADDRINUSE") {
        console.error("\nPort " + args.port + " is already in use. Try:  node server.js --port " +
          (args.port + 1) + "\n");
      } else {
        console.error("\nServer error: " + (e && e.message) + "\n");
      }
      process.exitCode = 1;
    });

    server.listen(args.port, args.host, function () {
      var url = "http://" + (args.host === "0.0.0.0" ? "localhost" : args.host) + ":" + args.port + "/";
      banner(api, args, root);
      if (args.open) openBrowser(url);
    });

    process.on("SIGINT", function () {
      console.log("\nbokskie.ai server stopped.");
      server.close(function () { process.exit(0); });
    });

    return server;
  }

  /* ============================================================
     EXPORTS (Node: module.exports | Browser test: window.BokskieServer)
     ============================================================ */
  return {
    VERSION: VERSION,
    byteLen: byteLen,
    safePath: safePath,
    originAllowed: originAllowed,
    decSignal: decSignal,
    createHandler: createHandler,
    nodeIO: nodeIO,
    makeReadFile: makeReadFile,
    nodeFetchStream: nodeFetchStream,
    parseArgs: parseArgs,
    probeOllama: probeOllama,
    main: main
  };
});

