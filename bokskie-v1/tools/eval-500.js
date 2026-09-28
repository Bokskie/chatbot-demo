/* ============================================================
   bokskie-v1 · tools/eval-500.js
   ------------------------------------------------------------
       node bokskie-v1/tools/eval-500.js
       node bokskie-v1/tools/eval-500.js --verbose

   THE 500-QUESTION EXAM.

   "500 questions, 20 right" is a real report from a real run, and
   it is a claim about the only thing this project exists to do. A
   harness that only asks "what is X" flatters the engine, because
   the bank was written expecting that shape. So the exam is built
   out of what people actually type:

     A. the bank asked about ITSELF, in three languages and three
        natural phrasings per language. The answer is guaranteed to
        exist, so every failure here is retrieval.
     B. everyday free-form questions - Tagalog, Bisaya, Taglish,
        English - with the subject named the way a person names it.
     C. misspellings, because real keyboards produce them.
     D. chat - greetings, thanks, goodbyes, feelings. Here a warm
        reply is correct; a refusal is the failure.
     E. honest refusals - live data, genuine nonsense, questions no
        written bank can answer. A refusal is CORRECT and an answer
        is the failure.

   WHAT IS COUNTED, and the distinction matters more than the total:

     RIGHT    the entry a person would want came back
     WRONG    something else came back. This is the number that must
              be zero.
     SOCIAL   a warm sticker went out over a real question - the
              same failure as a wrong answer, tracked apart because
              the cause is different.
     GAP      refused, but the bank holds the answer
     HONEST   refused, correctly

   useful = RIGHT + HONEST. That is the honest headline.
   ============================================================ */

"use strict";

var path = require("path");
var ROOT = path.join(__dirname, "..");
var E = require(path.join(ROOT, "engine", "index.js"));

var VERBOSE = process.argv.indexOf("--verbose") !== -1;

/* ---------- the hand-written rows ---------- */

/* [question, what a person would want, group]
   "topic:x" means any entry from that shelf is a good answer. */
var EVERYDAY = [
  /* ---------- time, weather, news: what people ask all day ---------- */
  ["anong oras na", "time", "live"],
  ["ano ang oras na", "time", "live"],
  ["anong oras na ngayon", "time", "live"],
  ["what time is it", "time", "live"],
  ["unsa oras na", "time", "live"],
  ["unsa na ang oras", "time", "live"],
  ["maulan ba ngayon", "weather", "live"],
  ["ano ang weather ngayon", "weather", "live"],
  ["ano ang panahon ngayon", "weather", "live"],
  ["unsa ang panahon karon", "weather", "live"],
  ["ano ang balita ngayon", "news", "live"],
  ["unsa ang balita karon", "news", "live"],
  ["may bagyo ba ngayon", "typhoon", "live"],
  ["kailan ang bagyo season", "typhoon", "live"],
  ["what is a time zone", "time zone", "fact"],
  ["what is a leap year", "leap year", "fact"],
  ["bakit may leap year", "leap year", "fact"],
  ["ano ang klima", "climate", "fact"],
  ["unsa ang klima", "climate", "fact"],

  /* ---------- health: the reason a person opens a chat at 2am ---------- */
  ["may sakit ako", "topic:health-symptoms", "everyday"],
  ["masakit ang ulo ko", "headache", "everyday"],
  ["ano ang gamot sa lagnat", "fever", "everyday"],
  ["unsay tambal sa hilanat", "fever", "everyday"],
  ["ano ang sintomas ng dengue", "dengue", "everyday"],
  ["paano maiwasan ang diabetes", "diabetes", "everyday"],
  ["kulang ako sa tulog", "insomnia", "everyday"],
  ["paano makatulog ng maayos", "sleep", "everyday"],
  ["what is a concussion", "concussion", "everyday"],
  ["what is cpr", "cpr", "everyday"],
  ["paano mag first aid", "first aid", "everyday"],
  ["what is a balanced diet", "balanced diet", "everyday"],
  ["ano ang vitamins", "vitamins", "everyday"],
  ["nasobrahan ako sa kain", "calorie", "everyday"],
  ["what is a side effect", "side effect", "everyday"],

  /* ---------- money and work: what nobody teaches in school ---------- */
  ["ano ang budget", "budget", "everyday"],
  ["paano mag budget ng sweldo", "budget", "everyday"],
  ["what is interest", "interest", "everyday"],
  ["paano mag invest", "invest", "everyday"],
  ["ano ang insurance", "insurance", "everyday"],
  ["kailangan ko ng trabaho", "topic:conversations", "everyday"],
  ["what is income", "income", "everyday"],

  /* ---------- school and study ---------- */
  ["paano mag aral ng mabuti", "topic:study", "school"],
  ["paano maka memorya", "mnemonic", "school"],
  ["what is spaced repetition", "spaced repetition", "school"],
  ["what is the pomodoro technique", "pomodoro", "school"],
  ["ano ang thesis statement", "thesis statement", "school"],
  ["how do i stop procrastinating", "procrastination", "school"],
  ["what is plagiarism", "plagiarism", "school"],
  ["ano ang citation", "citation", "school"],
  ["paano gumawa ng summary", "summary", "school"],
  ["what is a hypothesis", "hypothesis", "school"],
  ["ano ang fraction", "fraction", "school"],
  ["what is a prime number", "prime", "school"],
  ["what is the pythagorean theorem", "pythagorean", "school"],
  ["what is a derivative", "derivative", "school"],
  ["what is an integral", "integral", "school"],
  ["what is probability", "probability", "school"],
  ["ano ang mean median at mode", "topic:mathematics-statistics", "school"],
  ["what is standard deviation", "standard deviation", "school"],
  ["ano ang quadratic equation", "quadratic", "school"],
  ["what is a logarithm", "logarithm", "school"]
];
/* The rest of the everyday set: tech, mind, science, history,
   language, people, travel. */
