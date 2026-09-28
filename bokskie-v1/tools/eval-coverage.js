/* ============================================================
   bokkie-v1 · tools/eval-coverage.js
   ------------------------------------------------------------
       node bokskie-v1/tools/eval-coverage.js
       node bokskie-v1/tools/eval-coverage.js --verbose

   MEASURES COVERAGE. The integrity gate says the bank is
   well-formed; it says nothing about whether the bot can answer.
   Those are different questions, and only this one answers the
   second.

   "3 out of 100" is a claim about the thing this project exists to
   do, so it deserves a number rather than an argument. A refusal
   and a wrong answer are also not the same failure, and a single
   hit-rate conflates them:

     ANSWERED the engine returned an entry
     RIGHT     the entry was the one a person would want
     REFUSED   nothing cleared the bar
     HONEST    that refusal was correct - live data, or genuinely
               outside a written bank. A refusal here is the
               product working, not failing.
     GAP       that refusal was a hole. The bank could have
               answered and did not. This is the number that
               should embarrass us.

   Questions are grouped by what a person TYPES, not by shelf,
   because that is the only view that matches the complaint.
   English is expected to be strong and Tagalog/Bisaya to be weak;
   measuring only English would hide the actual problem.
   ============================================================ */

"use strict";

var path = require("path");
var ROOT = path.join(__dirname, "..");
var E = require(path.join(ROOT, "engine", "index.js"));

var VERBOSE = process.argv.indexOf("--verbose") !== -1;

/* [question, expected concept, kind]
   expected "" means a refusal is CORRECT. Saying so in the table is
   the point: an honest refusal and a gap look identical from
   outside, and only the table can tell them apart. */
var SET = [
  /* ---------- English: the easy case ---------- */
  ["what is javascript", "javascript", "english core"],
  ["how do i fix a javascript bug", "bug", "english core"],
  ["what is photosynthesis", "photosynthesis", "english core"],
  ["what is a primary key", "primary key", "english core"],
  ["what is phishing", "phishing", "english core"],
  ["what is dna", "dna", "english core"],
  ["what is the pythagorean theorem", "pythagorean", "english core"],
  ["what is css grid", "css grid", "english core"],
  ["what is a noun", "noun", "english core"],
  ["what is a thesis statement", "thesis statement", "english core"],
  ["what is a concussion", "concussion", "english core"],
  ["what is machine learning", "machine learning", "english core"],

  /* ---------- Tagalog: what a Filipino actually types ---------- */
  ["ano ang kahulugan ng salamat", "salamat", "tagalog covered"],
  ["ano ang meaning ng kaayo", "kaayo", "tagalog covered"],
  ["unsa meaning nga salamat", "salamat", "tagalog covered"],
  ["anong oras na", "time", "tagalog live"],
  ["ano ang balita ngayon", "news", "tagalog live"],
  ["maulan ba ngayon", "weather", "tagalog live"],
  ["ano ang weather ngayon", "weather", "tagalog live"],
  ["ano ang pinakamabuting course", "choosing a course", "tagalog judgement"],
  ["magandang araw sa inyo", "", "tagalog greeting"],
  ["kita na unsa", "", "tagalog greeting"],
  ["ano ang ibig sabihin ng baybay", "", "tagalog vocab gap"],
  ["paano magpundasyon", "", "tagalog money gap"],
  ["sino ang unang president ng pilipinas", "", "tagalog history gap"],
  ["ano ang wikang filipino", "", "tagalog vocab gap"],
  /* ---------- Bisaya ---------- */
  ["unsa meaning nga salamat", "salamat", "bisaya covered"],
  ["kaayo kamusta", "kaayo", "bisaya covered"],
  ["maunaw ba karon", "weather", "bisaya live"],
  ["unsa na nga weather karon", "weather", "bisaya live"],
  ["unsa gyud nga atoa", "", "bisaya gap"],
  ["unsa nga akong kinuhaan", "", "bisaya gap"],
  ["unsa oras na", "time", "bisaya live"],

  /* ---------- Taglish: how people really type ---------- */
  ["ano weather maulan ba ngayon", "weather", "taglish live"],
  ["sino artist pinaka sikat ngayon", "", "taglish live"],
  ["best course for me", "choosing a course", "taglish judgement"],
  ["how do i fix a javascript bug", "bug", "taglish core"],
  ["ano ang gender at sex", "", "taglish gap"],
  ["bakit mahal ang bilis ng 5G", "", "taglish telecom gap"],
  ["ano ang pinakamahusay na phone", "", "taglish product gap"],

  /* ---------- Honest refusals: no written bank can answer these -- */
  ["what is the price of tesla stock today", "", "honest live"],
  ["who won the 2019 basketball world cup", "", "honest lookup"],
  ["what is the meaning of life", "", "honest philosophy"],
  ["how to bake sourdough bread", "", "honest recipe"],
  ["asdfghjkl qwerty", "", "honest nonsense"]
];

