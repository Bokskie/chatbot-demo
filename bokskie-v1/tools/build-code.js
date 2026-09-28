/* ============================================================
   bokskie-v1 / tools / build-code.js
   ------------------------------------------------------------
     node bokskie-v1/tools/build-code.js
     node bokskie-v1/tools/build-code.js --check

   Turns tools/source-code/<name>/ into data/code.json.

   WHY CODE IS NOT IN THE KNOWLEDGE BANK
   -------------------------------------
   The obvious place for a website template is a .kb line, and it
   is the wrong place for three separate reasons.

   1. .kb is one dense line per entry. A page is two hundred lines.
   2. The answer field feeds the token index and the `variations`
      rotation, which re-enters the same facts from a different
      first sentence. Rotating a paragraph is a readability
      feature. Rotating a <script> tag produces a page that no
      longer runs, and the damage is invisible until somebody
      opens it.
   3. Code is not knowledge to be summarised. It has to arrive
      byte for byte or not at all.

   So the code lives in its own authored tree, as a real .html file
   with real newlines that a person can open and read, and the prose
   that explains it lives beside it in meta.js. This file only
   assembles the two. build-kb.js is the parallel tool for the bank
   and shares the same reasoning: source you can read, JSON a
   machine can load.

   WHAT IS CHECKED, AND WHY
   -----------------------
   A template that is malformed is worse than no template, because
   the user cannot tell it is broken until they have pasted it into
   an editor. So this fails loudly on the things that break a page:
   unbalanced tags, a missing doctype, a stray backtick or ${} that
   would corrupt the JSON, and a folder whose metadata disagrees
   with the file sitting next to it.
   ============================================================ */

"use strict";

var fs = require("fs");
var path = require("path");

var SRC = path.join(__dirname, "source-code");
var OUT = path.join(__dirname, "..", "data", "code.json");
var CHECK = process.argv.indexOf("--check") >= 0;

/* Read the build stamp out of the engine rather than repeating it
   here. Two copies of a version number is two things to forget. */
var BUILD = "unknown";
try {
  BUILD = require(path.join(__dirname, "..", "engine", "index.js")).BUILD;
} catch (e) { /* the engine is not requireable; the build check will say so */ }

/* Tags whose balance actually matters for a page to render. Void and
   self-closing elements are deliberately absent - counting <br> as
   needing a </br> would fail a perfectly good page. */
var PAIRED = [
  ["<div", "</div>", "div"],
  ["<section", "</section>", "section"],
  ["<header", "</header>", "header"],
  ["<footer", "</footer>", "footer"],
  ["<nav", "</nav>", "nav"],
  ["<form", "</form>", "form"],
  ["<style", "</style>", "style"],
  ["<script", "</script>", "script"],
  ["<body", "</body>", "body"],
  ["<article", "</article>", "article"]
];

var problems = [];
var templates = {};
var slugSeen = Object.create(null);
var conceptSeen = Object.create(null);

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

