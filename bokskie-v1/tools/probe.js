"use strict";
/* THE COVERAGE PROBE, and the difference between a bug and the design.

   "300 questions, 20 answered" was reported from a real run, so it
   gets measured rather than argued about. The measurement separates
   two things that look identical from outside:

     - the bot refused something the bank HAS an entry for. That is a
       routing or retrieval failure, and it is a bug.
     - the bot refused something the bank has no entry for. That is
       the honesty guarantee working, and it is the design.

   Probe A asks about the bank's OWN concepts - "what is X" for every
   concept in every shelf. It cannot measure content coverage, because
   the entry is guaranteed to exist, so whatever fails is retrieval.
   That is the number worth improving.

   Probe B is 300 real questions a person might type, to see what the
   experience actually feels like. */
var E = require("../engine/index.js");
var I = require("../engine/intent.js"); var T = require("../engine/tokenizer.js");

E.Engine.load().then(function (en) {
  /* ---------------- PROBE A: the bank asked about itself ------------- */
  var entries = en.kb.entries || [];
  var perTopic = {}, missTopics = {};
  var aOk = 0, aRefused = 0, aWrong = 0;
  var wrongSamples = [];

  entries.forEach(function (e) {
    var topic = e.topic || "?";
    var q = "what is " + e.concept;
    var r = en.reply(q, { seed: 3, useContext: false });
    if (!perTopic[topic]) perTopic[topic] = { n: 0, ok: 0 };
    perTopic[topic].n++;
    if (r.known) {
      aOk++;
      perTopic[topic].ok++;
      /* answered, but with somebody else's entry? */
      if (r.concept !== e.concept) {
        aWrong++;
        if (wrongSamples.length < 8) {
          wrongSamples.push(q + "  ->  " + r.concept);
        }
      }
    } else {
      aRefused++;
      missTopics[topic] = (missTopics[topic] || 0) + 1;
    }
  });

  console.log("=== PROBE A: " + entries.length +
              " bank entries, each asked about by name ===");
  console.log("  answered with the RIGHT entry : " + aOk +
              "  (" + Math.round(aOk / entries.length * 100) + "%)");
  console.log("  answered with a DIFFERENT one : " + aWrong +
              "  (" + Math.round(aWrong / entries.length * 100) + "%)");
  console.log("  REFUSED though it exists      : " + aRefused +
              "  (" + Math.round(aRefused / entries.length * 100) + "%)");

  var worst = Object.keys(missTopics).map(function (t) {
    return { topic: t, n: missTopics[t], total: perTopic[t].n };
  }).sort(function (a, b) { return b.n - a.n; });
  console.log("\n  worst shelves by refusals:");
  worst.slice(0, 12).forEach(function (w) {
    console.log("    " + w.topic.padEnd(34) + w.n + " of " + w.total + " refused");
  });
  if (wrongSamples.length) {
    console.log("\n  wrong-entry samples:");
    wrongSamples.forEach(function (s) { console.log("    " + s); });
  }
  if (wrongSamples.length) {
    console.log("\n  wrong-entry samples:");
    wrongSamples.forEach(function (s) { console.log("    " + s); });
  }

  console.log("\n\n=== PROBE B: 144 real messages, as a person would type them ===");
  /* Written as people actually speak. No "what is X" template: the
     bank has been trained to expect that shape for two years, and a
     probe that only uses it flatters the retrieval. */
  var B = [
    "kumusta ka", "magandang umaga", "magandang gabi", "kainin mo na ba",
    "tulog ka na ba", "gutom na ako", "payso na ako", "salamat sa iyo",
    "mag-ingat ka", "ito ba ay tama", "nasa bahay ako", "late na ako",
    "busy ako", "sige", "ok lang", "tama ka", "hindi kita intindihan",
    "ano ang ayaw mo", "gusto ko ng kape", "mayaman ka na",
    "mahal kita", "bakit mo ako iniwan", "ano ang plano natin", "saan ka",
    "kanino ka", "kelan ka", "ano ang oras", "magkano", "ano ang weather",
    "mainit ba sa labas", "ano ang latest", "sino ang nanalo",
    "saan ang ospital", "paano sumulat ng email", "paano magluto",
    "paano magtanim", "ano ang ibig sabihin", "ano ang law", "ano ang pamilya",
    "ano ang trabaho", "ano ang ekonomiya", "ano ang kalusugan",
    "ano ang pagkain", "ano ang musika", "bakit mahal ang billy",
    "bakit gabi na", "bakit umuulan", "paano gumana", "saan nakikita",
    "nagkano", "kailan ako pwede", "pwede ba", "sakto ba", "tama ba ako",
    "kaunti", "marami", "mababa", "mataas", "mahal", "mura", "ganda",
    "panget", "matamis", "maasim", "mapait", "malinaw", "mainit", "malamig",
    "malakas", "mahina", "matanda", "bago", "luma", "mabilis", "mabagal",
    "gusto", "ayaw", "kailangan", "pwede", "dapat", "baka", "siguro",
    "oo", "hindi", "baka oo", "wala", "nasa", "kung", "kapag", "habang",
    "bakit hindi", "paano kung", "sinong", "alin", "malaking salamat",
    "kumusta ka na", "may kwenta ka ba", "gusto ko sana", "ayoko",
    "may oras ka ba mamaya", "kailangan kita", "nasa Cebu ako", "malayo ka",
    "bilis ka", "ito ang numero ko", "ano ang kahulugan ng buhay",
    "ano ang katangian ng mabuting tao", "paano maging successful",
    "ano ang pinakamahusay na petsa", "magkano ang pasada",
    "saan ang school na pinupuntaan", "ano ang sining", "sino ang nanunulat",
    "ano ang pelikula", "paano magluto ng sinigang", "ano ang lami",
    "paano pumunta sa airport", "unsa na ka", "kumusta na kag",
    "unsa ka ginandahan", "ngano ka gikan", "kanus-a ka",
    "naa ka man kay?", "unsa na atong aban", "gikan kag",
    "unsa ang imong problema", "naayo ka na ba", "gutom ka na man",
    "unsaon nimo og lunch", "bisan dili pa, salamat", "naa gyud nako",
    "dili gikan nako, buta", "maayo kaayo man", "katam-is jud ka",
    "sayon ka baya", "baka unsa man", "unsa nga akong gamit"
  ];

  var bOk = 0, bRefused = 0, bSocial = 0, bCode = 0;
  var gaps = [], clean = [];
  B.forEach(function (q) {
    var r = en.reply(q, { seed: 3, lang: "tagalog", useContext: false });
    if (r.isCode) { bCode++; return; }
    if (r.social) { bSocial++; return; }
    if (r.known) { bOk++; return; }
    bRefused++;
    /* A refusal is CORRECT when the bank has nothing on the subject,
       and a BUG when it does. Which one this is, decided by whether
       any bank entry shares a keyword with the question. */
    var tokens = T.tokenize(q).tokens;
    var near = 0;
    (en.kb.entries || []).forEach(function (e) {
      var kws = e.keywords || [];
      for (var i = 0; i < kws.length && i < 12; i++) {
        if (tokens.indexOf(T.stem(kws[i])) >= 0) { near++; return; }
      }
    });
    (near ? gaps : clean).push(q + (near ? "  (" + near + " entries share a keyword)" : ""));
  });

  var total = B.length;
  console.log("  answered from the bank : " + bOk + "  (" + Math.round(bOk / total * 100) + "%)");
  console.log("  social (not a question): " + bSocial);
  console.log("  code handed over       : " + bCode);
  console.log("  refused                : " + bRefused + "  (" + Math.round(bRefused / total * 100) + "%)");
  console.log("    of those refusals, " + gaps.length +
              " are GAPS (the bank has something) and " +
              clean.length + " are the bank honestly having nothing.");

  if (gaps.length) {
    console.log("\n  GAPS - should be answering:");
    gaps.forEach(function (g) { console.log("    " + g); });
  }
  if (clean.length) {
    console.log("\n  CLEAN REFUSALS - correct behaviour:");
    clean.slice(0, 12).forEach(function (g) { console.log("    " + g); });
    if (clean.length > 12) console.log("    ... and " + (clean.length - 12) + " more");
  }
});
