/* ============================================================
   bokskie-v1 · engine/tokenizer.js
   ------------------------------------------------------------
   The cheapest possible first pass: turn a messy human message
   into comparable tokens.

   Why not a real stemmer? English stems are cheap to learn, but
   Tagalog and Bisaya lean on prefixes (mag-, na-, naka-) that a
   suffix stripper destroys. "nag-aabot" and "aabot" must collapse
   together, but "nag" and "aabot" must not be the same word. So:
   a tiny conservative normaliser plus a hand list of Filipino
   prefixes we know are safe to drop.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BokskieTokenizer = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Words that carry no retrieval signal. Asking "what is a good horror
     film" and "good horror film" must retrieve the same thing, so the
     filler has to go. Kept deliberately short: an aggressive stop list
     is a silent accuracy bug. */
  var STOP = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, were: 1, am: 1, be: 1, been: 1,
    of: 1, to: 1, in: 1, on: 1, at: 1, for: 1, with: 1, about: 1, from: 1,
    and: 1, or: 1, but: 1, if: 1, so: 1, as: 1, it: 1, its: 1, this: 1,
    that: 1, these: 1, those: 1, i: 1, you: 1, he: 1, she: 1, we: 1, they: 1,
    me: 1, my: 1, your: 1, do: 1, does: 1, did: 1, can: 1, could: 1,
    would: 1, should: 1, will: 1, shall: 1, may: 1, might: 1, have: 1,
    has: 1, had: 1, having: 1, there: 1, here: 1, what: 1, which: 1, who: 1,
    whom: 1, whose: 1, when: 1, where: 1, why: 1, how: 1, all: 1, any: 1,
    some: 1, each: 1, more: 1, most: 1, other: 1, such: 1, no: 1, not: 1,
    nor: 1, only: 1, own: 1, same: 1, too: 1, very: 1, just: 1, get: 1,
    got: 1, tell: 1, please: 1, thanks: 1, thank: 1, know: 1, like: 1,
    good: 1, best: 1, give: 1, want: 1, make: 1, made: 1, say: 1, said: 1,
    /* Tagalog */
    ang: 1, ng: 1, mga: 1, na: 1, ba: 1, po: 1, ito: 1, iyon: 1, doon: 1,
    dito: 1, kay: 1, ko: 1, mo: 1, ka: 1, kami: 1, tayo: 1, sila: 1,
    ikaw: 1, ako: 1, at: 1, o: 1, pero: 1, dahil: 1, kasi: 1, para: 1,
    may: 1, wala: 1, hindi: 1, oo: 1, ano: 1, sino: 1, saan: 1, kailan: 1,
    bakit: 1, paano: 1, mag: 1, nag: 1, naka: 1, ni: 1, si: 1,
    /* GREETING PARTS ARE NOT SUBJECTS.

       "gandang araw" is a hello, and with `gandang` and `araw` both
       content it scored 0.396 against the entry about `ganda` and
       answered a greeting with a vocabulary definition - the word for
       "beautiful" and the word for "day" between them looked like a
       question about beauty. Neither names a subject on its own:
       `ganda` stays searchable (it is its own entry with its own
       patterns), and `araw` is the same class as `day`, stopped
       above - a calendar unit that appears in half of ordinary chat
       and identifies nothing on its own. With both stopped the
       greeting tokenises to nothing and reaches the greeting pack,
       which is where it belonged. */
    araw: 1, gandang: 1,
    /* Discourse particles - address and filler, never content.

       These are the Tagalog and Bisaya equivalents of "well" and "like",
       and they are everywhere in real Filipino chat: "bro ano ang
       sleep?" is a perfectly clear question that must retrieve exactly
       what "ano ang sleep?" retrieves. They were not here, and one of
       them alone dragged a strong match from 0.78 down to 0.23 - an
       unmatched token takes the highest IDF in the vector, so pure
       filler was outweighing the actual subject.

       "man" is deliberately NOT here despite being a common Bisaya
       particle. In Bisaya it also means "all/every" and carries real
       meaning; stopping it would lose that. */
    /* "raw" is not here despite being a common filler particle in some
       speech - it is also an ordinary English word (raw data), and a
       stopword list that quietly ate a real term would be its own bug. */
    bro: 1, pre: 1, bes: 1, besh: 1, boss: 1, dude: 1, sis: 1, ate: 1,
    koya: 1, uy: 1, pala: 1, sige: 1, ay: 1, daw: 1,
    /* Interrogatives. These say what KIND of answer is wanted and
       nothing about the subject, and intent.js already reads them as
       intent signals - "magkano" is the trigger for the `price` intent.
       Leaving them in the retrieval vector meant they were counted
       twice: once as the intent, and again as unmatched subject
       evidence, where they could only dilute. "magkano ang pera"
       scored 0.280 against the money entry and refused, on a question
       whose only real content word is "pera". */
    magkano: 1, pila: 1, ilan: 1,
    /* Request verbs, same argument as the interrogatives above.
       "what framework you suggest to use in frontend" contains exactly
       two content words - framework and frontend - and "suggest" and
       "use" are how the person phrased the request, not what they are
       asking about. Neither appears in any entry, so each one took the
       highest IDF in the vector and split the coverage in half, which
       put a fully answerable question at 0.245 and refused it.

       This is the same failure as "bro" and "magkano" wearing a
       different hat, so it belongs in the same list. The test is not
       "is it a real word" but "does it identify the subject or only
       the shape of the request". */
    suggest: 1, recommend: 1, prefer: 1, choose: 1, pick: 1,
    use: 1, using: 1, used: 1, gonna: 1, wanna: 1, about: 1,
    /* "gamit" is the Tagalog for "use, used for", and it is the same
       class of word in the same position - the shape of the question
       rather than its subject.

       "Ano ang gamit ng python" is the most ordinary Tagalog way to
       ask what something is for, and it refused while "what is python
       used for" answered fine. The tokens show the difference exactly:
       the English version is ["python"], because "used" is already
       stopped, and the Tagalog version was ["unsa","gamit","python"],
       where two of the three appear nowhere in the python entry. An
       unmatched term takes the highest IDF in the vector, so one
       request-shape word was enough to halve a real match.

       Checked before stopping it: "gamit" is not a concept and does not
       appear in any entry in the bundle, so nothing loses the ability
       to be looked up. */
    gamit: 1, gamitin: 1,
    /* REQUEST WORDS, IN EVERY LANGUAGE THE BANK IS ASKED IN.
       "Ipaliwanag mo ang X" is how a Tagalog speaker asks for an
       explanation, and it is the same class as "explain X": the shape
       of the request, never its subject. Two separate ways it hurt:

         1. The word is unmatched, so it took the highest IDF in the
            vector and split the coverage of the real subject.
         2. Worse - the cross-language bridge rewrites it. The bridge
            maps Ipaliwanag onto an English concept from the data, and
            it does not ask whether that concept is on the stop list. So
            "ipaliwanag mo ang naa" tokenised to ["elaborate"] alone: the
            request word came back as a content word, and the actual
            subject vanished. The answer was a study technique.

       That is why the stop test now runs on the RAW word as well as on
       the bridged one, in indexToken below. A word that is filler in
       the language the person typed it in does not become content by
       being translated. */
    explain: 1, explains: 1, explained: 1, explaining: 1, explanation: 1,
    describe: 1, description: 1, define: 1, definition: 1, meaning: 1,
    means: 1, meant: 1, term: 1, terms: 1,
    ipaliwanag: 1, paliwanag: 1, pasabta: 1, pasabot: 1, sabta: 1,
    sabihin: 1, ibig: 1, kahulugan: 1, kahulogan: 1, unsay: 1,
    tulong: 1, tabang: 1, tabangi: 1, tulungan: 1, palihug: 1, pakiusap: 1,
    /* Bisaya request-frame words, and the Tagalog pronoun set.

       "Buhat nako og restaurant website" means "make me a restaurant
       website", and all three of buhat, og and nako describe the shape
       of the request rather than its subject. They were indexing as
       content, and an unmatched term takes the highest IDF in the
       vector - so three of them out of four tokens diluted the only
       two that mattered.

       The visible damage was small and entirely misleading: the
       resort template and the restaurant template scored 0.410 and
       0.397, and the resort won. The same question in English,
       "create a restaurant website", scored 0.756 for the right
       answer because there was nothing to dilute it. A one-word
       difference between "almost right" and "wrong" is exactly the
       margin a stop list exists to remove.

       `og` and `ug` are the Bisaya linker and conjunction. Neither can
       ever be the subject of a lookup, and both appear in most
       sentences that use the language at all. */
    og: 1, ug: 1, buhat: 1, himoon: 1, buhata: 1,
    /* Linkers and demonstratives. "tambal sa hilanat" carried "sa" as a
       content word: a preposition that is in no entry, taking the top
       IDF in the vector and halving the weight of the two words that
       mean something. Same class as "ang", which was already stopped. */
    sa: 1, yan: 1, yun: 1, yung: 1, naman: 1, ho: 1,
    nako: 1, nato: 1, natin: 1, nimo: 1, nila: 1, niya: 1, niini: 1,
    kako: 1, kita: 1, sila: 1, siya: 1, ako: 1, ikaw: 1, kami: 1, tayo: 1,
    /* Conversation framing. "lets talk about programming", "teach me
       python" and "i need to learn sql" all name exactly one subject
       and bury it under verbs that describe the conversation rather
       than the thing. Those verbs appear in no entry, so each took the
       highest IDF in the vector and cut the real subject's share of the
       coverage - the difference between a 0.34 answer and a refusal. */
    talk: 1, chat: 1, discuss: 1, teach: 1, learn: 1, study: 1,
    stuff: 1, things: 1, thing: 1, topic: 1, subject: 1, question: 1,
    questions: 1, anything: 1, something: 1, explain: 1, know: 1,
    /* `let` and `need` are here for the same reason, and `let` is a
       sharper case: it is a JavaScript reserved word, so it looks like
       programming vocabulary while being nothing of the kind to a person
       typing "lets talk about programming". It was in the builder's
       keyword noise list and not in the tokenizer, which is exactly the
       kind of drift that makes a stop list quietly wrong. */
    let: 1, need: 1, needed: 1, needs: 1, want: 1, wanted: 1,
    /* Tagalog and Bisaya function words that FRAME a question rather
       than name a subject.

       The case that forced this: "may alam kaba about programming"
       means "do you know about programming", and its only content word
       is "programming". But "alam" (to know) and "kaba" (an emphatic
       particle) indexed as content, took the highest IDF in the vector
       as unmatched terms, and cut the real subject's share of the
       coverage to a third - so a perfectly answerable question scored
       0.214 and refused.

       DELIBERATELY EXCLUDED, because they are entry concepts in
       data/filipino.json and data/cebuano.json: dili, oo, kaayo, unsa,
       kinsa, ngano, asa, kami, ikaw, salamat, dako, gamay, sayop,
       kayo, tayo, sino, saan, kailan, bakit, hindi, may, wala, noo.
       Stopping those would make "unsa ang kaayo" unanswerable, which
       is a far worse failure than the one this fixes. The test is
       "can this word be the subject of a lookup", and "alam" cannot be
       while "kaayo" can. */
    alam: 1, kaba: 1, tulong: 1, tulungan: 1, sabi: 1, sabihin: 1,
    tanong: 1, tatanungin: 1, gawa: 1, gawain: 1, pwede: 1, dapat: 1,
    kaya: 1, sana: 1, naman: 1, bang: 1, paalala: 1, tanongin: 1,
    /* Bisaya framing words, same test, same exclusions */
    mahimo: 1, unsang: 1, unsaon: 1, usab: 1, bisan: 1, unya: 1,
    kay: 1, tanan: 1, ingon: 1, apan: 1, pero: 1, human: 1, unyaon: 1,

    /* High-frequency abstract nouns. These appear in almost every long
       answer, so they carry no topical information at all, and indexing
       them lets a single shared word carry a whole query.

       The case that forced this: the new `cell` entry contains "a cell
       is the smallest unit of life", so "life" became an index term.
       "what is the meaning of life" then matched it on that one word
       and scored 0.349, over the 0.34 bar, answering a question about
       existence with a definition of a cell. That is the confident
       wrong answer this project exists to prevent, and the threshold
       is not the thing to change - "life" is simply not a word that
       identifies a subject.

       Note this only covers words that can never be the SUBJECT of a
       lookup. Distinctive high-frequency words are deliberately absent,
       and `life` is safe to lose because nobody is looking up "life"
       expecting one definition. */
    life: 1, world: 1, time: 1, year: 1, years: 1, day: 1, days: 1,
    people: 1, person: 1, man: 1, woman: 1, way: 1, ways: 1, part: 1,
    case: 1, cases: 1, fact: 1, number: 1, group: 1, system: 1, form: 1,
    level: 1, point: 1, area: 1, end: 1, need: 1, kind: 1, sort: 1,
    order: 1, type: 1, value: 1, values: 1, work: 1, works: 1,
    /* Bisaya */
    nga: 1, nako: 1, nimo: 1, unya: 1, apan: 1, kon: 1,
    kung: 1, unsa: 1, kinsa: 1, asa: 1, ngano: 1, unsaon: 1, "kanus-a": 1,
    ikaw: 1, gikan: 1, ngadto: 1, diri: 1, didto: 1, naa: 1, wala: 1,
    dili: 1, oo: 1, usa: 1, adlaw: 1, giya: 1, tanan: 1, lang: 1, gyud: 1,
    jud: 1, mao: 1, pa: 1, kaayo: 1, salamat: 1, aron: 1, pudon: 1
  };

  /* Safe Filipino/Bisaya prefixes. Dropping these is what lets
     "nag-laro" and "laro" meet at the same key.

     Every entry is at least 3 characters and must leave a 4-character
     remainder. Two-letter prefixes look tempting ("ka" in kamusta) but
     they shred ordinary words - "kamusta" became "musta", "maayo"
     became "ayo" - and a silently mangled token is an accuracy bug
     that is very hard to notice later. */
  var PREFIX = [
    "naka", "nagi", "maka", "maki", "mama", "mami", "mang",
    "nang", "nag", "nam", "gika", "gina", "gipang",
    "paka", "pang", "pagi", "paa", "kaa"
  ];

  /* Suffixes, tried in order so "ies" wins over a bare "s". */
  var SUFFIX = ["ies", "ing", "ings", "ed", "es", "s", "ly"];

  /* Number of surfaces the lexicon has attached. Exposed so a test can
     assert the lexicon actually loaded, rather than a missing file
     quietly leaving every foreign word unmatched. */
  var lexiconCount = 0;

  /* The lexicon bridge, and the single most valuable line in the
     tokenizer.

     A Bisaya question about sleep says "unsa ang katulog". As far as
     retrieval is concerned "katulog" and "sleep" are unrelated strings
     that share nothing: the question scores near zero against the entry
     holding the answer, and the bank answers "I do not know" about a
     subject it plainly covers. No amount of extra entries fixes that,
     because the problem is not coverage - it is that the two languages
     were never connected.

     So the lexicon supplies the translation table, and every surface
     form collapses onto one canonical concept token before anything
     downstream sees it. "tulog" and "katulog" both become "sleep", the
     inverted index has a single key for the concept, and the topic
     router can read it too - which is what lets a question that never
     contains an English word still get routed to the right shelf.

     Exact match only, and deliberately so. This is a dictionary, not a
     guesser: "tulig" is a typo, not a word, and folding it in would put
     a wrong token into the index. Typos are already recovered one edit
     away, in kb.candidates(), against real tokens. */
  function registerLexicon(map) {
    if (!map) return 0;
    var added = 0;
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      var word = normalize(key);
      /* One word per key: a token is a single word, so a multi-word
         phrase can never be matched here. Phrases still work - they are
         handled as patterns at the entry level. */
      if (!word || /[\s]/.test(word)) continue;
      var target = normalize(String(map[key]));
      if (!target || /[\s]/.test(target)) continue;
      /* Never clobber a hand-curated spelling. The MAP above is
         orthography ("kumustaaa" -> "kamusta") and is load-bearing;
         letting a bulk import overwrite it would trade a known-good
         rule for a data-file one. */
      if (MAP[word]) continue;
      MAP[word] = target;
      added++;
    }
    lexiconCount += added;
    return added;
  }

  function lexiconSize() { return lexiconCount; }

  /* WORDS THAT MUST STAY SEARCHABLE
     ---------------------------------
     The list above is old and was written without checking it against
     the data. Several words in it are entry CONCEPTS in data/filipino.json
     and data/cebuano.json, which means those entries could not be
     reached in their own language at all: "unsa ang kaayo" tokenised to
     nothing, because `unsa` was stopped, `ang` was stopped, and `kaayo`
     was stopped too. The shelf looked populated and answered English.

     Stopping a word is only correct if it can never be the SUBJECT of a
     lookup. `ba`, `naman` and `kaba` cannot. `unsa` and `kaayo`
     are three of the most-asked things in those two shelves, so they
     must not be. Applied as a deletion rather than by editing the
     literal above, so the reason stays attached to the fix. */
  var MUST_STAY_SEARCHABLE = {
    /* Cebuano concepts */
    unsa: 1, kinsa: 1, asa: 1, ngano: 1, kaayo: 1, sayop: 1, dili: 1,
    salamat: 1, kami: 1, dako: 1, gamay: 1,
    /* THE SAME TEST, APPLIED TO THE WORDS THE BANK WENT ON TO USE AS
       SUBJECTS. The note above says stopping is only correct if the
       word can never be the SUBJECT of a lookup, and that rule had
       never been run against the finished bank. It was, and 18 stop
       words are subjects of an entry - so stopping them looked wrong,
       and unstopping them looked like the fix. It was not.

       "what is oo" and "unsa ang naa" need those words searchable, and
       they are: the literal-pattern lift in kb.search accepts any entry
       whose written pattern appears in the sentence, so "unsa ang naa"
       reaches the entry about `naa` without `naa` being a content token.
       What unstopping them cost was everything else: "gandang araw" (a
       greeting) found the entry about `adlaw` and answered it with a
       definition, and "haha ikaw" answered as a pronoun, because `ikaw`
       bridges to `kayo`. A greeting is not a lookup, and the words here
       appear in far more sentences than they name subjects.

       So the list stays as it was, and reachability is provided by the
       written patterns instead. Measured both ways before deciding. */
    /* English words that are on the stop list but are the subject of
       a whole shelf and are typed alone more often than not. "what
       time is it" tokenised to NOTHING at all, because "what", "is",
       "it" and "time" were all stopwords - so no entry could ever be
       reached, however well it was written, and the bank refused
       every time question while looking like it simply had no time
       shelf. The mechanism was already here for exactly this; the
       word was just never added to it. */
    time: 1, news: 1, weather: 1, course: 1, artist: 1,
    /* THE SENTENCES PEOPLE ACTUALLY SEND, not the words they look up.

       Same failure as "time" above, in two languages. "sige" (go
       ahead), "gikan ako" (I am on my way), "kay nga" (as I was
       saying) and "okay gyud ako" (I am genuinely fine) are among the
       most common lines in Tagalog and Cebuano conversation, and all
       four tokenised to NOTHING because each is on the stop list as
       filler. "sige" is there as a discourse particle, "kay" and "nga"
       as linkers, "gikan" as an apparently generic preposition, and
       "gyud" as an intensifier.

       So the conversational shelves were written, populated, and
       unreachable in the exact language they exist for: "sige" and
       "gikan ako" both refused. An entry can be perfectly written and
       still be unanswerable if its own name is filtered out before
       retrieval runs, and nothing downstream reports that - the shelf
       just looks full.

       "nga" is deliberately NOT here even though "kay nga" is an entry.
       It is a linker that appears in far too many ordinary sentences to
       be evidence of anything, and "kay" is enough to reach the entry.
       A particle that fires on half the corpus is noise, not signal. */
    sige: 1, gikan: 1, kay: 1, gyud: 1,
    /* "gamit" is the same class of word one language further down.

       "Ano ang gamit ng python" is the most ordinary Tagalog way to ask
       what something is for, and it refused - while "what is python
       used for", the identical question in English, answered fine. The
       cause is visible in the tokens: the English version tokenises to
       ["python"] because "used" is already stopped, and the Tagalog
       version tokenises to ["unsa","gamit","python"], where neither
       "unsa" nor "gamit" appears in the python entry. Two unmatched
       terms against one match is the dilution the stop list exists to
       prevent, and "gamit" - use, used for - is exactly the request
       shape that "use" is already stopped for.

       Confirmed before stopping it: "gamit" is not a concept and does
       not appear in any entry in the bundle, so nothing loses the
       ability to be looked up. */
    /* Tagalog surface forms get spelled a dozen ways
    /* Tagalog concepts */
    mahal: 1, mura: 1, kulang: 1, sobra: 1, kayo: 1, tayo: 1, sino: 1,
    saan: 1, kailan: 1, bakit: 1, hindi: 1, wala: 1, maganda: 1,
    masama: 1, malaki: 1, maliit: 1, natin: 1, ano: 1, kumusta: 1,
    musta: 1
  };
  Object.keys(MUST_STAY_SEARCHABLE).forEach(function (w) { delete STOP[w]; });

  /* Filipino surface forms get spelled a dozen ways ("ng kumusta",
     "na kumusta", "kumustaaa"). This map collapses the common ones so
     retrieval is not defeated by orthography. */
  var MAP = {
    kumusta: "kamusta", kamusta: "kamusta", musta: "kamusta",
    kumustaa: "kamusta", "kumust\u00e1": "kamusta",
    anong: "ano", sinong: "sino",
    magandang: "maganda", ganda: "ganda",
    kumikain: "kain", kain: "kain", kumuha: "kuha", kuha: "kuha",
    gumawa: "gawa", gawa: "gawa", nagawa: "gawa",
    naglaro: "laro", naglalaro: "laro", naghinayag: "hinayag",
    katongod: "katongod", adlawa: "adlaw",
    sayon: "sayon", sayra: "sayra", maayo: "maayo", sayoke: "sayoke",
    unsaon: "unsa", unsa: "unsa", kinsa: "kinsa", asa: "asa", ngano: "ngano"
  };

  /* ---- normalisation ---------------------------------------- */

  /* Diacritics matter in Tagalog/Bisaya (a-acute, n-tilde, e-acute),
     so we do not strip them. We only unify the curly quotes people
     paste in and squash whitespace. */
  function normalize(text) {
    return String(text == null ? "" : text)
      .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* Split on anything that is not a letter, digit or apostrophe, so
     "don't" survives as one token. */
  function words(text) {
    var n = normalize(text);
    var out = n.split(/[^a-z0-9'\u00C0-\u024F]+/);
    var res = [];
    for (var i = 0; i < out.length; i++) {
      var w = out[i].replace(/^'+|'+$/g, "");
      if (w) res.push(w);
    }
    return res;
  }

  function canonical(w) { return MAP[w] || w; }

  /* WORDS THAT SAY "I AM ASKING" AND NAME NOTHING.

     Lives here, in the tokenizer, rather than in the router, because two
     different stages need the same answer and duplicating the list is
     how the two drift apart.

     "ano", "unsa", "bakit", "ngano" and the rest are the frame a
     question arrives in, not its subject. Measured cost of treating
     them as subjects, on a 144-message probe: 38 of 41 content words a
     Tagalog speaker uses matched no entry at all, and of what did
     match, 30 questions refused that the bank could answer.

     Two distinct failures, both fixed by the same list:

       1. They are KEYS on the question-word shelves, so "ano ang oras"
          routed to cebuano-question-words - the shelf about the word
          "unsa" - and the shelf about TIME was never consulted.
       2. They are in no entry, so they take the highest IDF as an
          unmatched term and halve the subject's share of the score.
          "ano ang musika" found the right entry, ranked it first, and
          scored it 0.308 against a 0.34 bar. Lowering the bar is the
          wrong fix and verify-scale.js pins it on purpose; the frame
          word should not be in the denominator at all.

     They are deliberately NOT stop words. "unsa ang kaayo" is a real
     question about a real word, and a bank of Cebuano vocabulary that
     cannot be asked about in Cebuano is not a bank. They stay
     searchable and simply carry no weight in routing or scoring. */
  var FRAME_WORDS = {
    ano: 1, anong: 1, unsa: 1, unsang: 1, unsaon: 1, ngano: 1,
    bakit: 1, "kanus-a": 1, kansa: 1, kinsa: 1, sino: 1, paano: 1, pano: 1,
    saan: 1, kailan: 1, magkano: 1, ilan: 1, ba: 1,
    /* The same words in the spelling people actually type, and the
       ones the router reads as the shape of a question: "giunsa" and
       "diin" (how, where), "pila" (how many/how much), "hain" (where),
       "ngadto" (there). Kept searchable - "unsa ang pila" is a real
       lookup - but never counted as the subject of the sentence. */
    unsay: 1, giunsa: 1, diin: 1, hain: 1, pila: 1, ngadto: 1, tagpila: 1,
    what: 1, why: 1, how: 1, who: 1, where: 1, when: 1, which: 1
  };

  /* Why, too - the English member of the same set. "Why is the grass
     green" was measured refusing, and "why" was the term eating the
     score the same way "unsa" does. */
  function isFrameWord(w) { return FRAME_WORDS[w] === 1; }

  /* The tokens a query should be SCORED on: the same list minus the
     frame. Used by the bank when it builds a query vector, which is
     where the dilution happens. Candidate generation keeps the full
     list on purpose - an entry that shares only the frame word is a
     poor answer but a reasonable thing to look at. */
  function contentTokens(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      if (!isFrameWord(tokens[i])) out.push(tokens[i]);
    }
    /* A query made ONLY of frame words - "why?", "ano?" - is left as it
       is. Emptying the vector would score every entry at zero and turn
       a real question into a silent refusal, which is the opposite of
       what this is for. */
    return out.length ? out : tokens;
  }

  /* ---- stemming --------------------------------------------- */

  function stem(w) {
    if (w.length <= 3) return w;
    var i;

    for (i = 0; i < PREFIX.length; i++) {
      var p = PREFIX[i];
      if (w.length - p.length >= 4 && w.indexOf(p) === 0) { w = w.slice(p.length); break; }
    }
    /* "mag-aabot" -> "aabot": drop a hyphen the prefix left behind. */
    if (w.charAt(0) === "-") w = w.slice(1);
    if (w.length <= 2) return w;

    for (i = 0; i < SUFFIX.length; i++) {
      var s = SUFFIX[i];
      if (w.length - s.length >= 3 && w.slice(-s.length) === s) {
        w = s === "ies" ? w.slice(0, -3) + "y" : w.slice(0, -s.length);
        break;
      }
    }
    if (w.charAt(0) === "-") w = w.slice(1);
    return w;
  }

  /* ---- the one normalisation, shared by both sides ---------- */

  /* THE INDEX KEY FOR ONE WRITTEN WORD.

     Both sides of the index must call this and nothing else. The query
     side used to canonicalise, stop-check and stem in one order and the
     entry side in another, and the two disagreements were invisible
     until they cost an answer:

       - the entry side never checked the stop list at all, so "the" and
         "ang" were index keys in 890 entries, waiting to be matched;
       - the query side checked the stop list BEFORE the bridge, so a
         bridged word could come back as content: "ipaliwanag" is filler,
         the bridge turned it into "elaborate", and the stop test - which
         had already run on the raw word - never saw it;
       - and the reverse: "naa" is a stop word, but it is also the SUBJECT
         of two entries, so "unsa ang naa" tokenised to nothing while the
         entry it was asking about sat in the bank.

     So the rules are, in order:
       1. filler in the language it was TYPED in stays filler;
       2. the bridge may rename a word but must never be able to delete
          one - if the bridged form is filler and the typed word was not,
          the typed word is the token;
       3. stem, and re-check on the stem, because "lets" reached the
          index as "let" past a list that only held "let". */
  function indexToken(raw) {
    var w = normalize(String(raw == null ? "" : raw));
    if (!w || /\s/.test(w)) return "";
    if (STOP[w]) return "";
    var c = canonical(w);
    /* RULE 2, and it is the one that needed the most care. The bridge is
       a translation table built from the data, and some of its rows land
       on a filler word: "gawa" (to do, to make) bridges to "make", which
       is stopped. Deleting the token there loses a real content word, so
       the typed word is kept instead. The bridge may rename a word; it
       may not erase one. */
    if (STOP[c]) {
      var wS = stem(w);
      if (wS.length < 2 || STOP[wS]) return "";
      return wS;
    }
    var st = stem(c);
    if (st.length < 2) return "";
    if (STOP[st]) return "";
    return st;
  }

  /* ---- entry points ----------------------------------------- */

  function toSet(arr) {
    var s = Object.create(null);
    for (var i = 0; i < arr.length; i++) s[arr[i]] = 1;
    return s;
  }

  /* THE QUESTION FRAME PROBLEM - MEASURED, NOT FIXED. KEEP THIS NOTE.

     "Ano ang X" is the most common way to ask a question in Tagalog,
     and it retrieves worse than its English equivalent:

       "what is python"      -> tokens ["python"]          -> python
       "ano ang python"      -> tokens ["unsa","python"]
                             -> "list comprehension"
       "ano ang basketball"  -> tokens ["unsa","basketball"] -> refused

     The cause is one word. "ano" is normalised to "unsa" and "unsa"
     must stay searchable, because "unsa ang kaayo" is a real lookup
     and stopping it made that shelf unanswerable in its own language.
     So in every Tagalog question "unsa" indexes as content, appears
     in no entry, takes the highest IDF, and eats half the subject's
     score. This is the same class as "may", noted earlier and still
     open.

     The obvious fix is a frame rule: "ano ang" introduces a question
     ("what IS x") while a bare "ano" is the subject, and the linker is
     what tells them apart. Implemented, and it works on its own terms -
     "ano ang python" went to the right entry, "ano ang basketball"
     stopped refusing, and "unsa ang kaayo" still reached kaayo, so
     nothing is lost in either direction.

     It was reverted, because dropping the word also drops a ROUTING
     signal and the router is a different consumer from the scorer:
     "unsa" is what sends the question to the Cebuano shelves at all.
     Six tests went red - two vocabulary questions lost their answer
     language, and four memory tests changed which subject a recall
     reported, because "ano ang sleep" moved off the shelf holding the
     real `sleep` entry and landed on a neighbouring one. Three
     questions fixed against six broken, one of them a silent change to
     what the bot claims it remembered last.

     So the tokens stay as they are. The real fix is not a smarter
     token: it is a `tulog`/`katulog` entry per language, and a router
     that can tell a question frame from a subject without destroying
     the signal both of them carry. That is a routing change, not a
     tokenizer one, and it should be done on its own evidence. */

  /* The pipeline. Returns raw words (for display), every word (for
     substring checks) and the stemmed content tokens (for scoring). */
  function tokenize(text) {
    var raw = words(text);
    var all = [];
    var content = [];
    for (var i = 0; i < raw.length; i++) {
      var c = canonical(raw[i]);
      all.push(c);
      if (c.length < 2) continue;
      /* One function, so the two sides of the index cannot disagree -
         see indexToken. The raw word goes in, not the canonical one, so
         the stop test sees what the person actually typed. */
      var st = indexToken(raw[i]);
      if (!st) continue;
      content.push(st);
    }
    return { raw: raw, all: all, tokens: content, set: toSet(content) };
  }

  function isStop(w) { return !!STOP[canonical(w)]; }

  /* Character bigrams - what makes typos survivable, because
     "progaming" and "programming" share most of theirs. */
  function bigrams(str) {
    var s = " " + str + " ", out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    return out;
  }

  return {
    normalize: normalize,
    words: words,
    stem: stem,
    canonical: canonical,
    indexToken: indexToken,
    isFrameWord: isFrameWord,
    contentTokens: contentTokens,
    tokenize: tokenize,
    isStop: isStop,
    bigrams: bigrams,
    toSet: toSet,
    registerLexicon: registerLexicon,
    lexiconSize: lexiconSize,
    STOP: STOP
  };
});
