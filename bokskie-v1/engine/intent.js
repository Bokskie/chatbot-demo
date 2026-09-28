/* ============================================================
   bokskie-v1 · engine/intent.js
   ------------------------------------------------------------
   Two jobs, and keeping them apart matters:

   1. TOPIC  - "which shelf do I look in". Cheap, and it is what
               makes the system scale: only the chosen topic is
               scored, not all 100k entries. A mis-routed topic
               still finds the right answer if shelves overlap.

   2. INTENT - "what kind of answer is wanted". A greeting wants
               a greeting. A "how do I" wants steps. A "what is"
               wants a definition. Getting this wrong is what makes
               a bot answer a greeting with an essay.

   Both return a confidence, and that confidence is load-bearing.
   Low confidence must never silently become a confident answer.
   ============================================================ */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./tokenizer.js"));
  else root.BokskieIntent = factory(root.BokskieTokenizer);
})(typeof globalThis !== "undefined" ? globalThis : this, function (T) {
  "use strict";

  /* Topic router. Weights matter: "javascript" should pull
     programming hard on its own, while "history" alone is weaker
     evidence because it is a word people use loosely. */
  var TOPICS = {
    programming: {
      keys: {
        javascript: 3, js: 2, html: 3, css: 3, python: 3, java: 2,
        code: 2, coding: 3, program: 2, programming: 3, function: 2,
        variable: 2, array: 2, loop: 2, method: 2, object: 1,
        bug: 2, debug: 3, error: 1, syntax: 2, api: 2, json: 2,
        framework: 2, library: 2, node: 2, react: 3, vue: 3, angular: 3,
        typescript: 3, database: 2, sql: 3, server: 2, deploy: 2,
        git: 2, github: 2, algorithm: 3, stack: 1, compile: 2, script: 2,
        /* Stemmed forms. The router compares against tokens, and tokens
           are stemmed - so a key that is not itself stemmed is a key
           nothing can ever produce. The stemmer turns "programming"
           into "programm" and "coding" into "cod", so those two keys
           above were dead, and a bare "lets talk about programming"
           routed to nothing. verify-engine.js now lints for this
           class of key so it cannot come back quietly. */
        programm: 3, cod: 2,
        php: 2, golang: 2, rust: 2, kotlin: 2, swift: 2, backend: 2,
        frontend: 2, dev: 1, software: 2, prompt: 2,
        /* Native-language keys. The lexicon bridge folds many of these
           onto their English concept already, but a router that only
           knows English mis-files every question whose subject word is
           not in the lexicon - and a mis-routed shelf is a 0.55x
           penalty on the eventual winner, so this is not cosmetic. */
        programa: 3, kompyuter: 2, kode: 2, "c++": 2, "c#": 2, web: 2
      }
    },
    science: {
      keys: {
        science: 3, atom: 3, molecule: 3, physics: 3, chemistry: 3,
        biology: 3, cell: 2, dna: 3, gravity: 3, energy: 2, electron: 3,
        quantum: 3, planet: 2, experiment: 2, scientist: 2,
        relativity: 3, evolution: 3, gene: 2, protein: 2, chemical: 2,
        reaction: 2, lab: 2, mass: 2, velocity: 3, orbit: 3,
        /* Tagalog / Bisaya */
        syansiya: 3, kimika: 3, biologya: 3, fizika: 3, atomo: 3,
        molekula: 3, "dna": 3, enerhiya: 2, planeta: 2, gravitation: 3
      }
    },
    mathematics: {
      keys: {
        math: 3, mathematics: 3, algebra: 3, geometry: 3, calculus: 3,
        equation: 3, solve: 2, sum: 2, product: 2, prime: 3, number: 1,
        fraction: 3, decimal: 2, percent: 2, integral: 3, derivative: 3,
        theorem: 3, triangle: 3, circle: 2, angle: 2, area: 2, volume: 2,
        formula: 3, matrix: 2, vector: 2, statistic: 3, probability: 3,
        /* Tagalog / Bisaya */
        matematika: 3, kalkulasyon: 3, kabuuan: 2, trilangkulo: 3,
        kuwadrado: 2, bahin: 2, tinong: 2
      }
    },
    geography: {
      keys: {
        geography: 3, country: 2, capital: 3, city: 2, map: 2, river: 3,
        mountain: 3, ocean: 3, continent: 3, island: 3, province: 2,
        climate: 2, latitude: 3, longitude: 3, population: 2,
        philippines: 3, asia: 2, europe: 2, africa: 2, landmark: 2, border: 3,
        /* `philippin` is the one that actually fires. The stemmer strips
           a trailing "es" from "philippines", so the plural written above
           could never be produced by tokenize() and the key was dead -
           the topic routed on nothing. Listing the stemmed form is the
           same reason science lists both "gravity" and "gravitation". */
        philippin: 3, pilipinas: 3, pilipina: 3,
        /* Tagalog / Bisaya */
        geograpiya: 3, bansa: 3, syudad: 2, kabisodao: 2, kapangalan: 3,
        dagat: 2, bundok: 3, ilawom: 2, klimat: 2, hanginan: 2
      }
    },
    history: {
      keys: {
        history: 3, historical: 3, war: 3, empire: 3, ancient: 3,
        century: 3, revolution: 3, dynasty: 3, king: 2, queen: 2,
        colonize: 3, independence: 2, treaty: 3, medieval: 3, world: 1,
        /* Tagalog / Bisaya */
        kasaysayan: 3, gubat: 3, imperyo: 3, siningkod: 3, rebolusyon: 3,
        henerasyon: 2, kaharianan: 3, kasunod: 2, driyri: 2
      }
    },
    health: {
      keys: {
        health: 3, sick: 3, illness: 3, fever: 3, cough: 3,
        medicine: 3, doctor: 2, hospital: 3, pain: 2, hurt: 2,
        symptom: 3, virus: 2, bacteria: 2, infection: 3, allergy: 3,
        diabetes: 3, cancer: 2, stress: 2, sleep: 2, nutrition: 3,
        exercise: 2, diet: 2, vitamin: 3, mental: 2, anxiety: 3,
        /* Tagalog / Bisaya. `katulog` is deliberately absent - the
           lexicon folds it onto `sleep`, which is already a key, so
           listing both would be two routes to one place. */
        karamat: 3, sakit: 3, pagamot: 3, doktor: 2, ospital: 3,
        ngipon: 2, ehersisyo: 2, pagkain: 2, pamamagitan: 2
      }
    },
    money: {
      keys: {
        money: 3, budget: 3, save: 2, savings: 3, invest: 3,
        stock: 2, crypto: 2, bitcoin: 3, loan: 3, debt: 3, price: 2,
        cost: 2, cheap: 2, expensive: 2, salary: 3, income: 2,
        expense: 3, pension: 3, finance: 3, profit: 3, freelance: 2,
        /* Tagalog / Bisaya. `abot` is deliberately not here: it is a
           common word meaning "reach", and weighting it toward money or
           technology would misfile ordinary conversation. */
        pera: 3, kabuhayan: 2, ipon: 3, utang: 3, presyo: 2, gastos: 2,
        kita: 2, sweldo: 3, kabuhay: 2, tubo: 2
      }
    },
    technology: {
      keys: {
        ai: 3, artificial: 3, machine: 2, robot: 2, computer: 2,
        internet: 3, phone: 2, smartphone: 3, app: 2, hardware: 2,
        cloud: 2, encrypt: 3, security: 2, password: 3, network: 2,
        chatgpt: 3, gemini: 3, automation: 2, digital: 2,
        /* Tagalog / Bisaya */
        teknolohiya: 3, makina: 2, telepono: 3, datos: 2,
        seguridad: 2, awtomatiko: 2, linya: 2,
        /* The stemmer has no rule for "-ion", so "encryption" survives
           whole and never reaches the "encrypt" key above. Adding a
           derivational suffix stripper here would be the wrong fix -
           the stemmer is deliberately conservative, and this table
           already lists variant forms explicitly for exactly this
           reason. */
        encryption: 3, cryptography: 3, hashing: 2
      }
    },

    /* ---- the shelves added for the large bank -------------------
       These are new topic keys, not a change to how routing works.
       The weights matter and they are not uniform:

       The five technical shelves are peers at 2-3, so a question that
       names one of them clearly wins. They overlap - "server" touches
       networking, computers and databases - and that is fine, because
       topic is a soft preference (0.55x off-topic) and the second
       ranked topic is a free fallback.

       The four catch-all shelves are deliberately held at weight 1.
       "english", "filipino", "cebuano", "conversations" and
       "general-knowledge" are the places a question lands when nothing
       more specific applies, so a single shared word in one of them
       must never outrank a real subject. At weight 1 it takes three
       such words to outscore a single weight-3 hit, which is the right
       way round: better to search the wrong catch-all shelf and let
       scoring sort it out than to route a genuine question away from
       its own topic. */
    "web-development": {
      keys: {
        html: 3, css: 3, dom: 3, browser: 3, frontend: 2, markup: 3,
        stylesheet: 3, responsive: 2, flexbox: 3, grid: 2, accessibility: 2,
        javascript: 1, cookie: 2, localstorage: 3, http: 2, url: 2,
        anchor: 2, div: 2, span: 2, tag: 1, class: 1, id: 1, header: 1,
        footer: 1, navbar: 2, form: 1, input: 1, button: 1, meta: 1,
        viewport: 2, webpage: 3, website: 2, page: 1, render: 2,
        pahina: 2, "web development": 3
      }
    },
    computers: {
      keys: {
        computer: 3, cpu: 3, ram: 3, harddrive: 3, ssd: 3, motherboard: 3,
        gpu: 3, graphics: 2, processor: 3, memory: 2, storage: 2, disk: 2,
        laptop: 2, desktop: 2, monitor: 2, keyboard: 2, mouse: 2,
        binary: 3, bit: 2, byte: 3, operating: 2, windows: 1, linux: 2,
        macos: 2, kernel: 3, file: 1, folder: 1, directory: 2, cache: 3,
        kompyuter: 3,
        /* Stemmed forms - see the note in the programming keys. */
        proces: 2, thread: 2, hardwar: 2, softwar: 2,
        /* Caught by the dead-key lint, not by reading: "graphics",
           "windows" and "operating" are each stemmed before the router
           ever sees them, so the unstemmed spellings above were dead. */
        graphic: 2, window: 1, operat: 2
      }
    },
    networking: {
      keys: {
        network: 3, router: 3, lan: 3, wan: 3, dns: 3, ip: 3, tcp: 3,
        udp: 3, bandwidth: 3, latency: 3, gateway: 3, switch: 2, ethernet: 3,
        wifi: 3, firewall: 2, packet: 3, protocol: 2, port: 2, subnet: 3,
        internet: 1, broadband: 3, fiber: 2, dialup: 3, hub: 2, bridge: 2,
        /* Stemmed forms - see the note in the programming keys. */
        vpn: 3, ethernet: 3, packet: 3, latenci: 2, subn: 2,
        "computer network": 3
      }
    },
    databases: {
      keys: {
        database: 3, sql: 3, table: 2, query: 2, schema: 3, index: 2,
        primary: 1, foreign: 1, key: 1, row: 1, column: 2, join: 3,
        normalize: 2, transaction: 3, commit: 2, nosql: 3, redis: 3,
        postgres: 3, mysql: 3, sqlite: 3, mongodb: 3, backup: 2,
        data: 1, records: 2, relational: 3, crud: 3
      }
    },
    cybersecurity: {
      keys: {
        security: 2, malware: 3, virus: 1, ransomware: 3, phishing: 3,
        hacker: 3, exploit: 3, vulnerability: 3, patch: 2, firewall: 2,
        encryption: 1, authentication: 3, authorization: 3, two: 1,
        factor: 1, cipher: 3, brute: 3, injection: 3, sql: 1, xss: 3,
        csrf: 3, cyber: 3, cyberattack: 3, privacy: 2, breach: 3,
        "computer security": 3
      }
    },
    "general-knowledge": {
      keys: {
        what: 1, why: 1, how: 1, who: 1, when: 1, where: 1, which: 1,
        explain: 1, meaning: 1, difference: 1, example: 1, fact: 1,
        trivia: 3, general: 1, knowledge: 1, information: 1, tell: 1,
        "general knowledge": 3
      }
    },
    english: {
      keys: {
        grammar: 3, spelling: 3, vocabulary: 3, verb: 3, noun: 3,
        adjective: 3, adverb: 3, pronoun: 3, tense: 3, sentence: 2,
        english: 3, word: 1, phrase: 2, idiom: 3, passive: 3,
        active: 2, plural: 3, singular: 2, synonym: 3, antonym: 3,
        infinitive: 3, gerund: 3, preposition: 3
      }
    },
    filipino: {
      keys: {
        tagalog: 3, filipino: 3, kayo: 2, po: 1, mga: 1, ang: 1, ng: 1,
        man: 1, sana: 2, salamat: 2, magandang: 2, maraming: 2,
        wala: 1, may: 1, hindi: 1, ito: 1, iyon: 1, sila: 1,
        wika: 2, grammar: 1, meaning: 1, translate: 2
      }
    },
    cebuano: {
      keys: {
        cebuano: 3, bisaya: 3, visayan: 3, kani: 1, nimo: 1, nato: 1,
        kanila: 1, gyud: 1, jud: 1, kaayo: 1, sayon: 1, unsaon: 1,
        adlaw: 1, gabon: 1, hapon: 1, wika: 1, meaning: 1, translate: 1,
        bis: 1, cebu: 2
      }
    },
    conversations: {
      keys: {
        hello: 1, hi: 1, hey: 1, bye: 1, goodbye: 1, thanks: 1, thank: 1,
        please: 1, sorry: 1, yes: 1, no: 1, ok: 1, okay: 1, help: 1,
        name: 1, welcome: 1, good: 1, morning: 1, night: 1, day: 1,
        kumusta: 1, kamusta: 1, musta: 1, salamat: 1, paalam: 1,
        greetings: 3, farewell: 3, small: 2, chat: 1, talk: 1
      }
    },
    /* EVERYDAY - the questions a person actually types. "ano maganda
       ulam", "gutom na ako", "baka matula ako", "tangnan mo ako".

       These all used to fall through the router entirely (topic=null)
       and were refused with a confidence near zero - not because the
       engine was being cautious but because no shelf had ever claimed
       the words. The key list is deliberately made of CONTENT words
       only, with no "ang", "sa", "na" or "ako", because a router key
       that is a particle fires on almost every Filipino sentence and
       drags all of them into one shelf, which is worse than not
       routing at all. That is exactly what happened with "maganda"
       before it was demoted to weight 1: at weight 2 every sentence
       containing it, including "magandang araw", was pulled to one
       shelf and the greeting stopped working. */
    everyday: {
      keys: {
        ulam: 3, kainin: 3, kain: 2, pagkain: 3, gutom: 3, recipe: 3,
        resipe: 3, adobo: 3, lutuin: 2, pagluto: 3, carinderia: 3,
        panoorin: 3, pelikula: 3, music: 2, kantahin: 3,
        sunday: 2, weekend: 3, bakasyon: 3, libangan: 3,
        matula: 3, tulog: 2, pagod: 3, kapayapaan: 2,
        tangnan: 3, naihi: 3, tikol: 3, ganda: 2,
        libro: 3, pelikula: 3, recipe: 3, tanawin: 2, labado: 2,
        /* `maganda` is weight 2, not 3, and that is measured rather
           than guessed. At 3 it outranked the greeting shelf and
           "magandang araw" stopped being a greeting. At 1 it lost
           the topic outright to the question words: "ano magandang
           libro" scored everyday only 1 against unsa's 3, routed to
           cebuano-question-words, and answered with the question
           word ano instead of a book. At 2, a second everyday word
           in the same sentence - ulam, libro, panoorin - carries it
           past the question words, while a sentence with only
           "maganda" in it falls through to the greeting, which is
           the right home for that. */
        maganda: 2, sayon: 2, masarap: 3, sarap: 2,
        bayad: 2
      }
    }
  };

  /* Intents are matched by pattern, not by a bag of words, because
     "who are you" and "what is your name" must both land on
     identity, and a bag of words would split them apart. */
  var INTENTS = [
    /* Memory reference is weighted above everything else on purpose.

       "you remember our last topic about sleep" also contains topic-shaped
       words, and if a lower-weight intent won the tie the question would
       be routed into ordinary knowledge search. That is the failure this
       whole feature exists to prevent: the words "you", "remember" and
       "topic" share no vocabulary with the entry that holds the answer,
       so retrieval returns whatever drifted closest and the engine
       confidently describes the wrong subject. The answer to this
       question is in the transcript, not in the bank. */
    { id: "memory_reference", weight: 5, re: /\b(do you remember|you remember|dont you remember|remember (our|my|the|last|what)|naalala mo|naalala ko|naalala ba|naalala nato|ginhapon natin|ginhapon nato|ginhapon tanan|pinag-?usapan (natin|nato|ko|mo)|pinagkay-?iya|unsa (ang )?(in|na)?(pinag-?usapan|ginhapon|topic)|katongod (ba )?nga (kay|ako)|last (topic|subject|question)|previous (topic|subject|question)|what did (we|i) (talk|discuss|say|ask)|we were (talking|discussing)|what was (our|my|the) (last |previous )?(topic|subject|question))\b/ },
    { id: "greeting",   weight: 3, re: /^(hi|hey|hello|yo|sup|hiya|oi|kumusta|kamusta|musta|unsa sayon|magandang (umaga|hapon|gabi|araw)|good (morning|evening|afternoon|day))\b/ },
    /* "salamat" means "thank you", so it lives in gratitude only.
       Listing it in both made farewell win the tie every time. */
    { id: "farewell",   weight: 3, re: /\b(bye|goodbye|see you|paalam|adios|good night|tapos na)\b/ },
    { id: "gratitude", weight: 3, re: /\b(thanks|thank you|salamat|arigato|slapatsa|mabuhay|appreciate)\b/ },
    /* An explicit ASK FOR A MEANING outranks every behaviour word, at
       weight 4, and it is the only thing above the behaviour intents
       except memory reference.

       This is here because "unsa meaning nga salamat" contains
       "salamat", so gratitude won at weight 3 and the bot answered a
       vocabulary question with "you are welcome" - the behaviour
       entry, not the entry that explains the word. "Salamat" on its
       own is a thank-you and must stay one; "what does salamat mean"
       is a dictionary question and must not be.

       The distinction is carried by the asking, not by the word, so
       it has to be matched before the behaviour words are. */
    { id: "definition", weight: 4, re: /\b(meaning|kahulugan|unsa meaning|ano ang meaning|kay unsa|what does .{1,24} mean|what do .{1,24} mean|define)\b/ },
    { id: "identity",   weight: 3, re: /\b(who are you|what are you|your name|who r u|kayo ka|kanimo ka|katongod ka|ano (ang )?pangalan mo|ano (ka|ikaw)|sino ka|unsa (imong |iyong |aking )?ngalan|naa ka pay ka|naa ka man)\b/ },
    /* The USER asking for THEIR OWN name back. This is a different
       question from `identity` above, and it is not a rare one - it is
       the first thing anyone types to check whether a bot really
       listens. It is also the one question that had nowhere to go.

       "what is my name" contains "name", routed into ordinary
       knowledge search, and was answered with a paragraph explaining
       the word "credit" - the entry about giving someone credit for
       work they did. Confident, fluent, and not remotely an answer to
       the question. "ano pangalan ko" was worse: it refused, telling
       the user it had nothing on the subject, when the subject was
       sitting in its own memory.

       Both failures had the same cause, which is that the bank has no
       entry for this and retrieval therefore went looking for a
       neighbour. The answer does not belong in the bank at all - it is
       a fact about THIS conversation, so it is answered from context
       and never searched for. See Engine.nameReply. */
    { id: "askname",    weight: 5, re: /\b(what('s| is| was)? my name|do you know my name|who am i|remind me (of )?my name|ano (ang )?pangalan ko|ano (ako|ikaw)|kingalan ko|unsa (ang )?aking ngalan|unsa akong ngalan|kanus-a ako nga|kinsa ako)\b/ },
    /* "BUILD ME SOMETHING", in three languages.

       Weighted with the behaviour intents rather than below `howto`,
       because the shape of the request - make me a thing - carries no
       subject words at all. "gawa ka ng resort website" tokenises to
       almost nothing usable, and "can you build me a website" is the
       same. Left to `howto` these either refused or, worse, matched an
       entry about web development in general and explained what HTML
       is while the person waited for a file.

       The languages are deliberately not just Tagalog and English.
       "gawa ka" and "gawain" are the Tagalog forms; "buhat" and
       "himoon" are the Cebuano ones, and "himoon" in particular is
       how a Bisaya speaker asks for something to be made. */
    { id: "code",       weight: 4, re: new RegExp([
      /* Built from a list rather than written as one literal, because a
         single regex this wide is a nightmare to edit: the version
         that shipped first had one `)` too many and took the whole
         engine down with a SyntaxError at require time. One
         alternative per line, every group non-capturing, and a paren
         cannot drift without it being obvious here.

         Each line is a SHAPE of request rather than a subject, which
         is the point: "make me a resort website" and "gawa ka ng
         resort website" share no vocabulary, and the subject arrives
         from the shelf router rather than from here. */
      "\\b(?:build|make|create|generate|write|code|program|design|draft)(?: me)? (?:an? |the )?(?:[a-z]+ )?(?:web ?site|web ?page|website|landing page|portfolio|blog|resort|hotel|restaurant|calculator|to-?do(?: list)?|todo list|checklist|task list|dashboard|page|site|application|program|script|template|app|code|game|form)\\b",
      "\\bcan you (?:build|make|create|write|code)\\b",
      "\\bi need (?:an? )?(?:web ?site|website|web ?page|program|app|code|script)\\b",
      "\\bgive me (?:an? )?(?:web ?site|website|code|html|css|javascript|program)\\b",
      "\\bhtml,? ?css\\b",
      "\\bcss (?:and|&) javascript\\b",
      /* The nouns here are the SUBJECTS the library can actually build.
         They are duplicated in the intent table by necessity - intent.js
         cannot read data/code.json - which is exactly the kind of
         duplication that rots. verify-engine.js checks every template's
         keywords against this pattern, so adding a template without
         adding its noun here fails the build rather than quietly
         refusing the one question it exists to answer. */
      "\\bgawa(?:an|in)? (?:ka|kami|mo|ako)? ?(?:ng|nang|ang)? ?(?:[a-z]+ )?(?:web ?site|web ?page|website|landing page|portfolio|blog|resort|hotel|restaurant|calculator|to-?do(?: list)?|todo list|checklist|task list|dashboard|page|site|program|app|code)\\b",
      "\\bbuhat (?:ako|ka|nako|nimo) (?:og|ng|nang)? ?(?:[a-z]+ )?(?:web ?site|web ?page|website|landing page|portfolio|blog|resort|hotel|restaurant|calculator|to-?do(?: list)?|todo list|checklist|task list|dashboard|page|site|program|app|code)\\b",
      "\\bhimoon (?:ako|ka|nako|nimo) (?:og|ng|nang)? ?(?:[a-z]+ )?(?:web ?site|web ?page|website|landing page|portfolio|blog|resort|hotel|restaurant|calculator|to-?do(?: list)?|todo list|checklist|task list|dashboard|page|site|program|app|code)\\b",
      "\\bpang (?:website|code)\\b",
      /* NO VERB AT ALL, which is how people actually type. Every
         alternative above needs build/make/create. "resort website
         please" and "code of resort" have none, so the intent came
         back null, the request was answered with the entry's PROSE -
         a correct description of a page the user was plainly asking to
         be given - and the code sat in the library unused.

         Subject-first, and the subject has to be one the library
         holds, so this cannot swallow "what is javascript" or "tell me
         about code": those have no such noun, and the definition intent
         is matched above this one anyway. */
      "\\b(?:resort|hotel|restaurant|portfolio|blog|landing|dashboard)[a-z ]{0,14}(?:website|web ?site|web ?page|site|page|app|code|template)\\b",
      /* The subject alone, with the politeness word doing all the work.
         "resort website please" is covered above, but "calculator
         please" and "todo list pls" name a template and then stop, and
         those were refused.

         `please` is required rather than optional on purpose. A bare
         "calculator" has to stay a question - "what is a calculator" is
         a definition question and the definition intent is matched
         above this one, but relying on a tie-break to stop a loose
         pattern eating real questions is how a router ends up answering
         vocabulary questions with code menus. */
      "\\b(?:resort|hotel|restaurant|portfolio|blog|landing|dashboard|calculator|to-?do list|todo list|checklist)\\s+(?:please|pls|plz)\\b",
      /* "code of X", "the code for X" - and the preposition is
         REQUIRED, which is the whole point of the line. The first
         version made it optional and then "how do i fix a javascript
         bug" matched, because `javascript` followed by one more word is
         the shape, and the reply was the code menu instead of an
         answer about a bug. A bare noun plus a bare noun is not a
         request for a file. */
      "\\b(?:code|html|css|javascript|source) (?:of|for|to|sa|og|ng) [a-z ]{1,20}\\b",
      "\\b(?:website|web ?site|page|app|program) (?:for|of|about) [a-z ]{1,20}\\b",
      /* A bare plea for the file, with no subject at all. It is a
         follow-up and carries the previous topic forward; the engine
         handles that, and this only has to notice the shape. */
      "\\b(?:give|show|send|paste|resend) (?:me |us )?(?:the |that |those |it )?(?:code|file|full|whole|complete)\\b",
      "\\b(?:full|complete|whole|actual) (?:code|file|version)\\b",
      /* A bare noun plus the politeness word, with nothing else. "code
         please" is two words and a name is not in it - it was being
         answered with a definition of the word "code", from a shelf
         about Cebuano programming terms, while the user waited for a
         file. Narrow to `code` and `file` on purpose: adding `app`,
         `page` and `site` here starts eating "build me an app", which
         the verb forms already cover and which must keep reaching the
         library. */
      "\\b(?:code|file)\\s+(?:please|pls|plz|now)\\b",
      /* The same request in the other two languages, with no subject.
         "Gusto ko ng code" and "guston nako og code" are how a Tagalog
         and a Cebuano speaker ask for this, and both were being
         answered with the ordinary "I do not know anything about that"
         while the English version got the menu. The verbs are `gusto`
         and `guston`, the linker is `ng` or `og`, and neither was in the
         table. */
      "\\bgusto (?:ko|mo|namin|natin|natin) (?:ng |nang |ang )?(?:code|file|program|app|website|web ?site|site|page)\\b",
      "\\bguston (?:nako|nimo|namit|nato) (?:og |ng |nang |ang )?(?:code|file|program|app|website|web ?site|site|page)\\b"
    ].join("|"), "i") },
    { id: "capability", weight: 3, re: /\b(what can you do|who can help|help me|paano ka makakatulong|unsa ka mahimong)\b/ },
    { id: "howto",      weight: 2, re: /\b(how (do|to|can)|paano (ako|ko|mo|kami|ka)|unsaon (ko|mo|nimo|ako|ka)|steps|guide|tutorial|instructions)\b/ },
    /* RECOMMENDATION - "ano maganda ulam", "what can i do sunday".

       This is the intent that was missing, and its absence is why a
       whole class of ordinary questions refused. Nothing above it
       matches "ano maganda ulam bro": there is no "what is", no
       "how", no "why", and nearly every word is a particle. Even a
       correct topic route had nothing to score against, so the score
       came back near zero and the bot refused a completely reasonable
       question.

       It has to match the SHAPE of the request rather than the
       subject, because the subject is exactly what varies: good +
       a noun, or a "what can i" question. "Maganda" alone is
       deliberately NOT in here, because "maganda ang araw" is small
       talk and not a request for a recommendation; putting it in
       would capture weather and compliments. The \s+ between the
       adjective and the noun is what requires a noun to follow.

       A BARE `unsa na` is NOT here on purpose. `unsa ang pwede` is a
       request, but "unsa na tayo" is the ordinary way of asking what
       now between two people, and it has to keep going to the
       question-words shelf - when it was captured here it answered
       that phrase about the pronoun we, which is worse than refusing
       because it sounds confident. The `unsa` branch therefore
       requires the adjective AND a noun, exactly like the `ano` one. */
    /* The optional (ng) after the adjective is not decoration. Filipino
       links an adjective to the word after it with -ng, so the same
       sentence is written both ways: "ano maganda ulam" and "ano
       magandang ulam" are the same request from the same speaker,
       and a pattern that only accepts the bare form silently fails
       on the more careful spelling. "ano magandang libro" was
       refusing because of that one syllable. */
    { id: "recommend", weight: 3, re: /\b(ano|anong) (maganda|mabuti|maayong|besta|best|good)(ng)? (ulam|panain|kainin|food|movie|film|book|libro|activity|activities|gawin|panoorin|watch|place|restaurant|recipe|resipe|bandera|destination|spot|thing|example|ideya|suggestion|tip|paanyagan|adlaw|day|plan|hudyat|libangan|labas|destinasyon|tanawin)\b|\b(unsa|unsang) (maganda|mabuti|maayong|best|good)(ng)? (ulam|kainin|food|movie|film|book|activity|paanyagan|adlaw|place|recipe|resipe)\b|\b(any (good|great|nice)|any (recipe|resipe|idea|suggestion|tip))\b|\b(what (can|should) i (do|watch|eat|make|cook|buy|read))\b|\b(ano|anong) (ang )?(pwede|puwede)\b|\b(suggest (a|an|some)|give me (a|an|some) (idea|recipe|suggestion))\b/ },
    /* SMALL TALK - a remark, not a question.

       "oy ang ganda pala ng araw", "sobrang init", "tangnan mo ako".
       A person is saying something, not asking for a fact, and the
       bot was refusing them at a confidence near zero because there
       is no question word in the sentence for the router to key on.

       This intent does not answer these by itself. It exists so the
       small-talk entries are RETRIEVED at all, and the generator
       then answers from them. The patterns are the ordinary Filipino
       and Cebuano forms of a remark about the day or about a person,
       and they are matched at weight 3 so a genuine question such as
       "ano maganda ulam" is never captured here, because it contains
       none of these words. */
    { id: "small_talk", weight: 3, re: /\b(ang )?ganda (pala )?(ng )?(araw|buwan|langit)|maganda (pala )?(ang )?(araw|panahon|panain|weather)|kaayo (ba )?(gyud )?kaayo|sayon (ba )?kaayo|buti (ba )?kaayo|nice (weather|day)|ang init|sobrang (init|lamig)|tangnan (mo|ka) (ako|siya)|naihi (k|ka) ako|ayoko na na|pud (ba )?ako|ka na (ba )?ako/i },
    { id: "definition", weight: 2, re: /^(what is|what are|what does|define|meaning of|kay unsa)\b/ },
    { id: "price",      weight: 2, re: /\b(how much|cost|price|worth|presyo|magkano)\b/ },
    /* The Cebuano question word is `ngano`, not `gano`. The pattern had
       `gano (nga|man)`, and `\\bgano` cannot match inside "ngano"
       because the preceding "n" is a word character, so there is no
       boundary there. Every "Ngano man nga ..." question in Cebuano
       therefore routed as a plain question word instead of a `why`,
       which is the intent that decides whether the bot looks for a
       reason or a definition. The bare form is kept as well for the
       regions that say gano. */
    { id: "why",        weight: 2, re: /\b(why (is|are|do|does)|bakit|na?gano|gano (nga|man))\b/ },
    { id: "where",      weight: 2, re: /\b(where (is|are|do)|saan|asa ka)\b/ },
    { id: "when",       weight: 2, re: /\b(when (is|are|do)|kailan|kanus-a)\b/ },
    { id: "who",        weight: 2, re: /\b(who (is|are|was|were)|sino|kinsa)\b/ },
    { id: "compare",    weight: 2, re: /\b(difference between| vs | versus |compare|unlike)\b/ },
    { id: "opinion",    weight: 2, re: /\b(do you think|what do you think|your opinion|ikaw ba)\b/ }
  ];

  /* ---- declaring shelves at runtime ----------------------------

     The bank is 100 JSON files. Hardcoding 100 topic tables here would
     be the wrong shape: adding a category would mean editing the router
     by hand, and a miss would produce a shelf that builds, loads, and
     then can never be routed to - which presents as a vague answer
     rather than a config error, and is genuinely hard to trace.

     So a shelf declares its own routing and this registers it. The
     declarations ship inside data/bundle.js, which loads before the
     engine, so the browser ends up with exactly the topics node has.

     Weights are deliberately modest. A per-shelf topic is a NARROWER
     category than the old coarse ones, and a narrow category that wins
     a routing contest steals questions that belonged elsewhere, so
     catching-all is a 2 and the original broad topics keep their
     higher weights. A real subject still beats a guess. */
  function registerShelves(list) {
    if (!list || !list.length) return 0;
    var n = 0, i, j;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      /* Idempotent: a topic that already exists keeps whatever weight
         it has, so this can never undo a hand-tuned one. */
      if (!s || !s.topic || TOPICS[s.topic]) continue;
      var keys = Object.create(null);
      /* The subcategory name, split on hyphens: a person types
         "first aid", not "health-first-aid". */
      var sub = String(s.sub || "").replace(/-/g, " ").split(/\s+/);
      for (j = 0; j < sub.length; j++) {
        if (sub[j].length >= 2) keys[sub[j]] = 3;
      }
      var g = String(s.group || "").replace(/-/g, " ").split(/\s+/);
      for (j = 0; j < g.length; j++) {
        if (g[j].length >= 2 && keys[g[j]] === undefined) keys[g[j]] = 2;
      }
      /* Declared extras: the words a person actually types that are not
         in the name. Weight 3, because they were written for this job. */
      if (s.keys && s.keys.length) {
        for (j = 0; j < s.keys.length; j++) {
          if (s.keys[j]) keys[s.keys[j]] = 3;
        }
      }
      TOPICS[s.topic] = { keys: keys, shelf: true, lang: s.lang || "english" };
      n++;
    }
    return n;
  }

  /* The frame-word list lives in the tokenizer (T.isFrameWord), which is
     where the scoring side reads it from too. Two copies of "which
     words are just the question frame" is two answers to the same
     question, and they would not stay equal.

     What is wrong here is not that these words are searchable - they
     are not stop words, and "unsa ang kaayo" is a real question about a
     real word that the bank must stay able to answer. What is wrong is
     that they are allowed to decide WHERE the search happens. They keep
     their place in the index and lose the right to pick the shelf, and
     a topic whose entire score came from them is ranked below any topic
     that matched something real.

       "what is time"   tokens ["time"]          0.430  answered
       "ano ang oras"   tokens ["unsa","hour"]   0.302  refused

     One extra word, and the shelf about time was never consulted. */
  function isFrameWord(t) { return T.isFrameWord(t); }

  /* ---- topic -------------------------------------------------- */

  /* Ranked, not single. A hard topic pick throws away information
     for nothing: the second topic is a free fallback, and overlapping
     shelves are how "what is a good horror film" can still find
     something sane when the router guessed conversation.

     A topic whose whole score came from frame words is ranked last
     among equals - see FRAME_WORDS above for why, and for the
     measurement that forced it. The two fields are kept separate so
     the sort can prefer a real subject match without changing the
     score itself, which the tests assert on directly. */
  function topics(tokens) {
    var scored = [];
    for (var name in TOPICS) {
      if (!TOPICS.hasOwnProperty(name)) continue;
      var keys = TOPICS[name].keys;
      var hits = 0;
      var subject = 0;      /* hits that are not the word "what" */
      var evidence = [];
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (keys[t] !== undefined) {
          hits += keys[t];
          evidence.push(t);
          if (!isFrameWord(t)) subject += keys[t];
        } else if (keys[t + "s"] !== undefined) {
          hits += keys[t + "s"] * 0.5;
        }
      }
      if (hits > 0) {
        scored.push({ topic: name, score: hits, subject: subject,
                      evidence: evidence });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  /* ---- intent ------------------------------------------------- */

  /* LOWERCASE FIRST. This is not a style preference, it was the
     single largest defect in the router.

     None of the intent patterns carry the `i` flag, and this function
     tested the RAW text, so a capital letter anywhere silently
     cancelled every intent match in the sentence. "What is
     javascript" matched nothing while "what is javascript" matched
     definition; "Salamat" matched nothing while "salamat" matched
     gratitude. One capital letter, and the whole routing layer
     switched off.

     That is not a rare edge case. A capital letter at the start of a
     sentence is the normal way to write, every mobile keyboard
     auto-capitalises the first word as you type, and a user who
     typed "Kumusta" got no greeting because the greeting pattern is
     `^(hi|hey|hello|...|kumusta|...)` anchored at the start and
     case-sensitive.

     The tokeniser and the mood reader both lowercased their input
     already; this one place did not, which is exactly the kind of
     gap that only shows up when someone types the way a person
     types rather than the way a fixture is written. */
  function intents(text) {
    var out = [];
    var t = String(text || "").toLowerCase();
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(t)) out.push({ intent: INTENTS[i].id, weight: INTENTS[i].weight });
    }
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  /* ---- language ------------------------------------------------ */

  /* Not a detector anyone would call rigorous, but it only has to
     pick which of three banks to answer in, so overlap is fine. */
  function language(text) {
    var w = " " + String(text || "").toLowerCase() + " ";
    var bis = 0, tl = 0, en = 0;
    var bisWords = [" kumusta ", " kamusta ", " musta ", " unsa ", " kinsa ", " asa ", " ngano ", " unsaon ", " kanus-a ", " adlaw ", " maayo ", " sayon ", " salamat ", " dili ", " gyud ", " jud ", " unsa man ", " unsaon nga ", " nimo ", " nato ", " kanila ", " kani ", " kaayo ", " dako ", " sayop ", " naa ", " nga ", " ba ", " gud ", " okay "];
    var tlWords = [" magandang ", " ang ", " mga ", " nang ", " ikaw ", " ito ", " hindi ", " po ", " ba ", " sa ", " ko ", " mo ", " ano ", " ano ang ", " anong ", " yung ", " kung ", " naman ", " sana ", " pwede ", " puwede ", " dito ", " doon ", " kayo ", " ako ", " kami ", " tayo ", " sila ", " siya ", " iyan ", " maganda ", " marami ", " wala ", " may ", " bakit ", " saan ", " kailan ", " sino ", " ulam ", " kainin ", " gawin ", " panoorin ", " kain ", " pagkain "];
    var enWords = [" the ", " and ", " what ", " how ", " your ", " of ", " to ", " in ", " please ", " thanks ", " is ", " are ", " do ", " can ", " i ", " it ", " a "];
    var i;
    for (i = 0; i < bisWords.length; i++) if (w.indexOf(bisWords[i]) !== -1) bis++;
    for (i = 0; i < tlWords.length; i++) if (w.indexOf(tlWords[i]) !== -1) tl++;
    for (i = 0; i < enWords.length; i++) if (w.indexOf(enWords[i]) !== -1) en++;

    /* A short utterance is a sentence, not a document.

       The thresholds below were written for paragraphs, where two
       English markers really does mean English. "ano maganda ulam bro"
       is four content words with not one English marker, and it was
       being labelled english and refused, which is the single most
       common way this bot fails. When a text carries a clear native
       signal and NO english signal at all, the native reading wins
       regardless of how short it is.

       The "a"/"i"/"it" markers were removed from the English list
       above for the same reason: they are not English evidence, they
       are an article and two pronouns, and counting them is what
       tipped a Filipino sentence into the english bank.

       A CEBUANO QUESTION WORD OUTRANKS A TAGALOG PARTICLE, and that
       ordering is deliberate rather than alphabetical. "unsa ang
       katulog" is unambiguously Cebuano, but "unsa" and "ang" each
       score one, the counts tie, and the tie-break was `tl >= bis`,
       so the strongest Cebuano signal - the word a Cebuano speaker
       opens every question with - was being read as Tagalog and the
       answer came back in the wrong language.

       These are lexicalised at the start of a Cebuano sentence, so
       they appear with surrounding spaces, and in that position they
       cannot be Tagalog, so seeing one is decisive. */
    var DECISIVE_BIS = [" unsa ", " kinsa ", " ngano ", " kanus-a ", " unsaon "];
    for (i = 0; i < DECISIVE_BIS.length; i++) {
      if (w.indexOf(DECISIVE_BIS[i]) !== -1) return "bisaya";
    }
    if (en === 0 && bis >= 1 && bis > tl) return "bisaya";
    if (en === 0 && tl >= 1 && tl > bis) return "tagalog";
    if (bis >= 2 && bis > tl) return "bisaya";
    if (tl >= 2 && tl > en) return "tagalog";
    if (en >= 2) return "english";
    if (bis && !en) return "bisaya";
    if (tl && !en) return "tagalog";
    return "english";
  }

  /* Everything at once - the shape the engine actually wants. */
  function analyse(text, tokens) {
    var t = topics(tokens || []);
    var i = intents(text);
    var intent = i.length ? i[0].intent : null;

    /* A "build me a thing" request routes to the CODE shelves, whatever
       the keywords happen to say.

       The case that forced it: "build a resort website using html css
       and javascript" tokenises to html, css, javascript, resort and
       website, and html/css/javascript are keys on the programming
       shelves. Those are three strong, legitimate matches, so the
       router did the right thing by its own rules and answered with a
       paragraph about what HTML is - while the person waited for a
       file.

       The fix is one line of precedence rather than a reweighting,
       because reweighting cannot fix it: the competing keys are real
       words that genuinely belong where they are. What identifies the
       request is not the vocabulary but the SHAPE, and the shape is
       what `intent` carries. So when the shape says "make me a thing",
       the code shelves outrank everything, and the subject is then
       chosen by the keys within them.

       Falls through untouched when no code shelf matches, so a request
       with no template still routes normally and still refuses. */
    var topic = t.length ? t[0].topic : null;
    if (intent === "code") {
      var codeTopic = null;
      for (var c = 0; c < t.length; c++) {
        if (t[c].topic.indexOf("code-") === 0) { codeTopic = t[c].topic; break; }
      }
      /* No code shelf scored, so fall back to one anyway rather than
         leaving the topic wherever the words happened to point.

         "Give me code of resosrt" is the case. "kode" is a key on
         cebuano-programming-terms, and "resosrt" is a misspelling that
         matches no key at all, so nothing on either code shelf scored
         and the topic stayed on the Cebuano programming terms - which
         put the resort template out of scope entirely. The user got
         the honest refusal for a request whose answer was sitting in
         the library under a near-identical name.

         A request shaped like "make me a thing" is a request about the
         thing the library holds. Searching somewhere else is never the
         right default, and a miss here produces the noTemplate menu
         rather than a wrong answer, so the cost of being wrong is one
         extra search. */
      topic = codeTopic || firstCodeShelf() || topic;
    }

    /* A topic chosen ONLY by frame words does not get to narrow the
       search. It says the person asked something; it does not say
       what about.

       "Ano ang oras" has a real subject word, so the time shelf wins
       on subject hits and this never triggers. "Bakit umuulan" does
       not - "umuulan" matches no shelf name or key - so the only
       ranked topic is cebuano-question-words, matched on "ngano"
       alone. Restricting the search to that shelf asks the shelf
       about the word "ngano" to find something about rain, and it
       finds nothing, so the answer is a refusal on a question the bank
       can answer.

       With no topic the search runs across the whole bank and the
       weather entries are found. Narrowing is only worth doing when
       the narrowing is based on something real. */


    return {
      topic: topic,
      topicScore: t.length ? t[0].score : 0,
      topicRank: t,
      intent: intent,
      intentRank: i,
      language: language(text)
    };
  }
  /* The first registered code shelf, used as the fallback topic for a
     build request that scored nowhere. Read from the registry rather
     than named, so adding the first template is what turns this on and
     nobody has to edit the router to add the second. */
  function firstCodeShelf() {
    for (var name in TOPICS) {
      if (TOPICS.hasOwnProperty(name) && name.indexOf("code-") === 0) return name;
    }
    return null;
  }

  return {
    TOPICS: TOPICS,
    INTENTS: INTENTS,
    registerShelves: registerShelves,
    topics: topics,
    intents: intents,
    language: language,
    analyse: analyse
  };
});
