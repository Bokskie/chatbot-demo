/* ============================================================
   bokskie-v1 · engine/index.js
   ------------------------------------------------------------
   The public API. One call, one answer:

       var engine = await BokskieEngine.load();
       engine.reply("what is javascript");

   The pipeline it runs, in order:

       1. normalize + tokenize
       2. detect language, intent and topic
       3. fold in conversation memory for follow-ups
       4. retrieve from the inverted index
       5. generate - or refuse, if nothing cleared the bar
       6. write the turn back into memory

   Loading differs by host and nothing else: node reads data/*.json
   off disk, the browser fetches them. Same engine, same answers.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tokenizer.js"), require("./similarity.js"),
                           require("./intent.js"), require("./context.js"),
                           require("./kb.js"), require("./generator.js"),
                           require("./mood.js"), require("./code.js"),
                           require("./packs.js"));
  } else {
    root.BokskieEngine = factory(root.BokskieTokenizer, root.BokskieSimilarity,
                                root.BokskieIntent, root.BokskieContext,
                                root.BokskieKB, root.BokskieGenerator,
                                root.BokskieMood, root.BokskieCode,
                                root.BokskiePacks);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (T, SIM, I, C, K, G, M, CODE, PACKS) {
  "use strict";

  /* LEGACY FALLBACK - the shelf tree has outgrown it. Left in place
     rather than deleted because the two real load paths do not need
     it: the browser uses the generated bundle (which lists the shelf
     declarations itself), and node reads the data/ directory and
     picks up whatever is in it. This list is only reached by a
     browser that loaded neither.

     It is now wrong, and wrong in a quiet way: these names were the
     old flat topics, so every fetch 404s, the failures are swallowed
     into empty documents, and the page shows a working bot with an
     empty bank. Paths are relative to data/ and follow the tree, so
     "cebuano/basic-words" not "cebuano-basic-words". Regenerate it
     from tools/shelves.js, or load data/bundle.js, rather than
     trusting it. */
  var DATA_FILES = [
    "conversation",
    /* The code library, alongside conversation.json and for the same
       reason: it is data, not logic, and the browser has to be able to
       fetch it. Without it the engine still answers every question it
       always did - a code request simply falls through to the prose
       description of the template instead of handing over the file. */
    "code",
    /* The social reply library, same reasons. Optional in the strict
       sense: without it the bot gives the plain refusal and nothing
       else changes. */
    "packs"
  ];

  /* THE BUILD STAMP, and it has to match the `?v=` on the script tags
     in index.html. verify-build.js asserts that they agree.

     Bumping `?v=` is easy to forget and its absence is invisible: the
     engine on disk changes, the browser never asks for it again, and
     every fix looks like it did nothing. That is not a hypothetical -
     it is the afternoon this stamp was added, and it is why the check
     is automated rather than left to memory. */
  var BUILD = "20260927e";

  /* Flatten entries into a surface -> concept map.

     This reads tl/bis off EVERY entry rather than from a separate
     vocabulary file, and that is deliberate. A separate lexicon file
     means every concept exists twice - once as a knowledge entry and
     once as a vocabulary row - and the two copies drift, the duplicate
     competes with the original for the same query, and the integrity
     gate reports the collision every single build. One source of truth
     per concept is the only version that survives contact with a large
     bank.

     A vocabulary file is still accepted, for rows that are a word with
     no article attached to them. It is additive, never the main path. */
  function conceptOf(e) {
    return e.concept || (e.keywords && e.keywords[0]) || null;
  }

  function lexiconMap(entries) {
    var map = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e) continue;
      var concept = conceptOf(e);
      if (!concept || /\s/.test(concept)) continue;   /* a token never has a space */
      var surfaces = [];
      if (e.en) surfaces.push(e.en);
      if (e.syn) for (var s = 0; s < e.syn.length; s++) surfaces.push(e.syn[s]);
      if (e.tl) surfaces.push(e.tl);
      if (e.bis) surfaces.push(e.bis);
      for (var k = 0; k < surfaces.length; k++) {
        var w = T.normalize(String(surfaces[k]));
        /* Skip identity. A word that already IS the concept needs no
           bridge, and adding one would only make the map look fuller
           than the coverage it actually provides. */
        if (!w || w === concept) continue;
        /* First writer wins, deterministically. Two concepts claiming
           one surface is a data bug; picking the first keeps the result
           stable instead of dependent on file iteration order. */
        if (!map[w]) map[w] = concept;
      }
    }
    return map;
  }

  function Engine(opts) {
    opts = opts || {};
    this.kb = new K.KB();
    this.gen = new G.Generator(opts);
    this.ctx = new C.Context(opts);
    /* The code library lives on the engine, not on the generator, for
       the same reason the context does: it is loaded data rather than
       behaviour, and the generator receives it per call so it stays
       testable with no files at all. Empty by default, which is a
       supported state - it just means this engine cannot hand over
       code and will say so. */
    this.code = new CODE.Code();
    /* The social reply library, same reasoning: loaded data, empty by
       default, and its absence is a supported state - the bot simply
       gives the plain refusal it always gave. */
    this.packs = new PACKS.Packs();
    this.basePath = opts.basePath || "bokskie-v1/data/";
    this.loaded = false;
    this.files = [];
    this.lexiconCount = 0;
  }

  /* ---- loading ------------------------------------------------ */

  /* Browser loading, in order of preference:
       1. window.BokskieData - the generated <script>-tag bundle. Works
          from file://, where fetch() of a local JSON file is blocked.
       2. fetch() of data/*.json - fine over http, and keeps the JSON
          files authoritative at runtime.
     A file that fails in one path is still tried in the other, and
     only the ones that fail everywhere are reported. */
  function fromGlobal(engine) {
    var g = (typeof globalThis !== "undefined" && globalThis.BokskieData) ||
            (typeof root !== "undefined" && root.BokskieData);
    return g && g.entries && g.entries.length ? g : null;
  }

  /* Add a whole bank, in the one order that works.

     The lexicon MUST be registered before the first entry is added, and
     this is the only place that ordering is decided. kb.add() stems and
     canonicalises every keyword as it indexes it; the query side is
     canonicalised by the tokenizer at tokenize() time. Register the
     lexicon after the fact and the two sides get normalised differently
     - a Tagalog keyword indexed under its own surface, the same word in
     a question folded onto the English concept - and then the two
     languages can never meet, no matter how many entries exist.

     Cheap to get wrong and invisible in testing: the bank still answers
     English questions perfectly, and only the non-English ones fail. */
  function addEntries(engine, entries, lexicon) {
    /* The vocabulary file, if there is one, goes in as well. It is
       additive: a row that is a bare word with no article attached. */
    var extra = lexicon || [];
    for (var x = 0; x < extra.length; x++) entries.push(extra[x]);
    engine.lexiconCount = T.registerLexicon(lexiconMap(entries));
    for (var j = 0; j < entries.length; j++) engine.kb.add(entries[j]);
    return engine;
  }

  /* Register the shelf declarations that shipped with the bank.

     Done at load rather than compiled in, because the bank is data and
     the router must follow it: adding a shelf to tools/shelves.js
     should make that shelf routable without anyone editing the engine.
     Idempotent - a topic that already exists is left alone, so a
     hand-tuned weight on a built-in topic is never overwritten. */
  function registerShelves(engine, list) {
    if (engine._shelvesRegistered) return 0;
    engine._shelvesRegistered = true;
    return I.registerShelves(list || []);
  }

  /* Kept as a method too: anything that builds a bank by hand (the
     tests do) reaches for engine.addEntries, and losing it there is a
     confusing "not a function" rather than an obvious omission. */
  Engine.prototype.addEntries = function (entries, lexicon) {
    return addEntries(this, entries, lexicon);
  };

  /* Attach the bank to an engine. Every load path funnels through here
     so that the shelf declarations are registered exactly once, before
     any query runs - a router that does not know a shelf yet will
     silently file that shelf's questions under something else. */
  function attach(engine, entries, lexicon, shelves) {
    addEntries(engine, entries, lexicon);
    engine.shelfCount = registerShelves(engine, shelves);
    return engine;
  }

  /* Is this document the code library? Shape, not name. A template is
     any object carrying a non-empty `code` string, so a library of one
     template and a library of twenty look the same, and neither needs
     the engine to be told which file it came from. */
  /* Words that describe a request for code rather than what the code is
     about. Dropped from the search only when the intent is `code` -
     see the note at the filter in reply(). Global stop-listing would be
     wrong: "code" and "program" are perfectly good subjects to look up
     on their own, and "kode" is a real Cebuano vocabulary entry that
     other shelves legitimately reach through. */
  var CODE_REQUEST_WORDS = {
    code: 1, kode: 1, codes: 1, kodo: 1,
    build: 1, make: 1, create: 1, generate: 1, write: 1, design: 1, draft: 1,
    gawa: 1, gawan: 1, buhat: 1, himoon: 1, program: 1, script: 1,
    /* "gusto ko ng code" / "guston nako og code" - want, in the two
       languages. They describe the request and nothing about the
       subject, and without them here they survived the filter and
       made a subjectless request look like one that had named
       something - so it was refused instead of asked. */
    gusto: 1, gusto: 1, guston: 1, gusto: 1,
    please: 1, pls: 1, want: 1, need: 1, give: 1, show: 1, can: 1, could: 1,
    you: 1, i: 1, me: 1, my: 1, us: 1, of: 1, for: 1, that: 1, this: 1
  };

  function looksLikeCodeLibrary(doc) {
    if (!doc || typeof doc !== "object") return false;
    /* The wrapper is unwrapped first, and that detail is not cosmetic.
       The file is now `{_build, _templates}` so the stamp travels with
       the data, and the original check - every value must carry a
       `code` string - looked at `_build`, found a plain string, and
       said no. The library was then never added, on the BROWSER path
       only, and every code request in the real app went back to the
       no-template menu while node carried on working perfectly.

       Two bugs, same lesson, same afternoon: a silent filter at a
       boundary where a file is read and its shape assumed. Section 8.2
       of verify-engine.js is the only reason this was caught before it
       reached anybody. */
    var lib = doc._templates && typeof doc._templates === "object" ? doc._templates : doc;
    var keys = Object.keys(lib);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      var t = lib[keys[i]];
      if (!t || typeof t.code !== "string" || !t.code.length) return false;
    }
    return true;
  }

  /* The code library in the browser, fetched separately from the bank.

     This exists because of a bug worth writing down. The browser loads
     the bank from data/bundle.js through a global, so loadAsync takes
     the `fromGlobal` branch and returns immediately - and code.json was
     only being read on the node path, which has no such short circuit.
     The result was that every code request refused with "I do not have
     a template for that" in the real app while passing every test,
     because every test runs under node.

     Two lessons, and the second is the expensive one. A file read on
     one load path and not the other is not half-done, it is
     done-and-broken in the place that matters. And the suite was
     green because it never ran the path the user runs; the browser
     branch is now covered by its own test below, which is the only
     reason a test can catch this class at all. */
  /* Recognise a packs document by SHAPE, the same way the code library
     is recognised, so a new file in data/ cannot be silently skipped by
     the loader and the difference between "not loaded" and "loaded but
     empty" stays invisible. Every value in `packs` is an array of
     strings. */
  function looksLikePacks(doc) {
    if (!doc || typeof doc !== "object") return false;
    var lib = doc.packs && typeof doc.packs === "object" ? doc.packs : doc;
    var keys = Object.keys(lib);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (!Array.isArray(lib[keys[i]])) return false;
    }
    return true;
  }

  function loadPacksFile(engine) {
    var fs = require("fs");
    var path = require("path");
    var file = path.join(__dirname, "..", "data", "packs.json");
    if (!fs.existsSync(file)) return 0;
    engine.packs.add(JSON.parse(fs.readFileSync(file, "utf8")));
    return engine.packs.total();
  }

  function loadPacksAsync(engine) {
    if (typeof fetch !== "function") return Promise.resolve(engine);
    return fetch(engine.basePath + "packs.json")
      .then(function (r) {
        if (!r.ok) throw new Error("packs.json -> HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (looksLikePacks(json)) engine.packs.add(json);
        return engine;
      })
      .catch(function () { return engine; });   /* optional, never fatal */
  }

  /* The social reply library, read straight off disk under node.

     Separate from the branches above for the same reason as the code
     library: a file read on one load path and not the other is a file
     that silently does not work on the other, and that is the single
     most expensive bug class in this project. */
  function loadPacksSync(engine) {
    try { return loadPacksFile(engine); }
    catch (e) {
      if (typeof console !== "undefined") {
        console.warn("[bokskie] packs unavailable: " + e.message);
      }
      return 0;
    }
  }

  function loadCodeAsync(engine) {
    var url = engine.basePath + "code.json";
    /* Guarded before it is called, not after. A missing or throwing
       `fetch` raises synchronously rather than returning a rejected
       promise, so a `.catch` chained onto the call would never see it
       and the whole load would throw instead of degrading.

       That is not hypothetical: verify-loadorder.js deliberately runs
       the page in a sandbox with `fetch: undefined` to prove the
       script order works, and this turned that from a warning into a
       failure. And in production it matters too - a page opened from
       file:// in an older engine has no fetch, and the answer it
       should give is "this bot cannot write code", not a blank screen. */
    if (typeof fetch !== "function") {
      if (typeof console !== "undefined") {
        console.warn("[bokskie] code library unavailable: no fetch in this environment");
      }
      return Promise.resolve(engine);
    }
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("code.json -> HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (looksLikeCodeLibrary(json)) engine.code.add(json);
        return engine;
      })
      .catch(function (e) {
        /* Not fatal: the engine still answers every other question,
           and a code request falls back to describing the template. */
        if (typeof console !== "undefined") {
          console.warn("[bokskie] code library unavailable: " + e.message);
        }
        return engine;
      });
  }

  function loadAsync(engine) {
    var g = fromGlobal(engine);
    if (g) {
      attach(engine, g.entries, g.lexicon, g.shelves);
      engine.files = ["bundle.js"];
      engine.kb.build();
      engine.loaded = true;
      /* The bank came from the global; the libraries did not, and this
         branch used to return without them. */
      return loadCodeAsync(engine).then(loadPacksAsync);
    }

    var names = engine.files && engine.files.length ? engine.files : DATA_FILES;
    var jobs = names.map(function (name) {
      return fetch(engine.basePath + name + ".json")
        .then(function (r) {
          if (!r.ok) throw new Error(name + ".json -> HTTP " + r.status);
          return r.json();
        })
        .catch(function (e) {
          if (typeof console !== "undefined") console.warn("[bokskie] skipped " + name + ": " + e.message);
          return { entries: [] };
        });
    });
    return Promise.all(jobs).then(function (docs) {
      var all = [], lex = [];
      for (var i = 0; i < docs.length; i++) {
        var list = docs[i].entries || [];
        if (docs[i].topic === "lexicon") lex = lex.concat(list);
        for (var j = 0; j < list.length; j++) all.push(list[j]);
        /* The code library is keyed by concept, not by entries, so the
           loop above sees nothing in it. Identified by SHAPE rather
           than by filename or by any concept name: a document with no
           `entries` and no `topic` whose values all carry a `code`
           string is the library. Checking for a specific concept
           would mean editing the engine every time a template was
           added, which is how data ends up quietly unread. */
        if (!list.length && !docs[i].topic && looksLikeCodeLibrary(docs[i])) {
          engine.code.add(docs[i]);
        }
      }
      /* The JSON fallback has no bundle, so the declarations come from
         the registry directly. require() is safe here: this branch only
         runs under node, and the browser always takes the bundle. */
      var reg = null;
      try { reg = require("../tools/shelves.js").shelves; } catch (e) { /* no registry */ }
      attach(engine, all, lex, reg);
      engine.loaded = true;
      return engine;
    });
  }

  /* Node prefers the bundle when it is present so that tests exercise
     the exact bytes the browser gets, then falls back to the JSON on
     disk. Either path must produce the same bank, and the test suite
     checks that they do. */
  /* The code library, read straight off disk under node.

     Separate from both branches above on purpose. The bundle carries
     the knowledge bank and nothing else, and the browser path fetches
     code.json as one of DATA_FILES - but loadSync takes the bundle
     branch and would otherwise never look at it, so the engine came
     up with an empty library and answered every code request in
     prose. A file that is only read on one of the two paths is a file
     that silently does not work on the other.

     A missing library is not an error. It means this engine cannot
     hand over code, and it says so by describing the template. */
  function loadCodeSync(engine) {
    try {
      var fs = require("fs");
      var path = require("path");
      var file = path.join(__dirname, "..", "data", "code.json");
      if (!fs.existsSync(file)) return 0;
      engine.code.add(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      if (typeof console !== "undefined") {
        console.warn("[bokskie] code library unavailable: " + e.message);
      }
    }
    return engine.code.size();
  }

  function loadSync(engine) {
    var bundle = null;
    try { bundle = require("../data/bundle.js"); } catch (e) { /* not built yet */ }

    if (bundle && bundle.entries && bundle.entries.length) {
      attach(engine, bundle.entries, bundle.lexicon, bundle.shelves);
      engine.files = ["bundle.js"];
    } else {
      var fs = require("fs");
      var path = require("path");
      var dir = path.join(__dirname, "..", "data");
      /* Recursive, because the bank is a tree on disk: data/<group>/
         <sub>.json. A flat readdir here found only the hand-written
         documents sitting at the top of data/ and loaded a bank with
         almost nothing in it - no error, just an assistant that
         suddenly could not answer anything. */
      var files = (function walk(d, prefix, acc) {
        fs.readdirSync(d).sort().forEach(function (name) {
          var full = path.join(d, name);
          if (fs.statSync(full).isDirectory()) {
            walk(full, prefix ? prefix + "/" + name : name, acc);
            return;
          }
          if (/\.json$/.test(name)) acc.push(prefix ? prefix + "/" + name : name);
        });
        return acc;
      })(dir, "", []);
      engine.files = files;
      var all = [], lex = [];
      for (var f = 0; f < files.length; f++) {
        var raw = JSON.parse(fs.readFileSync(path.join(dir, files[f]), "utf8"));
        var list = raw.entries || [];
        if (raw.topic === "lexicon") lex = lex.concat(list);
        for (var j = 0; j < list.length; j++) all.push(list[j]);
      }
      engine.addEntries(all, lex);
    }
    engine.kb.build();   /* index once, here, not lazily per query */
    loadCodeSync(engine);
    loadPacksSync(engine);
    engine.loaded = true;
    return engine;
  }

  Engine.load = function (opts) {
    var e = new Engine(opts);
    if (typeof module === "object" && module.exports) return Promise.resolve(loadSync(e));
    return loadAsync(e);
  };

  /* ---- the answer --------------------------------------------- */

  /* opts: { seed, lang, useContext, explain } */
  Engine.prototype.reply = function (text, opts) {
    opts = opts || {};
    if (!this.loaded) this.kb.build();

    var useCtx = opts.useContext !== false;
    var raw = String(text == null ? "" : text);

    /* 1-2. understand */
    var tok = T.tokenize(raw);
    var analysis = I.analyse(raw, tok.tokens);
    var lang = opts.lang || analysis.language;

    /* 1c. the person, not the question.

       Two things are learned here and both are things they chose to
       say, never things the app asked for: their name, and the tone
       they are writing in. `learnName` returns the existing name when
       the message does not introduce one, so a later "i am a developer"
       cannot overwrite it - the NOT_A_NAME guard catches the obvious
       case and "first one wins" catches the rest. */
    /* The bot's own question is the context the user answers in, so it
       is what tells `learnName` that a bare word is a name rather than
       a remark. Without it, "jz" in reply to "what should I call you?"
       is indistinguishable from "haha" - and the bot asks, so the
       person is answering, and refusing the answer is not an option
       the engine has. */
    var learnedName = useCtx
      ? this.ctx.learnName(raw, this.ctx.hasAskedName() && !this.ctx.nameOf())
      : null;
    var justLearned = learnedName && !opts._knownName;
    var moodRead = M.detect(raw);
    var mood = moodRead.mood === "neutral" ? null : moodRead.mood;

  /* The user asking for their own name. Reads it back, or admits it has
     not been told. Never guesses - a bot that invents a name and then
     greets you by it for the rest of the session is the worst version
     of this feature, and the only guard is refusing to do it here. */
  Engine.prototype.nameReply = function (raw, lang, useCtx, opts) {
    opts = opts || {};
    var name = useCtx ? this.ctx.nameOf() : null;
    var def = this.kb.defines("greeting") || {};
    var block = def.nameRecall || {};

    /* Wording lives in the bank, beside the greeting, so it can be
       edited without touching code - the same reason the memory
       templates are not hard-coded here. */
    var set = name ? (block.known || {}) : (block.unknown || {});
    var text = this.gen.line({
      lines: set, language: lang, name: name, seed: opts.seed,
      avoid: useCtx ? this.ctx.said : null
    });

    /* Belt and braces: if the bank were ever emptied, say the true
       thing rather than return an empty bubble. */
    if (!text) {
      text = name
        ? "Your name is " + name + "."
        : "I do not know your name yet.";
    }

    if (useCtx) {
      this.ctx.push({
        user: raw, reply: text, topic: "conversation", intent: "askname",
        subject: name || "user name", language: lang, entities: [],
        unknown: false
      });
      this.ctx.rememberSaid(text);
      /* Counts as the one ask, so the greeting will not ask again in
         the same breath as this answer. */
      if (!name) this.ctx.claimNameAsk();
    }

    return {
      text: text,
      entryId: def.id || null,
      concept: "user name",
      confidence: 1,
      known: name !== null,
      weak: false,
      topic: "conversation",
      intent: "askname",
      answerLang: lang,
      requestLang: lang,
      userName: name,
      justLearnedName: null,
      mood: null,
      moodConfidence: 0,
      hint: null
    };
  };

  /* 1d. greeting uses the name, when there is one.

       Handled before search because a greeting is not a retrieval
       question: "hi" shares almost no vocabulary with anything, so
       retrieval would pick whichever entry happens to drift nearest.
       The bank supplies the wording, the context supplies the name. */
    if (analysis.intent === "greeting" && useCtx) {
      var def = this.kb.defines("greeting");
      if (def && def.greet) {
        return this.greetingReply(raw, def, lang, useCtx, opts, moodRead, justLearned);
      }
    }

    /* 2c. the user asking for their OWN name back.

       This never reaches the bank. There is no entry for "what is my
       name" because the answer is not a fact ABOUT anything - it is a
       fact about this conversation, and inventing a neighbour entry
       for it is what produced the "credit" reply described in intent.js.

       Two outcomes and both are honest. With a name, it is read back
       out of context. Without one, it says so plainly and asks, rather
       than refusing - a refusal here reads as "I do not understand
       you", which is a different and much more insulting claim than
       the true one, "I have not been told".

       Asking here is not a repeat of the greeting offer: a user who
       types their own name has invited the question, and there is a
       hard cap of one ask per session either way. */
    if (analysis.intent === "askname" && useCtx) {
      return this.nameReply(raw, lang, useCtx, opts);
    }

    /* 2b. memory reference, handled before any search happens.

       "Do you remember our last topic about sleep?" must never reach
       the knowledge bank. Its content words - "remember", "last",
       "topic" - appear in no entry, so retrieval would score every
       candidate near zero, sort them by noise, and hand back whichever
       shelf happened to drift highest. The engine would then answer
       that question by confidently describing some unrelated subject,
       which is the exact failure this project exists to prevent.

       The answer is already here, in the transcript. So this path reads
       memory and touches the bank only for the wording, which lives in
       data/conversation.json as a `memory` block - three languages of
       it - so the sentences can be edited without touching code. */
    if (analysis.intent === "memory_reference") {
      return this.memoryReply(raw, lang, useCtx, opts);
    }

    /* 3. memory: only a genuine follow-up inherits the last topic.
       Requiring isFollowUp() rather than "no topic found" is the
       whole point - a bare "kumusta ka" has no topic of its own, and
       treating that as a follow-up dragged the previous question's
       subject into it, so a greeting after a history question got
       answered with the history entry. An unrelated question is not a
       follow-up just because it is silent about its topic. */
    var searchTokens = tok.tokens.slice();
    var searchTopic = analysis.topic;

    /* Once the intent is known to be `code`, the words that asked for the
       code are not evidence about WHICH code. They are the request, not
       the subject, and they cost the subject its score.

       The case: "code of resort please" tokenises to ["kode","resort"],
       because the canonical map folds "code" onto the Cebuano "kode" -
       which is a key on cebuano-programming-terms and appears in no
       template. So it indexed as an unmatched term, took the highest
       IDF in the vector, halved the one token that mattered, and the
       request for the resort website scored below the accept bar. The
       right answer was in the library the entire time.

       This is the same lesson as `gamit`, and the same reason `use` is
       stopped: a word that identifies the SHAPE of a request cannot also
       be evidence of its SUBJECT. Removing it here rather than in the
       stop list is deliberate - "code" is a perfectly good thing to
       look up on its own, and the stop list is global. */
    if (analysis.intent === "code") {
      searchTokens = searchTokens.filter(function (t) {
        return !CODE_REQUEST_WORDS[t];
      });

      /* "Give me code of that please" has NO subject left - every word
         in it was request shape. The user is plainly asking for the
         thing we were just talking about, and the only place that
         subject exists is the conversation.

         The general follow-up test will not do this job: it caps at
         four words, and this is six. That cap is a deliberate guard
         against a bare "tell me more" dragging an unrelated topic in
         from three turns ago, and loosening it to reach this one case
         would trade a real protection for a convenience.

         So the carry is narrow on purpose. It applies only when the
         intent is `code`, only when the request has no subject left at
         all, and only from the immediately preceding turn. "Give me
         the code" after a resort question means the resort; the same
         sentence after an unrelated question means nothing and is
         refused, which is the right answer for "that". */
      if (!searchTokens.length && useCtx && this.ctx.turns.length) {
        var carried = this.ctx.contextTokens();
        for (var c = 0; c < carried.length; c++) {
          if (searchTokens.indexOf(carried[c]) === -1) searchTokens.push(carried[c]);
        }
        if (carried.length) {
          /* Keep the topic on the code shelves too, or the carried
             tokens go searching through the whole bank and the
             neighbouring entries compete for them again. */
          var lastTopic = this.ctx.topic || "";
          if (lastTopic.indexOf("code-") === 0) searchTopic = lastTopic;
        }
      }
    }
    /* The follow-up test runs on the raw words, not the filtered
       tokens. "tell me more" is three stopwords, so after filtering
       there is nothing left to test and it stopped being recognised
       as a follow-up at all. A follow-up is made of filler words by
       definition - that is the whole problem it solves. */
    var followUp = useCtx && this.ctx.turns.length > 0 && this.ctx.isFollowUp(tok.all);
    if (followUp) {
      var carried = this.ctx.contextTokens();
      for (var i = 0; i < carried.length; i++) {
        if (searchTokens.indexOf(carried[i]) === -1) searchTokens.push(carried[i]);
      }
      if (!searchTopic) searchTopic = this.ctx.topic;
    }

    /* 4. retrieve */
    var results = this.kb.search({
      text: raw,
      tokens: searchTokens,
      topic: searchTopic,
      intent: analysis.intent
    });

    /* 5. generate, or refuse */
    var out = this.gen.generate({
      results: results,
      analysis: analysis,
      language: lang,
      followUp: followUp,
      context: useCtx ? this.ctx : null,
      /* The code library, so a template that wins retrieval can be
         handed over as a file. Absent it, the generator answers in
         prose and the feature degrades rather than breaking. */
      code: this.code || null,
      /* The social reply library, and the gate that decides whether it
         may be used at all. The gate lives in the generator; passing
         the library is this end's whole responsibility. */
      packs: this.packs || null,
      /* The raw message, for the gate to read. Without it the gate
         cannot tell a question from a remark, and a gate that cannot
         tell is not a gate. */
      text: raw,
      /* Whether the request named a SUBJECT, judged after the
         request-word filter above. This is what separates "give me code"
         from "make me a dating app": the first named nothing and wants
         a menu with a question, the second named something the library
         does not hold and wants the truth. Decided here, where the
         tokens are, so the generator never has to guess from wording. */
      codeHasSubject: analysis.intent === "code" ? searchTokens.length > 0 : true,
      /* null unless a mood cleared the bar, so an ordinary question is
         never decorated with an opening line it did not need. */
      mood: mood,
      seed: opts.seed
    });

    /* 2d. a name, just given, deserves an answer.

       "ako si jz" learns the name correctly and then gets told "I have
       nothing on that", because a name on its own retrieves nothing and
       the generator refuses it. So the person who just introduced
       themselves is answered with a refusal - the single worst reply
       available, and the one moment of the conversation where warmth
       matters most.

       The fix is narrow: when the name arrived in THIS message and the
       reply would otherwise be a refusal, the refusal is replaced by an
       acknowledgement. Nothing else is touched - if the message also
       contained a real question, "ako si jz, ano ang python", the
       answer is real and must survive, and the gate below is only
       reached when there is no answer to lose. */
    if (justLearned && useCtx && !out.known) {
      /* `def` is NOT in scope here. It is declared with `var` inside
         the greeting branch above, so it is hoisted but undefined on
         this path - reaching for it would throw rather than greet. */
      var gdef = this.kb.defines("greeting");
      var ack = this.gen.greet({
        name: learnedName,
        lines: (gdef && gdef.greet && (gdef.greet[lang] || gdef.greet.english)) || [],
        seed: opts.seed,
        nudge: 0
      });
      if (ack) {
        out.text = ack;
        out.known = true;
        out.concept = "greeting";
        out.intent = "greeting";
        out.confidence = 1;
      }
    }

    /* 5b. a build request that only reached a template on a TYPO.

       "Give me code of resosrt" - the transposition - now finds the
       resort entry, because _near counts a swap as one edit. It still
       scores 0.007 and is refused, because a fuzzy hit is discounted
       and 0.007 is under any sane bar.

       That discount is right in general: a near-match across a bank of
       a thousand entries can plausibly land on the wrong one, and this
       project is built on refusing rather than guessing. The code
       library is not a bank of a thousand - it is five named pages -
       but that alone is not enough, and the first version of this
       retry proved it: it served the to-do list in answer to "build me
       an ios app", because `app` is a keyword of that entry and the
       retry had dropped the bar entirely.

       What separates the two is not the score, it is HOW the match was
       made:

         "resosrt" -> "resort"  is a TYPO. The word typed is not in the
                                   index at all, and the only reason the
                                   entry surfaced is the fuzzy path
                                   finding it one edit away.
         "app"     -> "app"      is an EXACT hit on a generic word. It
                                   was always going to match, and it
                                   says nothing about the subject.

       So the retry fires only for a genuine misspelling: some query
       token that is NOT an exact index key, yet is one edit from a key
       that belongs to that entry. An exact hit on a shared word is not
       a rescue, it is a coincidence, and the refusal stands. */
    if (analysis.intent === "code" && out.noTemplate && this.code) {
      var inCode = results.filter(function (h) {
        return h.entry && (h.entry.topic || "").indexOf("code-") === 0;
      });
      var top = inCode[0];
      if (top && top.entry.concept && this.code.get(top.entry.concept) &&
          this.kb.reachedByTypo(searchTokens, top.entry.id)) {
        out = this.gen.code({
          template: this.code.get(top.entry.concept),
          entry: top.entry,
          score: top.score,
          language: lang,
          seed: opts.seed,
          fuzzy: true
        });
      }
    }

    /* HOW THE TEMPLATE WAS REACHED, EVEN WHEN IT WAS REACHED NORMALLY.

       The retry above only runs when retrieval REFUSED - out.noTemplate.
       "give me code of resosrt" no longer refuses: the typo token is
       resolved to its near key in queryVector, the resort entry clears
       the accept bar, the template goes out through the ordinary path
       - and fuzzyMatch came back false, because the flag described the
       refusal retry rather than the fact that the match was reached on
       a misspelling.

       So the same predicate that authorises the retry also LABELS the
       ordinary serve: some query token absent from the index entirely,
       one edit from a key that posts to this entry. "app" in "build me
       an ios app" is an exact index hit and still reports false, which
       is the whole point of the distinction - a weak match on a shared
       word is a coincidence, not a typo. */
    if (analysis.intent === "code" && out.isCode && out.entryId && !out.fuzzyMatch) {
      out.fuzzyMatch = this.kb.reachedByTypo(searchTokens, out.entryId);
    }

    /* Report the language of the text we are actually returning, not
       the language of the request. They differ: refusals are written in
       all three languages, but the knowledge bank is English, so a
       Bisaya question still gets an English answer. Claiming "bisaya"
       over an English paragraph would be a small lie in the metadata
       that anything downstream would reasonably trust. */
    out.lang = out.answerLang || "english";
    out.requestLang = lang;
    /* Exposed so an app can show or act on the read without parsing the
       text. Null when nothing cleared the detection bar, which is the
       common case and is deliberately not a guess. */
    out.mood = mood;
    out.moodConfidence = moodRead.confidence;
    out.userName = useCtx ? this.ctx.nameOf() : null;

    /* 6. remember */
    if (useCtx) {
      this.ctx.push({
        user: raw, reply: out.text, topic: out.topic,
        intent: out.intent,
        /* The subject and the entry that answered. Storing the shelf
           alone is not enough to answer "our last topic" later: the user
           remembers the thing, not the category it was filed under. */
        subject: this.subjectOf(results),
        entryId: out.entryId || null,
        language: lang,
        entities: this.extractEntities(results),
        unknown: !out.known
      });
      this.ctx.rememberSaid(out.text);
    }

    if (opts.explain) {
      out.debug = {
        tokens: tok.tokens,
        language: analysis.language,
        intent: analysis.intent,
        topic: analysis.topic,
        topicRank: analysis.topicRank.slice(0, 3),
        candidates: this.kb.candidates(searchTokens, 5).length,
        topScore: results.length ? results[0].score : 0,
        hits: results.slice(0, 3).map(function (r) { return r.id + " " + r.score.toFixed(3); })
      };
    }
    return out;
  };

  /* ---- memory reference --------------------------------------- */

  /* "Do you remember our last topic?"

     The one question the knowledge bank cannot answer, because the
     knowledge bank is not where the answer is. It is in the transcript,
     so this reads memory and uses the bank only for phrasing.

     Two details that are easy to get wrong and expensive when they are:

     1. The snapshot is taken BEFORE the turn is recorded. Once this
        turn is pushed it becomes the most recent turn with a topic, and
        "our last topic" would start answering with the question rather
        than the subject - which turns a correct answer into a wrong one
        on the very next repeat.

     2. The recorded topic is the RECALLED one, not this question's.
        This message's own detected topic is "conversation", and storing
        that would overwrite the real subject. The damage is delayed and
        hard to trace: the next genuine follow-up would inherit
        "conversation" as its subject and drag the shelf holding these
        very sentences into an unrelated question. */
  Engine.prototype.memoryReply = function (raw, lang, useCtx, opts) {
    opts = opts || {};
    var rec = useCtx ? this.ctx.recalled() : null;
    /* Taken first, deliberately. See note 1 above. */
    var snapshot = this.ctx.recallSnapshot();

    var def = this.kb.defines("memory_reference");
    var out = this.gen.memory({
      recalled: rec,
      templates: (def && def.memory) || {},
      entryId: def ? def.id : null,
      language: lang,
      seed: opts.seed
    });

    out.lang = out.answerLang || lang;
    out.requestLang = lang;
    out.recall = snapshot;

    if (useCtx) {
      this.ctx.push({
        user: raw,
        reply: out.text,
        topic: rec ? rec.topic : null,
        intent: "memory_reference",
        subject: rec ? rec.subject : null,
        entryId: rec ? rec.entryId : null,
        entities: rec && rec.subject ? [rec.subject] : [],
        language: lang,
        unknown: false
      });
      this.ctx.rememberSaid(out.text);
    }

    if (opts.explain) {
      out.debug = {
        intent: "memory_reference",
        bypassedSearch: true,
        hadHistory: !!rec,
        recalledTopic: rec ? rec.topic : null,
        recalledSubject: rec ? rec.subject : null,
        templatesFrom: def ? def.id : null
      };
    }
    return out;
  };

  /* ---- greeting ---------------------------------------------- */

  /* "hi" is not a retrieval question. It shares almost no vocabulary
     with anything in the bank, so searching for it returns whatever
     entry drifts nearest, which is how a greeting can produce a
     paragraph about encryption. The wording comes from the bank and
     the name from the context, and neither is inferred.

     When no name is known the slot is removed rather than filled with
     "there" - a greeting that says "Hello, there" to someone who never
     gave a name reads as a bug, and so does a dangling comma. */
  Engine.prototype.greetingReply = function (raw, def, lang, useCtx, opts, moodRead, justLearned) {
    var name = useCtx ? this.ctx.nameOf() : null;
    var lines = (def.greet && (def.greet[lang] || def.greet.english)) || [];

    /* Rotate through the greeting lines rather than seeding a pick, so
       a fixed seed still varies. See generator.greet for why the seed
       alone was not enough. */
    var text = this.gen.greet({
      name: name,
      lines: lines,
      seed: opts.seed,
      nudge: useCtx ? this.ctx.greetCount : 0
    });

    /* A mood on the greeting itself - "hi :(" - is worth answering,
       and it is the one place where the opener replaces nothing,
       because there is no answer to lose. */
    var lead = this.gen.empathise({ mood: moodRead.mood, language: lang, seed: opts.seed });
    if (lead) text = lead + " " + text;

    /* The one-time offer, on the FIRST greeting and only while no name
       is known. `claimNameAsk` is the gate, so no call site can
       accidentally ask twice - and the greeting still works perfectly
       well for someone who never answers, because the ask is a
       separate sentence that can simply be ignored.

       Skipped when the name arrived in this same message ("hi, I am
       jz"), because asking someone their name in the breath of them
       giving it to you is a small, avoidable silliness. */
    if (useCtx && !name && !justLearned && this.ctx.claimNameAsk()) {
      var ask = this.gen.line({
        lines: (def.nameAsk || {}), language: lang, seed: (opts.seed || 1) + 1,
        avoid: this.ctx.said
      });
      if (ask) text = text + "\n\n" + ask;
    }

    if (useCtx) {
      this.ctx.greetCount++;
      this.ctx.push({
        user: raw, reply: text, topic: "conversation", intent: "greeting",
        subject: name || "greeting", language: lang, entities: [], unknown: false
      });
      this.ctx.rememberSaid(text);
    }

    return {
      text: text,
      entryId: def.id,
      concept: def.concept || "greeting",
      confidence: 1,
      known: true,
      weak: false,
      topic: "conversation",
      intent: "greeting",
      answerLang: lang,
      requestLang: lang,
      /* What the app can show or act on, without re-parsing the text. */
      userName: name,
      justLearnedName: justLearned ? name : null,
      mood: moodRead.mood,
      moodConfidence: moodRead.confidence,
      hint: null
    };
  };

  /* What the engine currently remembers, as plain data.

     This is the read-only view - the same object shape the design calls
     for, and it never invents a topic. `previous_topic` is null when
     nothing substantive has been discussed, which is the answer, not a
     failure to find one. */
  Engine.prototype.recall = function () {
    return this.ctx.recallSnapshot();
  };

  /* What the last answer was actually about.

     `concept` when the entry declares one, because that is the curated
     name for the subject; otherwise the entry's first keyword. Never the
     shelf: "health" is where the entry was filed, not what it says, and
     telling someone their last topic was "health" when they were asking
     about sleep is technically accurate and practically useless. */
  Engine.prototype.subjectOf = function (results) {
    if (!results.length || !results[0].entry) return null;
    var e = results[0].entry;
    if (e.concept) return e.concept;
    return (e.keywords && e.keywords.length) ? e.keywords[0] : null;
  };

  /* The entry's own keywords are a better guess at the subject than
     grabbing any noun out of the sentence. */
  Engine.prototype.extractEntities = function (results) {
    var out = [];
    if (results.length && results[0].entry) {
      var e = results[0].entry;
      for (var i = 0; i < e.keywords.length && out.length < 3; i++) {
        if (/[\s]/.test(String(e.keywords[i]))) continue;
        out.push(T.stem(String(e.keywords[i]).toLowerCase()));
      }
    }
    return out;
  };

  Engine.prototype.reset = function () { this.ctx.reset(); return this; };
  Engine.prototype.stats = function () {
    var s = this.kb.stats();
    s.files = this.files.length;
    /* Surface forms attached, not concepts. This is the number that says
       "how many words does it understand", which is the question people
       actually ask about a multilingual bank. */
    s.lexicon = this.lexiconCount;
    return s;
  };
  Engine.prototype.topics = function () { return Object.keys(this.kb.topics); };

  return { Engine: Engine, DATA_FILES: DATA_FILES, MOOD: M, BUILD: BUILD, _loadAsync: loadAsync };
});