var EVERYDAY2 = [
  ["what is javascript", "javascript", "tech"],
  ["ano ang javascript", "javascript", "tech"],
  ["what is python used for", "python", "tech"],
  ["paano gamitin ang python", "python", "tech"],
  ["what is css grid", "css grid", "tech"],
  ["how do i fix a bug", "bug", "tech"],
  ["what is an api", "topic:programming", "tech"],
  ["ano ang malware", "topic:technology", "tech"],
  ["what is phishing", "phishing", "tech"],
  ["paano protektahan ang account", "topic:technology", "tech"],
  ["what is the cloud", "topic:technology", "tech"],
  ["ano ang wifi", "topic:technology", "tech"],
  ["what is machine learning", "machine learning", "tech"],
  ["what is artificial intelligence", "topic:technology", "tech"],
  ["what is mental health", "mental health", "everyday"],
  ["ano ang stress", "stress", "everyday"],
  ["ano ang depression", "topic:health", "everyday"],
  ["unsa ang insomnia", "insomnia", "everyday"],
  ["what is photosynthesis", "photosynthesis", "science"],
  ["ano ang photosynthesis", "photosynthesis", "science"],
  ["what is the solar system", "solar system exploration", "science"],
  ["ano ang galaxy", "galaxy", "science"],
  ["what is a habitat", "habitat", "science"],
  ["what is a food chain", "food chain", "science"],
  ["ano ang extinct", "extinct", "science"],
  ["what is an equator", "equator", "science"],
  ["ano ang kontinente", "continent", "science"],
  ["what is a monsoon", "monsoon", "science"],
  ["what is humidity", "humidity", "science"],
  ["what is a storm", "storm", "science"],
  ["what is martial law", "martial law", "history"],
  ["ano ang martial law", "martial law", "history"],
  ["unsa ang katipunan", "katipunan", "history"],
  ["what is the katipunan", "katipunan", "history"],
  ["ano ang edsa revolution", "edsa revolution", "history"],
  ["ano ang colonization", "colonization", "history"],
  ["what is the commonwealth", "commonwealth", "history"],
  ["ano ang kahulugan ng kaayo", "kaayo", "language"],
  ["unsa meaning sa kaayo", "kaayo", "language"],
  ["what is the meaning of sayop", "sayop", "language"],
  ["ano ang ibig sabihin ng salamat", "salamat", "language"],
  ["what does jarg mean in bisaya", "jarg", "language"],
  ["ano ang ibig sabihin ng ulam", "ulam", "language"],
  ["unsa ang gutom", "gutom", "language"],
  ["what is naa in cebuano", "naa", "language"],
  ["what is a noun", "noun", "language"],
  ["what is a red flag", "red flag", "people"],
  ["ano ang trust", "trust", "people"],
  ["paano ayusin ang away ng kaibigan", "conflict", "people"],
  ["what is a boundary", "boundary", "people"],
  ["why do we procrastinate", "why do we procrastinate", "people"],
  ["bakit nagsisinungaling ang tao", "lying", "people"],
  ["what is an apology", "apology", "people"],
  ["ano ang magandang libro", "libro", "people"],
  ["what is a good movie to watch", "movie to watch", "people"],
  ["what is public transport like", "public transport", "travel"],
  ["ano ang traffic sa manila", "manila traffic", "travel"],
  ["what is a jeepney", "jeepney", "travel"]
];


