/* ============================================================
   bokskie-v1 / tools / build-packs.js
   ------------------------------------------------------------
     node bokskie-v1/tools/build-packs.js
     node bokskie-v1/tools/build-packs.js --check

   Turns bokskie-v1/response-packs.js into data/packs.json.

   WHY A BUILD STEP AND NOT JUST LOADING THE FILE
   ---------------------------------------------
   response-packs.js is a 128 KB object literal that exports nothing -
   it assigns to a bare `RESPONSE_PACKS` and stops, so nothing can
   require it. It also lives outside data/, which is the one directory
   the browser is allowed to fetch from. Both are fixed here rather than
   in the engine, so the engine keeps loading data and only data.

   The packs are copied VERBATIM. They are somebody's creative work and
   this file's job is to move them, not to improve on them - the audit
   in tools/audit-packs.js reports what is in them so the decision to
   rewrite anything stays with the person who wrote them.
   ============================================================ */

"use strict";

var fs = require("fs");
var path = require("path");

var SRC = path.join(__dirname, "..", "response-packs.js");
var OUT = path.join(__dirname, "..", "data", "packs.json");
var CHECK = process.argv.indexOf("--check") >= 0;

/* The three keys, mapped onto the engine's language names. The source
   uses `ceb`/`tl`/`en`; the engine speaks `bisaya`/`tagalog`/`english`,
   and translating here rather than at every use site means the rest of
   the codebase never has to know the source's abbreviations. */
var LANG = { ceb: "bisaya", tl: "tagalog", en: "english" };

if (!fs.existsSync(SRC)) {
  console.log("  no response-packs.js to build from - nothing to do");
  process.exit(0);
}

/* Evaluated, not parsed. Re-implementing the parse would be a second
   reading of the data, and a second reading of a 1500-line literal is
   exactly the thing that goes quietly wrong. */
var raw = new Function(fs.readFileSync(SRC, "utf8") + "\n;return RESPONSE_PACKS;")();
if (!raw || typeof raw !== "object") {
  console.log("  FAILED: response-packs.js did not produce an object");
  process.exit(1);
}

var problems = [];
var out = { _build: null, _counts: {}, packs: {} };
var total = 0;

Object.keys(LANG).forEach(function (key) {
  var arr = raw[key];
  if (!Array.isArray(arr)) return;
  var list = [];
  var seen = Object.create(null);
  arr.forEach(function (s, i) {
    if (typeof s !== "string" || !s.trim()) {
      problems.push(key + "[" + i + "]: not a non-empty string");
      return;
    }
    var line = s.trim();
    if (seen[line]) return;                 /* identical reply twice is not variety */
    seen[line] = 1;
    list.push(line);
  });
  out.packs[LANG[key]] = list;
  out._counts[LANG[key]] = list.length;
  total += list.length;
});

/* The build stamp, so a half-updated tab is detectable the same way the
   code library is. Read from the engine rather than repeated here. */
try {
  out._build = require(path.join(__dirname, "..", "engine", "index.js")).BUILD;
} catch (e) { /* the engine is not requireable here; verify-build will say so */ }

if (problems.length) {
  console.log("  FAILED - " + problems.length + " problem(s):");
  problems.slice(0, 10).forEach(function (p) { console.log("    - " + p); });
  process.exit(1);
}

var json = JSON.stringify(out, null, 1);

if (CHECK) {
  var onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (onDisk !== json) {
    console.log("  packs.json is OUT OF SYNC - run: node bokskie-v1/tools/build-packs.js");
    process.exit(1);
  }
  console.log("  packs.json is in sync (" + total + " packs, " +
              (json.length / 1024).toFixed(0) + " KB)");
} else {
  fs.writeFileSync(OUT, json);
  console.log("  wrote " + total + " packs (" + (json.length / 1024).toFixed(0) +
              " KB, build " + out._build + ")");
  Object.keys(out.packs).sort().forEach(function (k) {
    console.log("    " + k.padEnd(9) + out.packs[k].length);
  });
}
