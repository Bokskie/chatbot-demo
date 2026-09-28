/* ============================================================
   bokskie.ai - tests/verify.node.js
   ------------------------------------------------------------
   A dependency-free test runner. Run it with:

       node tests/verify.node.js

   The other files in tests/ are browser harnesses (open the .html
   in a tab). This one covers the logic that has no DOM: the mode
   detector, the stream decoders, key handling, and request
   building. Run it in CI, or before you push.

   Every check prints PASS or FAIL. Exit code is 1 if anything
   failed, so a script or CI job can gate on it.
   ============================================================ */

"use strict";

var path = require("path");
var fs = require("fs");
var ROOT = path.join(__dirname, "..");

var pass = 0, fail = 0;
var failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else {
    fail++;
    failures.push(name + (extra !== undefined ? "  -> " + extra : ""));
    console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + extra : ""));
  }
}
function eq(name, a, b) {
  ok(name, a === b, JSON.stringify(a) + " !== " + JSON.stringify(b));
}
function section(t) { console.log(""); console.log(t); }

/* modes.js and llm.js attach themselves to `window`; give them one. */
global.window = {};
require(path.join(ROOT, "assets/js/modes.js"));
require(path.join(ROOT, "assets/js/llm.js"));
var Modes = global.window.Modes;
var A = require(path.join(ROOT, "api.js"));

/* ============================================================
   1. MODE DETECTION
      The bug this guards: "what's a good horror film?" matched the
      old RE_LEARN ("what is|whats|ano ang") and was forced into
      Study mode. Study is the Vue tutor, so the model answered the
      film question and then tacked on a Vue "Try this" challenge.
   ============================================================ */
section("1. mode detection - general questions must not hit the Vue tutor");

(function () {
  var wantGeneral = [
    "what is a good horror film",
    "what's a good horror film",
    "ano maganda horror film",
    "ano ang pinakamahusay na pelikula",
    "paano gumana ang venus",
    "what is the capital of Japan",
    "ano ang recipe ng adobo"
  ];
  wantGeneral.forEach(function (t) {
    var r = Modes.detect(t);
    eq("general: " + t, r && r.mode, "general");
  });

  /* A bare opinion question carries no signal at all, so detect()
     returns null and the mode is left alone. The Study prompt's
     STAY ON TOPIC rules are the backstop for that case - it must
     never be quietly routed into the Vue tutor. */
  [
    "best horror movie of all time",
    "good scary films to watch",
    "anong pelikula ang pinakamaganda"
  ].forEach(function (t) {
    var r = Modes.detect(t);
    ok("never routes to study: " + t, !r || r.mode !== "study", r && r.mode);
  });

  var wantStudy = [
    "I want to learn vue.js",
    "gusto ko matutu ng vue",
    "teach me react",
    "quiz me on pinia",
    "explain computed properties",
    "ano ang composition api",
    "tutor me in javascript"
  ];
  wantStudy.forEach(function (t) {
    var r = Modes.detect(t);
    eq("study: " + t, r && r.mode, "study");
  });

  eq("build: build me a website", Modes.detect("build me a website").mode, "build");
  eq("build: gawa ka ng portfolio", Modes.detect("gawa ka ng portfolio").mode, "build");

  /* A bare topic word must stay unconfident so the app asks. */
  eq("bare topic still asks", Modes.detect("vue").confident, false);
  /* Too short to classify at all. */
  eq("too short returns null", Modes.detect("ok"), null);
})();


/* ============================================================
   2. GEMINI DECODER
      Thinking models (2.5 / 3.x) stream the reasoning summary in
      the same parts array, flagged "thought": true. Those parts
      routinely quote the system prompt back, which is how Vue text
      ended up inside a movie answer. Only non-thought parts count.
   ============================================================ */
section("2. gemini decoder - thought parts are dropped");

(function () {
  function run(sse) {
    var d = A.decoder("gemini");
    var evs = d.push(sse);
    return {
      text: evs.filter(function (e) { return e.type === "delta"; })
               .map(function (e) { return e.text; }).join(""),
      done: evs.some(function (e) { return e.type === "done"; })
    };
  }

  var out = run(
    'data: {"candidates":[{"content":{"role":"model","parts":' +
    '[{"text":"**Reasoning:** the system prompt says I am a Vue 3 study partner, so I should add a Try this challenge","thought":true}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Try ","thought":true}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hereditary"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" and Midsommar."}]},"finishReason":"STOP"}]}\n\n'
  );
  eq("thought text removed", out.text, "Hereditary and Midsommar.");
  ok("no Vue leak in reply", !/vue|study partner|try this/i.test(out.text), out.text);
  ok("done event still fires", out.done);

  var plain = run(
    'data: {"candidates":[{"content":{"parts":[{"text":"Just "}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"text":"text."}]},"finishReason":"STOP"}]}\n\n'
  );
  eq("plain stream unchanged", plain.text, "Just text.");

  /* A tail part carrying only a signature must not break the stream. */
  var tail = run(
    'data: {"candidates":[{"content":{"parts":[{"text":"Hi."}]},"finishReason":"STOP"}],' +
    '"usageMetadata":{"totalTokenCount":9}}\n\n'
  );
  eq("signature-only tail ignored", tail.text, "Hi.");
})();