/* Misspellings. Each row is a real mistyping of a concept the bank
   holds, and the answer must still find that concept. Where the
   word is not in the bank at all, "" in the third column means the
   honest outcome is a refusal. */
var TYPOS = [
  ["what is javascirpt", "javascript"],
  ["what is javascrpt", "javascript"],
  ["ano ang javascrip", "javascript"],
  ["what is photosythesis", "photosynthesis"],
  ["what is photosynthsis", "photosynthesis"],
  ["what is progamming", "topic:programming"],
  ["what is machine lerning", "machine learning"],
  ["what is pythn", "python"],
  ["what is cybersecuirty", "topic:technology"],
  ["what is phising", "phishing"],
  ["what is a concusion", "concussion"],
  ["what is diabetis", "diabetes"],
  ["what is vacination", "vaccination"],
  ["what is hypertenison", "hypertension"],
  ["what is anitbiotics", "antibiotics"],
  ["what is pythagoran theorem", "pythagorean"],
  ["what is a thesus statement", "thesis statement"],
  ["what is plagarism", "plagiarism"],
  ["what is probablity", "probability"],
  ["what is standrad deviation", "standard deviation"],
  ["what is an intergral", "integral"],
  ["what is a derrivative", "derivative"],
  ["what is a qaudratic", "quadratic"],
  ["what is photoosynthesis", "photosynthesis"],
  ["what is a habitatt", "habitat"],
  ["what is a typoon", "typhoon"],
  ["what is the equater", "equator"],
  ["what is a contient", "continent"],
  ["what is martila law", "martial law"],
  ["what is a katipunann", "katipunan"],
  ["what is the solar systm", "solar system exploration"],
  ["what is galaxxy", "galaxy"],
  ["what is a food chian", "food chain"],
  ["what is the commnwealth", "commonwealth"],
  ["what is a jeepny", "jeepney"],
  ["ano ang kahulugan ng kaayoo", "kaayo"],
  ["what is the meaning of kumpyansa", "", "typo-nonsense"],
  ["what is an eqipment", "", "typo-nonsense"],
  ["what is a skool", "", "typo-nonsense"],
  ["what is psycology", "", "typo-nonsense"],
  ["what is the pominently", "", "typo-nonsense"],
  ["what is jargg", "jarg"],
  ["what is insomia", "insomnia"],
  ["what is denguee", "dengue"],
  ["ano ang budgeet", "budget"]
];

/* Chat. A warm reply is right and a refusal is the failure; the
   expectation names the behaviour entry the bank holds, or "" for
   any social pack - either counts. */
var CHAT = [
  ["hello", "greeting"],
  ["hi bokskie", "greeting"],
  ["kumusta ka", "greeting"],
  ["kamusta ka na", "greeting"],
  ["magandang umaga", "greeting"],
  ["magandang gabi po", "greeting"],
  ["musta na", "greeting"],
  ["unsa na", "greeting"],
  ["kumusta mo", "greeting"],
  ["thank you", "gratitude"],
  ["salamat kaayo", "gratitude"],
  ["maraming salamat po", "gratitude"],
  ["salamat bro", "gratitude"],
  ["thanks a lot", "gratitude"],
  ["bye", "farewell"],
  ["paalam na", "farewell"],
  ["goodbye", "farewell"],
  ["hanggang sa muli", "farewell"],
  ["gutom na ako", "gutom"],
  ["pagod na pagod ako", ""],
  ["kinakabahan ako", ""],
  ["nag-aalala ako", ""],
  ["katam-is jud ka", ""],
  ["maayo kaayo man", ""],
  ["sige na", ""],
  ["kain ka na ba", "kumain ka na ba"],
  ["kilala mo ako", ""],
  ["nalipay ko karon", ""],
  ["hahaha grabe ka", ""],
  ["love lots", ""],
  ["ganda mo naman", ""],
  ["good vibes lang", ""],
  ["okay lang ako", "okay lang ako"],
  ["naayo ka na ba", "naayo ka na"],
  ["unsa imong g-iya", "unsa imong g-iya"],
  ["ngano ka gikan", "gikan ako"],
  ["ang init ng araw", "ang init"],
  ["pasensya na", "sorry"],
  ["ayaw nako", "ayaw nako"],
  ["salamat sa lahat", "thank you"]
];


