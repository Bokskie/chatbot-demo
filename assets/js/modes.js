/* ==========================================================
   bokskie.ai - study & build modes
   Each mode carries its own system prompt, welcome copy,
   and suggestion cards. No build step, no dependencies.
   ========================================================== */
(function (global) {
  "use strict";

  var ORDER = ["study", "build", "general"];

  var MODES = {
    /* ---------------- Vue study partner ---------------- */
    study: {
      id: "study",
      label: "Study",
      chip: "Study",
      icon: "i-book",
      blurb: "Vue tutor \u2014 teaches the idea first, then the code.",
      welcomeTitle: "What do you want to learn?",
      welcomeHint: "I\u2019m your Vue study partner. I explain the idea first, then show the code. Paste a file and I\u2019ll walk through it line by line.",
      prompt:
        "You are bokskie.ai, a patient and rigorous study partner. You are strongest in Vue 3 and modern JavaScript, and that is usually what the learner wants - but your job is to answer the question they actually asked, not the one you were built for.\n\n" +
        "FIRST RULE - answer what was asked:\n" +
        "- Read the question literally. If it has nothing to do with code (a film, a recipe, a person, trivia, small talk), answer it directly and well. Do not steer it toward programming.\n" +
        "- Never add a Vue example, a code snippet, or a \"Try this\" challenge to a question that was not about code.\n" +
        "- Do not mention being a Vue tutor unless the question was actually about Vue or code.\n" +
        "- If the question is vague or you had to guess what was meant, say what you assumed before answering.\n" +
        "- If it is outside what you know, say so plainly instead of guessing. A confident wrong answer is worse than saying you are unsure.\n\n" +
        "WHEN THE QUESTION IS ABOUT CODE:\n" +
        "- Teach the idea FIRST, then show code. Never dump a solution with no explanation behind it.\n" +
        "- When they paste code: name the problem, explain WHY it happens, then show the corrected version.\n" +
        "- Prefer the Composition API with <script setup>. Mention the Options API only when genuinely relevant.\n" +
        "- Write runnable, minimal examples. Never write \u201c// rest of the code\u201d or \u201c// ...\u201d placeholders.\n" +
        "- Name the file the code belongs in, and say where it goes in the project.\n" +
        "- After a non-trivial code answer, end with one short \u201cTry this\u201d challenge or a one-line self-check question.\n" +
        "- If they ask to be tested or quizzed, ask ONE question, then wait for their answer before revealing it.\n" +
        "- Be honest about uncertainty. If behaviour depends on a version, say which version.\n\n" +
        "LANGUAGE:\n" +
        "- Reply in the language they used. Tagalog in, Tagalog out. Bisaya in, Bisaya out. English in, English out. Do not default to English.\n" +
        "- Keep it plain. No filler, no restating the question back at them.",
      suggestions: [
        {
          title: "Quiz me on Vue",
          sub: "test my reactivity knowledge",
          icon: "i-book",
          prompt: "Quiz me on Vue 3 reactivity. Ask one question at a time and wait for my answer before explaining it."
        },
        {
          title: "ref vs reactive",
          sub: "when each one breaks",
          icon: "i-compass",
          prompt: "Explain the difference between ref and reactive in Vue 3, with a code example where each one silently breaks."
        },
        {
          title: "Teach me a concept",
          sub: "props, emits and slots",
          icon: "i-code",
          prompt: "Teach me props, emits and slots in Vue 3 using one small parent-child example."
        },
        {
          title: "Review my code",
          sub: "find the bug in my .vue file",
          icon: "i-spark",
          prompt: "I am pasting a Vue file next. Review it, find any bugs, and explain each one before fixing it."
        }
      ]
    },

    /* ---------------- website / app builder ---------------- */
    build: {
      id: "build",
      label: "Build",
      chip: "Build",
      icon: "i-code",
      blurb: "Describe a site or app \u2014 outputs complete, runnable code.",
      welcomeTitle: "What are we building?",
      welcomeHint: "Describe the site or app you want. I output the complete code \u2014 every file, nothing skipped \u2014 so you can run it right away.",
      prompt:
        "You are bokskie.ai, a senior web developer who ships complete, working code.\n\n" +
        "OUTPUT RULES \u2014 these matter more than anything else:\n" +
        "- When the request needs files, put EACH file inside its own <file name=\"...\"> block, exactly like this:\n" +
        "  <file name=\"index.html\">\n" +
        "  ...full file contents...\n" +
        "  </file>\n" +
        "- Never split one file across two blocks. Never write \u201c// ...rest of file\u201d or \u201c<template>...\u201d. Every file must be complete and copy-pasteable.\n" +
        "- Default to plain HTML + CSS + JavaScript in separate files unless the user asks for a framework. No build tools, no bundler, no npm install, unless requested.\n" +
        "- Always include index.html first, and make sure it actually references the other files you created.\n" +
        "- After the files, add a short \u201cRun it\u201d section with the exact command, then a brief list of what you built and what to try next.\n" +
        "- If the request is ambiguous, ask ONE short clarifying question instead of guessing.\n" +
        "- Prefer modern, accessible, responsive markup. Include viewport meta and real content, never lorem ipsum.",
      suggestions: [
        {
          title: "Portfolio site",
          sub: "single page, dark theme",
          icon: "i-user",
          prompt: "Build me a clean single-page portfolio website for a web developer. Dark theme, sticky nav, smooth scroll, and a contact form."
        },
        {
          title: "Landing page",
          sub: "hero, pricing, signup",
          icon: "i-chart",
          prompt: "Build a landing page for a SaaS app with a hero section, a 3-tier pricing table, and a working email signup form."
        },
        {
          title: "Todo app",
          sub: "add, filter, persist",
          icon: "i-check",
          prompt: "Build a todo app in plain HTML, CSS and JavaScript. It must add, edit, delete and filter tasks, and save them in localStorage."
        },
        {
          title: "Vue app",
          sub: "Vite + component structure",
          icon: "i-code",
          prompt: "Build a Vue 3 app with Vite. Break it into components, use the Composition API with <script setup>, and show every file including package.json."
        }
      ]
    },

    /* ---------------- plain assistant ---------------- */
    general: {
      id: "general",
      label: "General",
      chip: "General",
      icon: "i-spark",
      blurb: "General-purpose assistant \u2014 code, writing, analysis, ideas.",
      welcomeTitle: "What's on your mind?",
      welcomeHint: "Ask anything, paste code, or brainstorm an idea. Everything stays on your device.",
      prompt: "",
      suggestions: [
        {
          title: "Explain a concept",
          sub: "in simple terms",
          icon: "i-compass",
          prompt: "Explain how a computer's CPU actually works, in simple terms with an analogy."
        },
        {
          title: "Write some code",
          sub: "a working script",
          icon: "i-code",
          prompt: "Write a Python script that renames all the files in a folder by adding a date prefix."
        },
        {
          title: "Brainstorm ideas",
          sub: "for a small startup",
          icon: "i-chart",
          prompt: "Brainstorm small-budget business ideas I could realistically start this year."
        },
        {
          title: "Write for me",
          sub: "a short introduction",
          icon: "i-pen",
          prompt: "Write a short, friendly introduction for my personal website."
        }
      ]
    }
  };

  /* ---------- intent detection ----------
     Lets bokskie switch modes by itself, so "I want to learn vue"
     lands in Study without touching the chip. Pure heuristics, no
     network, no model call.

     Returns { mode, reason, confident } or null to keep the mode.
     When "confident" is false the app must ASK instead of guessing,
     because a bare topic word is genuinely ambiguous: "vue" could
     mean "teach me" (Study) or "build me one" (Build).            */

  /* Vue, the wider front-end world, AND the core Vue concepts people
     actually ask about. brain.js already tracks these phrases, so they
     belong here too - otherwise "explain computed properties" looks like
     a general question and never reaches the tutor. */
  var RE_TECH = /(^|[^a-z])(vue|vuejs|nuxt|pinia|vuex|vue-router|quasar|react|nextjs|angular|svelte|solid|astro|remix|html|css|sass|scss|tailwind|bootstrap|javascript|typescript|node|express|nestjs|flutter|dart|swift|kotlin|java|python|django|flask|fastapi|php|laravel|symfony|ruby|rails|golang|rust|csharp|dotnet|sql|mysql|postgres|mongodb|firebase|supabase|graphql|git|github|figma)([^a-z]|$)|composition api|options api|script setup|state management|computed propert|reactiv|props|emits?|slots?|watchers?|lifecycle|directives?|components?|v-model|v-for|v-if|v-on|v-bind|props drilling|event bus|render function|form validation|async component/i;

  /* STRONG learn intent - "I want to learn X", "tuturo ako", "quiz me".
     These always mean Study, whatever the topic is. */
  var RE_LEARN = /learn|learning|\bstudy\b|teach|tutor|quiz|matut[uo]|magtutuo|aralin|tuturo/i;

  /* SOFT learn words - "what is X", "explain", "ano ang X", "paano".

     These are NOT on their own a request to be taught. "What's a good
     horror film?" starts with "what's" and is just a normal question.
     Routing it to Study would fire the Vue tutor at someone who only
     asked for a film recommendation - which is exactly the bug that
     made bokskie answer a movie question and then tack on Vue code.

     So: soft words only mean Study when a tech topic is also in the
     sentence. Otherwise they mean the plain assistant (General). */
  var RE_LEARN_SOFT = /explain|review|understand|how do|how does|how to|what is|what's|whats|\bano\b|paano|paliwanag|bakit|difference between/i;

  // "build me a site", "gawa ka ng website", "create a todo app"...
  var RE_BUILD = /build me|create a|make a|generate a|build a|develop a|design a|scaffold|landing page|portfolio|website|web app|web page|dashboard|gawa (ka|ng|ako)|gumawa|buuin|likhain/i;

  function detect(text) {
    var t = String(text || "");
    if (t.replace(/\s+/g, "").length < 3) return null;

    var isTech = RE_TECH.test(t);
    var isLearn = RE_LEARN.test(t);
    var isSoft = RE_LEARN_SOFT.test(t);
    var isBuild = RE_BUILD.test(t);

    // Learning wins over building: "I want to LEARN to build a site"
    if (isLearn) {
      return { mode: "study", confident: true, reason: "you want to learn something" };
    }
    if (isBuild) {
      return { mode: "build", confident: true, reason: "you asked me to build something" };
    }

    // Soft learn-word + a tech topic = a real lesson.
    //   "explain computed properties" -> Study
    if (isTech && isSoft) {
      return { mode: "study", confident: true, reason: "that is a programming question" };
    }

    // Soft learn-word, no tech topic = an ordinary question.
    //   "what's a good horror film" -> General, NOT the Vue tutor.
    if (isSoft) {
      return { mode: "general", confident: true, reason: "that sounded like a general question" };
    }

    // A bare topic word such as "vue", "react" or "python" does not
    // say whether you want a lesson or a finished thing, so we do not
    // guess. The app shows a quick picker instead.
    if (isTech) {
      return {
        mode: "study",
        confident: false,
        reason: "I am not sure what you want to do with that"
      };
    }
    return null;
  }



  /* ---------- public API ---------- */

  function all() {
    return ORDER.map(function (id) { return MODES[id]; });
  }

  function get(id) {
    return MODES[id] || MODES.general;
  }

  function defaultId() {
    return "study";
  }

  /**
   * Combine the active mode prompt with the user's own system prompt.
   * The user's custom text always wins by being placed last.
   */
  function systemFor(modeId, custom) {
    var base = get(modeId).prompt || "";
    var extra = (custom || "").trim();
    if (!extra) return base;
    if (!base) return extra;
    return base + "\n\nADDITIONAL INSTRUCTIONS FROM THE USER:\n" + extra;
  }

  global.Modes = {
    ORDER: ORDER,
    all: all,
    get: get,
    defaultId: defaultId,
    systemFor: systemFor,
    detect: detect
  };
})(window);
