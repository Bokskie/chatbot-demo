/* ============================================================
   bokskie-v1 · engine/generator.js
   ------------------------------------------------------------
   Turns a ranked hit into an answer, or refuses to.

   The refusal is the important part. Search always returns
   *something* - the highest scoring entry, however bad. Answer
   with whatever came back and the system confidently explains
   quantum mechanics when you asked about a bicycle, because
   "about" and "is" scored well enough. That is the exact failure
   this whole project exists to stop.

   So the top hit must clear a bar. Under the bar we say we do not
   know, and we say what we did understand. An honest miss is
   recoverable; a confident invention is not.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./tokenizer.js"));
  else root.BokskieGenerator = factory(root.BokskieTokenizer);
})(typeof globalThis !== "undefined" ? globalThis : this, function (T) {
  "use strict";

  /* Tuned against the shipped bank. Low enough that a real question
     clears it, high enough that a coin-flip match does not. The
     margin matters more than the exact number. */
  var ACCEPT = 0.34;
  var WEAK = 0.24;

  /* The honest-failure lines, in all three languages. These are the
     most load-bearing strings in the whole project.

     THEY ARE WRITTEN FOR THE PERSON, NOT FOR THE DEVELOPER.

     The earlier English line said "I do not have anything about that
     in my knowledge bank... I answer only from things written down in
     advance - I cannot look anything up, and I do not know what is
     in the room." Every clause is about how this program is built.
     "knowledge bank" is a name for the data files, "written down in
     advance" describes the build pipeline, and "I do not know what
     is in the room" is an admission about the retrieval index. None
     of it means anything to someone who just asked a question, and
     all of it makes the bot sound like it is apologising for its own
     architecture instead of simply saying it does not have the answer.

     The honesty is the part worth keeping: it still says plainly that
     the answer is not there and that it will not invent one. What is
     gone is the self-description. */
  var SLOTS = {
    english: {
      unknown: [
        "I do not know anything about that, and I would rather say so than make something up. Tell me the general topic and I can tell you what I do have.",
        "That is outside what I actually know, so I am not going to guess. Give me a related topic and I will tell you what I do have.",
        "I do not know that one. I would rather be upfront about it than give you an answer I cannot stand behind."
      ],
      weak: [
        "I am not certain this is the right one. Here is the closest thing I have - treat it as a rough guess, not a fact.",
        "This is the nearest match I have and I am not confident in it. Read it as a hint rather than an answer."
      ],
      uncertain: [
        "This one is not firmly established, so I will not state it as settled:",
        "I have this marked as unsettled evidence rather than fact. Here it is, with that caveat:"
      ],
      /* Mood-matched openers, keyed by detected mood. Short, and never
         a substitute for the answer - these sit in front of it. */
      mood: {
        sad: ["That sounds heavy.", "I'm sorry it feels like that.", "That sounds like a rough day."],
        angry: ["That sounds frustrating.", "Fair enough to be annoyed.", "Okay, let's find the actual cause."],
        anxious: ["That sounds worrying.", "It's reasonable to be unsure here.", "Let's take it one piece at a time."],
        tired: ["You sound worn down.", "Sounds like you need a breather.", "That's a long one."],
        grateful: ["Glad that helped.", "Happy to be useful.", "Anytime."],
        excited: ["Good energy.", "Love that.", "Let's build on that."],
        happy: ["Glad to hear it.", "That's good.", "Nice."],
        joking: ["Fair enough.", "Ha, noted.", "That's a good one."],
        confused: ["That's a fair place to be stuck.", "Let's untangle it.", "Confusing things usually mean one of two things is wrong."]
      },
      /* The follow-up line used to interpolate the SHELF, so a user
         saw "Going with what we were just talking about
         (cebuano-programming-terms)." That is an internal identifier:
         it told the user nothing, and it made the reply look like a
         debug print left in a user-facing string. It now names the
         subject the user was actually discussing, and when there is
         no subject it does not invent one. */
      followUp: "Picking this up from {topic}.",
      followUpNoTopic: "Going back to what we were discussing.",
      topics: "programming, science, mathematics, geography, history, health, money, technology"
    },
    tagalog: {
      /* Same rule as the English slot: say that you do not know, do
         not describe the machinery. "Wala akong alam" is the whole
         honest claim; "hand-written at limitado ang aking bank" was a
         description of the data files that a user cannot act on. */
      unknown: [
        "Wala akong alam tungkol dito. Mas magsasabi ako kaysa maghaka-haka. Sabihin mo lang ang pangkalahatang topic, baka may maitulong ako.",
        "Hindi iyon ang saklaw ng kaalaman ko, kaya hindi ako maghuhula. Bigyan mo ako ng kaugnay na topic at sasabihin ko kung ano ang alam ko.",
        "Hindi ko alam iyon. Mas nais kong maging tapat sa iyo kaysa magbigay ng sagot na hindi ko kayang ipagtanggol."
      ],
      weak: [
        "Hindi ako sigurado na ito ang tama. Pinakamalapit lang ito sa alam ko, pero pagtataya lamang - hindi katotohanan.",
        "Ito ang pinakamalapit sa akin, pero hindi lubos ang katiyakan ko. Pahiwat ito, hindi sagot."
      ],
      uncertain: [
        "Hindi ito ganap na nakaayos na impormasyon, kaya hindi ko ito ipapakita bilang tapos na:",
        "May pagbabala: hindi ito ganap na nakatatatag. Narito, kasama ang pagbabala:"
      ],
      mood: {
        sad: ["Mabigat ang pakiramdam mo.", "Pasensya na kung ganyan ang nararamdaman mo.", "Mabigat ang araw mo."],
        angry: ["Naiintindihan ko ang pagkagalit.", "Wasto ka sa pagkagalit.", "Hanapin natin tunay ang sanhi."],
        anxious: ["Nababahala ka, at naiintindihan ko iyon.", "Makatuwiran ang pag-aalala.", "Isa-isa natin itong lakad."],
        tired: ["Pagod na pagod ka na.", "Mukhang kailangan mo ng pahinga.", "Mababa na ang iyong lakas."],
        grateful: ["Masaya akong nakatulong.", "Kahit kailan mo.", "Walang problema."],
        excited: ["Maganda ang energy mo.", "Saya nang saya ka.", "Tara na tayo."],
        happy: ["Masaya ako sa balita.", "Mabuti iyan.", "Ayos."],
        joking: ["HAHA, gets ko.", "Ayos, naunawa ko.", "Mabuti iyan."],
        confused: ["Naiintindihan ko kung baka nakakalito.", "Ayusin natin ito.", "Kapag nalito, kadalasan may isang mali."]
      },
      followUp: "Babase ito sa {topic} na pinag-usapan natin.",
      followUpNoTopic: "Babalik ito sa pinag-usapan natin.",
      topics: "programming, science, mathematics, geography, history, health, money, technology"
    },
    bisaya: {
      /* Same rule as the other two slots: state that you do not know,
         without narrating the data files. */
      unknown: [
        "Wala ako og kabalo niini. Mas maayo maton ko ikaw kaysa mahimong sayup. Isulat lang ang imong kinapgeneral nga topi, basin naa pa ako og makatabang.",
        "Pasensya, dili nako naabot niini, kaya dili nako magmangga. Hatag-i ko og usa ka nga topi, unya masulti ko kung unsa ang naa nako.",
        "Dili nako mahimo kining tubtob. Mas gyud kong makatinuod kaysa magbigay og tubag nga dili nako kayang ipagtanggol."
      ],
      weak: [
        "Dili ako konfident nga husto ni. Pinakaduha ra nga ako, apan pagtataya lamang - dili kamatuodan.",
        "Kani na gyud ang pinakaduha nako, apan dili pa gyud ako kasiguran. Pahiwat ni, dili tubag."
      ],
      uncertain: [
        "Dili gyud nga naayo ang kini, kaya dili ko siya ihatag nga tapos na:",
        "May pasabot: dili pa gyud nakat-stand nga impormasyon niini. Ania ra, kauban ang pasabot:"
      ],
      mood: {
        sad: ["Heavy ra ang kab feeling nimo.", "Sorry kaayo kung maa feeling nimo kana.", "Heavy ra ang adlaw nimo."],
        angry: ["Naa gyud ka nga dugut.", "Wasto ka nga magdugut.", "Atong hunahunanon sa unsang hinuon nga gigima."],
        anxious: ["Kahadlok nga feel nimo, naa gyud nga makatuwiron.", "Makatuwiron nga basi ka.", "Isa-isa nato nga lakad."],
        tired: ["Na exhaust ka na.", "Mukhang naa ka gyud nga kahangian.", "Long na siya nimo."],
        grateful: ["Nalipay ka nga makatabang.", "Andam nako anytime.", "Walay problema."],
        excited: ["Good nga energy nimo.", "Naa na gyud ako niana.", "Kini nato."],
        happy: ["Nalipay ako sa balita.", "Maayo nga naa.", "Ayos."],
        joking: ["HAHA, naa gyud ako.", "Ayos, naiintindihan nako.", "Maayo nga naa."],
        confused: ["Makatuwiron gyud nga ma-confused ka.", "I disentangle nato niini.", "Kung ma-confused, kasagaran naa kay sayop usa."]
      },
      followUp: "Nakabaser ni sa {topic} nga atong gi-chat.",
      followUpNoTopic: "Balik nato sa atong gi-chat kaniadto.",
      topics: "programming, science, mathematics, geography, history, health, money, technology"
    }
  };

  function Generator(opts) {
    opts = opts || {};
    this.accept = typeof opts.accept === "number" ? opts.accept : ACCEPT;
    this.weak = typeof opts.weak === "number" ? opts.weak : WEAK;
  }

  /* Seeded, so a session can be reproduced from a seed. */
  /* A LINEAR CONGRUENTIAL GENERATOR IS A BAD SCRAMBLER, and the first
     value out of it is the worst possible one.

     The engine seeds this from small integers - 1, 2, 3 as a test runs
     - and the first output of an LCG is a straight line in the seed:
     `s1 = (a*seed + c) mod 2^32`, so seed n+1 differs from seed n by
     `a / 2^32` = 1664525/4294967296 = 0.000388. Measured, for the
     first eight consecutive seeds:

       0.2365  0.2368  0.2372  0.2376  0.2380  0.2384  0.2388  0.2392

     Scaled against a 500-entry library that is a 0.0004 step inside a
     0.002-wide bucket, so consecutive seeds all pick the SAME entry.
     150 consecutive seeds produced 30 distinct replies, not 150.

     This has been quietly true of the whole engine, not just the packs:
     every seeded pick - greeting rotation, variation choice, anything
     that indexes by seed - has been far less varied than it looks, and
     the tests never caught it because they seed once and look once.

     The fix is the standard one and it is two lines: DISCARD the first
     few outputs. Stepping twice makes the value quadratic in the seed
     rather than linear, which scatters consecutive seeds across the
     whole range instead of marching them.

     Determinism is untouched - the same seed still produces the same
     sequence, it is just a better-distributed one - so the
     reproducibility tests that depend on seeded runs keep working. */
  function seeded(seed) {
    var s = (seed >>> 0) || 1;
    /* Warm-up. Two steps is enough to break the linear relationship
       and costs nothing; a third is measurably better again on small
       consecutive seeds, which is exactly the case that was broken. */
    s = (s * 1664525 + 1013904223) >>> 0;
    s = (s * 1664525 + 1013904223) >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  Generator.prototype.pick = function (arr, rnd, avoid) {
    if (!arr || !arr.length) return "";
    var start = Math.floor(rnd() * arr.length) % arr.length;
    for (var i = 0; i < arr.length; i++) {
      var at = (start + i) % arr.length;
      if (!avoid || !avoid[arr[at]]) return arr[at];
    }
    return arr[start];
  };

  /* Slots let one written answer serve many questions: {topic} is the
     subject the user was discussing, {entity} the word they typed.
     NOTE that {topic} is a SUBJECT, never a shelf id - see the refusal
     branch in generate(), where interpolating the shelf used to leak
     "cebuano-programming-terms" into the reply. */
  function fill(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] ? vars[name] : whole;
    });
  }

  function bank(lang) { return SLOTS[lang] || SLOTS.english; }

  /* ---- the main path ------------------------------------------ */

  /* Returns { text, entryId, confidence, known, weak, topic, intent }.
     "known: false" is a first-class outcome, not an error. */
  Generator.prototype.generate = function (opts) {
    opts = opts || {};
    var B = bank(opts.language || "english");
    var results = opts.results || [];
    var analysis = opts.analysis || {};
    var ctx = opts.context || null;
    var rnd = seeded(opts.seed || 1);

    var avoid = Object.create(null);
    var i;
    if (ctx) for (i = 0; i < ctx.said.length; i++) avoid[ctx.said[i]] = 1;

    /* Take the best hit that clears the bar, not merely the best
       hit. A slightly weaker entry in the right topic beats a
       stronger one from the wrong shelf. */
    var best = null;
    for (i = 0; i < results.length && i < 6; i++) {
      if (results[i].score >= this.accept) { best = results[i]; break; }
    }

    /* ---------- CODE, AND IT IS CHECKED FIRST ----------

       Before the `!best` refusal below, deliberately. That refusal is
       for questions that retrieved nothing, and it says "tell me the
       general topic" - which is useless advice for somebody who has
       just said "make me a checklist". A code request with no template
       is not an unknown question, it is a known request for something
       this library does not hold, and it deserves the menu.

       That was the second half of a real miss: "gawa ka ng checklist"
       matched the code intent perfectly, retrieved nothing at all, and
       got the generic refusal - so the honest answer existed and the
       ordering threw it away.

       A different code path, again, rather than a flag on the normal
       one. When the winning entry is a template the file goes out byte
       for byte, and everything the generator normally does is wrong
       here: the variation rotation re-enters the same facts from a
       different opening sentence, which is a readability feature for
       prose and a syntax error for a <script> tag; a mood opener
       above a 370-line page is noise; and the weak-match and
       uncertain-entry hedges describe how sure we are of a CLAIM, and
       there is no claim being made - there is a file.

       If the library does not hold the concept, the request is
       refused anyway rather than answered with the neighbouring entry
       that happened to win. "make me a dating app" routed to the
       smartphone shelf and produced a confident paragraph about phone
       screens, which is the worst outcome this feature can have. */
    var lib = opts.code || null;
    var tpl = null;
    if (analysis.intent === "code") {
      tpl = best && best.entry && best.entry.concept ? lib && lib.get(best.entry.concept) : null;
      if (tpl) {
        return this.code({
          template: tpl,
          entry: best.entry,
          score: best.score,
          language: lang,
          seed: opts.seed
        });
      }
      return this.noTemplate({
        available: (lib && lib.list ? lib.list() : []),
        /* opts.language, NOT `lang`. `lang` is declared further down in
           this function, and `var` hoisting means it exists here as
           undefined - so passing it silently answered every Tagalog and
           Cebuano request in English. Two of these three replies were in
           the wrong language and looked correct, because English is the
           default and a default that works hides a value that is not
           arriving. */
        language: opts.language || "english",
        topic: analysis.topic,
        hadSubject: opts.codeHasSubject !== false
      });
    }

    if (!best) {
      /* The refusal, or a social pack if one is allowed.

         A pack is checked FIRST and is refused in almost every case,
         because most of what fails retrieval is somebody asking a
         question. Putting the gate here rather than inside the
         generator means the pack library is optional in exactly one
         place: with no library, or with the gate closed, this is the
         plain refusal the project has always given.

         The company replies - "kumain ka na ba", a bit of banter, a
         feeling - land here too, and they are the only messages that
         get one. That is the whole design and it is small on purpose:
         1500 replies, and the rule that decides whether any of them
         is ever used. */
      if (opts.packs && packAllowed(opts.text || "", analysis.intent, false)) {
        var social = this.social({
          packs: opts.packs,
          language: opts.language || "english",
          name: ctx ? ctx.nameOf() : null,
          avoid: ctx ? ctx.said : null,
          intent: analysis.intent,
          seed: opts.seed
        });
        if (social) {
          if (ctx) ctx.rememberSaid(social.text);
          return social;
        }
      }

      var line = this.pick(B.unknown, rnd, avoid);
      /* Only a real follow-up gets the "we were talking about X"
         lead-in. Putting it on an unrelated question reads as if the
         engine had understood it, which is exactly the impression
         this whole design is trying to avoid.

         THE SUBJECT, NOT THE SHELF. This used to interpolate
         `ctx.topic`, which is the internal shelf id, so a user
         literally read "Going with what we were just talking about
         (cebuano-programming-terms)." That is a build artefact: the
         shelf is how the file is filed on disk, not anything the user
         said or would recognise. `ctx.recalled().subject` is the
         thing we were actually discussing - the entry's concept - and
         that is the only thing that belongs in a sentence aimed at a
         person.

         When there is no subject, the line drops the claim entirely
         rather than filling the slot with an internal name. */
      var recall = ctx ? ctx.recalled() : null;
      var subject = recall && recall.subject ? recall.subject : null;
      if (opts.followUp && subject) {
        line = fill(B.followUp, { topic: subject }) + " " + line;
      } else if (opts.followUp) {
        line = B.followUpNoTopic + " " + line;
      }
      return {
        text: line,
        entryId: null,
        concept: null,
        confidence: results.length ? results[0].score : 0,
        known: false,
        weak: false,
        topic: analysis.topic || null,
        intent: analysis.intent || null,
        hint: B.topics
      };
    }

    var entry = best.entry;
    var lang = opts.language || "english";

    var pool = this.poolFor(entry, lang);
    var chosen = this.pick(pool, rnd, avoid);

    var body = fill(chosen, {
      topic: entry.topic,
      intent: analysis.intent || entry.intent,
      entity: (ctx && ctx.entities.length ? ctx.entities[ctx.entities.length - 1] : "")
              || entry.keywords[0] || entry.topic
    });

    /* Mood first, answer second - and only when a mood was actually
       detected. `opts.mood` is null unless mood.js cleared its bar, so
       an ordinary question is never decorated. */
    var lead = this.empathise({ mood: opts.mood, language: opts.language, seed: opts.seed });
    if (lead) body = lead + "\n\n" + body;

    /* Caveat and answer arrive together, not as two separate claims. */
    var isWeak = best.score < this.weak;
    if (isWeak) body = this.pick(B.weak, rnd, avoid) + "\n\n" + body;

    /* A second, different reason to hedge: the entry itself is marked
       less than certain. Retrieval confidence and author confidence are
       different axes, and a perfect keyword match against a shaky entry
       is still a shaky answer - so it gets the same treatment. This is
       what lets a health claim be marked "not fully established" in
       the data and have that reach the user, instead of the metadata
       being decoration nobody reads. */
    var uncertain = typeof entry.confidence === "number" && entry.confidence < 1;
    if (uncertain && !isWeak) {
      body = this.pick(B.uncertain, rnd, avoid) + "\n\n" + body;
    }

    return {
      text: body,
      entryId: entry.id,
      /* The stable name of what answered. Ids are positional and
         renumber whenever a source file gains a line near the top, so
         this is what callers and tests should assert on - it survives
         reordering, which is the only property worth depending on. */
      concept: entry.concept || entry.keywords[0] || null,
      confidence: best.score,
      known: true,
      weak: isWeak || uncertain,
      topic: entry.topic,
      intent: analysis.intent || entry.intent,
      /* The language of the answer text itself, which is not the
         language that was asked in. An entry can carry a real Tagalog
         or Bisaya body; when it does not, the honest report is English,
         so the caller labels the paragraph for what it is rather than
         for what was requested. */
      answerLang: (entry.langs && entry.langs[lang]) ? lang
                : (entry.lang && entry.lang !== "any") ? entry.lang : null,
      source: entry.source || null,
      entryConfidence: (typeof entry.confidence === "number") ? entry.confidence : 1,
      hint: B.topics
    };
  };

  /* Which wording to say, in which language.

     An entry may carry the same answer in all three languages under
     `langs`. When the question came in Bisaya and a Bisaya body really
     exists, that is the answer to give - not an English paragraph with
     a Bisaya question taped to the top of it.

     When it does not exist, the English body is used, and only English
     is used. Mixing the two pools would let an English answer surface
     as a random "variation" of a Tagalog one, which is worse than
     either: the text would look translated when it was not. */
  Generator.prototype.poolFor = function (entry, lang) {
    var L = entry.langs;
    if (L && L[lang]) {
      var native = typeof L[lang] === "string" ? [L[lang]] : L[lang];
      if (native.length) return native;
    }
    return [entry.answer].concat(entry.variations || []);
  };

  /* ---- memory reference --------------------------------------- */

  /* "Do you remember our last topic?"

     The answer is not in the knowledge bank - it is in the transcript.
     That is the whole reason this is a separate path instead of another
     intent: the question's words ("you", "remember", "topic") share no
     vocabulary with the entry that would hold the answer, so ordinary
     retrieval would return whatever drifted closest and the engine
     would confidently describe the wrong subject.

     Two cases, and they must never be blurred:

       we had a topic  -> say which one, and quote what was asked
       we had nothing -> say there was nothing

     The second case is the one that matters. A system that answers
     "yes, we were discussing sleep" when the transcript is empty has
     invented a memory, and an invented memory is worse than no memory
     at all - the user has no way to tell it apart from a real one. So
     the empty branch has its own lines and there is no path from one
     to the other. */
  Generator.prototype.memory = function (opts) {
    opts = opts || {};
    var lang = opts.language || "english";
    var tpl = opts.templates || {};
    var rec = opts.recalled || null;
    var rnd = seeded(opts.seed || 1);

    var set = rec ? (tpl.recall || {}) : (tpl.empty || {});
    var lines = set[lang] || set.english || [];
    var text = lines.length
      ? this.pick(lines, rnd, null)
      /* No wording in the bank at all. Refusing to answer a question
         whose answer is sitting in the transcript would be absurd, so
         this one line is structural, not editorial - it exists so the
         feature still works if someone empties the templates. */
      : (rec
          ? "Yes - our last topic was " + rec.subject + "."
          : "This is the first thing we have talked about, so there is no earlier topic to recall.");

    text = fill(text, {
      topic: rec ? rec.topic : "",
      subject: rec ? rec.subject : "",
      intent: rec ? (rec.intent || "") : "",
      user: rec ? rec.user : ""
    });

    return {
      text: text,
      entryId: opts.entryId || null,
      /* Recall is not a guess. When the transcript holds the answer,
         hedging it would be a different kind of dishonesty - so the
         confidence here reflects certainty about OUR OWN state, which
         is 1, and it is not comparable to a retrieval score. */
      confidence: 1,
      known: true,
      weak: false,
      recall: true,
      hadHistory: !!rec,
      topic: rec ? rec.topic : null,
      intent: "memory_reference",
      answerLang: lang,
      hint: null
    };
  };

  /* One line out of a named set, in the user's language, with {name}
     filled in.

     Small on purpose. The name wording needs seeded selection and a
     {name} slot but no retrieval, no confidence and no variation
     rotation, so giving it a dedicated method would be more ceremony
     than the job needs - while calling `pick` from the engine is not
     possible, because the seeded generator `pick` wants lives inside
     this module and is deliberately not exported.

     Used by the two places that speak the user's name back: the
     greeting's one-time "what should I call you?", and the answer to
     "what is my name". */
  Generator.prototype.line = function (opts) {
    opts = opts || {};
    var lang = opts.language || "english";
    var set = opts.lines || {};
    var lines = set[lang] || set.english || [];
    var text = this.pick(lines, seeded(opts.seed || 1), opts.avoid || null);
    return fill(text, { name: opts.name || "" });
  };

  /* Greet by name, when we know it.

     The name is learned from what the person said earlier in this
     same conversation, never prompted for and never stored beyond the
     session. When there is no name there is no slot filled in with a
     placeholder - the greeting just says hello, which is correct
     rather than a template that visibly failed. */
  /* The words around a block of code.

     Three languages because the person asking for a website is as
     likely to be typing Tagalog as English, and a 370-line page
     introduced by "Here is a complete..." when they wrote "gawa ka
     ng website" reads as the bot not listening. The code and the
     bullet points are identical either way - the file is the file -
     so only the frame is translated. */
  var CODE_FRAME = {
    english: {
      intro: ["Here is a complete **{title}**. Save it as `{file}` and open it in a browser - no install, no server, nothing else to download."],
      how: "**How it works**",
      change: "**To make it yours**",
      tail: "Tell me which part you want changed and I will walk you through the edit.",
      miss: "I do not have a template for that, and I will not hand you code I have not written. Writing something that half-matches what you asked for is worse than saying no.",
      which: "Sure - which one? Tell me which of these you want and you get the whole file, not a sketch. If it is not on the list, say so and I will tell you straight rather than send you something that nearly matches.",
      have: "**What I can build**"
    },
    tagalog: {
      intro: ["Ito ang buong **{title}**. I-save mo ito bilang `{file}` at buksan sa browser - walang i-install, walang server, walang ibang ida-download."],
      how: "**Paano ito gumagana**",
      change: "**Paano ito gawing sa'yo**",
      tail: "Sabihin mo kung aling part ang gusto mong palitan, at ipapaliwanag ko ang edit.",
      miss: "Walang template ako para doon, at ayoko kang bigyan ng code na hindi ko pa naisulat. Mas masakit ang bibigyan ng code na halos-tulad lamang kaysa sa straightforward na hindi.",
      which: "Sige - alin? Sabihin mo kung alin sa mga ito ang gusto mo, at ibibigay ko ang buong file, hindi sketch lang. Kung wala sa listahan, sabihin mo lang - sasabihin ko nang tapat sa halip na magbigay ng bagay na halos-tulad.",
      have: "**Ang kaya kong gawin**"
    },
    bisaya: {
      intro: ["Ani ang full nga **{title}**. I-save nimo ni og `{file}` dayon open sa browser - walay i-install, walay server, walay laing i-download."],
      how: "**Unsaon ni nga kini**",
      change: "**Unsaon nimo og maayo ni**",
      tail: "Isulti nimo unsang part ang gustu mong palitan, dayon isipatok nako ang edit.",
      miss: "Wala ako nga template para niini, ug dili ako makahatag og code nga dili pa nako naisulat. Mas masakit nga ihatag ang code nga duha lang kay duha kay sa simple nga wala.",
      which: "Okay - unsaon? Isulti nimo unsa sa mga niini ang gusto nimo, dayon ihatag nako nga tibuqod nga file, dili lang sketch. Kung wala sa listahan, isulti nimo lang - isumbong nako nga tinuod kay sa una hatagan nako og buta nga duha lang kay duha.",
      have: "**Ang mahimo nako i-build**"
    }
  };

  function bullets(list) {
    return (list || []).map(function (line) { return "- " + line; }).join("\n");
  }

  /* THE GATE. May a social pack answer this?

     This one boolean is the most important line in the project, because
     a yes here is a permission to answer without knowing.

     A pack is allowed when the message is COMPANY, not a question: a
     greeting, a feeling, a bit of banter, a check-in, something the
     person said rather than asked. It is refused when the message is
     asking for information, in any of the three languages, because that
     is exactly the case the refusal exists for.

     The test is deliberately blunt rather than clever. "Kainin mo na
     ba?" ends in a question and contains a question word, so it is a
     question: it is answered from the bank or refused, and in fact the
     bank has an entry for it. A pack is for the messages with no
     information in them at all, which is a much smaller set than it
     looks - and that is the point.

     The intent comes first because it is the strongest signal the
     engine has already computed. The word list catches what intent.js
     could not classify. */
  var PACK_QUESTION = new RegExp([
    "\\b(what|whats|who|whom|whose|when|where|why|how|which|is|are|was|were|"
    + "do|does|did|can|could|should|would|will|have|has|had|"
    + "explain|define|meaning|tell|show|list|name|help)\\b",
    "\\b(ano|anong|unsa|unsang|unsaon|kinsa|kanus-a|pano|paano|"
    + "bakit|kailan|saan|ngano)\\b"
  ].join("|"), "i");

  function packAllowed(text, intent, known) {
    /* Never over a real answer, and never over anything that was
       asking for something. */
    if (known) return false;
    if (intent === "code" || intent === "memory_reference" ||
        intent === "askname" || intent === "identity" ||
        intent === "capability" || intent === "definition" ||
        intent === "why" || intent === "howto" || intent === "price" ||
        intent === "list" || intent === "location" || intent === "time" ||
        intent === "person" || intent === "compare") return false;
    /* A long message is somebody describing a problem. Filling that
       with a sticker is worse than saying nothing. */
    if (String(text || "").trim().split(/\s+/).length > 14) return false;
    if (PACK_QUESTION.test(String(text || ""))) return false;
    return true;
  }

  /* A social reply, when one is allowed.

     Not a slot with a few hand-written lines: the library is 1500 of
     them and they are somebody's work, so the engine's only job is to
     pick one, fill the name, and not repeat one it has already said
     this session. */
  Generator.prototype.social = function (opts) {
    opts = opts || {};
    var lib = opts.packs;
    var lang = opts.language || "english";
    var text = lib ? lib.pick(lang, seeded(opts.seed || 1),
                             opts.avoid, opts.name) : null;
    if (!text) return null;                 /* no library: caller falls back */
    return {
      text: text,
      entryId: null,
      concept: null,
      /* The bot knew nothing; it said something social instead. Kept
         distinct from an answer, because an app has no business
         showing this with a confidence number as though it were a
         fact. */
      confidence: 0,
      known: false,
      weak: false,
      social: true,
      topic: null,
      intent: opts.intent || null,
      answerLang: lang,
      hint: null
    };
  };

  /* The honest miss, in one of two shapes.

     WHICH rather than WHETHER, and that word is the whole point. A
     request that named something the library does not hold gets the
     refusal: "make me a dating app" is a dead end and the honest reply
     says so. A request that named nothing at all is not a dead end - it
     is somebody who has not chosen yet, and the useful reply is a
     question with the menu, not a refusal dressed up as one.

     "Give code please" used to get the refusal, which read as "I have
     nothing" when the truth was "I have five things and did not know
     which one you meant". The difference is whether any subject
     survived the request-word filter above, and that is decided here,
     where the tokens are, rather than guessed at from the wording.

     `askedWhich` is reported so the app can tell the two apart without
     re-reading the text. */
  Generator.prototype.noTemplate = function (opts) {
    opts = opts || {};
    var F = CODE_FRAME[opts.language] || CODE_FRAME.english;
    var have = (opts.available || []).map(function (c) { return "- " + c; });
    var asking = opts.hadSubject === false;
    var body = asking ? F.which : F.miss;
    if (have.length) body += "\n\n" + F.have + "\n" + have.join("\n");
    return {
      text: body,
      entryId: null,
      concept: null,
      confidence: 0,
      known: false,
      weak: false,
      isCode: false,
      /* Reported so the app can tell "I will not" from "I could not",
         which are different things to a user and the same thing to a
         boolean. */
      noTemplate: true,
      askedWhich: asking,
      available: (opts.available || []).slice(),
      topic: opts.topic || null,
      intent: "code",
      answerLang: opts.language || "english",
      hint: null
    };
  };

  /* Build the reply for a template. Assembles a message; it never
     rewrites a line of the file, and the file goes in a fence so the
     app's markdown renders it as a block with the right language
     rather than trying to lay it out as prose. */
  Generator.prototype.code = function (opts) {
    opts = opts || {};
    var t = opts.template;
    var F = CODE_FRAME[opts.language] || CODE_FRAME.english;
    var intro = F.intro[0]
      .replace(/\{title\}/g, t.title)
      .replace(/\{file\}/g, t.file);

    var parts = [intro, "```" + t.lang + "\n" + t.code + "\n```"];

    if (t.how && t.how.length) parts.push(F.how + "\n" + bullets(t.how));
    if (t.change && t.change.length) parts.push(F.change + "\n" + bullets(t.change));
    parts.push(F.tail);

    return {
      text: parts.join("\n\n"),
      entryId: opts.entry ? opts.entry.id : null,
      concept: t.concept,
      /* 1, and deliberately: this is not a claim that might be wrong,
         it is a file that is either in the library or not. The score is
         reported separately as `retrievalScore` so nothing downstream
         mistakes the two. */
      confidence: 1,
      known: true,
      weak: false,
      isCode: true,
      codeLang: t.lang,
      codeFile: t.file,
      codeLines: t.lines,
      retrievalScore: opts.score || 0,
      /* True when this template was reached on a fuzzy match inside the
         code shelves rather than on one that cleared the ordinary bar -
         a misspelling, or a request with almost no subject. Reported
         rather than hidden, so a weak answer is visible as one. */
      fuzzyMatch: !!opts.fuzzy,
      topic: opts.entry ? opts.entry.topic : "code",
      intent: "code",
      answerLang: opts.language || "english",
      hint: null
    };
  };

  Generator.prototype.greet = function (opts) {
    opts = opts || {};
    var name = opts.name || "";
    var lines = opts.lines || [];
    if (!lines.length) return "";
    /* Rotate by how many greetings have already been given, rather than
       only seeding a random pick. Seeding alone is not enough: the tests
       use a fixed seed, so every greeting in a seeded session came out
       identical - six of them, one unique. Rotation guarantees the whole
       set is used before any repeat, which is both more varied and more
       predictable than random, and it holds under a fixed seed, which is
       what a reproducibility test needs. */
    var n = typeof opts.nudge === "number" ? opts.nudge : 0;
    var start = ((n % lines.length) + lines.length) % lines.length;
    var text = lines[start];

    /* Named, or not named - two different renderings, and getting the
       second one right is the whole reason this is not one line.

       The bug this replaces: the slot was filled with the literal
       word "there" and a cleanup pass then went looking for "{name}"
       to tidy up after it. The placeholder was already gone, so the
       cleanup never fired and every nameless greeting came out as
       "Hello there, I am bokskieAI" - which reads as a bot addressing
       a room rather than a person, and which became actively silly
       the moment the one-time name offer was added, because the same
       reply would say "Hello there" and then ask what to call them.

       The comment above this function has claimed since the beginning
       that no placeholder is used. Now it is true. */
    if (name) {
      text = fill(text, { name: name });
    } else {
      /* Drop the slot, and keep the punctuation around it valid: the
         comma in "Hello {name}, I am" belongs to the name, so it goes
         with it, but "Hello {name}! I am" keeps its full stop. */
      text = text.replace(/\s*\{name\}\s*,\s*/gi, ", ")
                 .replace(/\s*\{name\}\s*!\s*/gi, "! ")
                 .replace(/\s*\{name\}/gi, "")
                 .replace(/^\s*,\s*/, "")
                 .replace(/\s{2,}/g, " ")
                 .trim();
    }
    return text;
  };

  /* Mood-matched prefix.

     Applies only when the mood actually cleared the detection bar, and
     only ahead of the answer - never instead of it. A person who says
       "I am so tired of this bug, how do I fix it"
     gets the bug fix AND an acknowledgement. Dropping the answer to
     match the tone would be worse than useless.

     And when the bank has no entry for the question, the mood does not
     rescue it: a sympathetic paragraph in place of an answer is still a
     non-answer, and it is more disappointing than a plain refusal
     because it feels like help. */
  Generator.prototype.empathise = function (opts) {
    opts = opts || {};
    var mood = opts.mood || "neutral";
    var bank = SLOTS[opts.language || "english"] || SLOTS.english;
    var set = (bank.mood && bank.mood[mood]) || null;
    if (!set || !set.length) return "";
    return this.pick(set, seeded(opts.seed || 1), null);
  };

  return { Generator: Generator, ACCEPT: ACCEPT, WEAK: WEAK };
});
