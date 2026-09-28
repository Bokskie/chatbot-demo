/* ============================================================
   bokskie-v1 · engine/context.js
   ------------------------------------------------------------
   Conversation memory. Deliberately small and deliberately honest.

   What it remembers:
     - the last N turns, so a follow-up question makes sense
     - the topic we were just in, so "how about the other one?"
       does not restart from nothing
     - the last entities asked about, so "tell me more" has
       something to point at

   What it deliberately does NOT do: pretend to learn. There is no
   weight update here, no "I'll remember that" that writes nothing
   down. The only store is this object, it is inspectable, and it
   dies with the page. A memory that lies about itself is worse
   than no memory.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BokskieContext = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_TURNS = 12;
  var MAX_ENTITIES = 8;

  function Context(opts) {
    opts = opts || {};
    this.maxTurns = opts.maxTurns || MAX_TURNS;
    this.maxEntities = opts.maxEntities || MAX_ENTITIES;
    this.turns = [];
    this.entities = [];
    this.topic = null;
    this.language = null;
    this.said = [];        /* anti-repeat memory of what we answered */
    this.unknownCount = 0;
    this.userName = null;  /* learned from what they said, never asked for */
    this.nameAsked = false; /* the one-time "what should I call you?" offer */
    this.greetCount = 0;   /* how many greetings given, so they vary */
  }

  /* One turn in. Called after we know the topic, so the topic we
     were just in is available to the *next* question. */
  Context.prototype.push = function (turn) {
    this.turns.push({
      user: String(turn.user || ""),
      reply: String(turn.reply || ""),
      topic: turn.topic || null,
      intent: turn.intent || null,
      /* Which entry actually answered, and what it was about. Storing
         these is what lets "do you remember our last topic" be answered
         from the transcript instead of guessed from the shelf name: the
         shelf is "health", but the subject is "sleep", and only the
         second one answers the question the user actually asked. */
      entryId: turn.entryId || null,
      subject: turn.subject || null,
      lang: turn.language || null,
      entities: turn.entities || [],
      unknown: !!turn.unknown
    });
    if (this.turns.length > this.maxTurns) this.turns.shift();
    if (turn.topic) this.topic = turn.topic;
    if (turn.language) this.language = turn.language;
    if (turn.entities) {
      for (var i = 0; i < turn.entities.length; i++) {
        var e = turn.entities[i];
        if (!e) continue;
        var at = this.entities.indexOf(e);
        if (at !== -1) this.entities.splice(at, 1);
        this.entities.push(e);
      }
      while (this.entities.length > this.maxEntities) this.entities.shift();
    }
    if (turn.unknown) this.unknownCount++;
    return this;
  };

  /* A follow-up is a short message that leans on what came before:
     "more", "tell me about that", "and the first one". These cannot
     be understood on their own, so the previous topic has to be
     folded into the query before retrieval, not after.

     TWO conditions, and the second is the one that was missing.

     The first is length: a real question is longer than a follow-up.
     The second, which this function did not have, is that EVERY
     OTHER WORD MUST ALSO BE FILLER. Testing only the first word, and
     only the length, is what let "what is fingers" be treated as a
     follow-up: it is three words and it starts with "what", so it
     passed both tests, the previous turn's entities were folded into
     it, and the bot answered a question about fingers with the
     definition of JavaScript - confidently, and completely wrong.

     That is the worst failure this engine has, because a confident
     wrong answer is worse than a refusal. A follow-up has no subject
     of its own. "fingers" IS a subject, so this is a new question and
     the previous topic must not touch it.

     So the filler list is the union of two things: the words that
     introduce a follow-up, and the pure grammar around them. Anything
     that is neither is a new subject and ends the test. */
  Context.prototype.isFollowUp = function (words) {
    if (!this.turns.length) return false;
    if (!words || !words.length || words.length > 4) return false;
    var FOLLOWR = /^(more|and|also|what|tell|go|continue|next|why|how|really|ok|okay|sure|then|that|the|it|explain|give|about|me|us|one|two|first|second|another|so|is|are|was|were|do|does|did|can|could|would|should|of|for|on|at|to|in|this|them|those)$/;
    if (!FOLLOWR.test(words[0])) return false;
    for (var i = 1; i < words.length; i++) {
      if (!FOLLOWR.test(words[i])) return false;
    }
    return true;
  };

  /* The words worth carrying forward into the next retrieval. */
  Context.prototype.contextTokens = function () {
    if (!this.turns.length) return [];
    var last = this.turns[this.turns.length - 1];
    var out = [];
    for (var i = 0; i < last.entities.length; i++) out.push(last.entities[i]);
    return out;
  };

  /* The turn "do you remember our last topic" is asking about.

     Scans backwards, and deliberately skips turns that had no topic. A
     bare "ok thanks" after a health question must not hide the health
     question - the most recent *substantive* turn is what the user
     means by "last topic", not the most recent turn of any kind.

     The distinction matters more than it looks. Returning the greeting
     would make the engine confidently confirm that "conversation" was
     the previous topic, which is technically true of the transcript and
     completely useless as an answer. */
  Context.prototype.recalled = function () {
    for (var i = this.turns.length - 1; i >= 0; i--) {
      var t = this.turns[i];
      if (!t.topic) continue;
      return {
        topic: t.topic,
        intent: t.intent || null,
        entryId: t.entryId || null,
        /* The subject, with the shelf as a last resort. "health" is a
           category, not a subject; "sleep" is what the user recognises
           as the topic they were discussing. */
        subject: t.subject || (t.entities && t.entities.length ? t.entities[0] : null) || t.topic,
        user: t.user,
        reply: t.reply,
        lang: t.lang || null,
        at: i
      };
    }
    return null;
  };

  /* The same thing as plain data, for callers that want to inspect
     memory without rendering a sentence. Keys are named after the
     question being asked, not after the fields they happen to come
     from - this is the shape an app or a log wants to read. */
  Context.prototype.recallSnapshot = function () {
    var r = this.recalled();
    if (!r) {
      return {
        previous_topic: null,
        previous_intent: null,
        previous_entry: null,
        previous_user_message: null,
        previous_reply: null,
        turns: this.turns.length
      };
    }
    return {
      previous_topic: r.subject,
      previous_shelf: r.topic,
      previous_intent: r.intent,
      previous_entry: r.entryId,
      previous_user_message: r.user,
      previous_reply: r.reply,
      turns: this.turns.length
    };
  };

  /* ---------- the user's name ----------

     Learned, not asked for. There is no name prompt anywhere in the
     flow: if a person says "my name is Juan" or "ako si Maria" it is
     noticed, and if they never say one, the bot simply greets without
     a name. Asking for a name in order to store it would be the
     intrusive choice, and there is no version of this that is not a
     form.

     Session-scoped and honestly so. It lives in this object, which
     dies with the page, exactly like the conversation itself. It is
     not written to storage and it is not sent anywhere. */
  /* The catch-all for "what should I call you?" followed by "jz".

     Every pattern above needs the person to FRAME the name - "ako si
     jz", "my name is jz", "i am jz". A bare answer to a question the
     bot asked itself matches none of them, so the sequence went:

       Bot:  By the way, what should I call you?
       User: jz
       Bot:  That is outside what I actually know.  <- refuses

     Asking a question and then refusing the answer is the least
     coherent thing a conversational bot can do, and it happened on the
     first thing a new user is likely to do.

     `awaiting` is the bot's own question as context. When it is set,
     a short reply of bare words IS the answer, which is what a person
     means by it. The guardrails are the reason this is safe to allow:
     one or two words, letters and apostrophes only, and none of the
     words a person reaches for when they are declining - "no",
     "nothing", "maybe", "wala", "ayoko". Learning a refusal as a name
     would be worse than the original bug. */
  function bareName(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    var parts = t.split(/\s+/);
    if (parts.length < 1 || parts.length > 2) return null;
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i].replace(/[^A-Za-z\u00C0-\u024F'-]/g, "");
      if (!w || w.length < 2) return null;
      if (NOT_A_NAME[w.toLowerCase()]) return null;
      out.push(w);
    }
    var name = out.join(" ");
    return name.length > 24 ? null : name;
  }

  /* Words a person says when they are NOT giving their name. Checked
     before the bare-name path, because "no" is two letters and would
     otherwise pass every other test. */
  var DECLINING = {
    no: 1, nope: 1, nothing: 1, none: 1, maybe: 1, later: 1, skip: 1,
    wala: 1, ayoko: 1, ayaw: 1, huwag: 1, dili: 1, wa: 1, okay: 1, ok: 1,
    thanks: 1, salamat: 1, stop: 1, cancel: 1, never: 1, dont: 1, no: 1,
    na: 1, ba: 1, oo: 1, yes: 1, sige: 1, fine: 1, good: 1, bye: 1,
    whatever: 1, whatev: 1, idk: 1, dunno: 1, anonymous: 1, bot: 1,
    /* Tagalog and Cebuano filler, which is where "jz lang" went. The
       name was the first word and correct; "lang" (only/just) is the
       second, and a two-word reply was allowed through, so the whole
       thing was rejected and the user was left being refused. Adding
       the particles is the fix - they are words that can never be part
       of a name, and there are not many of them. */
    lang: 1, lamang: 1, ra: 1, gani: 1, gud: 1, unya: 1, dayon: 1,
    naman: 1, tulong: 1, din: 1, rin: 1, kaya: 1, pala: 1, talaga: 1,
    sana: 1, marami: 1, maraming: 1, pwede: 1, sana: 1, lamang: 1,
    usab: 1, gayud: 1, jud: 1, gyud: 1, bisan: 1, human: 1, ingon: 1,
    apan: 1, tanan: 1, kani: 1, ilawom: 1, ibabaw: 1, lamang: 1,
    please: 1, thanks: 1, thank: 1, sorry: 1, wait: 1, hold: 1, yo: 1
  };

  Context.prototype.learnName = function (text, awaiting) {
    var found = extractName(String(text || ""));
    if (!found && awaiting) {
      /* Filler words are DROPPED, not treated as a rejection.

         "jz lang" - jz, only - is a name with a particle hanging off
         it, and the person means "my name is jz". Failing the whole
         reply because the second word is a filler left them being
         refused, which is the bug this path exists to remove. So the
         particles go and whatever is left is the name; "no" and "wala"
         leave nothing behind and are declined that way, which is the
         same list doing one job instead of two. */
      var words = String(text || "").trim().split(/\s+/).filter(function (w) {
        var k = w.replace(/[^A-Za-z\u00C0-\u024F'-]/g, "").toLowerCase();
        return k.length > 0 && !DECLINING[k];
      });
      if (words.length >= 1 && words.length <= 2) {
        var joined = words.join(" ");
        if (!DECLINING[joined.toLowerCase()]) found = bareName(joined);
      }
    }
    if (!found) return this.userName || null;
    /* First one wins. A later "i am a developer" must not overwrite
       the name with the word "developer" - the NOT_A_NAME guard stops
       that particular one, and this stops every other later phrase. */
    if (this.userName) return this.userName;
    this.userName = found;
    return found;
  };

  /* Said the name, and wants it gone. */
  Context.prototype.forgetName = function () {
    if (!this.userName) return false;
    this.userName = null;
    return true;
  };

  /* Answerable once it is known, and an honest null before that. */
  Context.prototype.nameOf = function () { return this.userName || null; };

  /* ASKING FOR THE NAME, ONCE.

     The old comment here said that asking would be "the intrusive
     choice, and there is no version of this that is not a form" - which
     is a fair reading, and it was the right call for a bot that asked
     on the first message. It is no longer the product decision: the
     person using this asked for the bot to learn and use their name,
     and refusing to even offer is its own kind of coldness.

     What makes it bearable is the constraint it is built under. The
     ask is made at most ONCE per session, at the one moment where a
     name is natural - the greeting - and it is a question, not a form:
     the conversation carries on normally whether or not it is ever
     answered. `claimNameAsk` is the only way to get permission, so
     "ask once" is enforced by the API rather than by discipline at
     each call site. */
  Context.prototype.claimNameAsk = function () {
    if (this.nameAsked) return false;
    this.nameAsked = true;
    return true;
  };

  /* Already asked, so a call site can stay quiet without tracking it. */
  Context.prototype.hasAskedName = function () { return !!this.nameAsked; };

  /* Words that look like names in the patterns above and are not.

     The Filipino and Cebuano entries are not padding. There is a real
     collision underneath: "akong" is Tagalog for "my", and the pattern
     that reads "ako si jz" splits it as "ako" (I) + "ng" (of), which
     matches. So "unsa akong ngalan" - "what is my name" - parsed as
     "ako" + "ng" + "ngalan", and the bot confidently learned the
     user's name as "ngalan", then greeted them as "Kumusta ngalan".

     No amount of tightening the pattern fixes that on its own, because
     the ambiguity is in the language, not the regex. So the guard is
     vocabulary: a name is not a question word, not a pronoun, and not
     a particle. Anything the grammar can put where a name goes is
     rejected, which is also the honest answer to "i am a developer". */
  var NOT_A_NAME = {
    a: 1, an: 1, the: 1, not: 1, no: 1, so: 1, just: 1, still: 1, also: 1,
    trying: 1, working: 1, looking: 1, coming: 1, going: 1, doing: 1,
    fine: 1, ok: 1, okay: 1, good: 1, bad: 1, tired: 1, busy: 1, here: 1,
    developer: 1, student: 1, teacher: 1, doctor: 1, engineer: 1,
    beginner: 1, learner: 1, human: 1, bot: 1, user: 1, guy: 1, girl: 1,
    boy: 1, man: 1, woman: 1, person: 1, filipino: 1, happy: 1, sad: 1,
    angry: 1, tired: 1, ready: 1, done: 1, back: 1, really: 1, very: 1,
    /* Question words and the nouns that mean "name" in all three. */
    name: 1, ngalan: 1, ngal: 1, pangalan: 1, kinsa: 1, sino: 1,
    unsa: 1, unsaon: 1, unsang: 1, ano: 1, "kanus-a": 1, kani: 1,
    what: 1, who: 1, where: 1, when: 1, why: 1, how: 1, which: 1,
    /* Pronouns, in all three. Every one of these can legally occupy
       the slot right after "ako" or "imong", which is exactly the
       problem above. */
    ako: 1, ka: 1, ikaw: 1, kami: 1, tayo: 1, sila: 1, siya: 1,
    nako: 1, nimo: 1, niya: 1, natin: 1, nato: 1, nila: 1, niini: 1,
    nako: 1, akong: 1, imong: 1, iyang: 1, apong: 1, nang: 1,
    mo: 1, ko: 1, ba: 1, man: 1, pa: 1, daw: 1, lang: 1, gani: 1,
    gyud: 1, jud: 1, unya: 1, dayon: 1, ngayon: 1, kaniadto: 1,
    /* Adjectival and adverbial words that land right after "i am" or
       "i'm" and are never a name. This list is what makes it safe to
       accept a LOWERCASE name after "i am" - which the old pattern
       forbade by demanding a capital letter, and which meant "i am jz"
       taught the bot nothing while "i am JZ" worked.

       Capitalising the first letter is a weak guard anyway: it stops
       "i am tired" and nothing else, because "i am Filipino" and
       "i am twenty" are both capitalised and both wrong. A vocabulary
       guard is the honest version of the same protection, and it is
       also the one that works in three languages. */
    free: 1, sick: 1, bored: 1, confused: 1, scared: 1, alone: 1,
    there: 1, early: 1, late: 1, now: 1, then: 1, always: 1, never: 1,
    sometimes: 1, often: 1, sure: 1, certain: 1, willing: 1, able: 1,
    excited: 1, stressed: 1, worried: 1, hungry: 1, full: 1, sleepy: 1,
    awake: 1, alive: 1, right: 1, wrong: 1, true: 1, false: 1, same: 1,
    different: 1, better: 1, worse: 1, best: 1, worst: 1, new: 1,
    old: 1, young: 1, quite: 1, too: 1, only: 1, even: 1, about: 1,
    almost: 1, nearly: 1, maybe: 1, probably: 1, actually: 1, sorry: 1,
    glad: 1, afraid: 1, lost: 1, stuck: 1, done: 1, gone: 1, sure: 1,
    /* Numbers, in words. "i am twenty" is the obvious false positive
       once lowercase is allowed, and it is not exotic. */
    one: 1, two: 1, three: 1, four: 1, five: 1, six: 1, seven: 1,
    eight: 1, nine: 1, ten: 1, eleven: 1, twelve: 1, twenty: 1,
    thirty: 1, forty: 1, fifty: 1, hundred: 1, thousand: 1, first: 1,
    last: 1, next: 1, second: 1, third: 1
  };

  function cleanName(raw) {
    if (!raw) return null;
    var parts = String(raw).trim().split(/\s+/).slice(0, 2);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i].replace(/[^A-Za-z\u00C0-\u024F'-]/g, "");
      if (!w || w.length < 2) continue;
      if (NOT_A_NAME[w.toLowerCase()]) return null;
      out.push(w);
    }
    if (!out.length) return null;
    var name = out.join(" ");
    return name.length > 24 ? null : name;
  }

  /* Patterns that actually introduce a name, in three languages.
     Deliberately narrow - the NOT_A_NAME guard is what stops "i am a
     developer" from teaching the bot to call everyone "Developer". */
  function extractName(text) {
    var t = String(text || "");
    var patterns = [
      /\bmy name(?:'s| is)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\bcall me\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /* Apostrophe optional, and lowercase allowed.

         "im jz" is how people type on a phone keyboard - the apostrophe
         is three taps away on most layouts and everyone skips it. The
         old pattern wanted "i'm" or "i am" and nothing else, so the
         bot learned the name from "i am jz" and sat there not knowing
         it from "im jz", in the same conversation.

         `im` on its own is not an English word, so there is nothing
         here to collide with, and the two-word form "i m" is there for
         the same reason. The guard against "i mean", "i might" and
         "i must" is the NOT_A_NAME list, not the pattern. */
      /\b(?:i'?m|im|i m|i am)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\bthis is\s+([A-Z][A-Za-z\u00C0-\u024F' -]{0,22})/,
      /\bako(?:ng| si)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\bnag[- ]ako(?:ng| si)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\baka(?:ng| si)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\bgit(?:a| akong) ngalan\s+(?:ako|niya|ng)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /* "aking ngalan si jz" / "akong ngalan si jz" / "imong ngalan si
         jz". These are the ordinary way to say your own name in all
         three languages and none of them matched anything above, so
         "aking ngalan si Juan" - a person plainly telling the bot
         their name - taught it nothing and it went on not knowing.

         The one Cebuano pattern above only covered "gita ngalan
         nako X", which is a much less common shape than the Tagalog
         "si" form that Cebuano also uses. */
      /\b(?:aking|akong|aking|iyong|imong|a[pn]ong)\s+ngalan\s+(?:ako|niya|nato|natin|nimo|ko|mo)\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /\b(?:aking|akong|imong|iyong)\s+ngalan\s+(?:niya\s+)?si\s+([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /* "kingalan nako si jz", "unsa ngal nako - jz". */
      /\bkingalan\s+(?:nako|ko|nimo|mo|natong|natin)\s+(?:si\s+)?([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i,
      /* "my name is" with the possessive already stripped, e.g.
         "name's jz". The "my" form is handled by pattern 1. */
      /\bpangalan\s+ko\s+(?:ay\s+)?([A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,22})/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(t);
      if (!m) continue;
      /* Stop at a sentence boundary, so "my name is Juan. How are you"
         does not try to learn "Juan How Are You". */
      var name = cleanName(m[1].split(/[.?!,;]/)[0]);
      if (name) return name;
    }
    return null;
  }

  /* Anti-repeat, same idea as the old composer: remember what we just
     said so the next answer is not the same answer. */
  Context.prototype.rememberSaid = function (text) {
    var t = String(text || "");
    if (t) this.said.push(t);
    while (this.said.length > 10) this.said.shift();
  };

  Context.prototype.saidRecently = function (text) {
    return this.said.indexOf(String(text || "")) !== -1;
  };

  /* Did we already tell them we do not know? If so, do not keep
     saying it - offer the honest next step instead. */
  Context.prototype.beenIgnorant = function () {
    return this.unknownCount > 0;
  };

  Context.prototype.reset = function () {
    this.turns = [];
    this.entities = [];
    this.topic = null;
    this.language = null;
    this.said = [];
    this.unknownCount = 0;
    this.greetCount = 0;
    /* The name goes with the rest. It was learned from this
       conversation, so it should not outlive it - and a shared screen
       should not greet the next person by name. */
    this.userName = null;
    /* The offer to be told a name goes with it. A reset is a new
       conversation with a new person, and "ask once per session" has
       to mean once per session, not once per process - otherwise a
       shared screen asks a stranger who already declined. */
    this.nameAsked = false;
    return this;
  };

  Context.prototype.snapshot = function () {
    return {
      turns: this.turns.length,
      topic: this.topic,
      language: this.language,
      entities: this.entities.slice(),
      unknowns: this.unknownCount
    };
  };

  return { Context: Context, MAX_TURNS: MAX_TURNS };
});
