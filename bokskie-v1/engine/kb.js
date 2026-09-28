/* ============================================================
   bokskie-v1 · engine/kb.js
   ------------------------------------------------------------
   The knowledge base and its index.

   The scaling question: with 100k entries, scanning everything on
   every message is hopeless. So entries are indexed by token:

       "javascript" -> [entry 12, entry 88, entry 431, ...]

   A query only ever scores the entries it actually shares a word
   with. That turns a linear scan of 100k into a lookup over the
   few hundred that could plausibly match, and it is the single
   design decision that makes a large bank affordable.

   Files are plain JSON under data/, loaded by the host: node reads
   the disk, the browser fetches. No bundler either way.

   Entry shape:
     {
       "id":       "prog-javascript",
       "topic":    "programming",
       "intent":   "definition",
       "keywords": ["javascript", "js", "ecmascript"],
       "patterns": ["what is javascript"],
       "answer":   "JavaScript is ... {topic} ...",
       "variations": ["...", "..."],
       "weight":   1
     }
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tokenizer.js"), require("./synonyms.js"));
  } else {
    root.BokskieKB = factory(root.BokskieTokenizer, root.BokskieSynonyms);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (T, SYN) {
  "use strict";

  /* The rescue pass fires below this. It sits just under the accept
     bar so it catches "almost answered" as well as "answered
     nothing", and stays above the genuinely hopeless band so a
     nonsense query does not get rescued into something confident. */
  var EXPAND_FLOOR = 0.30;

  /* What an inferred match has to reach before it is allowed to
     answer. Higher than the 0.34 accept bar, because an expansion is
     a guess about vocabulary rather than a match. */
  var EXPAND_ACCEPT = 0.50;

  /* The five behaviour entries are the answer by definition, so they
     get the same topic exemption in the expansion pass as in the
     normal one. See the BEHAVIOUR table further down. */
  var EXPAND_BEHAVIOUR = {
    greeting: 1, identity: 1, capability: 1, gratitude: 1,
    farewell: 1, memory_reference: 1
  };

  function KB() {
    this.entries = [];
    this.index = Object.create(null);   /* token -> [entryId] */
    this.df = Object.create(null);      /* token -> document frequency */
    this.topics = Object.create(null);  /* topic -> [entryId] */
    this.byIntent = Object.create(null);
    this.byId = Object.create(null);     /* id -> entry, built by build() */
    /* token -> the index key it was probably meant to be. Filled by
       candidates(), which is already walking the index looking for
       exactly this, and read by queryVector, which needs the answer
       before it can score. Cached because the scan is the expensive
       part and the same typo comes back. */
    this.nearKeys = Object.create(null);
    this.loaded = false;
  }

  /* A TYPO IS A REAL QUERY.

     "javascirpt" is not in the index. candidates() already found
     "javascript" one edit away and ranked the right entry first - and
     then scoring threw it away: coverage asked whether the entry holds
     the word the person TYPED, it did not, and so every misspelled
     question refused while the right answer sat at the top of the
     list. Measured on a 500-question exam: 1 of 40 misspellings
     answered. Resolving the token to the key it was one edit from is
     what lets the rescue reach the answer. */
  var TYPO_MIN = 6;        /* below this, one edit is not evidence */
  var TYPO_DISCOUNT = 0.75;

  /* THE FLOOR IS FOR THE QUERY THAT NAMES ITS SUBJECT.

     "ano ang musika" names the entry outright and shares nothing else
     with it - the shelf indexes the English side, so coverage measured
     0.000 - and naming the thing is still the whole subject of the
     question. "explain lamig in simple terms" shares only lamig with
     the entry, and the one word it does NOT cover is "simple" - the
     phrasing of the request, not more subject. The floor exists for
     those cases.

     The test is the COUNT OF MEANINGFUL WORDS THE ENTRY LEAVES
     UNCOVERED, and the count is the point rather than a coverage
     fraction. Zero or one uncovered means the entry accounts for the
     subject and the gap is how the question was asked. Two or more
     means the query is mostly about something else: "how to bake
     sourdough bread" leaves bake and sourdough, "who won the 2019
     basketball world cup" leaves 2019 and basketball, "what is the
     price of tesla stock today" leaves tesla and today - each names
     an entry in one word out of three or four, and on those the floor
     is the confident wrong answer this project exists to prevent, a
     definition handed back for a question the bank cannot answer. */
  var NAMED_MAX_GAP = 1;

  /* Whole-word phrase containment, on the core line. */

  /* THE CORE LINE: the words that carry meaning, in order.

       "ano ang oras na"       -> "oras"
       "ipaliwanag mo ang X"   -> "X"
       "what is a time zone"   -> "time zone"

     Used for pattern and concept matching, and it fixes two opposite
     failures at once. A raw substring test over the sentence could not
     see that "ano ang oras na" IS the pattern "anong oras na" - one
     linker was the whole difference between a match and a refusal -
     while a two-letter pattern like "oo" matched INSIDE "good". Whole
     words, on the meaningful part of the sentence, is the comparison
     that was actually intended.

     FRAME WORDS ARE NOT MEANING, and the frame list already says so:
     they "carry no weight in routing or scoring" and are "never
     counted as the subject of the sentence". The stop test alone let
     them through, because a frame word must stay searchable - the
     router needs "unsa" to know a question arrived in Bisaya - and
     searchable and meaningful are two different questions. The cost of
     the leak was a confident wrong answer: "sino ang nanalo ng 2019
     basketball world" matched the entry about the WORD "kinsa" on the
     word "kinsa", floored itself to 0.9 coverage, and answered a
     trivia question with a grammar definition. The subject of that
     sentence is the basketball. */
  function coreOf(text) {
    var w = T.words(text), out = [];
    for (var i = 0; i < w.length; i++) {
      var c = T.canonical(w[i]);
      if (c.length < 2) continue;
      if (T.isStop(c)) continue;
      if (T.isFrameWord(c)) continue;
      out.push(c);
    }
    return out.length ? " " + out.join(" ") + " " : "";
  }

  function phraseIn(core, phrase) {
    if (!core || !phrase) return false;
    return core.indexOf(phrase) !== -1;
  }


  /* ---- building ---------------------------------------------- */

  KB.prototype.add = function (raw) {
    if (!raw || !raw.answer) return null;

    var entry = {
      id: raw.id || ("e" + this.entries.length),
      topic: raw.topic || "general",
      intent: raw.intent || "definition",
      keywords: raw.keywords || [],
      patterns: raw.patterns || [],
      answer: raw.answer,
      variations: raw.variations || [],
      weight: typeof raw.weight === "number" ? raw.weight : 1,
      lang: raw.lang || "any",
      /* Per-language bodies. Optional, and the bank stays valid without
         it - `answer` is always present and is the fallback. The reason
         this exists: an entry written only in English, answered to a
         Tagalog question, is a small lie about what the system can do.
         When the translation is really there, use it; when it is not,
         fall back and let `answerLang` report the substitution. */
      langs: raw.langs || null,
      /* Provenance. Required to be meaningful, not merely present: a
         health claim with no source is a rumour with a search index.
         `confidence` below 1 makes the generator hedge rather than
         assert, so an uncertain entry degrades to a caveat instead of
         being presented as settled fact. */
      source: raw.source || null,
      confidence: typeof raw.confidence === "number" ? raw.confidence : 1,
      memory: raw.memory || null,
      /* Greeting wording, keyed by language, with a {name} slot. Lives
         in the bank rather than in the generator so all three languages
         are editable as data and the engine holds no English sentences.
         Without this line the templates were silently dropped on load
         and the greeting fell back to the generic entry - which is why
         adding the data alone appeared to do nothing. */
      greet: raw.greet || null,
      /* The two blocks that speak the USER'S name back, in the same
         spirit as `greet` above and for the same reason.

         Their absence here was invisible and total: the fields were
         written into conversation.json, validated as JSON, and then
         dropped on load, so the engine read `undefined` and fell back
         to the hard-coded "I do not know your name yet" every time -
         in every language, including the Tagalog and Bisaya questions
         that were routed correctly and then answered in English. Data
         that is silently discarded at the boundary is worse than data
         that was never written, because the file looks right. */
      nameAsk: raw.nameAsk || null,
      nameRecall: raw.nameRecall || null,
      concept: raw.concept || null
    };

    /* Both sides of the index have to use the same normalisation or
       nothing matches. The query is stemmed by the tokenizer, so the
       entry text has to be stemmed too - otherwise "physic" in the
       question can never find "physics" in the answer, and every
       match depends on the keyword list happening to save us.

       THE ENTRY'S OWN NAME IS PART OF ITS TEXT. It was not, and an
       entry could be unanswerable by the exact words that name it: the
       memory-reference entry indexes "remember" and "previous" and
       never "memory reference", so "explain memory reference in simple
       terms" matched only by accident of a pattern; the identity entry
       indexes "who", "name" and "yourself" and not "identity", so "ano
       ang identity" filled its candidate pool with entries that share
       only the question frame and the entry that ANSWERS it was never
       scored. A bank whose rows cannot be reached by their own name is
       a bank with a hole under every row. */
    var haystack = T.words(entry.answer + " " + entry.keywords.join(" ") +
                           " " + entry.patterns.join(" ") +
                           (entry.concept ? " " + entry.concept : ""));
    var uniq = Object.create(null);
    var i;
    for (i = 0; i < haystack.length; i++) {
      var s = T.stem(haystack[i]);
      if (s && s.length >= 2) uniq[s] = 1;
    }
    for (i = 0; i < entry.keywords.length; i++) {
      var raw_kw = String(entry.keywords[i]).toLowerCase();
      /* A phrase keyword like "ano ang tulog" cannot be matched as a
         token - no query token ever contains a space - so stemming it
         as one string only ever produced a junk index key that nothing
         could ever hit. The phrase is not lost: `haystack` above ran
         it through words(), so its individual words are already
         indexed, and it still matches whole as a `patterns` entry. */
      if (/[\s]/.test(raw_kw)) continue;
      var kw = T.indexToken(raw_kw);
      if (kw) uniq[kw] = 1;
    }

    entry.tokens = Object.keys(uniq);
    entry.set = T.toSet(entry.tokens);
    entry.bigrams = T.bigrams(T.normalize(entry.answer));
    /* The entry's own name and its written patterns, in the same
       whole-word form the query is reduced to. Precomputed because a
       search compares them against up to 60 candidates and rebuilding
       them per query is work that never changes until the bank does. */
    entry.conceptCore = entry.concept ? coreOf(entry.concept) : "";
    entry.patternCores = [];
    for (i = 0; i < entry.patterns.length; i++) {
      var pc = coreOf(entry.patterns[i]);
      /* " " + words + " " - a one-word pattern is length 4 at the
         shortest (" oo "), and a shorter one could only match by
         accident. */
      if (pc && pc.length >= 4) entry.patternCores.push(pc);
    }
    this.entries.push(entry);
    return entry;
  };

  /* Call once after all add(). Builds the inverted index and the
     document frequencies. Cost is O(total tokens), once. */
  KB.prototype.build = function () {
    this.index = Object.create(null);
    this.df = Object.create(null);
    this.topics = Object.create(null);
    this.byIntent = Object.create(null);
    this.byId = Object.create(null);
    /* The near-key cache is a statement about THIS index. A rebuilt or
       grown bank has different keys, and a surviving entry would point
       a query at a key that is no longer there. */
    this.nearKeys = Object.create(null);
    var i, j, t;

    for (i = 0; i < this.entries.length; i++) {
      var e = this.entries[i];
      this.byId[e.id] = e;
      for (j = 0; j < e.tokens.length; j++) {
        t = e.tokens[j];
        (this.index[t] || (this.index[t] = [])).push(e.id);
        this.df[t] = (this.df[t] || 0) + 1;
      }
      (this.topics[e.topic] || (this.topics[e.topic] = [])).push(e.id);
      (this.byIntent[e.intent] || (this.byIntent[e.intent] = [])).push(e.id);
    }
    /* Register every "-" prefix as a family, so `topics` answers the
       question a caller actually has - "does the bank cover
       programming?" - instead of the bookkeeping one, "which exact
       shelf ids exist".

       Without this, engine.topics() listed 50 shelf names and no
       group name at all, so a caller checking for "programming" was
       told the bank had never heard of programming while it held 38
       programming entries. Ids are unaffected: an entry is filed once,
       under its own shelf, and these family rows are extra keys
       pointing at the same entries. */
    var names = Object.keys(this.topics);
    for (i = 0; i < names.length; i++) {
      t = names[i];
      var cut = t.indexOf("-");
      while (cut !== -1) {
        var head = t.slice(0, cut);
        if (!this.topics[head]) this.topics[head] = this.topics[t].slice();
        cut = t.indexOf("-", cut + 1);
      }
    }

    this.loaded = true;
    this.families = null;   /* topic name -> { topic: 1 }, built on demand */
    return this;
  };

  /* The set of topics a routed name covers: the name itself when it is
     a real topic, plus every shelf filed beneath it ("programming" ->
     "programming-javascript", "programming-debugging", ...). Cached,
     because the topic list only changes when the bank does. */
  KB.prototype.topicSet = function (name) {
    if (!name) return null;
    if (!this.families) {
      var f = Object.create(null);
      var self = this;
      Object.keys(this.topics).forEach(function (t) {
        if (!f[t]) f[t] = Object.create(null);
        f[t][t] = 1;
        /* Every "-" separated prefix is also a family, so the
           two-segment group "general-knowledge" covers
           "general-knowledge-history" the same way one segment does. */
        var cut = t.indexOf("-");
        while (cut !== -1) {
          var head = t.slice(0, cut);
          if (!f[head]) f[head] = Object.create(null);
          f[head][t] = 1;
          cut = t.indexOf("-", cut + 1);
        }
      });
      this.families = f;
    }
    return this.families[name] || null;
  };

  /* TF-IDF. Rare words carry more weight, which is what stops "the"
     and "what" from dragging an unrelated entry upward. */
  KB.prototype.vectorOf = function (entry) {
    if (entry.vector) return entry.vector;
    var N = this.entries.length || 1;
    var v = Object.create(null);
    for (var i = 0; i < entry.tokens.length; i++) {
      var t = entry.tokens[i];
      v[t] = Math.log(1 + N / (1 + (this.df[t] || 0)));
    }
    entry.vector = v;
    return v;
  };

  KB.prototype.queryVector = function (tokens) {
    var N = this.entries.length || 1;
    var counts = Object.create(null);
    for (var i = 0; i < tokens.length; i++) counts[tokens[i]] = (counts[tokens[i]] || 0) + 1;
    var v = Object.create(null);
    var t;

    /* A token that matches no entry at all is not evidence for choosing
       BETWEEN entries - it says something about none of them. Left
       uncapped it gets the highest IDF in the vector, because rare means
       rare, and it then dominates coverage. "bro ano ang sleep?" scored
       0.23 against the sleep entry while "ano ang sleep" scored 0.78,
       and the entire difference was one discourse particle the bank has
       no business containing.

       So an unmatched token is capped at the weight of the strongest
       token that did match. It still dilutes the score, which is what
       keeps a genuinely off-topic question honest, but it can no longer
       outvote a real match.

       The cap only applies when something DID match. A question where
       nothing matches is left completely alone, so "asdfghjkl qwerty"
       still refuses - there is no matched weight to cap against, and a
       refusal threshold that a stray word could switch off would not be
       a threshold. Everything else in this engine exists to refuse; a
       retrieval quirk that turns good questions into refusals is the
       same failure reached from the other direction. */
    var matched = 0;
    for (t in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, t)) continue;
      if (this.df[t]) {
        var w = (1 + Math.log(counts[t])) * Math.log(1 + N / (1 + this.df[t]));
        v[t] = w;
        if (w > matched) matched = w;
        continue;
      }
      /* Not a token anything is indexed under - but possibly a
         misspelling of one that is. Querying the near key instead of
         the typed word is what makes the rescue in candidates() reach
         the score at all; the discount says a guessed spelling is
         weaker evidence than a match. Only for words long enough that
         one edit means something: at four or five letters the
         neighbours are mostly different words. */
      if (t.length >= TYPO_MIN && this.nearKeys[t]) {
        var nk = this.nearKeys[t];
        var wn = (1 + Math.log(counts[t])) * Math.log(1 + N / (1 + (this.df[nk] || 1))) * TYPO_DISCOUNT;
        v[nk] = (v[nk] || 0) + wn;
        if (wn > matched) matched = wn;
      }
    }
    for (t in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, t)) continue;
      if (this.df[t]) continue;
      if (t.length >= TYPO_MIN && this.nearKeys[t]) continue;
      var u = (1 + Math.log(counts[t])) * Math.log(1 + N);
      v[t] = (matched && u > matched) ? matched : u;
    }
    return v;
  };

  /* ---- candidate generation ---------------------------------- */

  /* This is the function that makes a big bank affordable. Only
     entries that share a token with the query are ever scored. */
  KB.prototype.candidates = function (tokens, limit) {
    var seen = Object.create(null);
    var counts = Object.create(null);
    var out = [];
    var i, j;

    for (i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      /* A RARE TOKEN IS THE SUBJECT; a common one is the frame that
         survived tokenization. Counting every match as 1 let the frame
         decide the pool: "ano ang identity" filled its 60 slots with
         entries that share only "unsa" and the entry about identity was
         never scored at all, so the answer did not exist as a
         CANDIDATE and no amount of scoring could recover it. Weighting a
         match by 1/(1+df) puts the entry holding the rare word in the
         pool, which is the entry the question is about. */
      var rare = 1 / (1 + (this.df[t] || 1));
      var posting = this.index[t];
      if (posting) {
        for (j = 0; j < posting.length; j++) {
          counts[posting[j]] = (counts[posting[j]] || 0) + rare;
          seen[posting[j]] = 1;
        }
      }
      /* No exact hit: look one edit away, so "javascrip" still lands.
         Only for tokens long enough that one edit means something, and
         discounted, because a fuzzy hit is weaker evidence.

         Whatever the strongest near key turns out to be is also
         RECORDED, not just used here. candidates() runs before
         queryVector() on every search, and it is already walking the
         index for exactly this answer - so the scorer reads it instead
         of walking the same index a second time. Without the record the
         typo could be found here and still score zero, which is what
         "1 of 40 misspellings answered" was. */
      if (!posting && t.length >= 5) {
        var bestKey = null, bestDf = -1;
        for (var key in this.index) {
          if (!Object.prototype.hasOwnProperty.call(this.index, key)) continue;
          if (key === t || key.length < 4) continue;
          if (Math.abs(key.length - t.length) > 2) continue;
          if (!this._near(t, key)) continue;
          var p2 = this.index[key];
          for (j = 0; j < p2.length; j++) {
            counts[p2[j]] = (counts[p2[j]] || 0) + 0.6 * rare;
            seen[p2[j]] = 1;
          }
          /* The most common near key, because among several one-edit
             candidates the everyday word is almost always the one meant
             - "taem" is closer to "team" than to "tael". */
          var d = this.df[key] || 0;
          if (d > bestDf) { bestDf = d; bestKey = key; }
        }
        if (bestKey !== null) this.nearKeys[t] = bestKey;
      }
    }
    /* `seen` has a null prototype, so it has no hasOwnProperty to call
       and every key in it is an own key. */
    for (var id in seen) out.push({ id: id, overlap: counts[id] || 0 });
    out.sort(function (a, b) { return b.overlap - a.overlap; });
    return limit ? out.slice(0, limit) : out;
  };

  /* Did this entry surface only because of a MISSPELLING?

       True when some query token is absent from the index entirely, yet
     is one edit away from a key that posts to this entry. False when
     every matching token was an ordinary exact hit - including the case
     where the token is a common word shared with other entries, which is
     a coincidence rather than evidence.

     The distinction is the whole point. "resosrt" is not in the index
     and "resort" is, one swap away, so the entry could only have come
     from the fuzzy path. "app" is in the index and matched itself, so
     the entry came from an ordinary match that happened to be weak -
     and a weak ordinary match should be refused, not rescued. */
  KB.prototype.reachedByTypo = function (tokens, entryId) {
    if (!tokens || !tokens.length || !entryId) return false;
    var i, j, k;
    for (i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (this.index[t]) continue;          /* an exact hit is not a typo */
      if (t.length < 5) continue;          /* too short for one edit to mean much */
      for (k in this.index) {
        if (!Object.prototype.hasOwnProperty.call(this.index, k)) continue;
        if (k === t || k.length < 4) continue;
        if (Math.abs(k.length - t.length) > 2) continue;
        if (!this._near(t, k)) continue;
        var posting = this.index[k];
        for (j = 0; j < posting.length; j++) {
          if (posting[j] === entryId) return true;
        }
      }
    }
    return false;
  };

  /* One-edit test rather than a full Levenshtein: this runs per
     unknown token, so it has to stay cheap. Adjacent transpositions
     count as ONE edit, which is a Damerau allowance and not a plain
     Levenshtein one.

     That is not a refinement, it is the single most common human typo
     there is. "resosrt" is "resort" with its last two letters swapped
     round, and plain Levenshtein scores that as TWO edits - so the
     fuzzy path rejected it, the token stayed unmatched, and "give me
     code of resosrt" found nothing at all while the template sat in
     the library under the obvious name.

     Swapping two adjacent keys is one slip of the finger, not two
     separate mistakes, and treating it as two is why the tolerance
     felt arbitrary from the outside: some typos matched and some did
     not, with no rule anyone could predict. */
  KB.prototype._near = function (a, b) {
    var la = a.length, lb = b.length, i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      /* a[j+1]/b[i+1] out of range guards the tail. */
      if (i + 1 < la && j + 1 < lb && a[i] === b[j + 1] && a[i + 1] === b[j]) {
        i += 2; j += 2; edits++;
        continue;
      }
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    if (i < la || j < lb) edits++;
    return edits <= 1;
  };

  /* ---- scoring ------------------------------------------------ */

  function cosineOf(a, b) {
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; } }
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) nb += b[k] * b[k];
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }
  function jaccardOf(a, b) {
    var inter = 0, total = 0, k;
    for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { total++; if (b[k]) inter++; } }
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !a[k]) total++;
    return total ? inter / total : 0;
  }
  function diceOf(aArr, bArr) {
    if (!aArr.length || !bArr.length) return 0;
    var m = Object.create(null), i, hits = 0;
    for (i = 0; i < aArr.length; i++) m[aArr[i]] = (m[aArr[i]] || 0) + 1;
    for (i = 0; i < bArr.length; i++) if (m[bArr[i]]) { hits++; m[bArr[i]]--; }
    return (2 * hits) / (aArr.length + bArr.length);
  }

  /* Cosine is the wrong tool for a short question against a long
     answer. It divides by the document norm, so a 2-word query
     matching an 80-word entry perfectly still scores around 0.17 -
     which is why "what is javascript" looked like a near-miss
     against the JavaScript entry.

     Coverage asks the question retrieval actually cares about: what
     fraction of the query does this entry account for? It ignores
     answer length entirely, so a one-word query fully covered by an
     entry scores 1.0, and a 50-word entry that shares nothing scores 0.
  */
  /* Coverage asks the question retrieval actually cares about: what
     fraction of the query does this entry account for? It ignores
     answer length entirely, so a one-word query fully covered by an
     entry scores 1.0, and a 50-word entry that shares nothing scores 0.

     The frame is skipped in the DENOMINATOR only, and that is the whole
     design. "ano ang musika" arrives as two terms: "musika" and
     "unsa". "unsa" is in no entry, so it takes the highest IDF as an
     unmatched term and the right entry - found, ranked first, correct -
     scored 0.308 against a 0.34 bar and was thrown away. The frame says
     a question was asked; it is not part of the thing that has to be
     covered, so it stops counting against the subject.

     It is deliberately NOT removed from the query vector. An earlier
     version of this fix stripped frame words from `qv` outright, which
     also fixed the refusals and broke six memory tests, because it
     changed which entry RANKED first and not merely by how much:
     "ano ang tulog" started answering from an English-only entry, so
     the Tagalog rendering disappeared with it. Coverage is where the
     dilution lives. Ranking is not, and must not be touched. */
  function coverageOf(qVector, eVector) {
    var need = 0, have = 0, frameNeed = 0, frameHave = 0, k;
    for (k in qVector) {
      if (!Object.prototype.hasOwnProperty.call(qVector, k)) continue;
      /* The frame is counted SEPARATELY rather than added in. "ano ang
         musika" arrives as "musika" plus "unsa", and "unsa" is in no
         entry: the right entry was found, ranked first, and scored
         0.308 against a 0.34 bar with the frame taking half of the
         denominator. The frame says a question was asked; it is not
         part of the thing that has to be covered.

         Kept, not discarded: a query made ONLY of frame words - "unsa
         ang kaayo" is a real lookup of the word kaayo - still has to be
         scored against them, so the frame becomes the denominator when
         there is nothing else. */
      if (T.isFrameWord(k)) {
        frameNeed += qVector[k];
        if (eVector[k]) frameHave += qVector[k];
      } else {
        need += qVector[k];
        if (eVector[k]) have += qVector[k];
      }
    }
    if (!need) return frameNeed ? frameHave / frameNeed : 0;
    return have / need;
  }

  /* The full search. Returns ranked hits carrying their own score, so
     the generator can decide whether the top one is good enough to
     answer with - or honest enough to refuse. */
  KB.prototype.search = function (opts) {
    opts = opts || {};
    var tokens = opts.tokens || [];
    if (!this.loaded) this.build();

    var pool = this.candidates(tokens, opts.candidateLimit || 60);

    /* A clear intent is a candidate source, but only when retrieval
       found nothing at all. "who are you" is three stopwords, so the
       token index has no candidates - yet we know it is an identity
       question, and the bank has exactly one entry for that.

       Seeding unconditionally is worse than not seeding at all: a
       generic "what is X" would drag in every definition entry and
       hand a greeting the top spot over a real keyword match. If the
       text itself found candidates, the text wins. */
    if (!pool.length && opts.intent && this.byIntent[opts.intent]) {
      var seed = this.byIntent[opts.intent];
      for (var s2 = 0; s2 < seed.length; s2++) {
        pool.push({ id: seed[s2], overlap: 0, viaIntent: true });
      }
    }

    /* A BEHAVIOUR intent is not ambiguous, and this is the one case
       where seeding unconditionally is right rather than dangerous.

       There is exactly one greeting entry, one identity entry, one
       farewell. "kayo ka" is the identity question and it was
       answered with a definition of the Tagalog word "you": the
       router sent it to filipino-pronouns, the identity entry was
       multiplied by 0.55, and the pronoun scored 0.737 while the
       right answer sat at 0.439 and lost. "sino ka" went to
       cebuano-question-words for the same reason.

       Ordinary intents must not seed like this - a generic "what is
       X" would drag in every definition entry and beat a real
       keyword match. These five carry no content, so there is
       nothing to outrank them with: if the text is a greeting, the
       greeting is the answer. They are marked here and exempted from
       the topic penalty below. */
    var BEHAVIOUR = {
      greeting: 1, identity: 1, capability: 1, gratitude: 1,
      farewell: 1, memory_reference: 1
    };
    var behaviour = (opts.intent && BEHAVIOUR[opts.intent]) ? opts.intent : null;
    if (behaviour && this.byIntent[behaviour]) {
      var bseed = this.byIntent[behaviour];
      for (var bi = 0; bi < bseed.length; bi++) {
        var already = false;
        for (var bj = 0; bj < pool.length; bj++) if (pool[bj].id === bseed[bi]) { already = true; break; }
        if (!already) pool.push({ id: bseed[bi], overlap: 0, viaIntent: true });
      }
    }
    if (!pool.length) return [];

    /* A routed topic is a FAMILY, not a single shelf.

       The router still knows the hand-tuned group names - programming,
       health, science - because those carry carefully chosen weights
       and native-language keys. But the bank files entries under the
       shelf tree, so an entry about fixing a bug has topic
       "programming-debugging", not "programming".

       The old exact test turned that into a silent, total failure. The
       router said "programming", `this.topics["programming"]` did not
       exist, so `restrict` became null, and then NOTHING equalled
       null - every single entry, including the right one, was
       multiplied by 0.55. "how do i fix a javascript bug" found the
       bug entry as the top hit and then refused to answer it, because
       0.291 sat below the accept bar where 0.53 used to.

       So a name that is not itself a topic still counts as a match
       for every shelf beneath it. "programming" covers
       programming-javascript and programming-debugging; "health"
       covers health-symptoms. The router keeps its hand-tuned weights
       and the bank keeps its fine-grained filing, which is the point
       of the tree. */
    var restrict = this.topicSet(opts.topic);
    /* The FULL query, frame words and all. An earlier version of this
       passed T.contentTokens() here and fixed the refusals, and broke
       six memory tests doing it - it changed which entry ranked first
       rather than by how much, so "ano ang tulog" answered from an
       English-only entry and the Tagalog rendering vanished. The frame's
       damage is in the coverage denominator, and coverageOf is where it
       is corrected. Ranking stays exactly as it was. */
    var qv = this.queryVector(tokens);
    var qb = T.bigrams(T.normalize(opts.text || ""));
    var qs = T.toSet(tokens);
    var norm = T.normalize(opts.text || "");
    /* The meaningful words of the query, in order, and whether there
       are any: "what is 2+2" has none, "ano ang oras na" has "oras".
       Used for the two rules below, and both of them need it. */
    var core = coreOf(norm);
    /* The meaningful words as a list, for the gap count in the floor
       rule below: how many of them this entry does NOT account for. */
    var coreWords = core ? core.trim().split(" ") : [];
    var hasSubject = false;
    var i;
    for (i = 0; i < tokens.length; i++) {
      if (!T.isFrameWord(tokens[i])) { hasSubject = true; break; }
    }
    /* Built once in build(). This used to be rebuilt here, from
       scratch, on every single query - 90,000 entry objects allocated
       and assigned per keystroke, for a map that never changes until
       the bank does. The lookup it replaced was a genuine bottleneck
       the moment the bank grew past a few hundred entries. */
    var byId = this.byId;

    var results = [];
    for (i = 0; i < pool.length; i++) {
      var e = byId[pool[i].id];
      if (!e) continue;
      var ev = this.vectorOf(e);

      /* Topic is a preference, not a wall. A routing error should
         degrade the score, not wipe the entry out. The one exception
         is a behaviour entry, which is the answer by definition
         rather than by resemblance. */
      var isBehaviour = behaviour && e.intent === behaviour;
      var topicFactor = (isBehaviour || (restrict && restrict[e.topic])) ? 1 : 0.55;
      /* An intent match is a CATEGORY match. The multiplier is
         deliberately small.

         Raising it was tried and reverted, twice, and the reason is
         worth recording. At 1.35 "ano magandang libro" started working
         and the honesty guarantee broke: "what is the meaning of
         life" then matched an entry about `maayong` on the strength
         of the category alone, and the bot answered a question with
         no answer. At 1.20 the same failure persisted, which proved
         the multiplier was never the cause and that raising it was
         treating a symptom.

         The real cause is that a weak match was being lifted over the
         accept threshold by a term that is supposed to break TIES.
         1.12 is kept because it breaks ties and cannot promote an
         entry that has nothing to say. Fixing the retrieval side
         means giving the right entry more words to match on, not
         making the wrong entry more confident. */
      var intentFactor = (opts.intent && opts.intent === e.intent) ? 1.12 : 1;

      /* NAMING THE THING IS COVERING IT - WHEN ALMOST NOTHING ELSE IS.

         "explain boundary in simple terms" is one content word the bank
         knows plus two it does not, and coverage divided by three put
         the right entry at 0.230 against a 0.34 bar. The person named
         the subject; the rest of the sentence is how they asked. So when
         the entry's own name appears in the query and the entry covers
         almost none of the query's weight, the name IS the subject and
         the rest is phrasing.

         This is what makes the answer survive phrasing at all: "ipaliwanag
         mo ang kaayo", "unsa man ang kaayo", "kaayo meaning" and "pasabta
         ko unsa ang kaayo" all reduce to the same match instead of four
         different dilution scores.

         Bounded by NAMED_MAX_GAP rather than applied to every named
         match: a query that names the entry but leaves two or more of
         its meaningful words uncovered is mostly about something else -
         "how to bake sourdough bread" names bread and leaves bake and
         sourdough - and flooring THAT is how a refusal became a
         definition. See the constant for the count.

         At most one meaningful word may go uncovered: "explain lamig in
         simple terms" leaves only "simple" - the request's phrasing -
         and is floored, while "how to bake sourdough bread" leaves bake
         and sourdough, real subject, and keeps its honest 0.333. */
      var cov = coverageOf(qv, ev);
      var conceptHit = (core && e.conceptCore && phraseIn(core, e.conceptCore)) ? true : false;
      var gap = 0;
      if (conceptHit) {
        /* The concept's OWN words can be absent from the index and
           still covered. The memory-reference entry indexes "remember"
           and "previous" and never the phrase that names it, so a
           query that says "memory reference" leaves those two words
           "uncovered" - and they are the two words that named the
           entry. Naming is exactly what conceptHit already established,
           so they are not part of the gap; only words the entry neither
           holds NOR is named by. */
        var named = e.conceptCore ? e.conceptCore.trim().split(" ") : [];
        for (var gw = 0; gw < coreWords.length; gw++) {
          if (ev[T.stem(coreWords[gw])]) continue;
          if (named.indexOf(coreWords[gw]) !== -1) continue;
          gap++;
        }
        if (gap <= NAMED_MAX_GAP && cov < 0.9) cov = 0.9;
      }

      var score = (cov                     * 0.50
                + cosineOf(qv, ev)          * 0.25
                + jaccardOf(qs, e.set)      * 0.10
                + diceOf(qb, e.bigrams)     * 0.15)
                * topicFactor * intentFactor * e.weight;

      /* A written pattern matched literally, in the full sentence. Used
         as evidence for the intent lift below, so it is computed before
         the score can be lifted. */
      var literal = false;
      for (var pl = 0; pl < e.patterns.length; pl++) {
        if (norm.indexOf(T.normalize(e.patterns[pl])) !== -1) { literal = true; break; }
      }

      /* THE ENTRY'S OWN PATTERN, ON THE CORE LINE.

         A raw substring cannot see that "ano ang oras na" IS the
         entry's own pattern "anong oras na" - the two differ by one
         linker, "ang" - so the whole family of "ano ang X" questions
         lost the evidence that "anong X" had. Measured: "anong oras
         na" answered at 0.393 and "ano ang oras na" refused at 0.303,
         the same question with one word spelled out. On the core line
         the linker is already gone. */
      var patternHit = false;
      for (var p = 0; p < e.patternCores.length; p++) {
        if (core && phraseIn(core, e.patternCores[p])) { patternHit = true; break; }
      }

      /* WHOLE-QUERY IDENTITY, and only for a query with no core at
         all. "what is oo" is three stopped words: no content token, no
         core line, nothing to score against - yet the person typed a
         written pattern of the oo entry verbatim, and that IS the
         evidence. It is the only evidence an empty-core query can
         carry. Anything weaker is how "what is the meaning of life"
         came back with a confident definition of the word "what":
         the pattern "what" is a substring of every English question
         ever asked, so a substring can never be the thing that lifts. */
      var wholeQuery = false;
      if (!core && norm) {
        for (var pw = 0; pw < e.patterns.length; pw++) {
          if (T.normalize(e.patterns[pw]) === norm) { wholeQuery = true; break; }
        }
      }

      /* Seeded by intent with no shared words at all: the score is
         almost zero, which is honest, but the intent itself is real
         evidence. Lift it to a level that can be accepted.

         ONLY WITH SOMETHING TO STAND ON. This lift is what made
         "what is 2+2" answer with the entry whose concept is the word
         "what": the query carries no content token at all, the pool came
         entirely from intent seeding, and 0.55 is above the bar - so a
         confident definition of the word "what" went back to somebody
         asking for arithmetic. An empty query has no evidence in it
         whatever the router guessed. The lift needs one of four things:
         a behaviour intent (where the intent IS the answer, as in "who
         are you"), the entry's own pattern matched on the core line,
         the entry's own name in the query, or the whole query BEING a
         written pattern of the entry ("what is oo"). A raw substring is
         deliberately no longer one of them: "what" is a substring of
         every English question, and on "what is the meaning of life"
         it lifted the definition of the word "what" to 0.715 and
         answered a question about existence. */
      if (pool[i].viaIntent && (behaviour || conceptHit || patternHit || wholeQuery)) score = Math.max(score, 0.55);

      /* THE SAME EVIDENCE TAKEN ONCE, AND IN PROPORTION.

         patternHit and conceptHit are one fact seen two ways: the
         entry's own words appear in the query. Stacking both multiplied
         that fact flatly - "how to bake sourdough bread" named the bread
         entry, covered a third of the question, and 1.30 x 1.35 carried
         0.217 raw to 0.380, over the bar, so a recipe request got a
         definition of bread.

         The concept match speaks alone when it fires, and its strength
         is the coverage the score already used: at cov 1.0 naming the
         subject IS the whole query (1.75, the strength the flat stack
         used to give every match), at cov 0.333 the name is one word of
         three (1.25). "ano ang tulog" covers sleep completely and keeps
         its full-strength answer; "how to bake sourdough bread" covers
         a third and lands at 0.271, under the bar, honestly refused.

         The pattern boost applies when the concept match did not; the
         literal fallback is for a pattern appearing in the sentence on
         the raw line - "what is javascript" over "tell me about the
         language browsers run" - which the core line can miss when the
         pattern's own words are stopped. */
      if (patternHit && !conceptHit) score *= 1.30;
      if (conceptHit) score *= 1 + 0.75 * cov;
      else if (literal) score *= 1.30;

      results.push({ entry: e, id: e.id, topic: e.topic, score: score });
    }
    results.sort(function (a, b) { return b.score - a.score; });

    /* SECOND PASS: the lay-term bridge, and only as a rescue.

       Nothing above the floor means the person used words the bank
       does not index. "may sakit ako at gusto kong magpatingin" has
       no "symptom" and no "doctor" in it, so the first pass found
       nothing and the bot refused a question it could answer.

       The retry runs the whole search again with the lay terms
       expanded into index vocabulary, and its result is used ONLY if
       it beats what we already had. That ordering is the safety
       property: this can turn a refusal into an answer and can never
       displace an answer that already worked, so no existing
       behaviour moves. The flag stops it recursing. */
    var best = results.length ? results[0].score : 0;
    if (!opts._expanded && best < EXPAND_FLOOR) {
      var groups = SYN.expandEach(tokens);
      if (groups.length) {
        var retry = this.expandSearch(groups, opts);
        if (retry.length && retry[0].score > best) return retry;
      }
    }
    return results;
  };

  /* Score by how much of the EXPANSION an entry covers.

     Not by handing the expanded list to the normal scorer, which was
     tried and is wrong twice over. Coverage is divided by query
     length, so a 17-token expanded query against an entry holding
     three of those terms scores 0.13 - the right entry, ranked first,
     and refused anyway. Scoring the expansion alone is worse: "nagcuti"
     reaches git, because commit and conflict share a stem.

     What the number should mean is "this entry talks about the things
     the person was reaching for", and that is a set ratio, not a
     length-normalised overlap. The symptom entry covers symptom, pain
     and illness out of the six words "sakit" expands to, which is
     0.5 - comfortably past the bar, and it is a real claim rather
     than a coincidence of phrasing.

     Deliberately simple and deliberately countable: a number a person
     can check by looking at the table row that produced it. */
  KB.prototype.expandSearch = function (groups, opts) {
    var restrict = this.topicSet(opts.topic);
    var behaviour = opts.intent && EXPAND_BEHAVIOUR[opts.intent] ? opts.intent : null;
    var best = Object.create(null);   /* entryId -> { score, covered, need, e } */

    for (var g = 0; g < groups.length; g++) {
      var terms = groups[g].terms;
      var want = Object.create(null);
      for (var t = 0; t < terms.length; t++) want[terms[t]] = 1;

      for (var term in want) {
        if (!Object.prototype.hasOwnProperty.call(want, term)) continue;
        var ids = this.index[term];
        if (!ids) continue;
        for (var k = 0; k < ids.length; k++) {
          var e = this.byId[ids[k]];
          if (!e) continue;
          var covered = 0;
          for (var j = 0; j < e.tokens.length; j++) if (want[e.tokens[j]]) covered++;
          if (!covered) continue;
          var isBehaviour = behaviour && e.intent === behaviour;
          var topicFactor = (isBehaviour || (restrict && restrict[e.topic])) ? 1 : 0.55;
          var intentFactor = (opts.intent && opts.intent === e.intent) ? 1.12 : 1;
          var score = (covered / terms.length) * topicFactor * intentFactor * e.weight;
          var prev = best[ids[k]];
          /* Keep this entry's best-scoring group. An entry reached by
             two different words is not twice as right, it is just
             right, and summing would let breadth beat relevance. */
          if (!prev || score > prev.score) {
            best[ids[k]] = { score: score, e: e };
          }
        }
      }
    }

    var out = [];
    for (var id in best) {
      if (!Object.prototype.hasOwnProperty.call(best, id)) continue;
      var b = best[id];
      if (b.score < EXPAND_ACCEPT) continue;
      out.push({ entry: b.e, id: id, topic: b.e.topic, score: b.score });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  };

  /* An unbuilt KB has no index yet, so anything that reads it has to
     make sure it exists. Cheap and idempotent. */
  KB.prototype.ensure = function () {
    if (!this.loaded) this.build();
    return this;
  };

  /* The entry that defines a behaviour rather than a fact.

     Memory-reference wording lives in the bank, not in the engine, so
     the three languages can be edited as data instead of being
     hardcoded in two places that then drift. `byIntent` returns ids in
     insertion order, so the first one wins deterministically - but a
     second entry claiming the same intent is a data bug, and
     verify-memory.js asserts there is exactly one. */
  KB.prototype.defines = function (intent) {
    this.ensure();
    var ids = this.byIntent[intent];
    if (!ids || !ids.length) return null;
    return this.byId[ids[0]] || null;
  };

  KB.prototype.stats = function () {
    this.ensure();
    return {
      entries: this.entries.length,
      tokens: Object.keys(this.index).length,
      topics: Object.keys(this.topics).length
    };
  };

  return { KB: KB };
});
