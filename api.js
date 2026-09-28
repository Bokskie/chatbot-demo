/* ============================================================
   bokskie.ai - api.js
   ------------------------------------------------------------
   ANG BACKEND BRAIN. Narito ang mga patakaran at provider
   catalog ng bawat AI.

   Ang file na ito ay HINDI ipinapadala sa browser (403 ang
   sinasagot ng server). At HINDI DITO naka-store ang tunay mong
   key - para i-publish mo ito nang ligtas sa GitHub.

   Paano gamitin:
     1) I-copy:  cp keys.example.json keys.local.json
     2) Ilagay ang keys mo roon at i-save. (o .env: cp .env.example .env)
     3) Patakbuhin:  node server.js --open
     Tapos buksan ang http://localhost:3000 - pindutin lang ang
     provider sa Settings at awtomatikong konektado na.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BokskieAPI = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============================================================
     1. API KEYS - DITO SA BABA?  HINDI. HUWAG MO NA ILAGAY DITO.

     Itong file na ito ang i-co-commit mo sa GitHub, kaya HINDI
     DITO dapat nakalagay ang tunay mong key - makikita iyon ng
     lahat at maaaring i-abuse.

     Sa halip, ilagay ang keys sa alinman sa tatlong ligtas na
     paraan (precedence:  .env  >  keys.local.json  >  Settings UI):

       A) keys.local.json   (RECOMMENDED, zero setup)
          I-copy ang keys.example.json -> keys.local.json,
          tapos punan. Nasa .gitignore ito, kaya hindi mai-commit.

       B) .env               (ideal sa shared servers / CI)
          I-copy ang .env.example -> .env, tapos punan.
          Zero-dependency ang loader - walang npm install needed.

       C) Settings UI
          http://localhost:3000 -> Settings -> provider card ->
          "Add key". Nai-save nang automatico sa keys.local.json.

     Environment variables (OPENAI_API_KEY, DEEPSEEK_API_KEY,
     ANTHROPIC_API_KEY, GEMINI_API_KEY) ay gumagana rin.

     Bawat provider ay LISTAHAN, kaya pwede kang magdagdag ng
     maraming key. Kapag na-rate-limit, expired o paubos na ang
     isang key, awtomatikong susunod na key ang susubukan
     (failover) - walang gagawin sa frontend.

     Format (pareho sa keys.local.json):
       "deepseek": ["sk-aaaa", "sk-bbbb"]
       "openai":   [{ "key": "sk-cccc", "label": "Personal" }]

     Ang label ay lumalabas sa Settings UI para madaling malaman
     kung aling key ang aktibo.
     ============================================================ */
  var KEYS = {
    openai:    [],   /* ilagay sa keys.local.json o .env, hindi dito */
    deepseek:  [],
    anthropic: [],
    gemini:    [],
    ollama:    []    /* walang key: lokal na server lang ang kailangan */
  };

  /* ============================================================
     2. PROVIDER REGISTRY (endpoint, auth, models)
        Isang listahan lang ito na ginagamit ng server. Kapareho ng
        catalog sa assets/js/llm.js - kung may magbabago sa isa,
        i-update ang dalawa.
     ============================================================ */

  var AI = {
    openai: {
      id: "openai",
      label: "OpenAI",
      base: "https://api.openai.com/v1",
      keyUrl: "https://platform.openai.com/api-keys",
      keyHint: "OpenAI keys start with sk-",
      keyPrefix: /^sk-(?!ant-)/i,
      env: ["OPENAI_API_KEY"],
      auth: "bearer",
      dialect: "openai",
      note: "ChatGPT models. Pay per token; gpt-5.6-luna is the cheapest.",
      omitTemp: /^(gpt-([5-9])|gpt-oss|o[1-9])/,
      models: [
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", sub: "OpenAI \u00b7 cheapest", tag: "Cheap" },
        { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", sub: "OpenAI \u00b7 balanced" },
        { id: "gpt-6-astra", label: "GPT-6 Astra", sub: "OpenAI \u00b7 flagship", tag: "Flagship" },
        { id: "gpt-oss-120b", label: "gpt-oss-120b", sub: "OpenAI \u00b7 open weights" },
        { id: "gpt-4.1-mini", label: "GPT-4.1 mini", sub: "OpenAI \u00b7 older, still served" },
        { id: "gpt-4o-mini", label: "GPT-4o mini", sub: "OpenAI \u00b7 older, still served" }
      ],
      defaultModel: "gpt-5.6-luna"
    },
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      base: "https://api.deepseek.com",
      keyUrl: "https://platform.deepseek.com/api_keys",
      keyHint: "DeepSeek keys start with sk-",
      keyPrefix: /^sk-(?!ant-)/i,
      env: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
      auth: "bearer",
      dialect: "openai",
      note: "Pinakamurang paid option, at OpenAI-compatible ang endpoint.",
      omitTemp: /.*/,
      models: [
        { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", sub: "DeepSeek \u00b7 cheapest", tag: "Cheap" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", sub: "DeepSeek \u00b7 now served by V4.1 Flash" }
      ],
      defaultModel: "deepseek-flash"
    },
    anthropic: {
      id: "anthropic",
      label: "Anthropic (Claude)",
      base: "https://api.anthropic.com",
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyHint: "Anthropic keys start with sk-ant-",
      keyPrefix: /^sk-ant-/i,
      env: ["ANTHROPIC_API_KEY"],
      auth: "x-api-key",
      dialect: "anthropic",
      note: "Claude models. claude-haiku-4-5 ang pinakamura.",
      models: [
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", sub: "Anthropic \u00b7 cheapest", tag: "Cheap" },
        { id: "claude-sonnet-5", label: "Claude Sonnet 5", sub: "Anthropic \u00b7 balanced" },
        { id: "claude-opus-5-5", label: "Claude Opus 5.5", sub: "Anthropic \u00b7 flagship", tag: "Flagship" },
        { id: "claude-fable-5-1", label: "Claude Fable 5.1", sub: "Anthropic \u00b7 deep reasoning" }
      ],
      defaultModel: "claude-sonnet-5"
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      base: "https://generativelanguage.googleapis.com/v1beta",
      keyUrl: "https://aistudio.google.com/app/apikey",
      keyHint: "Google keys start with AIza (or AQ. for newer keys)",
      keyPrefix: /^(aiza|aq\.)/i,
      env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
      auth: "x-goog-api-key",
      dialect: "gemini",
      note: "May FREE TIER - hindi kailangan ng credit card para makapagsimula. " +
            "Rate-limited, kaya kapag 429, kailangan lang maghintay.",
      models: [
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", sub: "Google \u00b7 default \u00b7 free tier", tag: "Free" },
        { id: "gemini-3.8-flash-lite", label: "Gemini 3.8 Flash-Lite", sub: "Google \u00b7 cheapest + fastest", tag: "Free" },
        { id: "gemini-flash-latest", label: "Gemini Flash (latest)", sub: "Google \u00b7 auto-updating alias" },
        { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", sub: "Google \u00b7 previous flash" },
        { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", sub: "Google \u00b7 previous flash" },
        { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", sub: "Google \u00b7 best answers \u00b7 paid" }
      ],
      /* 2.5-flash was the old default, but Google retired it for new keys:
         "This model is no longer available to new users." It 404s. */
      defaultModel: "gemini-3.8-flash"
    },
    "bokskie-local": {
      id: "bokskie-local",
      label: "bokskie.ai",
      base: "",
      keyUrl: "",
      keyHint: "No key needed - it runs entirely on this machine.",
      keyPrefix: null,
      env: [],
      auth: "none",
      dialect: "openai",
      note: "HINDI ito AI. Isang offline na hanay ng hand-written na sagot - " +
            "kinuha ang pinakamalapit na pre-written na block, kahit hindi tama. " +
            "Hindi nito sinasagot ang tanong mo nang wasto at hindi magagamit sa trabaho. " +
            "Piliin ang Gemini kung gusto mong totoong sagot.",
      omitTemp: null,
      models: [
        { id: "bokskie.v1", label: "bokskie.v1", sub: "Offline \u00b7 canned answers \u00b7 cannot think", tag: "Demo" },
        { id: "bokskie.v1-verbose", label: "bokskie.v1 + translations", sub: "Adds the other two languages" }
      ],
      defaultModel: "bokskie.v1"
    },
    ollama: {
      id: "ollama",
      label: "Ollama (local)",
      base: "http://localhost:11434/v1",
      keyUrl: "https://ollama.com/download",
      keyHint: "No key needed - just run Ollama on this PC",
      keyPrefix: null,
      env: ["OLLAMA_BASE_URL"],
      auth: "none",
      dialect: "openai",
      note: "Libre at offline: kailangan lang tumatakbo ang Ollama sa PC mo.",
      omitTemp: null,
      models: [
        { id: "llama3.2", label: "Llama 3.2", sub: "Ollama" },
        { id: "llama3.1", label: "Llama 3.1", sub: "Ollama" },
        { id: "qwen2.5", label: "Qwen 2.5", sub: "Ollama" },
        { id: "mistral", label: "Mistral", sub: "Ollama" }
      ],
      defaultModel: "llama3.2"
    }
  };

  var ORDER = ["openai", "deepseek", "anthropic", "gemini", "bokskie-local", "ollama"];

  function providerIds() { return ORDER.slice(); }
  function info(provider) { return AI[provider] || null; }
  function modelsOf(provider) { return AI[provider] ? AI[provider].models.slice() : []; }
  function defaultModel(provider) { return AI[provider] ? AI[provider].defaultModel : ""; }

  /* ============================================================
     3. MODEL NAMES - friendly names papuntang tunay na id
     ============================================================ */

  function normalizeId(raw) {
    return String(raw === undefined || raw === null ? "" : raw)
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  var ALIASES = {
    openai: {
      "luna": "gpt-5.6-luna", "gpt-5.6-luna": "gpt-5.6-luna", "gpt5.6-luna": "gpt-5.6-luna",
      "terra": "gpt-5.6-terra", "gpt5.6-terra": "gpt-5.6-terra",
      "astra": "gpt-6-astra", "gpt-6": "gpt-6-astra", "gpt6": "gpt-6-astra",
      "gpt-5.6": "gpt-5.6-terra", "gpt-6-astra": "gpt-6-astra",
      "chatgpt": "gpt-5.6-luna", "chat-latest": "gpt-5.6-luna",
      "chatgpt-4o-mini": "gpt-4o-mini", "chatgpt-4o": "gpt-4o-mini",
      "oss-120b": "gpt-oss-120b", "gpt-oss": "gpt-oss-120b"
    },
    deepseek: {
      "flash": "deepseek-flash", "v4": "deepseek-flash", "v4-flash": "deepseek-flash",
      "v4.1": "deepseek-flash", "v4.1-flash": "deepseek-flash",
      "deepseek-v4.1-flash": "deepseek-flash", "deepseek-v41-flash": "deepseek-flash",
      "v4-pro": "deepseek-v4-pro", "deepseek-v4-pro-0813": "deepseek-v4-pro",
      "chat": "deepseek-flash", "reasoner": "deepseek-flash", "r1": "deepseek-flash",
      "v3": "deepseek-flash", "v3.2": "deepseek-flash"
    },
    anthropic: {
      "haiku": "claude-haiku-4-5", "sonnet": "claude-sonnet-5",
      "opus": "claude-opus-5-5", "fable": "claude-fable-5-1",
      "claude": "claude-sonnet-5", "claude-5": "claude-sonnet-5"
    },
    gemini: {
      "flash": "gemini-3.8-flash", "gemini-flash": "gemini-3.8-flash",
      "flash-lite": "gemini-3.8-flash-lite", "gemini-flash-lite": "gemini-3.8-flash-lite",
      "lite": "gemini-3.8-flash-lite",
      "pro": "gemini-3.1-pro-preview", "gemini": "gemini-3.8-flash",
      "gemini-pro": "gemini-3.1-pro-preview"
    },
    ollama: {}
  };

  /* Ids na ni-retire na ng providers (o lumang default natin). Ang
     naka-save na setting na tumutukoy sa mga ito ay 404, kaya
     tahimik natin itong inililipat sa model na gumagana ngayon.
     2.5-flash is in this list: Google cut it off for new keys, so the
     old default would have failed on every single message. */
  var RETIRED = {
    "gemini-2.5-flash": "gemini-3.8-flash",
    "gemini-2.5-flash-lite": "gemini-3.8-flash-lite",
    "gemini-2.5-pro": "gemini-3.1-pro-preview",
    "gemini-2.0-flash": "gemini-3.8-flash",
    "gemini-2.0-flash-lite": "gemini-3.8-flash-lite",
    "gemini-2.0-flash-exp": "gemini-3.8-flash",
    "gemini-flash-exp": "gemini-3.8-flash",
    "gemini-flash-latest": "gemini-3.8-flash",
    "gemini-3.1-flash-lite-preview": "gemini-3.8-flash-lite",
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gpt-5-chat-latest": "gpt-5.6-luna",
    "gpt-5.1-chat-latest": "gpt-5.6-luna",
    "gpt-5.1-codex": "gpt-5.6-luna",
    "gpt-5-mini": "gpt-5.6-luna",
    "gpt-5-nano": "gpt-5.6-luna",
    "o1": "gpt-5.6-luna", "o1-mini": "gpt-5.6-luna", "o3": "gpt-5.6-luna",
    "o3-mini": "gpt-5.6-luna", "o4-mini": "gpt-5.6-luna",
    "claude-sonnet-4-20250514": "claude-sonnet-5",
    "claude-opus-4-20250514": "claude-opus-5-5",
    "claude-3-7-sonnet-latest": "claude-sonnet-5",
    "claude-3-5-sonnet-latest": "claude-sonnet-5",
    "claude-3-5-haiku-latest": "claude-haiku-4-5",
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
    "deepseek-v3": "deepseek-flash"
  };

  function inTable(provider, id) {
    var list = modelsOf(provider);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }

  function resolveModel(provider, raw) {
    var input = String(raw === undefined || raw === null ? "" : raw).trim();
    if (!input) return "";
    if (inTable(provider, input)) return input;
    var key = normalizeId(input);
    if (!key) return "";
    if (inTable(provider, key)) return key;
    var alias = ALIASES[provider] || {};
    if (alias[key]) return alias[key];
    if (RETIRED[key]) return RETIRED[key];
    return input;                     /* custom id: huwag pakialaman */
  }

  var MODEL_PREFIX = [
    ["deepseek", /^deepseek-/],
    ["gemini", /^gemini-/],
    ["anthropic", /^claude-/],
    ["openai", /^(gpt|chatgpt|chat-latest|o[1-9][0-9]?(-|$))/]
  ];

  function providerOfModel(raw) {
    var key = normalizeId(raw);
    if (!key) return null;
    var names = providerIds();
    for (var i = 0; i < names.length; i++) if (inTable(names[i], key)) return names[i];
    for (var j = 0; j < MODEL_PREFIX.length; j++) {
      if (MODEL_PREFIX[j][1].test(key)) return MODEL_PREFIX[j][0];
    }
    return null;
  }

  function omitTemperature(provider, model) {
    var p = AI[provider];
    if (!p || !p.omitTemp) return false;
    return p.omitTemp.test(normalizeId(model));
  }

  /* ============================================================
     4. KEY HELPERS (mask, prefix check, failover list)
     ============================================================ */

  /** sk-abcd...1234 -> para hindi kailanman lumabas ang buong key. */
  function mask(key) {
    var k = String(key || "");
    if (k.length <= 10) return k ? k.slice(0, 2) + "\u2026" : "";
    return k.slice(0, 6) + "\u2026" + k.slice(-4);
  }

  /** Stable id para sa isang key (para malinis na mabura sa UI). */
  function keyId(key) {
    var h = 5381;
    for (var i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) & 0xffffffff;
    return "k" + (h >>> 0).toString(36);
  }

  /** Aling provider ang karapat-dapat sa ganitong key shape? */
  function providerHintFor(key) {
    var k = String(key || "").trim();
    if (/^(aiza|aq\.)/i.test(k)) return "gemini";
    if (/^sk-ant-/i.test(k)) return "anthropic";
    if (/^sk-/i.test(k)) return "openai";              /* openai o deepseek */
    if (/^[0-9a-f]{32}$/i.test(k)) return "deepseek";
    return null;
  }

  function shapeOk(provider, key) {
    var p = AI[provider];
    if (!p || !p.keyPrefix) return { ok: true };
    var k = String(key || "").trim();
    if (p.keyPrefix.test(k)) return { ok: true };
    var hint = providerHintFor(k);
    var better = hint && hint !== provider ? AI[hint] : null;
    return {
      ok: false,
      message: "This does not look like a " + p.label + " key (" + p.keyHint + ")." +
        (better ? " It looks like a " + better.label + " key - move it under \"" + hint + "\" in keys.local.json." : "")
    };
  }

  /** Normalize KEYS entries: "sk-x" at {key:"sk-x",label:"..."} */
  function asEntries(provider, raw, source) {
    var out = [];
    if (raw === undefined || raw === null) return out;
    var list = Array.isArray(raw) ? raw : [raw];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item) continue;
      var key = typeof item === "string" ? item : item.key;
      var label = typeof item === "string" ? "" : (item.label || "");
      key = String(key || "").trim();
      if (!key) continue;
      out.push({ key: key, label: label, source: source });
    }
    return out;
  }

  function withMeta(entry) {
    return {
      id: entry.source + ":" + keyId(entry.key),
      preview: mask(entry.key),
      label: entry.label || (entry.source === "env" ? "from environment" : entry.source === "inline" ? "from api.js" : "added here"),
      source: entry.source,
      removable: entry.source === "store"
    };
  }

  /* ============================================================
     5. KEY STORE + STATUS
        Nasaan naroon ang keys mo:
          .env              (unang maaaring basahin)
          keys.local.json   (i Settings UI, o kamay)
          environment vars  (OPENAI_API_KEY, ...)
          KEYS sa file na ito - HINDI na ginagamit, para
                              manatiling walang key ang nasa git.
        Precedence:  env/.env > keys.local.json > inline KEYS.
     ============================================================ */

  function memoryIO(seed) {
    var files = seed || {};
    return {
      readText: function (f) { return files[f] === undefined ? null : files[f]; },
      writeText: function (f, t) { files[f] = t; },
      env: function () { return undefined; },
      files: files
    };
  }

  function createAPI(io, options) {
    var fs = io || memoryIO();
    var opts = options || {};
    var STORE_FILE = opts.storeFile || "keys.local.json";
    var VERSION = opts.version || "2.0.0";

    function readStore() {
      var raw = null;
      try { raw = fs.readText(STORE_FILE); } catch (e) {
        return { data: {}, broken: "Could not read " + STORE_FILE + ": " + (e && e.message || e) };
      }
      if (!raw) return { data: {}, broken: null };
      try {
        var j = JSON.parse(raw);
        if (!j || typeof j !== "object" || Array.isArray(j)) {
          return { data: {}, broken: STORE_FILE + " must contain an object" };
        }
        return { data: j, broken: null };
      } catch (e) {
        return { data: {}, broken: STORE_FILE + " is not valid JSON (" + (e && e.message) + ")" };
      }
    }

    function writeStore(data) {
      fs.writeText(STORE_FILE, JSON.stringify(data, null, 2) + "\n");
      return data;
    }

    /** Lahat ng keys ng isang provider, in order: env, file, api.js. */
    function keyEntries(provider) {
      var p = AI[provider];
      if (!p) return [];
      var raw = [];
      var names = p.env || [];
      for (var i = 0; i < names.length; i++) {
        var v = null;
        try { v = fs.env(names[i]); } catch (e) { v = null; }
        raw = raw.concat(asEntries(provider, v, "env"));
      }
      raw = raw.concat(asEntries(provider, readStore().data[provider], "store"));
      raw = raw.concat(asEntries(provider, KEYS[provider], "inline"));
      var seen = {}, list = [];
      for (var j = 0; j < raw.length; j++) {
        if (seen[raw[j].key]) continue;
        seen[raw[j].key] = 1;
        list.push(raw[j]);
      }
      return list;
    }

    function keyPlan(provider) { return keyEntries(provider); }

    /** Magdagdag ng key papuntang keys.local.json (nagagamit ng UI). */
    function addKey(provider, key, label, force) {
      var p = AI[provider];
      if (!p) return { ok: false, error: "Unknown provider: " + provider };
      var value = String(key || "").trim();
      if (!value) return { ok: false, error: "The key is empty." };

      var shape = shapeOk(provider, value);
      if (!shape.ok && !force) return { ok: false, error: shape.message, mismatch: true };

      var store = readStore();
      var all = keyEntries(provider);
      for (var i = 0; i < all.length; i++) {
        if (all[i].key === value) {
          return { ok: false, error: "That key is already in use for " + p.label + " (source: " + all[i].source + ")." };
        }
      }
      var list = Array.isArray(store.data[provider]) ? store.data[provider].slice() : [];
      list.push({ key: value, label: String(label || "").trim(), addedAt: Date.now() });
      store.data[provider] = list;
      writeStore(store.data);
      return {
        ok: true,
        warning: shape.ok ? null : shape.message,
        entry: withMeta({ key: value, label: label, source: "store" })
      };
    }

    /** Burahin ang key na naidagdag sa UI. Ang nasa api.js/env ay read-only. */
    function removeKey(provider, id) {
      var p = AI[provider];
      if (!p) return { ok: false, error: "Unknown provider: " + provider };
      var store = readStore();
      var list = Array.isArray(store.data[provider]) ? store.data[provider].slice() : [];
      var kept = [], removed = null;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var key = String(typeof item === "string" ? item : (item && item.key) || "").trim();
        var meta = withMeta({ key: key, label: "", source: "store" });
        if (meta.id === id) { removed = meta; continue; }
        kept.push(item);
      }
      if (!removed) {
        return { ok: false, error: "That key is not in " + STORE_FILE + " - edit keys.local.json (or the environment) to remove it." };
      }
      if (kept.length) store.data[provider] = kept;
      else delete store.data[provider];
      writeStore(store.data);
      return { ok: true, removed: removed };
    }

    /** Mga bagay na dapat mong malaman: maling provider, doble, sira ang file. */
    function warnings() {
      var out = [];
      var store = readStore();
      if (store.broken) out.push(store.broken);

      var byKey = {};
      for (var i = 0; i < ORDER.length; i++) {
        var id = ORDER[i];
        var list = keyEntries(id);
        var bad = 0;
        for (var j = 0; j < list.length; j++) {
          var k = list[j].key;
          var shape = shapeOk(id, k);
          if (!shape.ok) {
            bad++;
            out.push(AI[id].label + " " + mask(k) + ": " + shape.message);
          }
          if (!byKey[k]) byKey[k] = [];
          byKey[k].push(AI[id].label);
        }
        if (id !== "ollama" && id !== "bokskie-local" && list.length && bad === list.length && bad > 1) {
          out.push("Every key saved for " + AI[id].label + " looks like it belongs to another provider.");
        }
      }
      Object.keys(byKey).forEach(function (k) {
        if (byKey[k].length > 1) {
          out.push("The same key " + mask(k) + " is listed under " + byKey[k].join(" and ") +
            ". Keep it under one provider only.");
        }
      });
      return out;
    }

    function providerStatus(id) {
      var p = AI[id];
      var local = p.auth === "none";
      var entries = keyEntries(id);
      return {
        id: id,
        label: p.label,
        note: p.note,
        keyUrl: p.keyUrl,
        keyHint: p.keyHint,
        base: p.base,
        local: local,
        connected: local || entries.length > 0,
        keyCount: entries.length,
        keys: entries.map(withMeta),
        models: modelsOf(id),
        defaultModel: defaultModel(id)
      };
    }

    function status() {
      return {
        ok: true,
        backend: "bokskie-server",
        version: VERSION,
        storeFile: STORE_FILE,
        providers: ORDER.map(providerStatus),
        warnings: warnings()
      };
    }

    return {
      version: VERSION,
      storeFile: STORE_FILE,
      providers: providerIds,
      info: info,
      modelsOf: modelsOf,
      defaultModel: defaultModel,
      resolveModel: resolveModel,
      normalizeId: normalizeId,
      providerOfModel: providerOfModel,
      omitTemperature: omitTemperature,
      providerHintFor: providerHintFor,
      shapeOk: shapeOk,
      mask: mask,
      keyEntries: keyEntries,
      keyPlan: keyPlan,
      addKey: addKey,
      removeKey: removeKey,
      warnings: warnings,
      status: status,
      buildRequest: buildRequest,
      decoder: decoder,
      summarizeError: summarizeError
    };
  }

  /* ============================================================
     6. REQUEST BUILDER - isang function, lahat ng provider
        (ito ang ginagamit ng server.js para sa bawat request)
     ============================================================ */

  function buildRequest(provider, req, key) {
    var p = AI[provider];
    if (!p) return null;
    var r = req || {};
    var model = resolveModel(provider, r.model) || p.defaultModel;
    var history = Array.isArray(r.messages) ? r.messages : [];
    var system = r.system ? String(r.system) : "";
    var base = String(r.baseUrl || p.base).replace(/\/+$/, "");
    var maxTokens = r.maxTokens || 4096;

    var headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (key) {
      if (p.auth === "bearer") headers.Authorization = "Bearer " + key;
      else if (p.auth === "x-api-key") {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
      } else if (p.auth === "x-goog-api-key") headers["x-goog-api-key"] = key;
    }

    var hot = !omitTemperature(provider, model);
    var temp = typeof r.temperature === "number" ? r.temperature : 0.7;
    var url, body, m, i;

    if (p.dialect === "anthropic") {
      /* Anthropic does not accept a system message inside messages: it
         has to be a top-level "system" field. */
      var msgs = [];
      for (i = 0; i < history.length; i++) {
        m = history[i];
        if (!m || m.role === "system") continue;
        msgs.push({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content === undefined || m.content === null ? "" : m.content)
        });
      }
      url = base + "/v1/messages";
      body = { model: model, max_tokens: maxTokens, messages: msgs, stream: true };
      if (system) body.system = system;
      if (hot) body.temperature = temp;

    } else if (p.dialect === "gemini") {
      var contents = [];
      for (i = 0; i < history.length; i++) {
        m = history[i];
        if (!m) continue;
        contents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: String(m.content === undefined || m.content === null ? "" : m.content) }]
        });
      }
      url = base + "/models/" + model + ":streamGenerateContent?alt=sse";
      body = { contents: contents, generationConfig: { maxOutputTokens: maxTokens } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (hot) body.generationConfig.temperature = temp;

    } else {
      /* OpenAI-compatible: OpenAI, DeepSeek, Ollama, at kahit anong
         proxy / LM Studio / OpenRouter na OpenAI-shaped. */
      var messages = [];
      if (system) messages.push({ role: "system", content: system });
      for (i = 0; i < history.length; i++) {
        m = history[i];
        if (!m) continue;
        messages.push({
          role: m.role,
          content: String(m.content === undefined || m.content === null ? "" : m.content)
        });
      }
      url = base + "/chat/completions";
      body = { model: model, messages: messages, stream: true };
      if (hot) body.temperature = temp;
    }

    return {
      provider: provider,
      model: model,
      url: url,
      method: "POST",
      headers: headers,
      body: body,
      json: JSON.stringify(body)
    };
  }

  /* ============================================================
     7. STREAM DECODER - lahat ng provider ay ginagawang isang
        simpleng "delta" event, kaya isa lang ang parser sa UI.
     ============================================================ */

  function errMessage(e) {
    if (!e) return "Unknown provider error";
    if (typeof e === "string") return e;
    if (e.message) return String(e.message);
    try { return JSON.stringify(e); } catch (err) { return "Provider error"; }
  }

  function decoder(provider) {
    var dialect = (AI[provider] || AI.openai).dialect;
    var buffer = "";
    var finished = false;

    function parse(data) {
      var events = [];
      if (!data || data === "[DONE]") return events;
      var j;
      try { j = JSON.parse(data); } catch (e) { return events; }
      if (j.error && !j.choices && !j.candidates) {
        events.push({ type: "error", message: errMessage(j.error) });
        return events;
      }

      if (dialect === "anthropic") {
        if (j.type === "content_block_delta" && j.delta && j.delta.text) {
          events.push({ type: "delta", text: j.delta.text });
        } else if (j.type === "message_stop" || (j.delta && j.delta.stop_reason)) {
          events.push({ type: "done" });
        } else if (j.type === "error") {
          events.push({ type: "error", message: errMessage(j.error || j) });
        }
        return events;
      }

      if (dialect === "gemini") {
        if (j.promptFeedback && j.promptFeedback.blockReason) {
          events.push({ type: "error", message: "Google blocked this prompt: " + j.promptFeedback.blockReason });
        }
        var c = j.candidates && j.candidates[0];
        if (c && c.content && c.content.parts) {
          for (var i = 0; i < c.content.parts.length; i++) {
            var part = c.content.parts[i];
            /* Thinking models (2.5 / 3.x) put the reasoning summary in
               the SAME parts array, flagged with "thought": true. Google
               streams those before the real answer, and they often quote
               the system prompt back verbatim - so rendering them dumps
               unrelated text (e.g. Vue instructions) into the reply.
               Only the non-thought parts are the actual answer. */
            if (part.thought) continue;
            var t = part.text;
            if (t) events.push({ type: "delta", text: t });
          }
        }
        if (c && c.finishReason) events.push({ type: "done" });
        return events;
      }

      var ch = j.choices && j.choices[0];
      if (ch && ch.delta && typeof ch.delta.content === "string" && ch.delta.content) {
        events.push({ type: "delta", text: ch.delta.content });
      }
      if (ch && ch.finish_reason) events.push({ type: "done" });
      return events;
    }

    function lineEvents(line) {
      var s = String(line).trim();
      if (!s || s.charAt(0) === ":" || s.indexOf("data:") !== 0) return [];
      var data = s.slice(5).trim();
      if (data === "[DONE]") {
        if (finished) return [];
        finished = true;
        return [{ type: "done" }];
      }
      if (finished) return [];
      return parse(data);
    }

    return {
      /** I-feed ang raw bytes (text) galing sa provider. */
      push: function (text) {
        buffer += String(text === undefined || text === null ? "" : text);
        var parts = buffer.split(/\r?\n/);
        buffer = parts.pop();
        var events = [];
        for (var i = 0; i < parts.length; i++) events = events.concat(lineEvents(parts[i]));
        return events;
      },
      /** Tawagin sa dulo para sa natirang partial line. */
      flush: function () {
        var rest = buffer;
        buffer = "";
        return rest ? lineEvents(rest) : [];
      },
      isFinished: function () { return finished; }
    };
  }

  /* ============================================================
     8. ERROR TRANSLATION - imbes na "HTTP 401" lang, sabihin kung
        ano ang nangyari at ano ang dapat gawin.
     ============================================================ */

  function extractMessage(text) {
    var raw = String(text === undefined || text === null ? "" : text);
    if (!raw) return "";
    try {
      var j = JSON.parse(raw);
      if (j.error) return errMessage(j.error);
      if (j.message) return String(j.message);
      if (j.detail) return String(j.detail);
    } catch (e) { /* hindi JSON */ }
    return raw.length > 400 ? raw.slice(0, 400) + "\u2026" : raw;
  }

  function summarizeError(provider, status, text) {
    var p = AI[provider] || AI.openai;
    var s = Number(status) || 0;
    var detail = extractMessage(text);
    var out = {
      status: s,
      provider: provider,
      providerLabel: p.label,
      detail: detail,
      retryWithAnotherKey: false,
      message: ""
    };

    if (!s) {
      out.retryWithAnotherKey = true;
      out.message = "Could not reach " + p.label + " from this PC. Check the internet connection" +
        (provider === "ollama"
          ? " and make sure Ollama is running (ollama serve)."
          : ", the firewall, or a VPN/proxy.");
      return out;
    }
    /* OpenAI does NOT use 402 for "out of credits" - it answers 429 with
       code "insufficient_quota" (or "billing_hard_limit_reached"). Matching
       only the status code made a dead account look like a plain rate
       limit, which sends people off waiting for a reset that never comes.
       So look at the body first, then fall back to the status. */
    var noCredit = /insufficient[_-]?quota|billing[_-]?hard[_-]?limit|billing[_-]?not[_-]?active|exceeded your current quota|add (a )?(payment|billing|credit)|no credit|out of credit|402/i.test(String(text || ""));

    if (noCredit) {
      out.retryWithAnotherKey = true;
      out.message = "Walang credit ang " + p.label + " account mo.\n\n" +
        "Note: hindi kasama ang ChatGPT Plus/Pro subscription mo dito - " +
        "hiwalay na billing ang API. Mag-add ng payment method sa " +
        (p.keyUrl ? p.keyUrl : "provider dashboard") + " at i-check ang Billing tab.\n\n" +
        "O lumipat sa libre: Google Gemini Flash (free tier, walang card) " +
        "o Ollama (local, 100% libre).";
    } else if (s === 401 || s === 403) {
      out.retryWithAnotherKey = true;
      out.message = "The " + p.label + " key was rejected (HTTP " + s + "). " + p.keyHint +
        ". Add or replace the key in keys.local.json (or add it in Settings), tapos subukan ulit.";
    } else if (s === 402) {
      out.retryWithAnotherKey = true;
      out.message = "Walang balance/credits ang " + p.label + " account mo (HTTP 402). Mag-top up, " +
        "o lumipat sa libre: Google Gemini Flash (free tier) o Ollama (local).";
    } else if (s === 429) {
      out.retryWithAnotherKey = true;
      out.message = "Rate limited ang " + p.label + " (HTTP 429). Kung may dagdag kang key sa keys.local.json, " +
        "susubukan ng bokskie ang susunod na key. Kung wala, maghintay muna o lumipat ng model.";
    } else if (s === 400 || s === 404 || s === 422) {
      out.message = "Tinanggihan ng " + p.label + " ang request (HTTP " + s + "). Karaniwang mali ang " +
        "model id - buksan ang Settings at pumili ng model na kasama sa listahan ng " + p.label + ".";
    } else if (s >= 500) {
      out.retryWithAnotherKey = true;
      out.message = p.label + " is having problems right now (HTTP " + s + "). Subukan ulit pagkalipas ng ilang segundo.";
    } else {
      out.message = p.label + " returned HTTP " + s + ".";
    }
    if (detail && out.message.indexOf(detail) === -1) out.message += "\n\nProvider said: " + detail;
    return out;
  }

  /* ============================================================
     9. EXPORTS
     ============================================================ */
  return {
    KEYS: KEYS,
    VERSION: "2.0.0",
    providers: providerIds,
    info: info,
    modelsOf: modelsOf,
    defaultModel: defaultModel,
    resolveModel: resolveModel,
    normalizeId: normalizeId,
    providerOfModel: providerOfModel,
    omitTemperature: omitTemperature,
    providerHintFor: providerHintFor,
    mask: mask,
    buildRequest: buildRequest,
    decoder: decoder,
    summarizeError: summarizeError,
    memoryIO: memoryIO,
    createAPI: createAPI
  };
});


