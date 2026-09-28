/* =====================================================================
   brain.js — the "utak" of bokskie.ai
   =====================================================================

   app.js  handles the SCREEN    (render, stream, buttons)
   llm.js  handles the CONNECTION (openai, anthropic, gemini, ollama)
   brain.js handles UNDERSTANDING — the only file that knows things
   about YOU between messages:

     1. Your name        "my name is Mark"  -> remembered after refresh
     2. The topic        "next" / "it"       -> linked to what came before
     3. Short-term       this chat, last 20 turns
     4. Recent chats     survives a page refresh
     5. A context block  injected into the system prompt, so a real model
                        already knows all of the above

   HOW TO EXTEND LATER
   -------------------
     store  -> localStorage   swap for a database or API
     remote -> stub           swap for embeddings + vector search (RAG)

   Everything the outside world touches goes through those two objects,
   so nothing else in this file has to change. No dependencies: plain
   browser JavaScript, like every other file in this project.
   ===================================================================== */

(function (global) {
  "use strict";

  /* ===================================================================
     1. SWAP POINT — STORAGE
     -------------------------------------------------------------------
     Every read and write goes through here. To move off localStorage,
     replace these two functions and return promises. Nothing else
     in this file needs to change.
     =================================================================== */

  var store = {
    get: function (key) {
      try {
        var raw = global.localStorage.getItem("bokskie.brain." + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null; // private mode, storage blocked, or corrupt JSON
      }
    },
    set: function (key, value) {
      try {
        global.localStorage.setItem("bokskie.brain." + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false; // quota exceeded, or storage blocked
      }
    },
    remove: function (key) {
      try {
        global.localStorage.removeItem("bokskie.brain." + key);
      } catch (e) { /* ignore */ }
    }
  };

  /* ===================================================================
     2. SWAP POINT — LONG-TERM MEMORY / RAG
     -------------------------------------------------------------------
     Runs before every request. Returns null today because there is no
     database yet.

     LATER: make it async, embed the question, search your notes, and
     return the best matches. Then await it from buildContext(). The
     rest of this file stays exactly the same.
     =================================================================== */

  function remote(text) {
    return null; // -> later: [{ text, score, source }]
  }

  /* ===================================================================
     3. HELPERS AND WORD LISTS
     =================================================================== */

  function clean(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* Words that follow "I'm ___" but are never a name. This is what
     stops "I'm tired" from being remembered as the name "Tired". */
  var NOT_A_NAME = {
    tired: 1, hungry: 1, sad: 1, happy: 1, angry: 1, busy: 1, free: 1,
    ready: 1, done: 1, sick: 1, bored: 1, confused: 1, scared: 1,
    afraid: 1, sorry: 1, glad: 1, fine: 1, okay: 1, ok: 1, good: 1,
    great: 1, awesome: 1, here: 1, there: 1, back: 1, still: 1,
    just: 1, not: 1, sure: 1, trying: 1, learning: 1, studying: 1,
    building: 1, making: 1, working: 1, using: 1, looking: 1, going: 1,
    coming: 1, thinking: 1, wondering: 1, curious: 1, beginner: 1,
    student: 1, developer: 1, new: 1, from: 1, help: 1, stuck: 1,
    lost: 1, a: 1, an: 1, the: 1, my: 1, your: 1, no: 1, yes: 1,
    so: 1, very: 1, really: 1, currently: 1, actually: 1, basically: 1,
    probably: 1, definitely: 1, in: 1, on: 1, at: 1, to: 1, of: 1,
    and: 1, or: 1, but: 1, asking: 1
  };

  /* Too common to be a useful topic label. Includes common Taglish. */
  var STOPWORDS = {
    the: 1, and: 1, for: 1, that: 1, this: 1, with: 1, you: 1, your: 1,
    are: 1, was: 1, were: 1, have: 1, has: 1, can: 1, could: 1, will: 1,
    would: 1, should: 1, from: 1, into: 1, about: 1, what: 1, how: 1,
    why: 1, when: 1, where: 1, which: 1, does: 1, do: 1, did: 1, is: 1,
    am: 1, it: 1, its: 1, they: 1, them: 1, their: 1, but: 1, not: 1,
    all: 1, any: 1, some: 1, just: 1, like: 1, get: 1, got: 1, make: 1,
    made: 1, want: 1, need: 1, know: 1, think: 1, tell: 1, give: 1,
    show: 1, explain: 1, use: 1, using: 1, code: 1, lang: 1, ko: 1,
    ako: 1, ang: 1, mga: 1, sa: 1, ng: 1, na: 1, ay: 1, please: 1,
    thanks: 1, thank: 1, hello: 1, hi: 1, hey: 1, also: 1, then: 1,
    next: 1, more: 1, again: 1, still: 1, very: 1, much: 1, many: 1,
    good: 1, great: 1, okay: 1, ok: 1, let: 1
  };

  /* ===================================================================
     4. PART 1 — REMEMBERING THE NAME
     =================================================================== */

  /* Explicit phrasings. Safe, always trusted. */
  var RE_NAME_EXPLICIT = [
    /\bmy name(?:'s| is)\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)?)/i,
    /\bcall me\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)?)/i,
    /\bi(?:'m| am) called\s+([A-Za-z][A-Za-z'\-]*)/i,
    /\byou can call me\s+([A-Za-z][A-Za-z'\-]*)/i,
    /\bako si\s+([A-Za-z][A-Za-z'\-]*)/i,
    /\bang pangalan ko (?:ay|ako|is)\s+([A-Za-z][A-Za-z'\-]*)/i
  ];

  /* "I'm Mark" is risky, so it is checked much harder below. */
  var RE_NAME_LOOSE = /\b(?:i(?:'m| am)|im)\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)?)/i;

  function looksLikeName(raw) {
    var v = clean(raw).toLowerCase().replace(/[^a-z'\- ]/g, "");
    if (!v || v.length < 2 || v.length > 30) return false;
    if (NOT_A_NAME[v]) return false;
    if (/^(a|an|the|my|your|his|her|their|our) /.test(v)) return false;

    var words = v.split(" ");
    if (words.length > 2) return false;
    for (var i = 0; i < words.length; i++) {
      if (NOT_A_NAME[words[i]] || words[i].length < 2) return false;
    }
    return true;
  }

  /**
   * Pull a name out of a message.
   * Returns { name } or null.
   */
  function extractName(text) {
    var t = clean(text);
    if (!t) return null;

    for (var i = 0; i < RE_NAME_EXPLICIT.length; i++) {
      var m = t.match(RE_NAME_EXPLICIT[i]);
      if (m && looksLikeName(m[1])) {
        return { name: titleCase(m[1].trim()) };
      }
    }

    /* "I'm Mark" is only trusted when the capitalisation gives it away:
       "I'm Mark" passes, "i'm tired" does not. */
    var loose = t.match(RE_NAME_LOOSE);
    if (loose) {
      var candidate = loose[1].trim();
      if (/^[A-Z]/.test(candidate) && looksLikeName(candidate)) {
        return { name: titleCase(candidate) };
      }
    }
    return null;
  }

  /* ===================================================================
     4b. PART 1b — HOW YOU FEEL, AND WHERE YOU ARE
     ===================================================================
     "I'm tired" and "I'm a beginner" are not names, but they are not
     nothing either. They tell us HOW to talk to you: gentler and
     shorter when someone is worn out, slower with a beginner.
     Recognised in English and Taglish. Mood is one-shot (it clears
     after one reply); level sticks for the session.
     =================================================================== */

  var MOODS = {
    tired: /\b(tired|exhausted|drained|weary)\b|\bpagod\b|\bpatay na (na )?ako\b/i,
    /* "stuck" and "hindi ko gets" = blocked, trying to push through */
    stuck: /\b(i'?m |i am )?stuck\b|\b(hi?ndi|di) ko gets\b|\bnasira na ako\b|\bhap os na ako\b|\bpatay na ko\b/i,
    /* "confused" and "hindi ko maintindihan" = the idea has not landed yet */
    confused: /\bconfused\b|\b(hi?ndi|di) ko (maintaindihan|maintindihan)\b|\bano (ang )?(nangyayari|meaning)\b/i,
    frustrated: /\b(frustrat(ed|ing)|sobrang hirap|ang hirap|tangina|damn)\b/i,
    happy: /\b(happy|excited|glad)\b|\bmasaya (na )?ako\b/i
  };

  var LEVELS = {
    beginner: /\b(beginner|newbie|noob|new to|first (time|ever)|just started|starting out)\b|\bbaguhan\b|\bwalang idea\b|\bhindi ko (alam|gets)\b|\bsa first time/i,
    advanced: /\b(advanced|expert|experienced|senior|professional)\b|\bmatagal na (na )?ako\b/i
  };

  /* Taglish markers, so replies can come back in the language you used. */
  var TAGLISH = /\b(ako|kung|yung|nang|hindi|opo|sige|pwede|kumuha|tayo|natin|ninyo|ito|iyan|yon|gusto|kailangan|dapat|baka|meron|wala|talaga|sana|para|pero|kasi|kapag|habang)\b|'di\b|'tong\b/i;

  function isTaglish(text) { return TAGLISH.test(clean(text)); }

  function readState(text) {
    var t = clean(text);
    var out = { mood: "", level: "" };
    if (!t) return out;
    for (var m in MOODS) {
      if (Object.prototype.hasOwnProperty.call(MOODS, m) && MOODS[m].test(t)) { out.mood = m; break; }
    }
    for (var l in LEVELS) {
      if (Object.prototype.hasOwnProperty.call(LEVELS, l) && LEVELS[l].test(t)) { out.level = l; break; }
    }
    return out;
  }

  /* ===================================================================
     5. PART 2 — TRACKING THE TOPIC
     ===================================================================
     A "topic" is a short label for what we are talking about right now.
     It is what "next", "it" and "that" hang on to.
     =================================================================== */

  /* Known multi-word concepts always win over single words. */
  var RE_TOPIC_PHRASE =
    /\b(v-model|v-for|v-if|v-on|computed properties|watchers?|lifecycle|composition api|script setup|props|emits?|slots?|reactivity|state management|pinia|vuex|vue-router|nuxt|components?|directives?|transitions?|async components?|teleport|suspense|form validation|http requests?|fetch|axios|localstorage|database|sql|authentication|responsive design|flexbox|grid|animations?|accessibility|testing|debugging|refs?|reactive)\b/gi;

  function extractTopic(text) {
    var t = clean(text);
    if (!t) return "";

    var phrase = t.match(RE_TOPIC_PHRASE);
    if (phrase && phrase[0]) return phrase[0].toLowerCase();

    /* Otherwise the longest meaningful word in the sentence. */
    var words = t.toLowerCase().match(/[a-z][a-z'\-]{2,}/g) || [];
    var best = "";
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (STOPWORDS[w] || NOT_A_NAME[w]) continue;
      if (w.length > best.length) best = w;
    }
    return best;
  }

  /* ===================================================================
     6. PART 3 — CONTINUATION WORDS
     ===================================================================
     "next" on its own means nothing to a model. This recognises the
     message as a follow-up and binds it to the previous topic.
     =================================================================== */

  var CONTINUE_WORDS = [
    "next", "then", "continue", "keep going", "go on", "go ahead",
    "proceed", "and then", "after that", "more", "another one",
    "next one", "the next", "it", "that", "this", "those", "these",
    "them", "same", "again", "same way", "how about it", "why", "how",
    "really", "and", "ok", "okay", "yes", "sure", "show me more"
  ];

  var RE_CONTINUE = new RegExp(
    "^\\s*(?:" + CONTINUE_WORDS.map(escapeRe).join("|") + ")\\b", "i"
  );

  function isContinuation(text) {
    var t = clean(text);
    if (!t) return false;
    if (!RE_CONTINUE.test(t)) return false;
    /* Short = a follow-up. A long sentence that merely starts with
       "and" is a new message, not a continuation. */
    return t.split(" ").length <= 4;
  }

  /* ===================================================================
     7. STATE
     =================================================================== */

  var state = {
    name: "",           // survives a refresh
    nameSavedAt: 0,
    topic: "",          // what we are on right now
    prevTopic: "",      // what we were on before that
    mood: "",           // how the last message sounded. One-shot.
    level: "",          // "beginner" / "advanced", sticks for the session
    turns: [],          // SHORT-TERM memory: this session only
    recent: []          // survives a refresh: [{ q, a, topic, at }]
  };

  var MAX_TURNS = 20;
  var MAX_RECENT = 6;
  var MAX_EXCERPT = 280;

  var lastQ = "";

  /* ===================================================================
     8. PART 4 — SHORT-TERM MEMORY (this chat only, never saved)
     =================================================================== */

  function pushTurn(question, answer) {
    state.turns.push({ q: clean(question), a: clean(answer) });
    if (state.turns.length > MAX_TURNS) {
      state.turns = state.turns.slice(state.turns.length - MAX_TURNS);
    }
  }

  /* ===================================================================
     9. PART 5 — PERSISTENCE (survives page refresh)
     =================================================================== */

  function load() {
    var profile = store.get("profile");
    if (profile && profile.name) {
      state.name = clean(profile.name);
      state.nameSavedAt = profile.nameSavedAt || 0;
    }

    var recent = store.get("recent");
    if (recent && Object.prototype.toString.call(recent) === "[object Array]") {
      state.recent = recent.slice(0, MAX_RECENT);
    }

    /* "Resume where we left off" after a refresh. */
    if (state.recent.length) {
      state.topic = state.recent[0].topic || "";
      state.prevTopic = state.recent[1] ? (state.recent[1].topic || "") : "";
    }
  }

  function saveProfile() {
    store.set("profile", { name: state.name, nameSavedAt: state.nameSavedAt });
  }

  function saveRecent() {
    store.set("recent", state.recent);
  }

  function rememberExchange(question, answer, topic) {
    state.recent.unshift({
      q: clean(question).slice(0, MAX_EXCERPT),
      a: clean(answer).slice(0, MAX_EXCERPT),
      topic: topic || "",
      at: Date.now()
    });
    if (state.recent.length > MAX_RECENT) {
      state.recent = state.recent.slice(0, MAX_RECENT);
    }
    saveRecent();
  }

  /* ===================================================================
     10. PART 6 — THE CONTEXT BLOCK
     ===================================================================
     This is what makes a real model feel like it remembers you. It is
     plain text prepended to the system prompt, so it already works
     with every provider already supported.
     =================================================================== */

  function buildContext() {
    var lines = [];

    if (state.name) {
      lines.push(
        "The user's name is " + state.name + " (they told you this earlier). " +
        "Use it naturally now and then, not in every single reply."
      );
    }

    if (state.topic) {
      var t = "The conversation is currently about: " + state.topic + ".";
      if (state.prevTopic) t += " Before that, it was about: " + state.prevTopic + ".";
      lines.push(t);
    }

    /* How the user is feeling right now. One-shot, so it is cleared
       after the next reply and does not stick around for ever. */
    if (state.mood) {
      lines.push(
        "The user's last message sounded " + state.mood + ". Be warm and " +
        "encouraging, keep this reply short, and do not dump a wall of code. " +
        "Suggest one small next step."
      );
    }

    if (state.level === "beginner") {
      lines.push(
        "The user is a beginner. Explain the idea in plain words before any " +
        "code, define each term the first time you use it, and prefer one small " +
        "example over a complete one."
      );
    } else if (state.level === "advanced") {
      lines.push(
        "The user is experienced. Skip the basics and be direct about tradeoffs."
      );
    }

    if (state.turns.length) {
      var brief = state.turns.slice(-4).map(function (turn, i) {
        return "  " + (i + 1) + ". User: " + turn.q + " | You: " + turn.a;
      }).join("\n");
      lines.push("What just happened in this chat:\n" + brief);
    }

    if (state.recent.length) {
      var past = state.recent.slice(0, 3).map(function (r) {
        return "  - " + (r.topic ? r.topic + ": " : "") + r.q;
      }).join("\n");
      lines.push(
        "From earlier conversations with this user. They may refer back to " +
        "these, so use them to avoid repeating yourself:\n" + past
      );
    }

    var hits = remote(lastQ);
    if (hits && hits.length) {
      lines.push("Relevant notes found in memory:\n" +
        hits.map(function (n) { return "  - " + n.text; }).join("\n"));
    }

    if (!lines.length) return "";
    return "\n\nWHAT YOU REMEMBER ABOUT THIS USER:\n" + lines.join("\n");
  }

  /* ===================================================================
     11. PUBLIC API
     -------------------------------------------------------------------
     This is all app.js is allowed to touch. Everything above stays
     private, so the internals can be rewritten any time.
     =================================================================== */

  /**
   * Read a message BEFORE it is sent.
   *   - learns the user's name
   *   - works out the topic
   *   - spots a follow-up like "next" or "it"
   *   - returns the text to actually send (original + a context note)
   */
  function ingest(text) {
    var original = clean(text);
    var result = {
      text: original,     // what actually gets sent
      learnedName: null,  // set when the name was new
      mood: "",           // how this message sounded
      level: "",          // beginner / advanced
      isFollowUp: false,
      topic: ""
    };
    if (!original) return result;

    lastQ = original;

    /* 0. how are you feeling, and how much do you already know */
    var feel = readState(original);
    if (feel.mood) {
      state.mood = feel.mood;
      result.mood = feel.mood;
    }
    if (feel.level) {
      state.level = feel.level;
      result.level = feel.level;
    }

    /* 1. learn the name */
    var found = extractName(original);
    if (found && found.name !== state.name) {
      state.name = found.name;
      state.nameSavedAt = Date.now();
      saveProfile();
      result.learnedName = found.name;
    }

    /* 2. topic */
    var topic = extractTopic(original);
    if (topic) {
      if (topic !== state.topic) {
        state.prevTopic = state.topic || state.prevTopic;
        state.topic = topic;
      }
      result.topic = topic;
    }

    /* 3. follow-up detection */
    result.isFollowUp = isContinuation(original) && !!state.topic;

    /* 4. build what we actually send */
    if (result.isFollowUp) {
      result.text = original + "\n\n" +
        "[Short follow-up from the user: \"" + original + "\". It refers to " +
        "what we were just discussing: " + state.topic +
        (state.prevTopic ? ". Earlier we covered: " + state.prevTopic : "") +
        ". Continue that thread instead of starting over.]";
    }

    return result;
  }

  /** Call once the assistant reply has finished. */
  function remember(question, answer) {
    if (!question) return;
    var topic = extractTopic(question) || state.topic;
    pushTurn(question, answer);
    rememberExchange(question, answer, topic);
    /* Mood is one-shot: it shaped the reply that just went out, so it
       should not keep colouring replies an hour later. Level sticks. */
    state.mood = "";
  }

  function init() {
    /* Short-term memory is per session by definition, so a fresh
       init() always starts with an empty head. The name and the
       recent-chats list come back from storage; the live turns do not. */
    state.turns = [];
    load();
    return api;
  }

  /** Wipe everything the brain knows. Not wired to any button yet. */
  function forget() {
    state.name = "";
    state.nameSavedAt = 0;
    state.topic = "";
    state.prevTopic = "";
    state.turns = [];
    state.recent = [];
    store.remove("profile");
    store.remove("recent");
  }

  var api = {
    /* use */
    init: init,
    ingest: ingest,
    remember: remember,
    context: buildContext,
    forget: forget,

    /* read-only, in case the UI ever shows "I know your name" */
    get name() { return state.name; },
    get topic() { return state.topic; },
    get prevTopic() { return state.prevTopic; },
    get mood() { return state.mood; },
    get level() { return state.level; },
    get recent() { return state.recent.slice(); },
    get turns() { return state.turns.slice(); },
    hasName: function () { return !!state.name; },
    isTaglish: isTaglish,

    /* internals, for tests only */
    _extractName: extractName,
    _extractTopic: extractTopic,
    _isContinuation: isContinuation,
    _readState: readState,
    _state: state,
    _store: store,
    _remote: remote
  };

  global.Brain = api;
})(window);
