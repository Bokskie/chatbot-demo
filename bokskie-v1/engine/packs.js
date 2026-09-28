/* ============================================================
   bokskie-v1 / engine / packs.js
   ------------------------------------------------------------
     BokskiePacks.load(pathOrObject)

   The social response library: 1500 short warm replies in Tagalog,
   Cebuano and English, authored outside this project and assembled
   into data/packs.json by tools/build-packs.js.

   WHAT THESE ARE FOR, AND WHAT THEY MUST NEVER DO
   -----------------------------------------------
   The source file's own header says they "guarantee the bot always has
   a fresh reply for ANY chat message". That promise is not implemented
   here, and it is worth being explicit about why, because it is the
   one thing in this project that would undo months of work.

   This bot has exactly one rule that outranks every other: when it
   does not know something, it says so. A library with a reply for
   EVERY message is a machine for never refusing - ask it something
   obscure and it produces a confident, cheerful paragraph about
   believing in yourself, which is worse than a refusal, because the
   user cannot tell the difference between "I answered" and "I filled
   the silence".

   So the packs are gated, not the guarantee. They are used for
   messages that are not asking for information - company, comfort,
   agreement, a check-in. They are never used for a question, never
   when the bank already answered, and never for a code request. The
   gate lives in the generator, and Generator.prototype.social is the
   only thing that can reach for a pack.

   Every pack carries an optional {name}, filled at use time from the
   name the user already gave. Nothing is ever stored.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BokskiePacks = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function Packs(raw) {
    this.by = Object.create(null);
    this.build = null;
    this.counts = {};
    if (raw) this.add(raw);
  }

  Packs.prototype.add = function (raw) {
    if (!raw || typeof raw !== "object") return this;
    if (raw.packs && typeof raw.packs === "object") {
      this.build = raw._build || null;
      this.counts = raw._counts || {};
      raw = raw.packs;
    }
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var list = raw[keys[i]];
      if (!Array.isArray(list) || !list.length) continue;
      /* Copied, not referenced: the engine must not be able to write
         into the loaded data by accident. */
      this.by[keys[i]] = list.filter(function (s) {
        return typeof s === "string" && s.trim().length > 0;
      }).map(function (s) { return s.trim(); });
    }
    return this;
  };

  Packs.prototype.list = function (lang) {
    return (this.by[lang] || []).slice();
  };

  Packs.prototype.size = function (lang) {
    return this.by[lang] ? this.by[lang].length : 0;
  };

  Packs.prototype.total = function () {
    var n = 0, k = Object.keys(this.by);
    for (var i = 0; i < k.length; i++) n += this.by[k[i]].length;
    return n;
  };

  /* Strip the {name} slot when there is no name to put in it.

     Without this the placeholder ships to the reader: "Sige {name},
     ayaw kabalaka" is a template that visibly failed, and it would
     appear on every pack for every user who has not given a name yet -
     which is most of them, most of the time.

     Three things to tidy after removing it, because a naive replace
     leaves evidence behind:

       "Sige {name}, ayaw"  -> "Sige , ayaw"  -> "Sige, ayaw"
       "{name}, bisan ka"   -> ", bisan ka"   -> "Bisan ka"   (also
         capitalised, because the name used to be holding the start)
       "Kaayo {name}"       -> "Kaayo"        (no dangling hole)

     The capital is the fiddly one. If the string opened with the
     placeholder, it was written to begin with a proper noun, so what
     is left is now the first word and should read like one. */
  function stripName(raw) {
    var out = String(raw).replace(/\{name\}/g, "");
    out = out.replace(/\s+([,.;:!?])/g, "$1")     /* " ," -> "," */
           .replace(/([,;:])\s*$/, "")             /* a dangling comma at the end */
           .replace(/\s{2,}/g, " ")
           .trim();
    out = out.replace(/^[,;:]+\s*/, "");
    if (String(raw).indexOf("{name}") === 0 && out) {
      out = out.charAt(0).toUpperCase() + out.slice(1);
    }
    return out;
  }

  /* A pack, or null. `avoid` is the anti-repeat memory the context
     already keeps: returning something just said is not variety, it
     is a stuck record. Checked against the raw text AND the filled
     text, because `{name}` in the pack means the same pack produces
     two different strings depending on whether a name is known. */
  Packs.prototype.pick = function (lang, rnd, avoid, name) {
    var list = this.by[lang];
    if (!list || !list.length) return null;
    var skip = avoid || [];
    /* The avoid list is small - the context remembers ten replies, not
       fifteen hundred - so the starting point is walked forward until
       something unused turns up rather than taken as-is. With 500 packs
       and ten remembered, that lands on an unused one almost every
       time; the loop is the part that makes it true, and removing it
       put the same reply back on screen over and over. */
    var start = Math.floor((rnd ? rnd() : 0) * list.length) % list.length;
    for (var step = 0; step < list.length; step++) {
      var raw = list[(start + step) % list.length];
      if (skip.indexOf(raw) >= 0) continue;
      var out = name ? raw.replace(/\{name\}/g, name) : stripName(raw);
      if (skip.indexOf(out) >= 0) continue;
      return out;
    }
    /* Everything has been said already. Returning the first is better
       than returning nothing, and the count is bounded by the library
       size so this cannot loop. */
    return name ? list[0].replace(/\{name\}/g, name) : stripName(list[0]);
  };

  Packs.prototype.load = function (src, cb) {
    var self = this;
    if (typeof src === "object" && src !== null) {
      this.add(src);
      if (cb) cb(null, this);
      return Promise.resolve(this);
    }
    var url = String(src || "packs.json");
    if (url.indexOf("/") < 0 && typeof location !== "undefined") url = "data/" + url;
    if (typeof fetch !== "function") {
      if (cb) cb(new Error("no fetch"), this);
      return Promise.resolve(this);
    }
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("packs " + r.status);
        return r.json();
      })
      .then(function (json) { self.add(json); if (cb) cb(null, self); return self; })
      .catch(function (err) {
        /* Not fatal. Without the library the bot simply falls back to
           the plain refusal it has always used - which is a supported
           and tested state, not a broken one. */
        if (cb) cb(err, self);
        return self;
      });
  };

  var singleton = new Packs();

  return {
    Packs: Packs,
    load: function (src, cb) { return singleton.load(src, cb); },
    list: function (l) { return singleton.list(l); },
    pick: function (l, rnd, avoid, name) { return singleton.pick(l, rnd, avoid, name); },
    stripName: function (raw) { return stripName(raw); },
    size: function (l) { return singleton.size(l); },
    total: function () { return singleton.total(); },
    build: function () { return singleton.build; },
    _reset: function () { singleton = new Packs(); return singleton; }
  };
}));