/* ============================================================
   3. OTHER DIALECTS UNAFFECTED
   ============================================================ */
section("3. openai and anthropic decoders unaffected");

(function () {
  function textOf(evs) {
    return evs.filter(function (e) { return e.type === "delta"; })
              .map(function (e) { return e.text; }).join("");
  }

  var o = A.decoder("openai");
  var oe = o.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
                 'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n' +
                 'data: [DONE]\n\n');
  eq("openai text", textOf(oe), "Hello");
  ok("openai done", oe.some(function (e) { return e.type === "done"; }));

  var an = A.decoder("anthropic");
  var ae = an.push('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n' +
                   'data: {"type":"message_stop"}\n\n');
  eq("anthropic text", textOf(ae), "Hi");
  ok("anthropic done", ae.some(function (e) { return e.type === "done"; }));
})();

/* ============================================================
   4. NO API KEY IS HARDCODED
      The whole point of the keys.local.json / .env split.
   ============================================================ */
section("4. no inline keys in api.js");

(function () {
  var dirty = A.providers().filter(function (id) { return (A.KEYS[id] || []).length > 0; });
  eq("inline KEYS are all empty", dirty.length, 0);

  var gi = path.join(ROOT, ".gitignore");
  if (fs.existsSync(gi)) {
    var txt = fs.readFileSync(gi, "utf8");
    ok(".gitignore covers keys.local.json", /keys\.local\.json/.test(txt));
    ok(".gitignore covers .env", /^\s*\.env\s*$/m.test(txt));
  }

  /* Path normalisation must reject traversal. */
  var S = require(path.join(ROOT, "server.js"));
  eq("traversal rejected", S.safePath("/..%2fapi.js"), null);
  eq("traversal rejected (plain)", S.safePath("/../api.js"), null);
  eq("normal path kept", S.safePath("/assets/js/app.js"), "assets/js/app.js");
})();

/* ============================================================
   5. REQUEST BUILDING PER DIALECT
   ============================================================ */
section("5. request building per dialect");

(function () {
  var hist = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];

  var g = A.buildRequest("gemini", { model: "gemini-3.8-flash", messages: hist, system: "S" }, "AQ.AbTest");
  var gb = JSON.parse(g.json);
  eq("gemini sse url", g.url.indexOf(":streamGenerateContent?alt=sse") !== -1, true);
  eq("gemini auth header", g.headers["x-goog-api-key"], "AQ.AbTest");
  eq("gemini systemInstruction", gb.systemInstruction.parts[0].text, "S");
  eq("gemini assistant role is model", gb.contents[1].role, "model");
  eq("gemini user role is user", gb.contents[0].role, "user");

  var o = A.buildRequest("openai", { model: "gpt-5.6-luna", messages: hist, system: "S" }, "sk-test123");
  var ob = JSON.parse(o.json);
  eq("openai system first", ob.messages[0].role, "system");
  eq("openai endpoint", o.url, "https://api.openai.com/v1/chat/completions");
  eq("openai bearer", o.headers.Authorization, "Bearer sk-test123");
})();

/* ============================================================
   6. ICON SPRITE SANITY
      Every <svg class="ico"> needs a viewBox. Without it the 24x24
      sprite paths were clipped inside the 20px box and sat
      off-centre, which is what the icons looked like.
   ============================================================ */
section("6. every icon has a viewBox");

