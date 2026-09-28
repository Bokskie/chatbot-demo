/* ============================================================
   bokskie-v1 / engine / code.js
   ------------------------------------------------------------
     BokskieCode.load(pathOrObject)

   The code library: a set of complete, working files that the
   engine can hand over verbatim when somebody asks it to build
   something.

   WHY THIS IS A SEPARATE FILE AND NOT A SHELF
   -------------------------------------------
   A shelf is prose. Retrieval reads it, scores it, and the
   generator re-enters the same facts from a different opening
   sentence to avoid repeating itself. All of that is right for
   knowledge and catastrophic for code, because the only version of
   a working page that works is the one that was written. A rotated
   <script> tag is a page that silently stopped running.

   So the library is loaded, indexed by concept, and never searched.
   Nothing here is tokenised, nothing is scored, nothing is rotated.
   The engine looks a concept up or it does not.

   It is loaded from data/code.json for the same reason
   conversation.json is: it is data, not logic, and the browser has
   to be able to fetch it.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BokskieCode = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function Code(raw) {
    this.templates = Object.create(null);
    this.order = [];
    /* The build the DATA was written by, compared against the build
       the code is running. Null when the file carries no stamp. */
    this.build = null;
    if (raw) this.add(raw);
  }

  /* Additive, and deliberately tolerant of a half-written file. A
     missing library must degrade to "this bot cannot write code",
     never to a crash on the first question.

     The `_build` and `_templates` wrapper is read here and unwrapped,
     so the loader does not care which shape the file is in. That
     matters because the stamp is the point: the file is served
     no-store and re-fetched on every load, while the scripts are not,
     so comparing the two is what tells us the tab is half-updated. */
  Code.prototype.add = function (raw) {
    if (!raw || typeof raw !== "object") return this;
    if (raw._templates && typeof raw._templates === "object") {
      this.build = raw._build || null;
      raw = raw._templates;
    }
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var t = raw[keys[i]];
      if (!t || typeof t.code !== "string" || !t.code.length) continue;
      this.templates[keys[i]] = {
        concept: t.concept || keys[i],
        title: t.title || keys[i],
        file: t.file || "index.html",
        lang: t.lang || "html",
        kind: t.kind || "website",
        how: Array.isArray(t.how) ? t.how : [],
        change: Array.isArray(t.change) ? t.change : [],
        code: t.code,
        lines: t.lines || t.code.split("\n").length
      };
      this.order.push(keys[i]);
    }
    return this;
  };

  /* The whole point. An exact concept match or nothing - there is no
     "close enough", because guessing here means shipping a page that
     is not what was asked for while looking exactly as confident as
     one that is. */
  Code.prototype.get = function (concept) {
    if (!concept) return null;
    return this.templates[concept] || null;
  };

  Code.prototype.has = function (concept) { return !!this.get(concept); };
  Code.prototype.size = function () { return this.order.length; };
  Code.prototype.list = function () { return this.order.slice(); };

  Code.prototype.load = function (src, cb) {
    var self = this;
    if (typeof src === "object" && src !== null) {
      this.add(src);
      if (cb) cb(null, this);
      return Promise.resolve(this);
    }
    var url = String(src || "code.json");
    /* An explicit path wins; otherwise sit next to this file. Kept
       tolerant so the loader works the same in node and the browser
       without either of them knowing which one it is in. */
    if (url.indexOf("/") < 0 && url.indexOf(".") !== 0 && typeof location !== "undefined") {
      url = "data/" + url;
    }
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("code library " + r.status);
        return r.json();
      })
      .then(function (json) { self.add(json); if (cb) cb(null, self); return self; })
      .catch(function (err) {
        /* Not fatal. The bot still answers everything else; it just
           stops being able to write code, and says so by refusing
           rather than by inventing a page. */
        if (cb) cb(err, self);
        return self;
      });
  };

  var singleton = new Code();

  return {
    Code: Code,
    load: function (src, cb) { return singleton.load(src, cb); },
    get: function (concept) { return singleton.get(concept); },
    has: function (concept) { return singleton.has(concept); },
    size: function () { return singleton.size(); },
    list: function () { return singleton.list(); },
    _reset: function () { singleton = new Code(); return singleton; },
    _Code: Code
  };
}));
