/* ============================================================
   bokskie-v1 / verify-markdown.js
   ------------------------------------------------------------
     node bokskie-v1/verify-markdown.js

   assets/js/markdown.js is the only renderer between the engine and
   the screen, and it is loaded as a plain <script> that attaches to
   `window` - so it is not requireable the way every other module in
   this project is, and nothing in the suite covered it.

   That is why a Save button could be added, wired to a click handler
   in app.js, styled in styles.css and still never once checked. These
   are the assertions that would have caught that.

   Loaded with a fake `window` and a fake `document`, which is all the
   file touches at load time.
   ============================================================ */

"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
global.window = {};
global.document = {};
require(path.join(ROOT, "assets", "js", "markdown.js"));

var MD = global.window.MD;
var pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "   " + extra : "")); }
}

var FENCE = String.fromCharCode(96).repeat(3);
var htmlSrc = FENCE + "html\n<!DOCTYPE html>\n<html>\n  <body>hi</body>\n</html>\n" + FENCE;
var out = MD.render("Here you go:\n\n" + htmlSrc + "\n\nAnd a script:\n\n" +
                    FENCE + "js\nvar x = 1;\n" + FENCE);

console.log("\nmarkdown: code blocks carry a usable Save button");
ok("a code block is rendered", /class="code-block"/.test(out));
ok("the Save button is present", /class="code-dl"/.test(out));
ok("the Copy button is still there", /class="code-copy"/.test(out));
ok("both sit in a tools wrapper", /class="code-tools"/.test(out));
ok("the download icon is referenced", /#i-download/.test(out));
ok("the button carries a file name", /data-name="/.test(out));
ok("an html block is named index.html", /data-name="index\.html"/.test(out));
ok("a js block is named script.js", /data-name="script\.js"/.test(out));
ok("both blocks rendered", (out.match(/class="code-block"/g) || []).length === 2,
   (out.match(/class="code-block"/g) || []).length + " found");

/* Escaping. Asserted as "no raw tag survives", not as a literal
   substring - the highlighter wraps tag names in <span>, so
   &lt;html&gt; never appears as one contiguous string and a substring
   check on it reports a correct escape as a failure. That mistake was
   made while writing this file. */
var pre = out.slice(out.indexOf("<pre>"));
ok("no raw <html> tag survives into the output", !/<html[\s>]/.test(pre));
ok("entities are used instead", pre.indexOf("&lt;") >= 0 && pre.indexOf("&gt;") >= 0);
ok("the highlighter wrapped tags rather than stripping them",
   /class="tok-tag"/.test(pre));

/* A file name with a quote in it must not break out of the attribute.
   None of the built-in names contain one, so this is checked directly
   against the escape rather than hoped about. */
var escaped = MD.escapeHtml('a" onerror="x');
ok("quote in a name is escaped", escaped.indexOf('"') === -1, escaped);

console.log("\n" + new Array(56, "=").join("="));
console.log("  bokskie.v1 markdown:  " + pass + " passed, " + fail + " failed");
console.log(new Array(56, "=").join("="));
process.exit(fail ? 1 : 0);