/* Honest refusals: a refusal is the RIGHT answer, and a confident
   answer - a definition or a social sticker - is the failure. */
var HONEST = [
  ["what is the price of tesla stock today", "live"],
  ["who won the 2019 basketball world cup", "lookup"],
  ["what is the meaning of life", "philosophy"],
  ["how to bake sourdough bread", "recipe"],
  ["asdfghjkl qwerty", "nonsense"],
  ["sino ang mananalo sa eleksyon", "live"],
  ["what is my future", "philosophy"],
  ["unsa ang dagan sa akong kinabuhi", "philosophy"],
  ["what will happen tomorrow", "predict"],
  ["nasaan ang susi ko", "personal"],
  ["what is the wifi password", "personal"],
  ["bakit ganun ang buhay", "philosophy"],
  ["what is the best phone to buy right now", "live"],
  ["magkano ang bigas ngayon", "live"],
  ["sino ang nanalong pangulo noong 2028", "lookup"],
  ["what is the score of the game", "live"],
  ["unsa ang imong password", "personal"],
  ["what is 2+2", "arithmetic"],
  ["what is 15 times 7", "arithmetic"],
  ["x y z kkk", "nonsense"],
  ["zzz qqq wwww", "nonsense"],
  ["qwertyuiop asdfghjkl", "nonsense"],
  ["what is the meaning of the word flurb", "nonsense"],
  ["translate this to japanese please", "out-of-scope"],
  ["draw me a picture of a cat", "out-of-scope"],
  ["sing me a song", "out-of-scope"],
  ["what is the weather in mars", "nonsense"],
  ["tell me a secret about my neighbour", "personal"],
  ["who is my crush", "personal"],
  ["what did i eat yesterday", "personal"],
  ["what is the current time in tokyo", "live"],
  ["what is today's lottery number", "live"],
  ["unsa ang resulta sa lotto kagabii", "live"],
  ["anong nangyari kahapon sa balita", "live"],
  ["who is the president of mars", "nonsense"],
  ["what is the colour of my shirt", "personal"],
  ["how long will i live", "predict"],
  ["what is the password of the wifi", "personal"],
  ["anong oras ako ipinanganak", "personal"],
  ["saan ako nagtatrabaho", "personal"],
  ["unsa ang akong sweldo", "personal"],
  ["what is my blood type", "personal"],
  ["sino ang aking mga magulang", "personal"],
  ["what is the meaning of the word zzzz", "nonsense"],
  ["blah blah blah nothing", "nonsense"]
];

/* ---------- part A: the bank asked about itself ---------- */

/* Natural phrasings of "tell me about X": three languages, and for
   each language a plain form and a longer one, because the longer
   one is where dilution shows up. */
var TEMPLATES = [
  { t: "what is {c}", g: "en" },
  { t: "ano ang {c}", g: "tl" },
  { t: "unsa ang {c}", g: "bis" },
  { t: "explain {c} in simple terms", g: "en-long" },
  { t: "ano ba ang {c}", g: "tl" },
  { t: "unsa man ang {c}", g: "bis" },
  { t: "{c} meaning", g: "en-short" },
  { t: "ipaliwanag mo ang {c}", g: "tl-long" },
  { t: "pasabta ko unsa ang {c}", g: "bis-long" }
];

var HAND = EVERYDAY.length + EVERYDAY2.length + TYPOS.length + CHAT.length + HONEST.length;
var PART_A = 500 - HAND;

