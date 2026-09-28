/* ============================================================
   bokskie-v1 - provider.js
   ------------------------------------------------------------
   The bridge between bokskie.ai and the understanding engine.
   Exposes the shape the app expects from any provider:

       reply(text, opts)  -> Promise
       stream(text, opts) -> async generator of chunks
       ready()            -> Promise, so the app waits for the bank
                             instead of guessing whether it is there

   The engine loads asynchronously, so every entry point waits on
   ready(). If loading fails, ready() resolves null and every call
   returns a clear error - a provider that answers "hello" while its
   knowledge base silently failed to load is the worst outcome.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../engine/index.js"),
                             require("../engine/tokenizer.js"),
                             require("../engine/intent.js"));
  } else {
    root.BokskieLocal = factory(root.BokskieEngine, root.BokskieTokenizer, root.BokskieIntent);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (E, T, I) {
  "use strict";

  var PROVIDER_ID = "bokskie-local";

  var info = {
    id: PROVIDER_ID,
    label: "bokskie.ai (offline)",
    base: "",
    keyUrl: "",
    keyHint: "No key needed - it runs entirely on this machine.",
    auth: "none",
    dialect: "openai",
    cost: "local",
    note: "An offline retrieval engine, not a language model. It looks your question " +
          "up in a hand-written knowledge bank and returns the closest real answer - " +
          "and when nothing is close enough it says so instead of guessing. " +
          "Correct for what it covers, honest about the rest. Use Gemini for real AI."
  };

  var MODELS = [
    { id: "bokskie.v1", label: "bokskie.v1", sub: "Offline \u00b7 answers from its knowledge bank", tag: "Free" },
    { id: "bokskie.v1-verbose", label: "bokskie.v1 + translations", sub: "Adds the other two languages" }
  ];

  var engine = null, loadError = null, pending = null;

  /* Resolve the engine at CALL time, not at load time.
     Reading root.BokskieEngine inside the factory meant a script-order
     mistake - provider.js loaded before the engine - killed the whole
     provider before it could report anything useful.

     Careful here: the UMD factory's parameters are (E, T, I). There is
     no `root` in scope in here - it belongs to the outer IIFE - so
     referring to it is a ReferenceError in strict mode, which throws
     before `root.BokskieLocal` is ever assigned and leaves the page
     with no provider at all. Use globalThis, which always exists. */
  function engineModule() {
    if (E) return E;
    var g = (typeof globalThis !== "undefined") ? globalThis.BokskieEngine : null;
    return g || null;
  }

  /* Does the bank advertise code templates the library should hold?

     Read off the entries rather than a flag, so it cannot be wrong: if
     a `code-` entry exists, some template is supposed to be there. */
  function bankHasCodeEntries(e) {
    var entries = (e.kb && e.kb.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      if (String(entries[i].topic || "").indexOf("code-") === 0) return true;
    }
    return false;
  }

  /* THE STALE-TAB RULE, as a function so it can be tested directly.

     Worth the indirection: the condition depends on whether the code
     library loaded, and the only way to see that fail is to have the
     library genuinely absent - which cannot be arranged through the
     load path under node, because the provider takes the synchronous
     branch there and reads the real file off disk whatever fetch is
     stubbed to. So the rule is written once, here, and both the load
     path and the test ask the same question. */
  /* THE BUILD MISMATCH, which is the failure that actually happened.

     The two cases are different and both had to be caught.

     EMPTY LIBRARY: a tab so old the loader had no code path at all.
     Detected, already handled by the provider.

     MISMATCHED STAMP: a tab that loaded engine.js from one build and
     code.json from another. The scripts are cached by URL, the data is
     served no-store, so this is the normal shape of a half-refreshed
     tab - and it is the one that bit twice. The engine had every fix in
     it, every test passed, and the browser kept serving the intent
     patterns from before the last edit, because the file was cached
     under a URL that had not changed.

     Comparing the two stamps turns "your tab is stale" from something
     we argue about into something the app reports about itself. Only
     possible because the data is always re-fetched and the code is
     not. */
  function isStaleTab(e) {
    if (!e || !e.code) return false;
    if (e.code.size() === 0) return bankHasCodeEntries(e);
    /* The stamp is read off the engine module rather than closed over,
       so there is no second copy of the version here to forget. The
       global is checked too, because that is how the browser reaches
       it and the node path is the one that can miss a new export. */
    var mod = engineModule();
    var mine = (mod && mod.BUILD) ||
               (typeof globalThis !== "undefined" && globalThis.BokskieEngine &&
                globalThis.BokskieEngine.BUILD) || null;
    if (e.code.build && mine && e.code.build !== mine) return true;
    return false;
  }

  function ready() {
    if (pending) return pending;
    var mod = engineModule();
    if (!mod || typeof mod.Engine === "undefined") {
      loadError = "the engine did not load. bokskie-v1/engine/*.js must be in the page " +
                  "before src/provider.js.";
      pending = Promise.resolve(null);
      return pending;
    }
    try {
      pending = Promise.resolve(mod.Engine.load({ basePath: "bokskie-v1/data/" }))
        .then(function (e) {
          engine = e;
          if (!e.kb.entries.length) loadError = "the knowledge bank came back empty";

          /* STALE CACHE, DETECTED RATHER THAN ASSUMED.

             A half-updated page is the hardest failure here to read
             from the inside, and it cost a whole afternoon: every fix
             worked, every test passed, and the app kept refusing to
             hand over a website it demonstrably had, because the tab
             was running an engine from before the library existed.

             The `?v=` on the script tags cannot save you from this on
             its own. Those tags live IN index.html, so if index.html is
             what got cached - which is what a browser does when the
             page is opened from file:// - the old URLs are the only
             ones ever requested, and the new ones are never seen. The
             cache-buster inside the file it is supposed to invalidate.

             So the app checks itself. The bank is loaded from the
             bundle and the templates are listed as code- entries; if
             the entries are there and the library is not, the two came
             from different builds, and the honest thing to say is "your
             tab is stale, reload it" rather than to answer every code
             request with the no-template menu and look broken. */
          if (!loadError && isStaleTab(e)) {
            loadError = "this tab is running an older copy (engine " +
                        (mod.BUILD || "?") + ", data " +
                        (e.code.build || "?") + "). " +
                        "Press Ctrl+Shift+R (Cmd+Shift+R on a Mac) to force a reload.";
          }
          return engine;
        })
        .catch(function (err) {
          loadError = (err && err.message) ? err.message : String(err);
          return null;
        });
    } catch (err) {
      loadError = (err && err.message) ? err.message : String(err);
      pending = Promise.resolve(null);
    }
    return pending;
  }

  function failText() {
    return "bokskie.v1 could not load: " + (loadError || "the engine files are missing") +
           ". Check that bokskie-v1/engine/*.js and data/bundle.js are in the page.";
  }

  var LANG_NAME = { english: "English", tagalog: "Tagalog", bisaya: "Bisaya" };

  function ask(e, text, opts, lang) {
    return e.reply(text, { seed: opts.seed, lang: lang, useContext: opts.useContext !== false });
  }

  function reply(text, opts) {
    opts = opts || {};
    return ready().then(function (e) {
      if (!e) return { text: failText(), known: false, entryId: null, confidence: 0 };
      if (!opts.translate) return ask(e, text, opts, opts.lang);

      /* Verbose mode: run the question once per language and stack the
         results. The first call is the real one and carries the memory;
         the others are pure lookups, or the context would advance three
         times per message. */
      var primary = ask(e, text, opts, opts.lang);
      if (!primary.text) return primary;
      /* Label by the language the REQUEST came in, not the answer.
         Each section below is the same question routed as though it had
         been asked in that language, so the request language is the
         meaningful axis - the heading says which routing produced it.

         But the note has to follow the ANSWER, and this is where the
         old text stopped being true. It said "knowledge bank is in
         English" unconditionally, which was accurate when every entry
         was English-only and became a lie the moment entries started
         carrying real Tagalog and Bisaya bodies - it would have denied
         a genuine translation that was right there. So the note appears
         only when the bank actually had to substitute. */
      var used = primary.requestLang || opts.lang || "english";
      var actual = primary.lang || used;
      var note = (actual === used)
        ? ""
        : " _(no " + (LANG_NAME[used] || used) + " version in the bank - " +
          "showing the " + (LANG_NAME[actual] || actual) + " one)_";
      var parts = ["**" + (LANG_NAME[used] || "Answer") + "**" + note + "\n" + primary.text];
      ["english", "tagalog", "bisaya"].forEach(function (l) {
        if (l === used) return;
        var alt = ask(e, text, { seed: (opts.seed || 1) + 7, useContext: false }, l);
        if (alt.text) parts.push("**" + LANG_NAME[l] + "**\n" + alt.text);
      });
      primary.text = parts.join("\n\n");
      return primary;
    });
  }

  /* ---------- how the reply is delivered ----------

     The app renders every provider through one streaming path, so the
     feel of this reply is decided right here. Equal-sized chunks at one
     fixed delay read as text teleporting, not as someone typing: real
     output arrives in uneven bursts and breathes at the punctuation.

     So the text is split on word boundaries - never mid-word, because a
     half word appearing on its own is the clearest possible tell - and
     each burst carries the whitespace that follows it, so the chunks
     still rejoin into the original string exactly. Correct markdown
     depends on that, and so does section 7 of verify-provider.js.

     The pace after a burst depends on what it ended with. Punctuation
     is the cue the eye actually reads: a full stop is a real pause, a
     comma is a breath.

     Burst sizes and pauses come from a hash of the text, never from
     Math.random(). That is what keeps a seeded reply reproducible from
     end to end, and it is what makes this testable: the same question
     always types at the same speed. */

  var PACE = {
    word:  34,     /* after a burst ending on an ordinary word */
    comma: 110,    /* after , ; : - or a line break - a short breath */
    stop:  220,    /* after . ! ? - the long one */
    swing: 18      /* +/- so the rhythm never becomes a metronome */
  };

  /* FNV-1a. It only has to spread neighbouring bursts apart - it is not
     meant to be cryptographic. Math.imul keeps the multiply in 32-bit
     so the result is identical everywhere. */
  function hashStep(key, step) {
    var s = key + ":" + step;
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function pauseAfter(burst, key, step) {
    var tail = burst.replace(/\s+$/, "").slice(-1);
    var wait = PACE.word;
    if (tail === "." || tail === "!" || tail === "?") wait = PACE.stop;
    else if (tail === "," || tail === ";" || tail === ":" ||
             tail === "-" || tail === "\n") wait = PACE.comma;
    return Math.max(0, wait + (hashStep(key, step) % (PACE.swing * 2 + 1)) - PACE.swing);
  }

  function* typeBursts(text, key) {
    /* \S+\s* keeps each word with the space that follows it. */
    var words = text.match(/\S+\s*/g) || [];
    var i = 0, step = 0;
    while (i < words.length) {
      /* One to three words per burst. A fixed size reads as a machine;
         a person types in uneven clumps. */
      var burst = "";
      var span = 1 + (hashStep(key, step) % 3);
      for (var k = 0; k < span && i < words.length; k++) burst += words[i++];
      /* A burst too small to paint anything is wasted work, so top it
         up - unless that was the last word, in which case send it. */
      if (burst.replace(/\s+$/, "").length < 3 && i < words.length) burst += words[i++];
      yield burst;
      step++;
    }
  }

  /* Chunked, so the UI uses the same streaming path it uses for a real
     provider and the bubble grows instead of appearing at once. */
  async function* stream(text, opts) {
    opts = opts || {};
    var out = await reply(text, opts);
    var bursts = Array.from(typeBursts(out.text, out.text));
    for (var i = 0; i < bursts.length; i++) {
      if (opts.signal && opts.signal.aborted) return;
      yield bursts[i];
      if (i === bursts.length - 1) break;   /* no pointless timer after the last one */
      var wait = pauseAfter(bursts[i], out.text, i);
      if (wait) await new Promise(function (r) { setTimeout(r, wait); });
    }
  }

  /* Synchronous best-effort stats for the settings panel. Reports zeroes
     before the bank is in rather than throwing, so the panel renders
     either way. */
  function stats() {
    if (!engine) {
      return { id: PROVIDER_ID, entries: 0, topics: [], topicsCount: 0, ready: false, error: loadError };
    }
    var s = engine.stats();
    return {
      id: PROVIDER_ID, entries: s.entries, tokens: s.tokens,
      topics: engine.topics(), topicsCount: s.topics, files: s.files,
      ready: true, error: null
    };
  }

  /* Start loading as soon as the provider exists, so the bank is warm
     by the time the first message is sent. */
  ready();

  return {
    id: PROVIDER_ID,
    info: info,
    /* Exposed for tests only. The stale-tab rule cannot be exercised
       through the load path under node, because node takes the
       synchronous branch and reads the real code.json whatever fetch
       is stubbed to. Exposing the rule means the test asks the same
       question the loader asks. */
    _isStaleTab: isStaleTab,
    providerInfo: function () { return info; },
    models: MODELS,
    modelsFor: function () { return MODELS; },
    defaultModel: "bokskie.v1",
    topics: function () { return engine ? engine.topics() : []; },
    ready: ready,
    isReady: function () { return !!engine; },
    reply: reply,
    stream: stream,
    stats: stats,
    reset: function () { if (engine) engine.reset(); },
    _engine: function () { return engine; },
    /* Test hook: how long the typer would pause after this chunk. Exposed
       so the punctuation rule can be asserted directly, instead of through
       a wall-clock timing test that would be flaky on a loaded machine. */
    _pauseAfter: function (burst, key, step) { return pauseAfter(burst, key, step); },
    version: "2.0.0"
  };
});