E.Engine.load({ basePath: path.join(ROOT, "data") }).then(function (eng) {
  var out = { answered: 0, right: 0, refused: 0, honest: 0, gap: 0 };
  var wrong = [], holes = [], liveRefused = [];
  var byGroup = {};

  SET.forEach(function (row) {
    var q = row[0], want = row[1], why = row[2];
    var r = eng.reply(q, { seed: 7, useContext: false });
    var g = byGroup[why] = byGroup[why] || { n: 0, right: 0, honest: 0 };
    g.n++;

    if (r.known) {
      out.answered++;
      var got = String(r.concept || "").toLowerCase();
      var w = String(want).toLowerCase();
      if (want && (got === w || got.indexOf(w) !== -1)) { out.right++; g.right++; }
      else wrong.push({ q: q, want: want, got: got, topic: r.topic });
    } else {
      out.refused++;
      if (want) { out.gap++; holes.push({ q: q, want: want, topic: r.topic, why: why }); }
      else { out.honest++; g.honest++; liveRefused.push(q); }
    }
  });

  var total = SET.length;
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "-"; }

  console.log("");
  console.log("  boksie.v1 coverage - " + total + " questions");
  console.log("  " + new Array(56, "-").join("-"));
  console.log("  answered           " + String(out.answered).padStart(4) + "   " + pct(out.answered, total));
  console.log("    right                   " + String(out.right).padStart(4) + "   " + pct(out.right, out.answered));
  console.log("  refused            " + String(out.refused).padStart(4) + "   " + pct(out.refused, total));
  console.log("    honest (correct)             " + String(out.honest).padStart(4) + "   <- the product working");
  console.log("    GAPS (bank could answer)     " + String(out.gap).padStart(4) + "   <- the product failing");
  console.log("");
  console.log("  useful answer rate:  " + out.right + "/" + total + "  (" + pct(out.right, total) + ")");
  console.log("  wrong-answer rate:   " + (out.answered - out.right) + "/" + total + "  (" +
              pct(out.answered - out.right, total) + ")   <- must stay near zero");
  console.log("");
  console.log("  " + new Array(56, "-").join("-"));
  console.log("  by kind");
  Object.keys(byGroup).sort().forEach(function (k) {
    var g = byGroup[k];
    console.log("    " + k.padEnd(20) + String(g.n).padStart(3) + " asked  " +
                String(g.right).padStart(3) + " right  " +
                String(g.honest).padStart(3) + " honest refusal");
  });

  if (wrong.length) {
    console.log("");
    console.log("  WRONG ANSWERS (worse than refusing) - " + wrong.length);
    wrong.forEach(function (w) {
      console.log("    \"" + w.q + "\"  asked " + w.want + "  got " + w.got);
    });
  }
  if (holes.length) {
    console.log("");
    console.log("  GAPS - silent, but the bank should know - " + holes.length);
    holes.forEach(function (h) {
      console.log("    \"" + h.q + "\"  wanted " + h.want + "  [" + h.why + "]");
    });
  }
  if (VERBOSE && liveRefused.length) {
    console.log("");
    console.log("  HONEST REFUSALS (correct - listed for the record)");
    liveRefused.forEach(function (q) { console.log("    \"" + q + "\""); });
  }
  console.log("");
});