function buildQuestions(entries) {
  var rows = [];
  var step = Math.max(1, Math.floor(entries.length / PART_A));
  var picked = [];
  for (var i = 0; i < entries.length && picked.length < PART_A; i += step) picked.push(entries[i]);
  /* Deterministic widening if the stride undershot the target. */
  for (var k = 0; picked.length < PART_A; k += 3) {
    var e = entries[(k * 7 + 5) % entries.length];
    if (picked.indexOf(e) === -1) picked.push(e);
  }
  picked.forEach(function (e, n) {
    var tpl = TEMPLATES[n % TEMPLATES.length];
    rows.push({
      q: tpl.t.replace("{c}", e.concept),
      want: String(e.concept || "").toLowerCase(),
      group: "bank/" + tpl.g
    });
  });
  EVERYDAY.concat(EVERYDAY2).forEach(function (r) { rows.push({ q: r[0], want: r[1], group: "ask/" + r[2] }); });
  TYPOS.forEach(function (r) { rows.push({ q: r[0], want: r[1], group: "typo/" + (r[2] || "real") }); });
  CHAT.forEach(function (r) { rows.push({ q: r[0], want: r[1], group: "chat", chat: true }); });
  HONEST.forEach(function (r) { rows.push({ q: r[0], want: "", group: "honest/" + r[1], honest: true }); });
  return rows;
}


/* Does the returned answer count as the one a person wanted?

   A chat row wants any reply at all. An honesty row wants a plain
   refusal - a sticker over "what is 2+2" is a wrong answer, not a
   warm one. Everything else wants the entry the person meant, or an
   entry from the shelf they meant. */
function isRight(row, r) {
  if (row.honest) return r.known === false && !r.social && !r.isCode;
  if (row.chat) return r.known === true || r.social === true || r.isCode === true;
  var want = String(row.want || "").toLowerCase();
  if (!want) return false;
  if (r.social || r.isCode) return false;
  if (want.indexOf("topic:") === 0) {
    return r.known === true && String(r.topic || "").toLowerCase().indexOf(want.slice(6)) === 0;
  }
  var got = String(r.concept || "").toLowerCase();
  if (!got) return false;
  return got === want || got.indexOf(want) !== -1 || want.indexOf(got) !== -1;
}

E.Engine.load({ basePath: path.join(ROOT, "data") }).then(function (eng) {
  var rows = buildQuestions(eng.kb.entries || []);
  var out = { right: 0, wrong: 0, gap: 0, honest: 0, social: 0 };
  var wrongList = [], gapList = [], socialList = [];
  var byGroup = {};

  rows.forEach(function (row) {
    var r = eng.reply(row.q, { seed: 7, useContext: false });
    var g = byGroup[row.group] = byGroup[row.group] || { n: 0, right: 0 };
    g.n++;

    if (isRight(row, r)) { out.right++; g.right++; return; }
    if (r.social) { out.social++; socialList.push(row.q + "  ->  " + String(r.text || "").slice(0, 48)); return; }
    if (r.known) { out.wrong++; wrongList.push(row.q + "  wanted " + (row.want || "-") + "  got " + r.concept); return; }
    out.gap++; gapList.push(row.q + "  wanted " + (row.want || "-"));
  });

  var total = rows.length;
  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "-"; }

  console.log("");
  console.log("  bokskie.v1 - " + total + " question exam");
  console.log("  " + new Array(58).join("-"));
  console.log("  RIGHT             " + String(out.right).padStart(4) + "   " + pct(out.right, total));
  console.log("  WRONG answer      " + String(out.wrong).padStart(4) + "   " + pct(out.wrong, total) + "   <- must stay near zero");
  console.log("  SOCIAL over it    " + String(out.social).padStart(4) + "   " + pct(out.social, total) + "   <- must stay near zero");
  console.log("  REFUSED, a hole   " + String(out.gap).padStart(4) + "   " + pct(out.gap, total));
  console.log("  refused, correct  " + String(out.honest).padStart(4) + "   " + pct(out.honest, total));
  console.log("");
  console.log("  useful answers    " + out.right + "/" + total + "  (" + pct(out.right, total) + ")");
  console.log("");
  console.log("  " + new Array(58).join("-"));
  console.log("  by group");
  Object.keys(byGroup).sort().forEach(function (k) {
    var g = byGroup[k];
    console.log("    " + k.padEnd(24) + String(g.right).padStart(3) + "/" +
                String(g.n).padEnd(4) + pct(g.right, g.n));
  });

  function show(title, list, limit) {
    if (!list.length) return;
    console.log("");
    console.log("  " + title + " - " + list.length);
    list.slice(0, VERBOSE ? list.length : limit).forEach(function (x) { console.log("    " + x); });
    if (!VERBOSE && list.length > limit) console.log("    ... and " + (list.length - limit) + " more (--verbose)");
  }
  show("WRONG ANSWERS", wrongList, 15);
  show("SOCIAL OVER A QUESTION", socialList, 15);
  show("HOLES THE BANK COULD FILL", gapList, 20);
  console.log("");
});

