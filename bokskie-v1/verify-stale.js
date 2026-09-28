"use strict";
/* The stale-tab rule, exercised directly.

   A half-updated tab is the failure that cost the most time today: the
   logic was right, the tests were green, and the app kept serving the
   no-template menu because the engine it was running predated the code
   library. The warning that now catches it is only worth having if it
   actually fires, and it cannot be reached through the loader under
   node - the provider takes the synchronous path there and reads the
   real file whatever fetch is stubbed to. So the rule is asked
   directly, in each of the four states that matter. */
var path = require("path");
var E = require(path.join(__dirname, "engine", "index.js"));
var provider = require(path.join(__dirname, "src", "provider.js"));

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "   " + extra : "")); }
}

console.log("\nstale-tab detection");
E.Engine.load().then(function (en) {
  var stale = provider._isStaleTab;

  ok("a fully loaded engine is not stale", stale(en) === false);

  /* The data and the code must be the same build. This is the case
     that actually bit: engine.js cached under a URL that had not
     changed, code.json re-fetched because it is served no-store, and
     the two drifting apart silently. */
  var realBuild = en.code.build;
  ok("the data file carries a build stamp", typeof realBuild === "string" && realBuild.length > 0,
     String(realBuild));
  ok("and it matches the build the code reports", realBuild === E.BUILD,
     "data=" + realBuild + " engine=" + E.BUILD);

  var wrongStamp = { size: function () { return 5; }, build: "19990101a" };
  ok("a different data build IS stale",
     stale({ code: wrongStamp, kb: en.kb }) === true);

  var noStamp = { size: function () { return 5; }, build: null };
  ok("an unstamped library is not called stale",
     stale({ code: noStamp, kb: en.kb }) === false,
     "no stamp means no claim, not a mismatch");

  /* The real one: bank intact, library empty. */
  var half = { code: en.code, kb: en.kb };
  var emptyCode = { size: function () { return 0; } };
  half.code = emptyCode;
  ok("bank present + library empty IS stale", stale(half) === true);

  /* Library present, bank present. */
  ok("bank present + library present is not stale", stale(en) === false);

  /* A build with no code shelves at all - before the feature existed.
     Nothing to be stale about, and the warning must stay quiet or it
     fires on every healthy install. */
  var noCode = { code: emptyCode, kb: { entries: [{ topic: "geography" }] } };
  ok("no code shelves at all is not stale", stale(noCode) === false);

  ok("a missing engine object is not stale", stale(null) === false);

  console.log("\n" + new Array(56, "=").join("="));
  console.log("  bokskie.v1 stale-tab:  " + pass + " passed, " + fail + " failed");
  console.log(new Array(56, "=").join("="));
  process.exit(fail ? 1 : 0);
});
