/* ============================================================
   bokskie-v1 · verify-engine.js
   ------------------------------------------------------------
   Tests for the understanding engine (engine/ + data/).

     node bokskie-v1/verify-engine.js

   The test that matters most is section 6. Everything else proves
   the machinery works; that one proves the system prefers to admit
   ignorance rather than answer wrongly, which is the entire reason
   this engine exists.
   ============================================================ */

"use strict";

var path = require("path");
var ROOT = __dirname;
var pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + extra : "")); }
}
function eq(name, got, want) {
  ok(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}
function section(n, t) { console.log("\n" + n + ". " + t + "\n" + new Array(58, "-").join("-")); }

var T = require(path.join(ROOT, "engine/tokenizer.js"));
var SIM = require(path.join(ROOT, "engine/similarity.js"));
var I = require(path.join(ROOT, "engine/intent.js"));
var C = require(path.join(ROOT, "engine/context.js"));
var K = require(path.join(ROOT, "engine/kb.js"));
var G = require(path.join(ROOT, "engine/generator.js"));
/* engine/index.js exports { Engine, DATA_FILES }, so the loader is on
   Engine - reaching for E.load() looks right and is not. */
var E = require(path.join(ROOT, "engine/index.js"));
var load = E.Engine.load;

/* Asynchronous checks register here and the summary waits. See the end
   of this file: without it, a promise-based test resolves after the
   verdict has been printed and its assertions are lost. */
var pending = [];

/* ============================================================
   1. TOKENIZER
   ============================================================ */
section(1, "tokenizer");

eq("lowercases", T.normalize("  HeLLo  "), "hello");
eq("curly quotes become plain", T.normalize("don\u2019t"), "don't");
eq("strips punctuation", T.words("hi, there!").length, 2);
eq("keeps contractions whole", T.words("don't stop")[0], "don't");

var t1 = T.tokenize("what is javascript");
eq("drops stopwords", t1.tokens.indexOf("what"), -1);
eq("keeps content words", t1.tokens.indexOf("javascript") !== -1, true);

/* The prefix list is deliberately conservative. A two-letter prefix
   looked harmless and quietly turned "kamusta" into "musta". */
eq("kamusta survives stemming", T.tokenize("kumusta").tokens[0], "kamusta");
eq("maayo survives stemming", T.tokenize("maayo").tokens[0], "maayo");
eq("naglaro strips nag-", T.tokenize("naglaro").tokens[0], "laro");
eq("kumusta and musta unify", T.tokenize("kumusta").tokens[0], T.tokenize("musta").tokens[0]);
eq("bigrams over a string", T.bigrams("ab").length, 3);

/* ============================================================
   2. SIMILARITY
   ============================================================ */
section(2, "similarity");

eq("identical strings", SIM.levRatio("javascript", "javascript"), 1);
ok("typo still scores high", SIM.levRatio("javascript", "javascrip") >= 0.9, SIM.levRatio("javascript", "javascrip"));
eq("empty is zero", SIM.cosine({}, {}), 0);
ok("jaccard rewards overlap", SIM.jaccard({ a: 1, b: 1 }, { a: 1, b: 1, c: 1 }) > 0.6);
ok("dice rewards shared bigrams", SIM.dice(["pr", "ro"], ["pr", "ro", "og"]) > 0.7);

/* ============================================================
   3. INTENT
   ============================================================ */
section(3, "intent, topic, language");

[["hi", "greeting"], ["kumusta ka", "greeting"], ["goodbye", "farewell"],
 ["salamat", "gratitude"], ["who are you", "identity"],
 ["what can you do", "capability"], ["how do i fix a bug", "howto"],
 ["what is gravity", "definition"], ["how much is it", "price"],
 ["bakit mahal", "why"], ["saan ito", "where"], ["sino ito", "who"]
].forEach(function (c) {
  var a = I.analyse(c[0], T.tokenize(c[0]).tokens);
  eq("intent: " + c[0], a.intent, c[1]);
});

eq("topic: javascript", I.analyse("what is javascript", T.tokenize("what is javascript").tokens).topic, "programming");
eq("topic: gravity", I.analyse("tell me about gravity", T.tokenize("tell me about gravity").tokens).topic, "science");
eq("topic: nothing relevant", I.analyse("asdfghjkl", T.tokenize("asdfghjkl").tokens).topic, null);
eq("language: bisaya", I.language("kumusta ka unsa sayon"), "bisaya");
eq("language: tagalog", I.language("magandang araw sa inyo"), "tagalog");
eq("language: english", I.language("what is the weather today"), "english");

/* ============================================================
   3b. DEAD ROUTER KEYS
   ============================================================
   The router matches against tokens, and tokens are stemmed. So a key
   that is not itself stemmed is a key nothing can ever produce - a line
   of configuration that looks load-bearing and does nothing.

   Five of these shipped: `programming` (the stemmer yields "programm"),
   `coding` ("cod"), `process` ("proces"), `thread` and `vpn`. The first
   is the one that hurt, because a bare "lets talk about programming"
   routes to no topic at all, takes the 0.55x off-topic penalty on the
   right answer, and refuses instead of answering.

   It survived this long because every earlier test asked a longer
   question that happened to contain some other keyword, so the dead
   key never had to carry the query by itself. */
var STEMMABLE = ("javascript python java code coding program programming function variable " +
  "array loop method object bug debug error syntax api json framework library node react " +
  "vue angular typescript database sql server deploy git github algorithm php golang rust " +
  "kotlin swift frontend backend software cpu ram ssd binary cache process thread http " +
  "cookie localstorage encryption firewall router dns vpn latency packet subnet ethernet " +
  "storage directory graphics motherboard processor memory disk file monitor keyboard " +
  "mouse windows linux operating manifest browser domain stylesheet").split(" ");

var deadKeys = [];
STEMMABLE.forEach(function (w) {
  var stem = T.stem(T.canonical(w));
  if (stem === w) return;                    /* already stemmed, fine */
  for (var topic in I.TOPICS) {
    if (!I.TOPICS.hasOwnProperty(topic)) continue;
    if (I.TOPICS[topic].keys[stem] !== undefined) return;
  }
  deadKeys.push(w + " -> \"" + stem + "\"");
});

ok("no dead router keys (" + STEMMABLE.length + " words audited)", deadKeys.length === 0,
   deadKeys.join(", "));

/* Framing words must not outvote the subject. Every one of these
   phrases names exactly one content word, and each of them used to
   refuse because the framing leaked into the query vector and diluted
   the real subject below the accept bar. "alam" and "kaba" are the
   clearest: "may alam kaba about programming" carries no information
   except the word "programming". */
[["may alam kaba about programming", ["programm"]],
 ["lets talk about programming", ["programm"]],
 ["what framework you suggest to use in frontend", ["framework", "frontend"]],
 ["magkano ang pera", ["pera"]],
 ["i want to learn about python", ["python"]]
].forEach(function (c) {
  eq("framing is stripped: " + c[0], T.tokenize(c[0]).tokens.join(" "), c[1].join(" "));
});

/* The other half, and the one that matters more: a language shelf's
   own concept words must NOT be stopped, or "unsa ang kaayo" becomes
   unanswerable while fixing the case above. */
[["unsa ang kaayo", true], ["ano ang mahal", true], ["unsa meaning nga dako", true],
 ["ano ang kulang", true], ["unsa ang ikaw", true], ["ano ang sobra", true],
 ["unsa ang dili", true], ["ano ang kumusta", true], ["bakit grumpy", true]
].forEach(function (c) {
  var survived = T.tokenize(c[0]).tokens.length > 0;
  eq("concept survives stopwords: " + c[0], survived, c[1]);
});

/* And the specific pre-existing bug this section exists for: every
   word in "unsa ang kaayo" used to be a stopword, so the query
   tokenised to nothing and the Cebuano entry was unreachable in
   Cebuano. The topic word itself must now survive. */
ok("kaayo survives tokenization", T.tokenize("unsa ang kaayo").tokens.indexOf("kaayo") !== -1,
   JSON.stringify(T.tokenize("unsa ang kaayo").tokens));

/* `ikaw` WAS on that list and was taken off it deliberately. With the
   token alive, "haha ikaw" - a joke, not a lookup - matched the entry
   about the pronoun at 0.864 and answered a laugh with a grammar
   definition, which is the failure the stop list exists for. The entry
   stays reachable the way the other stopped subjects stay reachable:
   its own written patterns lift it when somebody actually asks ("ano
   ang ikaw"), and the social half of "haha ikaw" is pinned with the
   greeting tests below. A word can be a common SUBJECT of conversation
   and still be wrong as a retrieval key, and this one is. */
ok("ikaw is stopped again", T.tokenize("unsa ang ikaw").tokens.indexOf("ikaw") === -1,
   JSON.stringify(T.tokenize("unsa ang ikaw").tokens));

/* And the case that actually broke, pinned so it cannot regress. */
eq("a bare topic word routes on its own",
   I.analyse("programming", T.tokenize("programming").tokens).topic, "programming");
eq("a framed request still routes",
   I.analyse("lets talk about programming", T.tokenize("lets talk about programming").tokens).topic,
   "programming");

/* ============================================================
   4. CONTEXT
   ============================================================ */
section(4, "conversation memory");

var ctx = new C.Context();
eq("a fresh context has no topic", ctx.topic, null);
ctx.push({ user: "what is javascript", reply: "...", topic: "programming", entities: ["javascript"] });
eq("topic is remembered", ctx.topic, "programming");
eq("entities are remembered", ctx.entities[0], "javascript");
ok("a short vague follow-up is recognised", ctx.isFollowUp(["more"]));
ok("a full question is not a follow-up", !ctx.isFollowUp(["how", "does", "gravity", "actually", "work", "properly"]));

for (var i = 0; i < 40; i++) ctx.push({ user: "x" + i, reply: "y" + i, topic: "science" });
eq("turn count is bounded", ctx.turns.length, ctx.maxTurns);

ctx.rememberSaid("a"); ctx.rememberSaid("b");
ok("said-text is remembered", ctx.saidRecently("a"));
ok("stranger is not remembered", !ctx.saidRecently("zzz"));
ctx.reset();
eq("reset clears everything", ctx.turns.length, 0);

/* ============================================================
   5. KNOWLEDGE BASE + INDEX
   ============================================================ */
section(5, "knowledge base and index");

var kb = new K.KB();
kb.add({ id: "a", topic: "t1", keywords: ["alpha"], answer: "Alpha is the first letter." });
kb.add({ id: "b", topic: "t2", keywords: ["beta"], answer: "Beta is the second letter." });
kb.build();

eq("two entries", kb.entries.length, 2);
ok("the index is populated", Object.keys(kb.index).length > 0);
eq("index is a real index, not a scan", kb.candidates(["alpha"], 10).length, 1);
eq("unknown token finds nothing", kb.candidates(["zzzzz"], 10).length, 0);
ok("fuzzy match finds a near miss", kb.candidates(["alpga"], 10).length > 0);

/* The whole point of the index: a query must not score the whole
   bank, or the 1M-entry plan collapses back into a linear scan. */
var big = new K.KB();
for (var n = 0; n < 5000; n++) {
  big.add({
    id: "e" + n, topic: "t" + (n % 10), keywords: ["word" + n, "common"],
    answer: "Entry " + n + " about topic " + (n % 10) + " and filler so the vector is not degenerate."
  });
}
big.build();
var t0 = Date.now();
for (var q = 0; q < 100; q++) big.search({ tokens: ["word4242"], text: "word4242" });
var elapsed = Date.now() - t0;
ok("100 queries over 5000 entries under 2s", elapsed < 2000, elapsed + "ms");
eq("and it found the right one", big.search({ tokens: ["word4242"], text: "word4242" })[0].id, "e4242");

load().then(function (engine) {
  var st = engine.stats();
  ok("engine loaded a real bank", st.entries >= 50, st.entries + " entries");
  ok("index has many tokens", st.tokens > 500, st.tokens + " tokens");
  ok("all nine topics present", engine.topics().length >= 9, engine.topics().join(","));

  /* ============================================================
     6a. THE REFUSAL TEXT ITSELF
     ============================================================
     The refusal is the sentence a user is most likely to see, and
     for two years it was the one line nobody re-read. It was also
     the worst-written text in the project: the Tagalog said "mas
     tayo akong magsasabi" (tayo wedged into the middle of the
     phrase), called its own memory a "talasalitaan" (a dictionary),
     and offered help "sa batayan nito"; the Bisaya asked for "kaubang
     nga topic" and the Tagalog excited opener read "Ayoko nito" -
     which means "I dislike this". All three were generated, all
     three were shipped, and no test failed, because every test
     checked the engine's DECISION to refuse and never the WORDS it
     used to refuse with.

     A test cannot judge whether Tagalog is good. It can catch the
     specific breakages seen here, and that is what this does: the
     refused strings are pinned against the known-bad substrings and
     required to still state the refusal. */
  section(6.1, "the refusal wording, in all three languages");
  (function () {
    /* Driven through the ENGINE, not by reaching into SLOTS. The
       strings are the product and the user only ever sees the
       engine's output, so asserting on an internal table would test
       something the user never sees - and it would keep passing if
       the table stopped being what the engine actually says. */
    var BANNED = ["mas tayo ako", "talasalitaan", "batayan nito",
                  "kaubang nga", "Ayoko nito", "maghatol",
                  "Dili nako mahimong"];
    var MUST = { english: /do not know|not going to guess|outside what/i,
                 tagalog: /hindi ko alam|maghuhula|wala akong alam/i,
                 bisaya:  /dili nako|wala ako og kabalo|dili ako/i };
    ["english", "tagalog", "bisaya"].forEach(function (L) {
      /* Enough seeds to rotate through every variation in the slot. */
      var seen = {};
      for (var s = 1; s <= 40; s++) {
        var t = engine.reply("what is zxqvw nonsense " + s,
                         { seed: s, lang: L, useContext: false }).text;
        if (/do not know any more about programming|is a small/i.test(t)) continue;
        seen[t] = 1;
      }
      var all = Object.keys(seen);
      ok(L + " produced refusal wording", all.length > 0, all.length + " variants");
      var bad = all.filter(function (t) {
        return BANNED.some(function (b) { return t.indexOf(b) >= 0; });
      });
      eq(L + " refusal has no known-bad wording", bad.join(" | "), "");
      var silent = all.filter(function (t) { return !MUST[L].test(t); });
      eq(L + " refusal still admits it does not know", silent.join(" | "), "");
    });
  })();

    /* ========== 6b. THE SENTENCES PEOPLE ACTUALLY SEND ==========

       22 real Tagalog and Cebuano lines, asked in the language they
       are written in, all of which must be answered from the right
       entry. This is not the 54-question coverage probe - that one
       asked about SUBJECTS in English. This one asks about the
       sentences themselves, which is a different retrieval path and
       was quietly at zero.

       Two separate failures were behind it, and only the second is
       visible from a shelf listing. The entries did not exist; and
       once they did, "sige", "gikan ako", "kay nga" and "okay gyud ako"
       still refused, because each of those words is on the tokenizer's
       stop list and the whole message tokenised to nothing. An entry
       can be perfectly written, present in the data, and still
       unanswerable, and nothing reports that except asking it. */
  section(6.2, "real Tagalog and Cebuano chat lines");
  (function () {
    [["busy ako", "busy ako"], ["puntahan kita", "puntahan kita"],
     ["kinakabahan ako", "kinakabahan ako"],
     ["kumain ka na ba", "kumain ka na ba"], ["sige", "sige"],
     ["pasensya na", "pasensya na"], ["ang init", "ang init"],
     ["susulongin kita", "susulongin kita"],
     ["nanghinihiya ako", "nanghinihiya ako"], ["tama ka", "tama ka"],
     ["nag-aalala ako sa iyo", "nag-aalala ako sa iyo"],
     ["okay lang ako", "okay lang ako"],
     ["naayo ka na", "naayo ka na"], ["okay gyud ako", "okay gyud ako"],
     ["gikan ako", "gikan ako"], ["kaayo unta", "kaayo unta"],
     ["kaw makaayo", "kaw makaayo"], ["ayaw nako", "ayaw nako"],
     ["kay nga", "kay nga"], ["mahal kita", "mahal kita"],
     ["adtlaka na ako", "adtlaka na ako"]
    ].forEach(function (row) {
      var r = engine.reply(row[0], { seed: 7, useContext: false });
      ok("\"" + row[0] + "\" is answered", r.known, r.text.slice(0, 50));
    });

    /* The four that were the actual bug, asserted directly rather than
       through the table, so a stop-list change is caught here and not
       only as one more red row above. */
    ["sige", "gikan ako", "kay nga", "okay gyud ako"].forEach(function (q) {
      var t = T.tokenize(q);
      ok("\"" + q + "\" leaves something to search with",
         t.tokens.length > 0, JSON.stringify(t.tokens));
    });

    /* "Ano ang gamit ng X" is the ordinary Tagalog for "what is X used
       for", and it refused while the English answered. "gamit" is the
       request-shape word and belongs beside "use" on the stop list.

       The plain "ano ang X" form is still weaker than its English
       equivalent and is NOT fixed here - see the long note in
       tokenizer.js, where the frame rule that would fix it was built,
       measured, and reverted. This one row is pinned so the gap stays
       visible instead of quietly becoming a regression. */
    var g = engine.reply("ano ang gamit ng python", { seed: 7, useContext: false });
    ok("ano ang gamit ng python is answered", g.known, g.text.slice(0, 50));
  })();

  /* ========== 6c. A NAME, JUST GIVEN, IS NOT A REFUSAL ==========

     "ako si jz" learned the name correctly and was then told "I have
     nothing on that", because a name on its own retrieves nothing and
     the generator does what it is built to do. The one moment warmth
     matters most was getting the coldest reply available.

     The negative half matters just as much: a name arriving with a
     real question must not swallow the answer. */
  section(6.3, "a name on its own is acknowledged, not refused");
  (function () {
    engine.reset();
    var r = engine.reply("ako si jz", { seed: 11, useContext: true });
    ok("the name is not answered with a refusal", r.known, r.text.slice(0, 50));
    ok("and the reply uses the name", /jz/.test(r.text), r.text.slice(0, 60));
    /* Anchored, and this is the second time that assertion has been
       wrong. "wala akong alam" is a substring of "kung wala akong
       alam, sasabihin ko" - the clause inside the Tagalog GREETING -
       so a plain contains-check reported a warm reply as a refusal.
       The test was green for the wrong reason. What matters is how
       the reply opens, so the refusal forms are matched as openings
       and nothing else. */
    var REFUSALS = ["I do not know anything about that",
                    "That is outside what I actually know",
                    "I do not know that one",
                    "Wala akong alam tungkol dito",
                    "Hindi ko alam iyon",
                    "Hindi iyon ang saklaw ng kaalaman ko",
                    "Wala ako og kabalo niini",
                    "Dili nako mahimo kining tubtob"];
    var startsLikeRefusal = REFUSALS.some(function (s) {
      return r.text.indexOf(s) === 0;
    });
    ok("and it does not open with a refusal",
       !startsLikeRefusal, r.text.slice(0, 70));

    /* A real question alongside the name must still be answered, and
       answered as itself rather than downgraded to a greeting. */
    engine.reset();
    var q = engine.reply("ako si jz, ano ang gravity", { seed: 11, useContext: true });
    ok("a name plus a real question still answers the question",
       /gravity/i.test(q.text) || q.concept === "gravity", q.text.slice(0, 60));
    engine.reset();
  })();

  /* ============================================================
     8. IT WRITES CODE
     ============================================================
     The newest capability and the easiest one to get wrong in a way
     that looks like success. Three properties are asserted, in
     order of how badly they fail when lost:

       1. VERBATIM. The file must arrive byte for byte. This is the
          one the generator actively works against - it rotates
          entries through `variations` so it does not repeat itself,
          which is a readability feature for prose and a syntax error
          for a <script> tag. A test that only checked `isCode` would
          pass while the page no longer ran.
       2. UNDECORATED. No mood opener above a file.
       3. STILL HONEST. A build request with no template must refuse
          and name what is available - not answer with a
          neighbouring entry. "make me a dating app" routed to the
          smartphone shelf and produced a confident paragraph about
          phone screens, which is the single worst outcome this
          feature can have.
     ============================================================ */
  section(8, "it writes code, verbatim, and still refuses honestly");
  (function () {
    ok("the code library loaded", engine.code.size() > 0,
       engine.code.size() + " template(s)");

    ["make me a resort website", "build a resort website using html css and javascript",
     "can you build me a website", "gawa ka ng resort website",
     "buhat nako og resort website"
    ].forEach(function (q) {
      var r = engine.reply(q, { seed: 5, useContext: false });
      ok("\"" + q + "\" is the code intent", r.intent === "code", r.intent);
      ok("  and hands over a file", r.isCode === true, String(r.concept));
      if (!r.isCode) return;

      var tpl = engine.code.get(r.concept);
      ok("  the file is the one the library holds", !!tpl, r.concept);

      /* Pull the body back out of the fence and compare it to the
         source. The trailing newline belongs to the fence, so it is
         trimmed - leaving it in makes every template read as altered,
         which is how a real off-by-one here would be dismissed. */
      var at = r.text.indexOf("```" + r.codeLang + "\n");
      var body = at >= 0
        ? r.text.slice(at + ("```" + r.codeLang + "\n").length, r.text.lastIndexOf("```"))
        : "";
      if (body.slice(-1) === "\n") body = body.slice(0, -1);
      eq("  the code arrives verbatim", body, tpl.code);

      ok("  no mood opener above the code",
         !/^(That sounds|I'm sorry|Sounds like|You sound|Glad)/.test(r.text),
         r.text.slice(0, 40));
      ok("  and it explains itself afterwards",
         /\*\*How it works\*\*|Paano ito gumagana|Unsaon ni nga kini/.test(r.text),
         "no explanation section");
    });

    /* A build request for something with no template. Every one of
       these produced a confident wrong answer before the guard. */
    ["make me a dating app", "build me an ios app", "make me a blockchain game",
     "create a neural network from scratch"
    ].forEach(function (q) {
      var r = engine.reply(q, { seed: 5, useContext: false });
      ok("\"" + q + "\" is not answered with code", r.isCode !== true,
         "concept=" + r.concept);
      ok("  and does not claim to know it",
         !/here (is|'s) a complete/i.test(r.text), r.text.slice(0, 60));
    });

    /* The available list is the useful half of the refusal. */
    var miss = engine.reply("make me a dating app", { seed: 5, useContext: false });
    ok("the refusal names what it can build",
       /What I can build|Ang kaya kong gawin|Ang mahimo nako/.test(miss.text),
       miss.text.slice(0, 60));

    /* THE LIBRARY AND THE INTENT TABLE MUST NOT DRIFT APART.

       intent.js cannot read data/code.json, so the list of subjects it
       recognises as "build me a thing" is a hand-maintained duplicate of
       the list of things that exist. Duplicates rot, and this one rotted
       in the wrong direction: four templates were written and served,
       and "gawa ka ng calculator" refused, because `calculator` was
       not in the intent pattern. The template was fine. The pattern was
       behind.

       So every template is asked for here, in all three languages, and
       a template nobody can ask for by name is a bug rather than an
       unreachable corner of the library. */
    engine.code.list().forEach(function (concept) {
      var short = concept.replace(/ (website|list|app)$/, "");
      ["make me a " + short, "gawa ka ng " + short,
       "buhat nako og " + short
      ].forEach(function (q) {
        var r = engine.reply(q, { seed: 5, useContext: false });
        ok("\"" + short + "\" is reachable (" + q.split(" ")[0] + ")",
           r.isCode === true && r.concept === concept,
           "concept=" + r.concept);
      });
    });
  })();

    /* ============================================================
       8.3. THE PHRASINGS PEOPLE ACTUALLY TYPE
       ============================================================
       Every one of these was reported broken by somebody using the app,
       and every one of them passed this suite at the time. The
       verb-only patterns were the blind spot: all of them asked for
       something without saying build, make or create, and the shape
       that marks a build request is not a verb.

       "give me code of that please" appears twice on purpose. In a
       conversation it resolves from the previous turn; alone it must
       refuse, because "that" points at nothing. That refusal is the
       correct answer, and it is asserted here so that it cannot later
       be "fixed" into a guess. */
  section(8.3, "the phrasings people actually type");
  (function () {
    [["can you create a restaurant website?", "restaurant website"],
     ["resort website please", "resort website"],
     ["give me code of resosrt", "resort website"],
     ["code of resort please", "resort website"],
     ["make me a portfolio website", "portfolio website"],
     ["calculator please", "calculator"]
    ].forEach(function (row) {
      engine.reset();
      var r = engine.reply(row[0], { seed: 5, useContext: false });
      ok("\"" + row[0] + "\" gives code",
         r.isCode === true && r.concept === row[1],
         "isCode=" + r.isCode + " concept=" + r.concept);
    });

    engine.reset();
    engine.reply("make me a resort website", { seed: 5 });
    var f = engine.reply("give me code of that please", { seed: 5 });
    ok("a subjectless \"give me the code\" reuses the last topic",
       f.isCode === true && f.concept === "resort website", "concept=" + f.concept);

    engine.reset();
    var alone = engine.reply("give me code of that please", { seed: 5 });
    ok("but with no history it refuses rather than guessing",
       alone.isCode !== true, "concept=" + alone.concept);
    engine.reset();
  })();

  /* ============================================================
     8.4. A TYPO IS RESCUED, A COINCIDENCE IS NOT
     ============================================================
     The other half of typo tolerance, and the one that matters more.
     "build me an ios app" also has a token that hits a code shelf, and
     it must NOT be rescued - the first version of the rescue served the
     to-do list in answer to it, because `app` is a keyword of that entry
     and the retry had dropped the bar with no way to tell a misspelling
     from a coincidence. */
  section(8.4, "a typo is rescued, a coincidence is not");
  (function () {
    engine.reset();
    var typo = engine.reply("give me code of resosrt", { seed: 5, useContext: false });
    ok("a transposition still finds the template", typo.isCode === true,
       "concept=" + typo.concept);
    ok("and is marked as reached on a fuzzy match", typo.fuzzyMatch === true);

    ["build me an ios app", "make me a dating app", "make a blockchain game"]
      .forEach(function (q) {
        engine.reset();
        var r = engine.reply(q, { seed: 5, useContext: false });
        ok("\"" + q + "\" is still refused", r.isCode !== true,
           "concept=" + r.concept);
      });
    engine.reset();
  })();

  /* ============================================================
     8b. THE BROWSER LOAD PATH
     ============================================================
     The bug this section exists for: the code library was read on the
     node path and not on the browser path, so the real app refused
     every code request while this entire suite stayed green. Every
     other test in this file runs under node, which is exactly why it
     could not see it.

     The browser gets its bank from data/bundle.js through a global, and
     that short circuit in loadAsync returned before the library was
     ever fetched. So this test drives loadAsync itself - with a fake
     fetch serving the real code.json - and asserts the library comes
     back. A suite that only ever runs one of two load paths is a
     suite with a blind spot the size of the path it skips. */
  section(8.2, "the browser load path also gets the code library");
  (function () {
    /* The real branch, not a simulation of it. The browser gets its
       bank from data/bundle.js, which sets BokskieData on the global;
       fromGlobal finds that and loadAsync returns early. That early
       return is exactly what skipped the code library, so the test
       sets the same global and calls the same function. */
    var bundle = require("./data/bundle.js");
    var hadGlobal = Object.prototype.hasOwnProperty.call(globalThis, "BokskieData");
    var before = globalThis.BokskieData;
    globalThis.BokskieData = { entries: bundle.entries, lexicon: bundle.lexicon,
                               shelves: bundle.shelves };

    var realFetch = global.fetch;
    var asked = [];
    global.fetch = function (url) {
      asked.push(String(url));
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve(require("./data/code.json")); }
      });
    };

    var e2 = new E.Engine();
    pending.push(E._loadAsync(e2)
      .then(function (engine) {
        ok("the browser path asked for code.json",
           asked.some(function (u) { return /code\.json$/.test(u); }),
           asked.join(", ") || "it never asked for anything");
        ok("and the library is not empty on that path",
           engine.code.size() > 0, engine.code.size() + " template(s)");
        var r = engine.reply("make me a resort website", { seed: 5, useContext: false });
        ok("so a code request works on the browser path too",
           r.isCode === true, "concept=" + r.concept);
        ok("and the bank still loaded from the global",
           engine.kb.stats().entries > 50, engine.kb.stats().entries + " entries");
      })
      .then(function () {
        global.fetch = realFetch;
        if (hadGlobal) globalThis.BokskieData = before; else delete globalThis.BokskieData;
      })
      .catch(function (err) {
        global.fetch = realFetch;
        if (hadGlobal) globalThis.BokskieData = before; else delete globalThis.BokskieData;
        eq("browser load path ran without throwing", err.message, "no error");
      }));
  })();

    /* ========== 6d. A CODE REQUEST WITH NO SUBJECT ==========

       "Give code please" names no subject at all, and it used to be
       answered with the same refusal as "make me a dating app" - which
       asks for something specific and gets told no.

       Those are different situations and they deserve different
       sentences. A specific request that is not in the library is a
       dead end, and the honest reply names what IS available. A request
       with no subject is not a dead end at all - it is somebody who has
       not chosen yet, and the useful reply is a question and the menu,
       not a refusal dressed up as one.

       "im jz" is here too because it is the same lesson from the other
       side: the bot learned a name from "i am jz" and did not learn it
       from "im jz", because the apostrophe was required. */
    section(6.3, "a name is learned however it is typed");
    (function () {
      [["im jz", "jz"], ["i'm jz", "jz"], ["i am jz", "jz"],
       ["i m jz", "jz"], ["my name is jz", "jz"],
       ["ako si jz", "jz"], ["aking ngalan si jz", "jz"]
      ].forEach(function (row) {
        engine.reset();
        var r = engine.reply(row[0], { seed: 3, useContext: true });
        eq("\"" + row[0] + "\" is learned as " + row[1], r.userName, row[1]);
      });
      /* And it must not learn nonsense. */
      engine.reset();
      ["i mean that", "i must go", "i am a developer", "i might"]
        .forEach(function (q) {
          engine.reset();
          eq("\"" + q + "\" is not a name", engine.reply(q, { seed: 3, useContext: true }).userName, null);
        });
      engine.reset();
    })();

    section(6.4, "a code request with no subject asks which one");
    (function () {
      ["give code please", "give me code", "code please", "can you give me code"]
        .forEach(function (q) {
          engine.reset();
          var r = engine.reply(q, { seed: 5, useContext: false });
          ok("\"" + q + "\" is the code intent", r.intent === "code", r.intent);
          ok("  and asks which one", r.askedWhich === true, "concept=" + r.concept);
          ok("  and lists what it can build",
             /What I can build|Ang kaya kong gawin|Ang mahimo nako/.test(r.text),
             r.text.slice(0, 60));
        });

      /* The specific request keeps the refusal. This is the half that
         must not be softened by the fix above. */
      engine.reset();
      var d = engine.reply("make me a dating app", { seed: 5, useContext: false });
      ok("a specific unsupported request is still refused, not asked",
         d.askedWhich !== true && d.isCode !== true, "concept=" + d.concept);
      engine.reset();
    })();

  /* ============================================================
     10. THE SOCIAL PACKS, AND THE GATE OVER THEM
     ============================================================
     1500 warm replies in three languages, authored outside this
     project. The thing worth testing is not the replies - it is the
     rule that decides whether one may ever be used, because a pack
     library with a reply for every message is a machine for never
     refusing, and refusing is the one promise this bot makes.

     So the gate is tested from both sides: remarks get a pack, and
     questions do not - in all three languages, because "unsa ang
     klase sa polya" and "what is the meaning of life" are the same
     request and both have to be refused. */
  section(10, "the social packs, and the gate that guards them");
  (function () {
    ok("the pack library loaded", engine.packs.total() > 1000,
       engine.packs.total() + " packs");
    ok("all three languages are present",
       engine.packs.size("english") > 0 && engine.packs.size("tagalog") > 0 &&
       engine.packs.size("bisaya") > 0,
       "en=" + engine.packs.size("english") +
       " tl=" + engine.packs.size("tagalog") +
       " bis=" + engine.packs.size("bisaya"));

    /* --- side one: company gets a pack. These are chosen because the
       bank has NO entry for them, because a message the bank can
       answer must keep its real answer - "kainin mo na ba" looked
       like a good example here and has an entry in the Filipino
       vocabulary shelf, so it was testing the wrong branch. --- */
    ["HAHA", "tapped", "gandang araw", "awts gege", "haha ikaw"].forEach(function (q) {
      engine.reset();
      var r = engine.reply(q, { seed: 5 });
      ok("\"" + q + "\" may something social to say", r.social === true,
         "concept=" + r.concept);
    });

    /* --- side two: QUESTIONS STILL REFUSE. This is the half that
       matters, and it is asserted in every language because a gate
       that only holds in English is not a gate. --- */
    [["what is the meaning of life", "english"],
     ["who won the 2019 basketball world cup", "english"],
     ["what is the price of tesla stock today", "english"],
     ["ano ang kasalimuya", "tagalog"],
     ["unsa ang klase sa polya", "tagalog"],
     ["bakit umuulan", "tagalog"],
     ["unsa ang klase sa polya", "bisaya"],
     ["kanus-a ka na giingon", "bisaya"],
     ["make me a resort website", "english"],
     ["what is my name", "english"]
    ].forEach(function (pair) {
      engine.reset();
      var r = engine.reply(pair[0], { seed: 5, lang: pair[1], useContext: false });
      ok("\"" + pair[0] + "\" is NOT answered with a pack", r.social !== true,
         r.text.slice(0, 50));
    });

    /* --- a real answer is never overwritten --- */
    engine.reset();
    ["what is javascript", "kumusta ka", "salamat"].forEach(function (q) {
      var r = engine.reply(q, { seed: 5 });
      ok("\"" + q + "\" keeps its real answer", r.social !== true && r.known !== false,
         r.text.slice(0, 40));
    });

    /* --- {name} is filled, and never leaks --- */
    engine.reset();
    engine.reply("ako si jz", { seed: 5 });
    var withName = 0, leaked = 0, social = 0;
    for (var i = 0; i < 80; i++) {
      var s1 = engine.reply("HAHA", { seed: i, lang: "tagalog" });
      if (!s1.social) continue;
      social++;
      if (s1.text.indexOf("jz") >= 0) withName++;
      if (s1.text.indexOf("{name}") >= 0) leaked++;
    }
    ok("social replies do use the name when there is one", withName > 0,
       withName + " of " + social);
    eq("and no {name} slot ever reaches the reader", leaked, 0);

    engine.reset();
    var leaked2 = 0;
    for (var j = 0; j < 60; j++) {
      var s2 = engine.reply("HAHA", { seed: j, lang: "tagalog" });
      if (s2.social && s2.text.indexOf("{name}") >= 0) leaked2++;
    }
    eq("with no name known, the slot is removed rather than shown", leaked2, 0);

    /* --- no repeats: 150 draws, all different. This one earned its
       place by exposing that the seeded generator was handing
       consecutive seeds almost the same value, so 150 replies
       produced 40 distinct ones. --- */
    engine.reset();
    var seen = {}, distinct = 0, repeats = 0;
    for (var k = 0; k < 150; k++) {
      var s3 = engine.reply("HAHA", { seed: k + 1, lang: "tagalog" });
      if (!s3.social) continue;
      if (seen[s3.text]) repeats++; else distinct++;
      seen[s3.text] = 1;
    }
    ok("150 consecutive seeds give 150 different replies",
       repeats === 0, distinct + " distinct, " + repeats + " repeats");

    /* --- with no library, the plain refusal is what comes back --- */
    var bare = engine.gen.generate({
      results: [], analysis: { intent: null },
      language: "tagalog", context: engine.ctx
    });
    /* Matched on the MEANING, not one phrasing. There are three
       Tagalog refusals and only one says "wala akong alam"; the other
       two say "hindi ko alam" and "hindi iyon ang saklaw ng
       kaalaman ko". Pinning the first one meant this passed or failed
       on which variant the seed happened to rotate to. */
    ok("and the library is optional, not required",
       bare.social === undefined &&
       /wala akong alam|wala ako og kabalo|hindi ko alam|hindi ko pa alam|hindi iyon ang saklaw|magbibigay kayo ng pangkalahatang topic/i
         .test(bare.text),
       bare.text.slice(0, 50));
    engine.reset();
  })();

  /* ============================================================
     7. THE NAME, BOTH DIRECTIONS
     ============================================================
     A bot that learns a name and never says it has half-done the job,
     so both directions are tested: told and used back, and asked for
     when it does not know.

     "what is my name" used to be answered with a paragraph explaining
     the word "credit", and "ano pangalan ko" refused outright. Both
     were the same bug - the bank holds no entry for this question, so
     retrieval went looking for a neighbour. Asserting only the learned
     direction would not have caught either, so the ASK is pinned too.

     And the ask is bounded. `claimNameAsk` exists precisely so that
     "once per session" is a property of the context rather than a
     promise each call site has to keep, and that is what is tested:
     three greetings in a row must produce exactly one question. */
  section(7, "the name, both directions");
  (function () {
    engine.reset();

    /* --- asked, not yet told --- */
    [["what is my name", "english"], ["ano ang pangalan ko", "tagalog"],
     ["unsa akong ngalan", "bisaya"]
    ].forEach(function (pair) {
      var r = engine.reply(pair[0], { seed: 3, lang: pair[1], useContext: true });
      eq("\"" + pair[0] + "\" is the askname intent", r.intent, "askname");
      /* The wording has three variants per language and only two of them
         put "I do not know" in those words - the third is "Not yet - you
         have not told me." Matching the first phrasing meant the test
         failed whenever the seed rotated to a variant that was equally
         honest, which is a test measuring wording while claiming to
         measure meaning. All three admit the gap; the assertion is that
         it is admitted at all. */
      ok("  and admits it does not know, in " + pair[1],
         /do not know|not going to guess|outside what|not been told|not yet|hindi pa alam|hindi mo pa ako sinabihan|wala pa ako og kabalo|wala pa gikan nimo/i
           .test(r.text),
         r.text.slice(0, 60));
      ok("  and offers to learn it",
         /what should i call you|ano ang tawag ko|unsa nako nga|unsa imong ngalan/i.test(r.text),
         r.text.slice(0, 80));
    });

    /* --- told, then asked back --- */
    engine.reset();
    engine.reply("ako si jz", { seed: 3, useContext: true });
    [["what is my name", "english"], ["ano ang pangalan ko", "tagalog"],
     ["unsa akong ngalan", "bisaya"]
    ].forEach(function (pair) {
      var r = engine.reply(pair[0], { seed: 3, lang: pair[1], useContext: true });
      ok("  says \"" + r.text + "\" back in " + pair[1], /jz/.test(r.text));
    });

    /* --- the shapes people actually use to say their name --- */
    [["ako si jz", "jz"], ["i am jz", "jz"], ["my name is jz", "jz"],
     ["aking ngalan si jz", "jz"], ["kingalan nako si jz", "jz"],
     ["call me jz", "jz"]
    ].forEach(function (pair) {
      engine.reset();
      var r = engine.reply(pair[0], { seed: 3, useContext: true });
      eq("\"" + pair[0] + "\" is learned as " + pair[1], r.userName, pair[1]);
    });

    /* --- the collision that taught it the name "ngalan" ---

       "akong" is Tagalog for "my" and the "ako si" pattern splits it
       as "ako" + "ng", so "unsa akong ngalan" parsed as "I" + "of" +
       "ngalan" and the bot greeted the user as "Kumusta ngalan". The
       guard is vocabulary, and this is the case that proves it works. */
    engine.reset();
    [["unsa akong ngalan", "a Cebuano question about the name"],
     ["ano pangalan ko", "a Tagalog question about the name"],
     ["what is my name", "an English question about the name"],
     ["i am a developer", "a statement, not a name"],
     ["ako siya", "a pronoun, not a name"]
    ].forEach(function (pair) {
      engine.reset();
      var r = engine.reply(pair[0], { seed: 3, useContext: true });
      eq(pair[1] + " is not learned as a name", r.userName, null);
    });

    /* --- a greeting without a name must not say "there" --- */
    engine.reset();
    var g = engine.reply("kumusta", { seed: 3, useContext: true });
    ok("nameless greeting has no stray comma or placeholder",
       !/there/.test(g.text) && !/\s,/.test(g.text), g.text.split("\n")[0]);

    /* --- the offer, exactly once --- */
    engine.reset();
    var asks = 0;
    /* Matched on the SLOT, not on one phrasing. The wording has three
       variants per language and this only ever caught the first: the
       greeting came back asking "Kung okay lang, unsa imong ngalan?"
       and the test reported that four greetings produced ZERO
       questions, when the real answer was one, correctly. A test that
       pins wording fails every time the wording improves. */
    var ASK = /what should I call you|what is your name|ano ang tawag ko|ano ang pangalan mo|unsa nako nga|unsa imong ngalan|ngalan\?|pangalan mo/i;
    for (var i = 0; i < 4; i++) {
      var out = engine.reply("kumusta", { seed: 10 + i, useContext: true });
      if (ASK.test(out.text)) asks++;
    }
    eq("four greetings produce exactly one name question", asks, 1);

    /* --- and never when the name is already known --- */
    engine.reset();
    var known = engine.reply("kumusta, ako si jz", { seed: 3, useContext: true });
    ok("no question when the name arrives in the same message",
       !/what should I call you/i.test(known.text), known.text.split("\n")[0]);

    engine.reset();
  })();

  /* ============================================================
     6. THE TEST THAT MATTERS: correct entry, or honest refusal
     ============================================================ */
  section(6, "right answer, or honest refusal");

  /* Asserted on `concept`, not `entryId`. Ids are positional: adding a
     line near the top of a .kb source file renumbers everything below
     it, and a test that breaks for that reason gets "fixed" by
     hardcoding the new number. `concept` is the name the author chose
     and survives reordering, which is the only thing worth depending
     on.

     Three expectations were updated when the finance shelves were
     written, and the DIRECTION of the change is the point:

       "what is compound interest"  interest  -> compound interest
       "how do i save money"        budget     -> savings
       "how much emergency fund"    emergency  -> emergency fund

     Each is a MORE specific answer than the entry it displaced, not
     a different one: a dedicated compound-interest entry now wins
     over the general interest entry, and "how do i save money" is
     answered by the entry about saving rather than by the one about
     budgeting. A test that had to be relaxed to pass would be a
     problem; a test that had to be made more precise is the suite
     doing its job. */
  [[ "what is javascript", "javascript"],
   ["how does gravity work", "gravity"],
   ["what is compound interest", "compound interest"],
   ["tell me about quantum physics", "quantum"],
   ["who are you", "identity"],
   ["kumusta ka", "greeting"],
   ["salamat", "gratitude"],
   ["goodbye", "farewell"],
   ["what can you do", "capability"],
   ["what is the pythagorean theorem", "pythagorean"],
   ["how do i fix a javascript bug", "bug"],
   ["when did the philippines get independence", "commonwealth"],
   ["how do i save money", "savings"],
   ["what is photosynthesis", "photosynthesis"],
   ["what is a quadratic equation", "quadratic"],
   ["what is dna", "dna"],
   ["how much emergency fund", "emergency fund"],
   /* Added alongside the new entries. "why is the sky blue" is among
      the most-asked science questions there is, the bank could not
      answer it at all, and it therefore belongs in the list that
      would have caught that. The capitalised one is deliberate: it
      is here to keep a router that stopped matching intents on a
      capital letter from ever coming back. */
   ["why is the sky blue", "light scattering"],
   ["What is a stock", "stock"],
   ["what is a melody", "melody"],
   ["what is a credit score", "credit score"],
   ["what is a rainbow", "rainbow"],
   /* The COVERAGE PROBE. A one-off test of 54 questions a person
      actually asks scored 14 out of 54 - a 26 percent answer rate -
      and the failures were not exotic. "Why is the grass green",
      "how do i cook rice", "what is a mutual fund" and "why is my
      phone slow" were all refusing, and a bank that refuses ordinary
      questions is not usable no matter how good its retrieval is.

      These are pinned here so the number cannot quietly go back down.
      A gap of this kind is invisible from inside the app, because a
      refusal looks exactly like a bot being cautious. */
   ["why is the grass green", "green grass"],
   ["why is the sea salty", "salty sea"],
   ["why do we sweat", "sweating"],
   ["why do we dream", "dreaming"],
   ["why do we yawn", "yawning"],
   ["why do we blink", "blinking"],
   ["how do magnets work", "magnetism"],
   ["why is fire hot", "fire hot"],
   ["why do volcanoes erupt", "volcano"],
   ["why is ice slippery", "ice slippery"],
   ["why do we get hiccups", "hiccups"],
   ["how do we taste food", "taste"],
   ["why do onions make you cry", "onion tears"],
   ["why is the moon round", "moon round"],
   ["why do leaves change colour", "leaf colour change"],
   ["why is zero divided by zero undefined", "divide by zero"],
   ["what is infinity", "infinity"],
   ["what is pi", "pi"],
   ["why do we use base 10", "base ten"],
   ["how do i lose weight", "losing weight"],
   ["how do i sleep better", "sleep better"],
   ["how do i tie a tie", "tying a tie"],
   ["how do i cook rice", "cooking rice"],
   ["how do i make coffee", "making coffee"],
   ["how do i change a tyre", "changing a tyre"],
   ["why do i feel tired after eating", "food coma"],
   ["how do i prepare for an interview", "interview"],
   ["how do i write a cover letter", "cover letter"],
   ["how do i pay my debts", "paying off debt"],
   ["how do banks work", "how banks work"],
   ["what is a mutual fund", "mutual fund"],
   ["why is traffic heavy in manila", "manila traffic"],
   ["why is the jeepney fare rising", "jeepney"],
   ["why is my phone slow", "why is my phone slow"],
   ["how do i back up my data", "backup"],
   ["why do we procrastinate", "why do we procrastinate"],
   ["why do people lie", "lying"],
   ["what does serendipity mean", "serendipity"],
   ["what is the opposite of ephemeral", "ephemeral"],
   ["why did the philippines colonize", "spain and the philippines"],
   ["what is the significance of edsa", "edsa revolution"],
   ["what is martial law", "martial law"],
   ["what is kundiman", "kundiman music"]
  ].forEach(function (c) {
    var r = engine.reply(c[0], { seed: 7, useContext: false });
    ok("answers: " + c[0], r.known && r.concept === c[1],
       (r.known ? r.concept : "refused") + " (want " + c[1] + ")");
  });

  /* The honest-failure half. A system with 1M entries still has gaps,
     and the only acceptable response to a gap is to admit it. */
  section(7, "out of scope is refused, not invented");
  ["who won the 2019 basketball world cup", "asdfghjkl qwerty",
   "what is the meaning of life", "how to bake sourdough bread",
   "what is the price of tesla stock today"
  ].forEach(function (q) {
    var r = engine.reply(q, { seed: 7, useContext: false });
    ok("refuses: " + q.substring(0, 34), r.known === false && r.entryId === null && r.text.length > 30,
       r.known ? "invented -> " + r.entryId : "too short");
  });

  section(8, "conversation and reproducibility");
  return load().then(function (e2) {
    var seen = {}, unique = 0;
    for (var i2 = 0; i2 < 6; i2++) {
      var r = e2.reply("kumusta ka", { seed: i2 + 1 });
      if (!seen[r.text]) { seen[r.text] = 1; unique++; }
    }
    ok("repeated greetings do not repeat verbatim", unique >= 2, unique + " unique of 6");

    e2.reset();
    var first = e2.reply("what is javascript", { seed: 5 });
    ok("first answer is about javascript", /javascript/i.test(first.text));
    eq("a contentless follow-up still answers", e2.reply("tell me more", { seed: 5 }).known, true);

    e2.reset();
    eq("reset makes it reproducible", e2.reply("what is javascript", { seed: 5 }).text, first.text);

    section(9, "the generator refuses by default");
    var gen = new G.Generator();
    ok("the accept threshold is above zero", gen.accept > 0.3, gen.accept);
    eq("no hits means known=false", gen.generate({ results: [], analysis: {}, language: "english" }).known, false);
    ok("every language has a real refusal line", ["english", "tagalog", "bisaya"].every(function (l) {
      return gen.generate({ results: [], analysis: {}, language: l }).text.length > 40;
    }));
    ok("confidence is always a number", typeof engine.reply("hi", { seed: 3, useContext: false }).confidence === "number");

    /* Push anything asynchronous onto `pending` and the summary at the
       end of this file waits for it. Without this the suite prints its
       verdict and exits while a promise is still in flight, and the
       assertions inside it are silently lost - which is exactly what
       happened to the browser load path test: it ran, and nobody saw
       it, and a real bug shipped underneath it.

       A test that does not appear in the count has not been run. */
    return Promise.all(pending).then(function () {
      console.log("\n" + new Array(62, "=").join("="));
      console.log("  bokskie.v1 engine:  " + pass + " passed, " + fail + " failed");
      console.log(new Array(62, "=").join("="));
      process.exit(fail ? 1 : 0);
    });
  });
}).catch(function (err) {
  console.log("ERROR " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
