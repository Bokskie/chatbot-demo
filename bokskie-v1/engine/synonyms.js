/* ============================================================
   bokskie-v1 · engine/synonyms.js
   ------------------------------------------------------------
   THE LAY-TERM BRIDGE. Retrieval today is exact-token: a query has
   to contain a word the entry is indexed under, or it does not
   match. So "may sakit ako at gusto kong magpatingin" - a person
   saying they are unwell and want to see someone - finds nothing,
   because neither "sakit" nor "magpatingin" is a keyword on a
   health entry. The person and the entry describe the same thing in
   different words, and a bag of tokens cannot see that.

   This is the smallest honest version of semantic search that needs
   no neural model. A lay word maps to the index terms of the shelves
   that would answer it. It is a table, and a table is inspectable,
   which matters more here than generality: every row can be argued
   with, and a wrong row is visible.

   WHAT IT IS NOT
   --------------
   It is not embeddings and it will never be as good. Pairs that are
   synonyms in any dictionary are still missed, and no table fixes
   that. What it buys is the common case - describing a thing in the
   words a person actually uses - which is the case refusing
   wholesale.

   SECOND PASS ONLY
   ----------------
   kb.search runs normally first and this only fires when that pass
   produced nothing above the floor, so it can rescue a refusal and
   can never change an answer that already worked. That is why
   adding rows here is safe: the worst a bad row can do is turn a
   refusal into a mediocre answer, and eval-coverage.js shows it.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BokskieSynonyms = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Key: a word a person types, stemmed. Value: index terms of the
     shelves that would answer it. */
  var MAP = {
    /* ---- feeling unwell ---- */
    sakit: ["symptom", "pain", "fever", "illness", "ache", "disease"],
    magpatingin: ["doctor", "hospital", "patient", "medicine"],
    lamok: ["teeth", "tooth", "cavity", "dental"],
    singkama: ["teeth", "tooth", "cavity"],
    ngipon: ["gum", "teeth", "tooth"],
    hilab: ["pain", "ache", "stomach"],
    pasok: ["cold", "cough", "flu", "fever"],
    bughat: ["nausea", "vomit", "sick"],
    puro: ["weak", "weakness", "symptom"],
    nahihirapan: ["breath", "breathless", "shortness"],
    pagod: ["fatigue", "tired", "exhaustion"],
    napagal: ["tired", "fatigue", "sleep"],
    /* ---- hurt ---- */
    hurts: ["pain", "ache", "injury"],
    hurt: ["pain", "ache", "injury"],
    sore: ["pain", "ache", "injury"],
    injured: ["injury", "wound", "fracture", "sprain"],
    bandaid: ["first", "aid", "wound", "bandage"],

    /* ---- friends and people, which the bank calls relationships -- */
    friend: ["conflict", "trust", "boundary", "attachment"],
    barkada: ["conflict", "trust", "boundary"],
    kaibigan: ["conflict", "trust", "boundary"],
    ignoring: ["conflict", "boundary", "red flag"],
    ignore: ["conflict", "boundary"],
    nagcuti: ["conflict", "trust", "attachment"],
    away: ["conflict", "trust"],
    betrayed: ["trust", "red flag", "attachment"],
    breakup: ["conflict", "attachment", "trust"],
    nagre: ["reply", "conflict", "ignore", "trust"],

    /* ---- money ---- */
    pera: ["budget", "invest", "interest", "income"],
    sahod: ["salary", "income", "budget"],
    mura: ["cost", "price", "budget", "cheap"],
    savings: ["budget", "interest", "invest"],
    debt: ["interest", "budget", "income"],
    utang: ["debt", "interest", "budget"],
    tubos: ["income", "budget", "profit"],

    /* ---- study ---- */
    pag: ["study", "revision", "recall", "note"],
    aralin: ["study", "revision", "recall"],
    exam: ["past", "paper", "mock", "syllabus", "mark", "scheme"],
    test: ["exam", "past", "paper", "mock"],
    klase: ["classroom", "teacher", "student", "teaching"],
    homework: ["assignment", "revision", "study"],
    course: ["major", "degree", "nursing", "engineering", "licence"],

    /* ---- work ---- */
    trabaho: ["job", "career", "salary", "colleague"],
    hanap: ["job", "career", "apply"],
    interview: ["job", "career", "promotion"],
    boss: ["colleague", "promotion", "manager"],
    manager: ["management", "colleague", "promotion"],

    /* ---- devices and computing: lay words that are not keywords -- */
    phone: ["smartphone", "computer", "laptop", "device"],
    laptop: ["computer", "portable", "device"],
    charger: ["battery", "device", "smartphone"],
    battery: ["charger", "device", "smartphone"],
    net: ["network", "router", "wifi", "internet"],
    wifi: ["network", "router", "internet"],
    website: ["browser", "internet", "http", "domain"],
    app: ["software", "smartphone", "device"],
    coding: ["code", "function", "variable", "loop"],
    program: ["code", "software", "function", "loop"],
    bug: ["debug", "error", "stack", "trace"],
    error: ["debug", "stack", "syntax", "bug"]
  };

  /* Multi-word keys, tried over adjacent token pairs. This is what
     catches "my tooth hurts", where the useful term is the pair
     rather than either word alone. */
  var PAIRS = {
    "may sakit": ["symptom", "pain", "illness"],
    "sakit ako": ["symptom", "pain", "illness"],
    "nagre reply": ["conflict", "ignore", "trust"],
    "hindi nagre": ["conflict", "ignore", "trust"],
    "nagre-reply": ["conflict", "ignore", "trust"],
    "gusto kong": ["want", "advice", "help"],
    "ano ang": ["what", "meaning"],
    "kailangan ko": ["need", "want"]
  };

  /* Expand a token list. Returns ONLY new terms, never the
     originals, so a caller can retry without double-counting. */
  function expand(tokens) {
    var seen = Object.create(null);
    var i;
    for (i = 0; i < tokens.length; i++) seen[tokens[i]] = 1;
    var out = [];
    for (i = 0; i < tokens.length; i++) {
      if (MAP[tokens[i]]) out = out.concat(MAP[tokens[i]]);
      if (i + 1 < tokens.length) {
        var pair = tokens[i] + " " + tokens[i + 1];
        if (PAIRS[pair]) out = out.concat(PAIRS[pair]);
      }
    }
    var fresh = [];
    for (i = 0; i < out.length; i++) {
      if (seen[out[i]]) continue;
      seen[out[i]] = 1;
      fresh.push(out[i]);
    }
    return fresh;
  }

  /* Per-source-word expansion, which is the form the search needs.

     expand() returns the union, and that union is the wrong thing to
     score against: "may sakit ako at gusto kong magpatingin" expands
     to 13 terms spanning three different ideas - unwell, wanting,
     and seeing a doctor - and no single entry can possibly cover 13,
     so the best real answer scored 0.23 and stayed silent.

     What a person means is "one of my words points at something you
     know". So each word is expanded on its own, scored on its own,
     and the best of them wins. "sakit" alone expands to six words,
     the symptom entry holds three of them, and that is 0.5. */
  function expandEach(tokens) {
    var out = [];
    var i;
    for (i = 0; i < tokens.length; i++) {
      if (MAP[tokens[i]]) out.push({ key: tokens[i], terms: MAP[tokens[i]].slice() });
      if (i + 1 < tokens.length) {
        var pair = tokens[i] + " " + tokens[i + 1];
        if (PAIRS[pair]) out.push({ key: pair, terms: PAIRS[pair].slice() });
      }
    }
    return out;
  }

  return { MAP: MAP, PAIRS: PAIRS, expand: expand, expandEach: expandEach };
});