(function () {
  var total = 0, missing = 0;
  ["index.html", "assets/js/app.js", "assets/js/markdown.js"].forEach(function (rel) {
    var full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    (fs.readFileSync(full, "utf8").match(/<svg\b[^>]*>/g) || []).forEach(function (tag) {
      if (tag.indexOf("sprite") !== -1) return;          /* the defs holder */
      total++;
      if (tag.indexOf("viewBox") === -1) { missing++; console.log("         missing: " + tag); }
    });
  });
  ok("all " + total + " icons carry a viewBox", missing === 0, missing + " missing");

  /* The sprite paths are drawn on a 24x24 grid, so that is exactly
     the viewBox every icon must declare. */
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("icons use the 0 0 24 24 grid", /viewBox="0 0 24 24" class="ico/.test(html));
})();

/* ============================================================
   7. THE SERVER REFUSES TO SERVE THE SECRETS
      Checks the real request handler, not a re-implementation:
      a browser asking for api.js / keys.local.json / .env must
      get 403, while a normal asset still gets 200.
   ============================================================ */
section("7. server answers 403 for private files");

function FakeRes() { this.status = 0; this.chunks = []; this.headers = {}; }
FakeRes.prototype.writeHead = function (s, h) { this.status = s; this.headers = h || {}; };
FakeRes.prototype.end = function (c) { if (c !== undefined && c !== null) this.chunks.push(c); };
FakeRes.prototype.text = function () { return this.chunks.join(""); };

function makeHandler() {
  var S = require(path.join(ROOT, "server.js"));
  var api = A.createAPI(A.memoryIO({}), { version: "test" });
  return S.createHandler({
    api: api,
    fetchStream: function () { return Promise.reject(new Error("no network in tests")); },
    readFile: function () { return Buffer.from("file contents"); },
    log: function () {}
  });
}

function call(handler, method, url) {
  return new Promise(function (resolve) {
    var res = new FakeRes();
    res.write = function () {};
    var done = function () { resolve(res); };
    var r;
    try { r = handler({ method: method, url: url, headers: { host: "localhost:3000" } }, res); }
    catch (e) { return done(); }
    if (r && typeof r.then === "function") r.then(done, done);
    else setTimeout(done, 0);
  });
}

/* ============================================================
   8. OUT-OF-CREDITS vs RATE-LIMIT
      OpenAI answers 429 + "insufficient_quota" when the account has
      no credit. Keying off the status alone made it read as a plain
      rate limit, so people waited for a reset that never came.
   ============================================================ */
function billingChecks() {
  var quota = A.summarizeError("openai", 429,
    '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.",' +
    '"type":"insufficient_quota","code":"insufficient_quota"}}');
  ok("insufficient_quota -> credits", /credit/i.test(quota.message), quota.message);
  ok("insufficient_quota is not 'Rate limited'", !/rate limited/i.test(quota.message));
  ok("mentions separate billing", /ChatGPT/i.test(quota.message), quota.message);

  var hard = A.summarizeError("openai", 429,
    '{"error":{"code":"billing_hard_limit_reached","message":"hard limit"}}');
  ok("billing_hard_limit -> credits", /credit/i.test(hard.message), hard.message);

  var real = A.summarizeError("openai", 429,
    '{"error":{"message":"Rate limit reached for gpt-4","code":"rate_limit_exceeded"}}');
  ok("plain 429 stays a rate limit", /Rate limited/i.test(real.message), real.message);

  var auth = A.summarizeError("openai", 401, '{"error":{"message":"Incorrect API key provided"}}');
  ok("401 is still an auth error", /rejected/i.test(auth.message), auth.message);

  var notfound = A.summarizeError("openai", 404, '{"error":{"message":"model not found"}}');
  ok("404 is not a billing error", !/credit/i.test(notfound.message), notfound.message);
}

/* ============================================================
   9. DEMO MODE MUST NOT LECTURE ABOUT VUE
      In Study mode the demo script only has a Vue lesson. Serving
      that to "what's a good horror film?" is what made demo look
      broken - it looked like the same bug as the real providers.
   ============================================================ */
/* Sections 8 and 9 are invoked from inside section 7's async flow, so the
   PASS lines land under their own headers instead of racing the event loop. */
/* ============================================================
   10. COST BADGES
       The card grid tells you which providers cost money before
       you paste a key. This guard stops a provider quietly losing
       its badge, which is how "I thought DeepSeek was free"
       happens.
   ============================================================ */
function costChecks() {
  section("10. cost badges are accurate");

  var LLM = global.window.LLM;
  var want = {
    demo:     "Free",
    ollama:   "Free \u00b7 local",
    gemini:   "Free tier",
    deepseek: "Paid \u00b7 cheap",
    openai:   "Paid",
    anthropic:"Paid"
  };

  Object.keys(want).forEach(function (id) {
    var c = LLM.costOf(id);
    eq("cost label: " + id, c.label, want[id]);
    ok("cost note: " + id, typeof c.note === "string" && c.note.length > 10, c.note);
  });

  /* The three that need money must never be labelled free. */
  ["openai", "deepseek", "anthropic"].forEach(function (id) {
    ok(id + " is not free", !/^free/i.test(LLM.costOf(id).label), LLM.costOf(id).label);
  });

  /* Every provider must declare a cost, or it falls back to "Free"
     and would lie about a paid provider. */
  var L2 = global.window.LLM;
  var declared = ["demo", "openai", "deepseek", "anthropic", "gemini", "ollama"];
  declared.forEach(function (id) {
    ok(id + " declares a cost", !!L2.PROVIDERS[id].cost, "missing cost field");
  });

  /* The paid notes must say a ChatGPT subscription is not enough. */
  ok("openai note warns about ChatGPT billing",
     /ChatGPT/i.test(L2.PROVIDERS.openai.note), L2.PROVIDERS.openai.note.slice(0, 60));
  ok("deepseek note says not free",
     /NOT free/i.test(L2.PROVIDERS.deepseek.note), L2.PROVIDERS.deepseek.note.slice(0, 60));
}

/* ============================================================
   11. CHAT BUBBLE LAYOUT
       The bug: .bubble had `max-width: 84%` and .u-wrap was sized
       from that bubble, so the percentage constrained the very box it
       was measured against. On a narrow window the wrap collapsed and
       `word-break: break-word` sliced short words one letter per line
       - "hey" rendered as h / e / y down the page.
   ============================================================ */
function layoutChecks() {
  section("11. chat bubble cannot collapse to one letter per line");

  /* Strip CSS comments first. The fix above is *explained* in a comment
     that names `word-break: break-word` and `max-width: 84%`, and a test
     that bans those strings would otherwise fail on its own docs. */
  var css = fs.readFileSync(path.join(ROOT, "assets/css/styles.css"), "utf8")
             .replace(/\/\*[\s\S]*?\*\//g, "");

  function rule(sel) {
    var i = css.indexOf(sel + " {");
    if (i === -1) return null;
    var j = css.indexOf("}", i);
    return css.slice(i, j);
  }

  var wrap = rule(".u-wrap") || "";
  var bubble = rule(".msg-user .bubble") || "";

  /* The cap must live on the wrapper, resolved against .msg-user.
     100% is fine here - it means "as wide as the wrapper allows". */
  ok(".u-wrap carries the width cap", /max-width:\s*(min\(|[\d])/.test(wrap), wrap.slice(0, 80));
  ok("bubble must not use a percentage max-width",
     !/max-width:\s*(?!100%)[\d.]+%/.test(bubble), bubble.slice(0, 90));
  ok("bubble max-width is 100% of the wrapper", /max-width:\s*100%/.test(bubble), bubble.slice(0, 90));

  /* This is what actually stopped the per-letter stacking. */
  ok("bubble uses overflow-wrap", /overflow-wrap:\s*break-word/.test(bubble), bubble.slice(0, 90));
  ok("bubble word-break is normal", /word-break:\s*normal/.test(bubble), bubble.slice(0, 90));
  ok("no word-break: break-word left on bubbles",
     !/\.msg-user \.bubble[^}]*word-break:\s*break-word/.test(css));

  /* The mobile override must not reintroduce it. */
  var mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  ok("mobile override targets .u-wrap, not the bubble",
     !/\.msg-user \.bubble\s*\{\s*max-width/.test(mobile));

  /* Resend must exist and be wired. */
  var app = fs.readFileSync(path.join(ROOT, "assets/js/app.js"), "utf8");
  ok("resend button is rendered", /data-uat="resend"/.test(app));
  ok("resend has a handler", /what === "resend"/.test(app));
  ok("resendUser drops the failed turn", /function resendUser/.test(app) && /splice\(idx \+ 1\)/.test(app));
  ok("failed bubble gets a marker", /bubble\.failed|\" failed\"/.test(app) || /\.bubble\.failed/.test(css));
  ok("resend button is styled", /\.resend-btn\s*\{/.test(css));
  ok("error actions are pinned open", /msg\.error \? " pinned"/.test(app));

  /* The Windows launcher is gone - it has no place in a published repo. */
  ok("no start-bokskie.cmd reference", !/start-bokskie/.test(app));
  var files = ["api.js", "server.js", "README.md", "assets/js/backend.js"];
  var leftover = files.filter(function (f) {
    return /start-bokskie/.test(fs.readFileSync(path.join(ROOT, f), "utf8"));
  });
  eq("no .cmd references anywhere", leftover.length, 0);
  ok("launcher file deleted", !fs.existsSync(path.join(ROOT, "start-bokskie.cmd")));
  ok("server no longer lists it as private",
     !/"start-bokskie\.cmd":\s*true/.test(fs.readFileSync(path.join(ROOT, "server.js"), "utf8")));
}

/* ============================================================
   12. OLLAMA REACHABILITY
       api.js marks every auth:"none" provider connected, because
       "needs no key" is a static fact. But "is Ollama running" is
       not - it is a separate program. The card used to say
       "Connected · local" even with nothing installed, which is
       exactly the question the user could not answer.
   ============================================================ */
function ollamaChecks() {
  section("12. ollama status is measured, not assumed");

  var S = require(path.join(ROOT, "server.js"));
  ok("probeOllama is exported", typeof S.probeOllama === "function");

  function FakeRes() { this.status = 0; this.body = ""; this.headers = {}; }
  FakeRes.prototype.writeHead = function (s, h) { this.status = s; this.headers = h || {}; };
  FakeRes.prototype.end = function (c) { this.body = String(c || ""); };
  FakeRes.prototype.write = function () {};

  function statusWith(running, models) {
    var api = A.createAPI(A.memoryIO({}), { version: "test" });
    var handler = S.createHandler({
      api: api,
      fetchStream: function () { return Promise.reject(new Error("no network")); },
      readFile: function () { return Buffer.from("x"); },
      probeLocal: function (base, cb) { cb(running, models || []); },
      log: function () {}
    });
    return new Promise(function (resolve) {
      var res = new FakeRes();
      var r = handler({ method: "GET", url: "/api/status", headers: { host: "localhost" } }, res);
      if (r && typeof r.then === "function") r.then(function () { resolve(res); }, function () { resolve(res); });
      else setTimeout(function () { resolve(res); }, 0);
    });
  }

  return Promise.all([
    statusWith(false, []).then(function (res) {
      var ol = JSON.parse(res.body).providers.filter(function (p) { return p.id === "ollama"; })[0];
      eq("not reachable -> connected false", ol.connected, false);
      eq("not reachable -> localRunning false", ol.localRunning, false);
    }),
    statusWith(true, ["llama3.2", "qwen2.5"]).then(function (res) {
      var ol = JSON.parse(res.body).providers.filter(function (p) { return p.id === "ollama"; })[0];
      eq("running -> connected true", ol.connected, true);
      eq("running -> localRunning true", ol.localRunning, true);
      eq("running -> model list", ol.installedModels.length, 2);
    })
  ]).then(function () {
    /* The UI must report that real state, not the assumed one. */
    var app = fs.readFileSync(path.join(ROOT, "assets/js/app.js"), "utf8");
    ok("card uses localRunning, not assumed connected", /ps\.localRunning/.test(app));
    ok("card no longer claims 'Connected · local' blindly",
       app.indexOf('? "Connected · local"') === -1);
    ok("card points at the download", /ollama\.com\/download/.test(app));
    ok("card explains the 3 setup steps", /ollama pull llama3\.2/.test(app));

    /* Ollama must still bypass the key requirement on the server. */
    var srv = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    ok("auth:none still gets a synthetic key slot", /auth === "none"[\s\S]{0,80}plan = \[\{ key: ""/.test(srv));
    ok("ollama is keyless in api.js", /ollama:[\s\S]{0,400}auth: "none"/.test(fs.readFileSync(path.join(ROOT, "api.js"), "utf8")));
    ok("ollama needs no key hint", /No key needed/.test(fs.readFileSync(path.join(ROOT, "api.js"), "utf8")));
  });
}

/* ============================================================
   13. SIDEBAR RAIL
       Collapsing the sidebar on a desktop was a one-way door: the
       only reopen control was .openSidebarBtn, which is
       .only-mobile (display:none above 760px), and the sidebar's
       own toggle vanished with the panel.
   ============================================================ */
function sidebarChecks() {
  section("13. collapsed sidebar can always be reopened");

  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var app = fs.readFileSync(path.join(ROOT, "assets/js/app.js"), "utf8");
  var css = fs.readFileSync(path.join(ROOT, "assets/css/styles.css"), "utf8")
             .replace(/\/\*[\s\S]*?\*\//g, "");

  /* The handle itself. */
  ok("rail exists in the markup", /class="sidebar-rail" id="sidebarRail"/.test(html));
  ok("rail is a button (keyboard reachable)", /<button class="sidebar-rail"[^>]*type="button"/.test(html));
  ok("rail has an accessible name", /aria-label="Show sidebar"/.test(html));
  ok("rail is the logo", /rail-logo[\s\S]{0,120}bokskie-logo/.test(html));
  ok("rail has a thin grip bar", /class="rail-grip"/.test(html));

  /* It must appear only when collapsed, and only on a desktop. */
  ok("rail is hidden by default", /\.sidebar-rail\s*\{\s*display:\s*none/.test(css));
  ok("rail shows when collapsed", /\.app\.collapsed \.sidebar-rail\s*\{[^}]*display:\s*flex/.test(css));
  var desk = css.slice(css.indexOf("@media (min-width: 761px)"));
  ok("rail is desktop-only", /min-width:\s*761px/.test(css) && desk.length > 0);

  /* The old trap: reopen control only exists on mobile. */
  ok("openSidebarBtn stays mobile-only", /openSidebarBtn/.test(html) && /class="icon-btn only-mobile" id="openSidebarBtn"/.test(html));

  /* Resize must not wipe the choice any more. */
  ok("resize no longer force-opens the sidebar",
     !/addEventListener\("resize"[\s\S]{0,200}!isMobile\(\)\) el\.app\.classList\.remove\("collapsed"\)/.test(app));
  ok("resize only reacts at the breakpoint", /__wasMobile/.test(app));
  ok("resize restores the stored choice", /else restoreSidebar\(\)/.test(app));

  /* The choice has to survive a reload. */
  ok("sidebar state is persisted", /bokskie\.sidebarHidden/.test(app));
  ok("restore honours an explicit hidden", /saved !== "1"/.test(app));

  /* Ways back in. */
  ok("rail click reopens", /el\.sidebarRail\.addEventListener/.test(app) && /setSidebar\(true\)/.test(app));
  ok("collapse button uses the shared toggle", /collapseBtn\.addEventListener\("click", toggleSidebar\)/.test(app));
  ok("Ctrl+B toggles the sidebar", /mod && e\.key\.toLowerCase\(\) === "b"/.test(app));
  ok("aria-expanded is kept in sync", /aria-expanded/.test(app) && /setAttribute\("aria-expanded"/.test(app));

  /* New sidebar features. */
  ok("provider chip exists", /id="provChip"/.test(html));
  ok("chip shows the cost badge", /el\.provChipCost\.textContent = cost\.label/.test(app));
  ok("chat count is rendered", /el\.chatStat\.textContent/.test(app) && /id="chatStat"/.test(html));
  ok("export-all is wired", /exportAllBtn[\s\S]{0,80}exportAllChats/.test(app));
  ok("clear-all is wired", /clearAllBtn[\s\S]{0,80}clearAllChats/.test(app));
  ok("export produces markdown", /\.md"/.test(app));
  ok("clear-all asks first", /confirm\("Delete all/.test(app));
  ok("sidebar meta renders on every paint", /renderChatList\(\);[\s\S]{0,200}renderSidebarMeta\(\)/.test(app));

  /* Styling for the new pieces. */
  ok("provider chip is styled", /\.prov-chip\s*\{/.test(css));
  ok("cost badge colours exist", /\.pc-cost\.c-free/.test(css) && /\.pc-cost\.c-paid/.test(css));
  ok("rail logo has hover motion", /\.rail-logo\s*\{[^}]*transition/.test(css));
  /* The brand bar: a thin lit strip beside the logo, always visible while
     the sidebar is open. Click it to fold away, and it breathes while
     auto-detect is on. */
  ok("brand bar exists", /class="brand-bar" id="brandBar"/.test(html));
  ok("brand bar sits in the brand lockup", /class="brand">[\s\S]{0,700}id="brandBar"/.test(html));
  ok("brand bar is next to the logo", /id="brandBar"[\s\S]{0,200}bokskie-logo/.test(html));
  ok("brand bar is a labelled button", /aria-label="Hide sidebar"/.test(html));
  ok("brand bar is clickable", /el\.brandBar\.addEventListener/.test(app) && /setSidebar\(false\)/.test(app));
  ok("brand bar breathes on auto mode", /el\.brandBar\.classList\.toggle\("live"/.test(app));

  var css2 = fs.readFileSync(path.join(ROOT, "assets/css/styles.css"), "utf8")
              .replace(/\/\*[\s\S]*?\*\//g, "");
  ok("brand bar is thin", /\.brand-bar\s*\{[^}]*width:\s*3px/.test(css2));
  ok("brand bar is styled", /\.brand-bar\s*\{/.test(css2));
  ok("brand bar has a hover state", /\.brand-bar:hover/.test(css2));
  ok("brand bar respects reduced motion", /prefers-reduced-motion[\s\S]{0,200}brand-bar\.live/.test(css2));
  /* Views + pinning: the ChatGPT-shaped nav, but wired to real data. */
  ok("side nav exists", /class="side-nav" id="sideNav"/.test(html));
  ["all", "pinned", "projects", "library"].forEach(function (v) {
    ok("nav has a " + v + " view", new RegExp('data-view="' + v + '"').test(html));
  });
  ok("nav has four views", (html.match(/data-view="/g) || []).length === 4);
  ok("star and folder icons were added to the sprite",
     /id="i-star"/.test(html) && /id="i-folder"/.test(html));
  ok("all four VIEWS are handled", /VIEWS = \["all", "pinned", "projects", "library"\]/.test(app));

  /* Pinning. */
  ok("pin button is rendered per chat", /data-pin="'\s*\+\s*c\.id/.test(app));
  ok("pin toggles a real flag", /c\.pinned = !c\.pinned/.test(app));
  ok("pin persists through the store", /Store\.upsertChat\(c\)/.test(app));
  ok("pinned chats get a Pinned group", /class="chat-group-title">Pinned</.test(app));
  ok("pinned rows are marked", /pinnedCls = c\.pinned \? " pinned"/.test(app));

  /* Projects. */
  ok("project button is rendered", /data-proj="'\s*\+\s*c\.id/.test(app));
  ok("project groups by folder name", /c\.project \|\| "Unfiled"/.test(app));
  ok("unfiled sorts last", /if \(a === "Unfiled"\) return 1;/.test(app));

  /* Library shows real counts, not a dead page. */
  ok("library has a stats strip", /class="lib-stats"/.test(app));
  ok("library counts messages", /msgs\+\+/.test(app));
  ok("nav counts are rendered", /renderNavCounts/.test(app) && /id="navPinnedCount"/.test(html));
  ok("zero counts hide themselves", /data-zero/.test(app));

  /* The collapse button moved into the brand row, right-aligned. The gap is
     large because the brand row carries two explanatory comments. */
  ok("collapse button lives in the brand", /class="brand">[\s\S]{0,1400}id="collapseBtn"/.test(html));
  ok("collapse button sits after the wordmark",
     /class="brand-text">[\s\S]{0,1400}id="collapseBtn"/.test(html));
  ok("old sidebar-top row is gone", !/class="sidebar-top"/.test(html));
  ok("collapse button is pushed right", /\.brand-collapse\s*\{[^}]*margin-left:\s*auto/.test(css2));

  /* Styling for the new sidebar pieces. */
  ok("side nav is styled", /\.side-nav\s*\{/.test(css2));
  ok("active nav item is styled", /\.side-nav-item\.is-active/.test(css2));
  ok("pin button is styled", /\.chat-item \.chat-pin/.test(css2));
  ok("pinned row has a lit edge", /\.chat-item\.pinned::before/.test(css2));
  ok("library stat cards are styled", /\.lib-stat\s*\{/.test(css2));
}

/* ============================================================
   14. PINNING ROUND-TRIP
       "I pinned it but the Pinned view is empty." The filter reads
       c.pinned, so the only way that view can be empty is if the
       flag never made it into the store. This exercises the real
       store against a mock localStorage, not a re-implementation.
   ============================================================ */
function pinChecks() {
  section("14. a pin survives the round-trip to storage");

  var store = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  global.window = global;
  delete require.cache[require.resolve(path.join(ROOT, "assets/js/store.js"))];
  require(path.join(ROOT, "assets/js/store.js"));
  var S = global.Store;

  var a = S.newChat();
  a.title = "Alpha";
  a.pinned = true;
  S.upsertChat(a);

  var b = S.newChat();
  b.title = "Beta";
  S.upsertChat(b);

  var all = S.listChats();
  eq("two chats stored", all.length, 2);

  /* This is the exact predicate renderChatList uses. */
  var pinned = all.filter(function (c) { return c.pinned; });
  eq("pinned filter finds one", pinned.length, 1);
  eq("pinned filter returns the right chat", pinned[0] && pinned[0].title, "Alpha");

  /* Re-read from storage, the way a page reload would. */
  delete require.cache[require.resolve(path.join(ROOT, "assets/js/store.js"))];
  require(path.join(ROOT, "assets/js/store.js"));
  var again = global.Store.listChats();
  eq("flag survives a reload", (again.filter(function (c) { return c.pinned; }).length), 1);

  /* Pinned and unpinned must be independent. Identify them by title, never
     by index: upsertChat re-sorts by updatedAt, so position is not identity. */
  var byTitle = {};
  again.forEach(function (c) { byTitle[c.title] = c.id; });
  var pinnedId = byTitle.Alpha, plainId = byTitle.Beta;

  var plain = S.getChat(plainId);
  plain.pinned = true;
  S.upsertChat(plain);
  eq("both chats pinned now", S.listChats().filter(function (c) { return c.pinned; }).length, 2);

  eq("unpinning one leaves the other", (function () {
    var x = S.getChat(pinnedId);
    x.pinned = false;
    S.upsertChat(x);
    return S.listChats().filter(function (c) { return c.pinned; }).length;
  })(), 1);
  eq("the survivor is the one we did not unpin",
     (S.listChats().filter(function (c) { return c.pinned; })[0] || {}).id, plainId);

  /* A full or blocked store must be detectable, not silent. */
  ok("store can report a broken storage", typeof S.storageBroken === "function");
  eq("healthy storage reports fine", S.storageBroken(), false);

  /* The view predicate and the row must agree on the same field name. */
  var app = fs.readFileSync(path.join(ROOT, "assets/js/app.js"), "utf8");
  ok("view filter reads c.pinned", /view === "pinned"\) chats = chats\.filter\(function \(c\) \{ return c\.pinned; \}\)/.test(app));
  ok("row reads the same field", /pinnedCls = c\.pinned \? " pinned"/.test(app));
  ok("empty state explains pinning", /Nothing pinned yet/.test(app));
  ok("no pinned view renders a date group by mistake",
     /chats\.filter\(function \(c\) \{ return !c\.pinned; \}\)/.test(app));
  /* The bug this turn reported: "I pinned it, the Pinned view is empty."
     Two causes were possible and both are now closed off. */
  var css3 = fs.readFileSync(path.join(ROOT, "assets/css/styles.css"), "utf8")
              .replace(/\/\*[\s\S]*?\*\//g, "");
  var html2 = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  /* 1. A control you can only discover by hovering looks broken. */
  ok("pin is faintly visible, not hidden", /\.chat-item \.chat-pin\s*\{\s*opacity:\s*\.4/.test(css3));
  ok("pin is never fully transparent",
     !/\.chat-item \.chat-pin[^{]*\{[^}]*opacity:\s*0\s*;/.test(css3));
  ok("pin reaches full opacity on hover", /\.chat-item:hover \.chat-pin/.test(css3));

  /* 2. A full localStorage lost the flag while the UI said "Pinned". */
  ok("store records a failed write", /bokskie\.storageError/.test(fs.readFileSync(path.join(ROOT, "assets/js/store.js"), "utf8")));
  ok("store can report broken storage", /function storageBroken/.test(fs.readFileSync(path.join(ROOT, "assets/js/store.js"), "utf8")));
  ok("pin refuses to lie about success", /if \(!saved\) \{ toast\(storageErrorMessage\(\)/.test(app));
  ok("storage is checked on boot", /checkStorage\(\);/.test(app));
  ok("the warning tells the user what to do", /Export in the sidebar/.test(app));

  /* 3. The hunger bar: desktop yes, phone no. */
  ok("brand bar is hidden on mobile",
     /@media \(max-width: 760px\)[\s\S]{0,900}\.brand-bar\s*\{\s*display:\s*none/.test(css3));
  ok("brand bar is visible on desktop", /@media \(min-width: 761px\)/.test(css3) && !/@media \(max-width: 760px\)[\s\S]{0,900}\.sidebar-rail\s*\{[^}]*display:\s*flex/.test(css3));
  ok("the rail stays desktop-only", /\.sidebar-rail \{ display: none; \}/.test(css3));
  ok("mobile keeps the outside hamburger", /class="icon-btn only-mobile" id="openSidebarBtn"/.test(html2));

  /* 4. No duplicated element refs left behind by the piecemeal edits. */
  var elBlock = app.slice(app.indexOf("var el = {"), app.indexOf("};", app.indexOf("var el = {")));
  var elKeys = (elBlock.match(/^\s*(\w+):\s*\$\(/gm) || []).map(function (s) { return s.trim().split(":")[0]; });
  eq("no duplicate el refs", elKeys.length, new Set(elKeys).size);
}

/* ============================================================
   15. THE PROMPT THAT ACTUALLY SHIPS
       This is the fix for "the AI answers badly". Study mode used
       to send "you are a Vue 3 study partner" no matter what was
       asked, because the prompt came from the pinned chip and
       nothing re-read the message. Now the last user turn picks the
       prompt for that one send, and the chip is left alone.
   ============================================================ */
function promptChecks() {
  section("15. the prompt follows the question, not just the chip");

  global.window = global;
  delete require.cache[require.resolve(path.join(ROOT, "assets/js/modes.js"))];
  require(path.join(ROOT, "assets/js/modes.js"));
  var M = global.window.Modes;

  /* Mirror of the decision inside app.js withTemp(settings, text). */
  function pick(pinned, text) {
    var mode = pinned;
    var g = M.detect(text);
    if (g && g.confident && g.mode !== mode) mode = g.mode;
    else if (!g && mode === "study") mode = "general";
    return mode;
  }
  function vuePrompt(mode) {
    return /Vue 3 study partner|strongest in Vue 3/.test(M.systemFor(mode, ""));
  }

  /* The bug: pinned Study + a general question shipped a Vue prompt. */
  eq("pinned study + film question -> general", pick("study", "what is a good horror film"), "general");
  ok("  and it sends no Vue prompt", !vuePrompt(pick("study", "what is a good horror film")));

  eq("pinned study + no signal -> general", pick("study", "best horror movie of all time"), "general");
  ok("  and it sends no Vue prompt", !vuePrompt(pick("study", "best horror movie of all time")));

  /* A real code question must still reach the tutor. */
  eq("pinned study + vue question -> study", pick("study", "explain computed properties in Vue"), "study");
  ok("  and it does send the Vue prompt", vuePrompt(pick("study", "explain computed properties in Vue")));

  eq("pinned study + build request -> build", pick("study", "build me a portfolio website"), "build");

  /* Pinned Build must not swallow a general question either. */
  eq("pinned build + film question -> general", pick("build", "what is a good horror film"), "general");
  eq("pinned general + vue question -> study", pick("general", "explain computed properties in Vue"), "study");

  /* The prompt itself must stop asserting a Vue identity. */
  var study = M.systemFor("study", "");
  ok("study prompt no longer opens as a Vue partner",
     !/^You are bokskie\.ai, a patient and rigorous Vue 3 study partner/.test(study), study.slice(0, 90));
  ok("study prompt says answer what was asked", /FIRST RULE - answer what was asked/.test(study));
  ok("study prompt has a language rule", /LANGUAGE:/.test(study));
  ok("study prompt tells it to admit uncertainty",
     /outside what you know, say so plainly/.test(study));
  ok("study prompt keeps the coding rules", /WHEN THE QUESTION IS ABOUT CODE/.test(study));
}

function billingChecksSection() {
  section("8. billing errors are not mistaken for rate limits");
  billingChecks();
}

async function demoChecksSection() {
  section("9. demo mode stays on topic");
  await demoChecks();
}

async function demoChecks() {
  var LLM = global.window.LLM;

  /* Collect the whole demo stream into one string. */
  async function collect(q, mode) {
    var it = LLM.stream({ provider: "demo", mode: mode }, [{ role: "user", content: q }], null);
    var text = "";
    for await (var chunk of it) text += chunk;
    return text;
  }

  var offTopic = await collect("what's a good horror film", "study");
  ok("study + film question gives no Vue lesson", !/Vue 3 in four parts|reactive\(|script setup/i.test(offTopic), offTopic.slice(0, 120));
  ok("study + film question explains itself", /not what you asked|Study/i.test(offTopic), offTopic.slice(0, 120));

  var onTopic = await collect("explain computed properties in Vue", "study");
  ok("study + Vue question still teaches", /Vue|reactive|component/i.test(onTopic), onTopic.slice(0, 120));

  var gen = await collect("what's a good horror film", "general");
  ok("general + film question is not a Vue lesson", !/Vue 3 in four parts/i.test(gen), gen.slice(0, 120));

  /* Every demo reply must be honest about being a script. */
  ok("demo always says it is a script", /Demo mode/i.test(offTopic), offTopic.slice(0, 80));
}

var finish = function () {
  console.log("");
  console.log(new Array(58).join("="));
  if (fail) {
    console.log("FAILED  " + fail + " of " + (pass + fail));
    failures.forEach(function (f) { console.log("   - " + f); });
    console.log(new Array(58).join("="));
    process.exit(1);
  } else {
    console.log("ALL " + pass + " CHECKS PASSED");
    console.log(new Array(58).join("="));
    process.exit(0);
  }
};

(async function () {
  var handler = makeHandler();

  var privates = ["/api.js", "/server.js", "/keys.local.json", "/.env", "/keys.example.json"];
  for (var i = 0; i < privates.length; i++) {
    var r = await call(handler, "GET", privates[i]);
    eq("403 " + privates[i], r.status, 403);
  }

  var okFiles = ["/", "/index.html", "/assets/js/app.js", "/assets/css/styles.css"];
  for (var j = 0; j < okFiles.length; j++) {
    var r2 = await call(handler, "GET", okFiles[j]);
    eq("200 " + okFiles[j], r2.status, 200);
  }

  var trav = await call(handler, "GET", "/..%2fapi.js");
  ok("400 on path traversal", trav.status === 400 || trav.status === 403, trav.status);

  /* Sections 8 and 9 - billing and demo. Awaited so the PASS lines
     land under their own headers. */
  billingChecksSection();
  await demoChecksSection();
  costChecks();
  layoutChecks();
  sidebarChecks();
  pinChecks();
  promptChecks();
  return ollamaChecks();

  finish();
})();


