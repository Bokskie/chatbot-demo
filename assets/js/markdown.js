/* ==========================================================
   bokskie.ai - minimal markdown renderer + syntax highlighter
   No external dependencies.
   ========================================================== */
(function (global) {
  "use strict";

  var PH_OPEN = "@@P";
  var PH_CLOSE = "@@";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var KEYWORDS = {
    js: "const let var function return if else for while class new this extends super import export from default async await try catch finally throw typeof instanceof null undefined true false break continue switch case static of in delete void yield",
    ts: "const let var function return if else for while class new this extends super import export from default async await try catch finally throw typeof instanceof null undefined true false break continue switch case static of in delete void yield interface type enum implements public private protected readonly as satisfies namespace declare",
    py: "def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda pass break continue global nonlocal yield assert async await self",
    java: "public private protected class interface extends implements return if else for while new this static final void int long double float boolean char String try catch finally throw throws import package abstract",
    sh: "if then else fi for while do done case esac function echo export return local source",
    sql: "SELECT FROM WHERE INSERT UPDATE DELETE CREATE TABLE JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER BY HAVING LIMIT AS AND OR NOT NULL VALUES SET INTO",
    json: "",
    css: "",
    html: ""
  };

  // common fence labels -> our internal language keys
  var ALIAS = {
    python: "py", py3: "py", python3: "py",
    javascript: "js", jsx: "js", node: "js", mjs: "js",
    typescript: "ts", tsx: "ts",
    shellscript: "sh", bash: "sh", shell: "sh", zsh: "sh", console: "sh",
    yml: "yaml",
    golang: "go",
    csharp: "cs", "c#": "cs",
    objectivec: "objc",
    plaintext: "text", txt: "text",
    vue: "vue", sfc: "vue",
    markup: "html", htm: "html", xhtml: "html"
  };

  function stash(list, html) {
    list.push(html);
    return PH_OPEN + (list.length - 1) + PH_CLOSE;
  }

  function restore(text, list) {
    return text.replace(new RegExp(PH_OPEN + "(\\d+)" + PH_CLOSE, "g"), function (_, i) {
      return list[+i];
    });
  }

  /* ---------- Vue single-file components ----------
     An SFC mixes three languages, so we split it into blocks and
     highlight each block with the right highlighter.            */

  function highlightSfcBlock(block) {
    var open = /^<([\w-]+)([^>]*)>/.exec(block);
    if (!open) return escapeHtml(block);
    var tag = open[1].toLowerCase();
    var attrs = open[2] || "";
    var lowered = block.toLowerCase();
    var closeIdx = lowered.lastIndexOf("</");
    var inner = block.slice(open[0].length, closeIdx === -1 ? block.length : closeIdx);
    var close = closeIdx === -1 ? "" : block.slice(closeIdx);
    var lang = tag === "script"
      ? (/lang\s*=\s*["']?(ts|typescript)["']?/i.test(attrs) ? "ts" : "js")
      : tag === "style" ? "css" : "html";
    return highlight(open[0], "html") + highlight(inner, lang) + escapeHtml(close);
  }

  function highlightVue(code) {
    var re = /<template[^>]*>[\s\S]*?<\/template>|<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) out += highlight(code.slice(last, m.index), "html");
      out += highlightSfcBlock(m[0]);
      last = m.index + m[0].length;
    }
    if (last < code.length) out += highlight(code.slice(last), "html");
    return out;
  }

  function highlight(code, lang) {
    var l = (lang || "").toLowerCase().trim();
    l = ALIAS[l] || l;
    var out;

    if (l === "vue") return highlightVue(code);
    out = escapeHtml(code);

    if (l === "json") {
      out = out
        .replace(/(&quot;(?:\\.|[^&])*?&quot;)(\s*:)/g, '<span class="tok-attr">$1</span>$2')
        .replace(/:\s*(&quot;(?:\\.|[^&])*?&quot;)/g, ': <span class="tok-str">$1</span>')
        .replace(/\b(true|false|null)\b/g, '<span class="tok-key">$1</span>')
        .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
      return out;
    }

    if (l === "html" || l === "xml" || l === "svg") {
      out = out
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-com">$1</span>')
        .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-tag">$2</span>')
        .replace(/([\w-]+)(=)(&quot;[^&]*?&quot;)/g,
          '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>');
      return out;
    }

    if (l === "css" || l === "scss") {
      out = out
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-com">$1</span>')
        .replace(/([\w-]+)(\s*:\s*)([^;{}]+)(;)/g,
          '<span class="tok-tag">$1</span>$2<span class="tok-str">$3</span>$4')
        .replace(/@[\w-]+/g, '<span class="tok-key">$&</span>');
      return out;
    }

    var store = [];
    var kw = KEYWORDS[l] || "";
    var kwList = kw.trim() ? kw.trim().split(/\s+/).filter(Boolean) : [];
    var kwRe = kwList.length
      ? new RegExp("\\b(?:" + kwList.join("|") + ")\\b", "g")
      : null;

    // 1) keywords first, on the raw escaped source (no HTML exists yet)
    if (kwRe) {
      out = out.replace(kwRe, function (m) {
        return stash(store, '<span class="tok-key">' + m + "</span>");
      });
    }

    // 2) comments
    out = out.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, function (m) {
      return stash(store, '<span class="tok-com">' + m + "</span>");
    });

    if (l === "py" || l === "sh" || l === "yaml" || l === "toml") {
      out = out.replace(/(#[^\n]*)/g, function (m) {
        return stash(store, '<span class="tok-com">' + m + "</span>");
      });
    }

    // 3) strings
    out = out.replace(/(&quot;(?:\\.|[^&])*?&quot;|&#39;(?:\\.|[^&])*?&#39;|`(?:\\.|[^\\`])*`)/g, function (m) {
      return stash(store, '<span class="tok-str">' + m + "</span>");
    });

    // 4) numbers and function names
    out = out
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>')
      .replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, '<span class="tok-fn">$1</span>');

    return restore(out, store);
  }

  /* ---------- inline markdown ---------- */

  function inline(text) {
    // text is already escaped
    return text
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }

  /* ---------- block markdown ---------- */

  /* ---------- <file name="..."> blocks ----------
     Build mode asks the model to wrap each file like this:

        <file name="index.html">
        ...full file...
        </file>

     We pull them out before fenced code so that code fences
     inside a file body are not mistaken for separate blocks.  */

  function langFromName(name) {
    var ext = (String(name).match(/\.([\w+#-]+)$/) || [])[1];
    if (!ext) return "text";
    ext = ext.toLowerCase();
    if (ext === "mjs" || ext === "cjs") return "js";
    if (ext === "ts" || ext === "tsx") return "ts";
    if (ext === "vue") return "vue";
    if (ext === "scss" || ext === "less") return ext;
    if (ext === "html" || ext === "htm") return "html";
    if (ext === "py") return "py";
    if (ext === "yml" || ext === "yaml") return "yaml";
    if (ext === "md") return "text";
    return ext;
  }

  var FILE_RE = /<file\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/file>/gi;

  // strip a redundant fence the model may add inside the file body
  function cleanFileBody(body) {
    var b = body.replace(/^\s*\n/, "").replace(/\s+$/, "");
    var m = /^```[\w+#-]*\n([\s\S]*?)\n?```$/.exec(b);
    return m ? m[1] : b;
  }

  function fileBlock(name, body) {
    var code = cleanFileBody(body);
    var lang = langFromName(name);
    return '<div class="file-block" data-fname="' + escapeHtml(name) + '">' +
      '<div class="file-head">' +
        '<span class="file-ico"><svg viewBox="0 0 24 24" class="ico"><use href="#i-code"/></svg></span>' +
        '<span class="file-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + "</span>" +
        '<span class="file-actions">' +
          '<button class="code-copy" type="button" title="Copy file">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-copy"/></svg><span>Copy</span>' +
          "</button>" +
          '<button class="file-save" type="button" title="Download this file">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-download"/></svg><span>Save</span>' +
          "</button>" +
        "</span>" +
      "</div>" +
      '<pre><code>' + highlight(code, lang) + "</code></pre>" +
    "</div>";
  }

  /* A default file name for a block, from its language.

     Deliberately not configurable from the caller. Every template in
     the code library is a single `index.html`, and a bare HTML snippet
     is one too, so this mapping is right for the whole project - and an
     option that nothing passes is a second naming scheme waiting to
     disagree with the first.

     The name lives on the button rather than the label: the label stays
     "Save" whatever the file is called, and the title attribute is what
     tells you what you are about to get. */
  var LANG_FILE = {
    html: "index.html", htm: "index.html", xml: "index.xml", svg: "image.svg",
    css: "styles.css", scss: "styles.scss",
    js: "script.js", javascript: "script.js", json: "data.json",
    py: "main.py", python: "main.py", sh: "run.sh", bash: "run.sh",
    sql: "query.sql", md: "README.md", yaml: "config.yaml", yml: "config.yaml"
  };

  function codeBlock(lang, code) {
    var l = (lang || "").trim().toLowerCase() || "text";
    var body = highlight(code, l);
    var name = LANG_FILE[l] || "code.txt";
    return '<div class="code-block">' +
      '<div class="code-head">' +
        '<span class="code-lang">' + escapeHtml(l) + "</span>" +
        '<span class="code-tools">' +
          '<button class="code-copy" type="button">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-copy"/></svg><span>Copy</span>' +
          "</button>" +
          '<button class="code-dl" type="button" data-name="' + escapeHtml(name) + '" ' +
            'title="Save as ' + escapeHtml(name) + '">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-download"/></svg><span>Save</span>' +
          "</button>" +
        "</span>" +
      "</div>" +
      "<pre><code>" + body + "</code></pre>" +
    "</div>";
  }

  function render(src) {
    if (!src) return "";
    var text = String(src).replace(/\r\n/g, "\n");
    var blocks = [];
    var out = [];

    // pull out <file name="..."> blocks first so any ``` inside
    // their body is never treated as a standalone code fence
    text = text.replace(FILE_RE, function (_, name, body) {
      blocks.push(fileBlock(name, body));
      return "@@CODE" + (blocks.length - 1) + "@@";
    });

    // pull out fenced code
    text = text.replace(/```([\w+#-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push(codeBlock(lang, code.replace(/\n$/, "")));
      return "@@CODE" + (blocks.length - 1) + "@@";
    });

    var lines = text.split("\n");
    var i = 0;
    var para = [];

    function flushPara() {
      if (para.length) {
        out.push("<p>" + inline(escapeHtml(para.join("\n")).replace(/ {2}\n/g, "<br>")) + "</p>");
        para = [];
      }
    }

    while (i < lines.length) {
      var line = lines[i];
      var fence = /^@@CODE(\d+)@@$/.exec(line.trim());
      if (fence) {
        flushPara();
        out.push(blocks[+fence[1]]);
        i++;
        continue;
      }

      // headings
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flushPara();
        var lvl = h[1].length;
        out.push("<h" + lvl + ">" + inline(escapeHtml(h[2])) + "</h" + lvl + ">");
        i++;
        continue;
      }

      // hr
      if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
        flushPara();
        out.push("<hr>");
        i++;
        continue;
      }

      // blockquote
      if (/^>\s?/.test(line)) {
        flushPara();
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + render(quote.join("\n")) + "</blockquote>");
        continue;
      }

      // lists
      var ul = /^\s*[-*+]\s+/, ol = /^\s*\d+[.)]\s+/;
      if (ul.test(line) || ol.test(line)) {
        flushPara();
        var ordered = ol.test(line);
        var items = [];
        var re = ordered ? ol : ul;
        while (i < lines.length && re.test(lines[i])) {
          var item = lines[i].replace(re, "");
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) {
            item += "\n" + lines[i].trim();
            i++;
          }
          items.push("<li>" + inline(escapeHtml(item).replace(/ {2}\n/g, "<br>")) + "</li>");
        }
        out.push((ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>"));
        continue;
      }

      // table
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        flushPara();
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var t = '<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return "<th>" + inline(escapeHtml(c)) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inline(escapeHtml(c)) + "</td>"; }).join("") + "</tr>";
          }).join("") +
          "</tbody></table></div>";
        out.push(t);
        continue;
      }

      if (line.trim() === "") { flushPara(); i++; continue; }
      para.push(line);
      i++;
    }

    flushPara();
    return out.join("\n");
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) {
      return c.trim();
    });
  }

  /**
   * Collect every <file name="..."> block from a raw model response.
   * Used by the "Download all" button so a generated site can be
   * saved file-by-file without a zip library.
   * Returns [{ name, code }].
   */
  function extractFiles(src) {
    var found = [];
    if (!src) return found;
    var re = new RegExp(FILE_RE.source, "gi");
    var m;
    while ((m = re.exec(String(src))) !== null) {
      found.push({ name: m[1].trim(), code: cleanFileBody(m[2]) });
    }
    return found;
  }

  global.MD = {
    render: render,
    highlight: highlight,
    escapeHtml: escapeHtml,
    extractFiles: extractFiles,
    langFromName: langFromName
  };
})(window);