fs.readdirSync(SRC).sort().forEach(function (name) {
  var dir = path.join(SRC, name);
  if (!fs.statSync(dir).isDirectory()) return;

  var codeFile = path.join(dir, "index.html");
  var metaFile = path.join(dir, "meta.js");
  if (!fs.existsSync(codeFile)) {
    problems.push(name + ": no index.html");
    return;
  }
  if (!fs.existsSync(metaFile)) {
    problems.push(name + ": no meta.js");
    return;
  }

  var meta = require(metaFile);
  var code = fs.readFileSync(codeFile, "utf8").replace(/\s+$/, "");

  /* ---- the checks that matter ---- */
  if (code.indexOf("`") >= 0) {
    problems.push(name + ": index.html contains a backtick, which ends the JSON string");
  }
  if (code.indexOf("${") >= 0) {
    problems.push(name + ": index.html contains ${, which JSON would read as a value");
  }
  if (!/^<!DOCTYPE html>/i.test(code)) {
    problems.push(name + ": no doctype - the page would render in quirks mode");
  }
  PAIRED.forEach(function (pair) {
    var open = count(code, pair[0]), close = count(code, pair[1]);
    if (open !== close) {
      problems.push(name + ": " + pair[2] + " is unbalanced - " +
                    open + " open, " + close + " close");
    }
  });
  if (/<html[\s>]/.test(code) === false) problems.push(name + ": no <html> element");
  if (/<\/html>\s*$/i.test(code) === false) problems.push(name + ": no closing </html>");

  ["concept", "title", "file", "lang", "how", "change"].forEach(function (field) {
    if (!meta[field]) problems.push(name + ": meta.js has no " + field);
  });
  /* The folder is a SLUG, not the concept. "resort website" has a
     space in it, and the concept is what the generator looks a
     template up by - it has to match the `concept` on the .kb entry
     that describes it, spaces and all. What must hold is that both
     the slug and the concept are unique, or one template would
     quietly overwrite another in the JSON below. */
  if (meta.concept && conceptSeen[meta.concept]) {
    problems.push("two templates declare the concept \"" + meta.concept +
                  "\" - the second would overwrite the first");
  }
  if (Array.isArray(meta.how) && meta.how.length < 2) {
    problems.push(name + ": needs at least two \"how\" points to be worth explaining");
  }

  var key = meta.concept || name;
  if (conceptSeen[key]) {
    problems.push("two templates declare the concept \"" + key + "\" - the second would overwrite the first");
  }
  conceptSeen[key] = 1;
  if (slugSeen[name]) problems.push("two templates share the folder name " + name);
  slugSeen[name] = 1;

  templates[key] = {
    concept: key,
    title: meta.title || name,
    file: meta.file || "index.html",
    lang: meta.lang || "html",
    kind: meta.kind || "website",
    how: meta.how || [],
    change: meta.change || [],
    code: code,
    lines: code.split("\n").length
  };
});

if (problems.length) {
  console.log("  FAILED - " + problems.length + " problem(s):");
  problems.forEach(function (p) { console.log("    - " + p); });
  process.exit(1);
}

var n = Object.keys(templates).length;
if (!n) {
  console.log("  no templates found in tools/source-code/");
  process.exit(1);
}

var json = JSON.stringify(templates, null, 1);

/* The build stamp travels WITH the data, and this is the part that
   actually catches a half-updated tab.

   verify-build.js compares the `?v=` in index.html against the
   constant in the engine, and that only proves they agree with each
   other. It cannot tell that engine/intent.js was edited and the
   constant was left alone, which is exactly what happened twice: a
   fix went in, every test passed, and the browser kept serving the
   files it had already cached under the same URL. Nothing in the page
   could see it.

   This can, because code.json is served no-store and is re-fetched on
   every load, while the scripts are not. The engine compares the stamp
   in this file with its own and reports a mismatch, which turns "your
   tab is stale" from something we argue about into something the app
   reports on its own. */
var lib = {};
Object.keys(templates).forEach(function (k) { lib[k] = templates[k]; });
var payload = { _build: BUILD, _templates: lib };

if (CHECK) {
  /* Compared against the payload, not against `json` - the file on
     disk is the wrapper, and checking the unwrapped form would report
     every build as out of sync. */
  var onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (onDisk !== JSON.stringify(payload, null, 1)) {
    console.log("  code.json is OUT OF SYNC - run: node bokskie-v1/tools/build-code.js");
    process.exit(1);
  }
  console.log("  code.json is in sync (" + n + " templates, " +
              (json.length / 1024).toFixed(0) + " KB, build " + BUILD + ")");
} else {
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
  var total = Object.keys(templates).reduce(function (acc, k) {
    return acc + templates[k].lines;
  }, 0);
  console.log("  wrote " + n + " templates (" + total + " lines of code, " +
              (json.length / 1024).toFixed(0) + " KB)");
  Object.keys(templates).sort().forEach(function (k) {
    var t = templates[k];
    console.log("    " + k.padEnd(22) + t.lines + " lines  " + t.title);
  });
}
