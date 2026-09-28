/* ============================================================
   bokskie-v1 / verify-build.js
   ------------------------------------------------------------
     node bokskie-v1/verify-build.js

   Checks that the `?v=` on every script tag in index.html matches the
   BUILD constant in the engine, and that nothing in the page is left
   pointing at an older build.

   This exists because of a specific, repeated failure. The engine was
   changed several times in a row - the code library added, then a load
   path fixed, then five phrasings corrected - and the `?v=` was not
   bumped. Every change was real and every change worked under node,
   and the app kept behaving exactly as it had the day before. Two
   separate rounds of "it still refuses to give me the website" were
   spent on logic that was already correct, because the browser was
   never asked for the new files.

   The cache-buster is inside the file it is meant to invalidate, so it
   cannot protect itself. This check is the thing that does: the
   version lives in exactly one place and the page is compared against
   it, so forgetting is a build failure rather than an afternoon.
   ============================================================ */

"use strict";

var fs = require("fs");
var path = require("path");

/* Two roots, and conflating them is the obvious mistake: the engine
   sits beside this file, while index.html is one level up at the repo
   root. */
var SELF = __dirname;
var ROOT = path.resolve(__dirname, "..");
var E = require(path.join(SELF, "engine", "index.js"));
var BUILD = E.BUILD;

var page = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "   " + extra : "")); }
}

console.log("\nbuild stamp: engine says " + BUILD);

ok("the engine exports a BUILD stamp", typeof BUILD === "string" && BUILD.length > 0,
   String(BUILD));

/* Every local script tag, and the version it asks for. */
var tags = [];
var re = /<script\s+src="([^"]+)"/g;
var m;
while ((m = re.exec(page)) !== null) tags.push(m[1]);

var local = tags.filter(function (s) { return s.indexOf("http") !== 0; });
ok("the page declares local scripts", local.length > 0, local.length + " found");

var mismatched = [];
var unversioned = [];
local.forEach(function (src) {
  var v = /\?v=([^"&]+)/.exec(src);
  if (!v) { unversioned.push(src); return; }
  if (v[1] !== BUILD) mismatched.push(src + " (asks for " + v[1] + ")");
});

ok("no script tag is left unversioned", unversioned.length === 0,
   unversioned.join(", "));
ok("every script tag asks for the current build", mismatched.length === 0,
   mismatched.join(", "));

/* The converse trap: a stale build left on disk. Not fatal, but worth
   seeing - it is what "I thought I had reverted that" looks like. */
var stray = [];
tags.filter(function (s) { return s.indexOf("http") !== 0; }).forEach(function (src) {
  var v = /\?v=([^"&]+)/.exec(src);
  if (v && v[1] !== BUILD) stray.push(v[1]);
});
ok("no two different build stamps in the page",
   new Set(stray.concat([BUILD])).size === 1,
   stray.join(", "));

/* The engine file the new code depends on has to actually be listed,
   or the page loads a build that cannot possibly have the feature. */
ok("engine/code.js is declared by the page",
   local.some(function (s) { return s.indexOf("engine/code.js") !== -1; }));
ok("engine/packs.js is declared by the page",
   local.some(function (s) { return s.indexOf("engine/packs.js") !== -1; }));

console.log("\n" + new Array(56, "=").join("="));
console.log("  bokskie.v1 build:  " + pass + " passed, " + fail + " failed");
console.log(new Array(56, "=").join("="));
process.exit(fail ? 1 : 0);
