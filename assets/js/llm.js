/* ==========================================================
   bokskie.ai - LLM provider layer
   Supports: OpenAI, Anthropic, Google Gemini, Ollama, Demo
   All streaming via ReadableStream + SSE parsing.
   ========================================================== */
(function (global) {
  "use strict";

  /* ---------- providers ----------
     One table drives the settings modal: the default endpoint, where to
     get a key, and what a key for that provider should look like. The
     key prefix matters because a wrong-provider key is the single most
     common reason a request fails with 401. Keep in sync with MODELS. */

  /* `cost` drives the badge on each provider card, so the money
     situation is visible before you paste a key - not buried in a
     tooltip nobody reads. A ChatGPT subscription pays for none of
     these, so the badge is the fastest way to avoid that surprise. */
  var COST = {
    free:      { label: "Free",         cls: "c-free",  note: "No key, no cost. Runs on your own machine." },
    local:     { label: "Free \u00b7 local", cls: "c-local", note: "No cost at all - the model runs on your own PC." },
    freemium:  { label: "Free tier",    cls: "c-free",  note: "Some models are genuinely free of charge, just rate limited. No card needed. Only the Pro models are paid." },
    paidCheap: { label: "Paid \u00b7 cheap", cls: "c-paid", note: "Needs credit on your account, but far cheaper than OpenAI or Anthropic." },
    paid:      { label: "Paid",         cls: "c-paid",  note: "Needs a payment method and credit on the API account before a single call works." }
  };

  var PROVIDERS = {
    demo: {
      label: "Demo",
      base: "",
      keyUrl: "",
      cost: "free",
      keyHint: "No key needed \u2014 this is an offline script.",
      note: "Nothing leaves your machine. Replies are canned samples, not real answers \u2014 demo mode cannot actually think."
    },
    openai: {
      label: "OpenAI",
      base: "https://api.openai.com/v1",
      keyUrl: "https://platform.openai.com/api-keys",
      cost: "paid",
      keyHint: "OpenAI keys start with sk-",
      note: "Paid, pay-as-you-go. You MUST add a payment method and credit under Settings \u2192 Billing first. A ChatGPT Plus/Pro subscription does NOT include API credit. GPT-5.6 Luna is the cheapest tier, GPT-6 Astra the strongest."
    },
    deepseek: {
      label: "DeepSeek",
      base: "https://api.deepseek.com",
      keyUrl: "https://platform.deepseek.com/api_keys",
      cost: "paidCheap",
      keyHint: "DeepSeek keys start with sk-",
      note: "Same key format as OpenAI, and NOT free \u2014 you still top up a balance. But it is dramatically cheaper than OpenAI (cheaper again off-peak, UTC). A good first paid option if Gemini is rate-limiting you."
    },
    anthropic: {
      label: "Anthropic",
      base: "https://api.anthropic.com",
      keyUrl: "https://console.anthropic.com/settings/keys",
      cost: "paid",
      keyHint: "Anthropic keys start with sk-ant-",
      note: "Paid. Needs credit on the API console before any call works. Claude Haiku 4.5 is the cheapest Claude."
    },
    gemini: {
      label: "Google Gemini",
      base: "https://generativelanguage.googleapis.com/v1beta",
      keyUrl: "https://aistudio.google.com/app/apikey",
      cost: "freemium",
      keyHint: "Google keys start with AIza (or AQ. for newer keys)",
      note: "Genuinely free tier \u2014 no card required. Flash and Flash-Lite are free of charge, just rate limited. This is the best zero-cost option with a real model behind it. Only the Pro models are paid."
    },
    ollama: {
      label: "Ollama",
      base: "http://localhost:11434/v1",
      keyUrl: "",
      cost: "local",
      keyHint: "Ollama ignores the key \u2014 leave it blank.",
      note: "Free and fully local, unlimited and offline. Install from ollama.com/download, run `ollama serve`, then `ollama pull llama3.2`. Needs a decent PC for the larger models."
    },
    "bokskie-local": {
      label: "bokskie.ai",
      base: "",
      keyUrl: "",
      cost: "free",
      keyHint: "No key needed \u2014 it runs entirely on your machine.",
      note: "An offline retrieval engine, not a language model. It looks your question up in a hand-written knowledge bank and returns the closest real answer \u2014 and when nothing is close enough it says so instead of guessing. Correct for what it covers, honest about the rest. Use Gemini for real AI."
    }
  };

  var MODELS = {
    demo: [
      { id: "bokskie-1", label: "bokskie-1", sub: "Demo (offline)" },
      { id: "bokskie-fast", label: "bokskie-fast", sub: "Demo (offline)" }
    ],
    openai: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", sub: "OpenAI \u00b7 cheapest", tag: "Cheap" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", sub: "OpenAI \u00b7 balanced" },
      { id: "gpt-6-astra", label: "GPT-6 Astra", sub: "OpenAI \u00b7 flagship", tag: "Flagship" },
      { id: "gpt-oss-120b", label: "gpt-oss-120b", sub: "OpenAI \u00b7 open weights" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", sub: "OpenAI \u00b7 older, still served" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", sub: "OpenAI \u00b7 older, still served" }
    ],
    deepseek: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", sub: "DeepSeek \u00b7 cheapest", tag: "Cheap" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", sub: "DeepSeek \u00b7 now served by V4.1 Flash" }
    ],
    anthropic: [
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", sub: "Anthropic \u00b7 cheapest", tag: "Cheap" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", sub: "Anthropic \u00b7 balanced" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", sub: "Anthropic \u00b7 flagship", tag: "Flagship" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", sub: "Anthropic \u00b7 deep reasoning" }
    ],
    gemini: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", sub: "Google \u00b7 default \u00b7 free tier", tag: "Free" },
      { id: "gemini-3.8-flash-lite", label: "Gemini 3.8 Flash-Lite", sub: "Google \u00b7 cheapest + fastest", tag: "Free" },
      { id: "gemini-flash-latest", label: "Gemini Flash (latest)", sub: "Google \u00b7 auto-updating alias" },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", sub: "Google \u00b7 previous flash" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", sub: "Google \u00b7 previous flash" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", sub: "Google \u00b7 best answers \u00b7 paid" }
    ],
    ollama: [
      { id: "llama3.2", label: "Llama 3.2", sub: "Ollama" },
      { id: "llama3.1", label: "Llama 3.1", sub: "Ollama" },
      { id: "qwen2.5", label: "Qwen 2.5", sub: "Ollama" },
      { id: "mistral", label: "Mistral", sub: "Ollama" }
    ],
    /* No second card for "your own API" - that is a different product
       decision, not a relabel. */
    "bokskie-local": [
      { id: "bokskie.v1", label: "bokskie.v1", sub: "Offline \u00b7 own knowledge bank \u00b7 no key", tag: "Free" },
      { id: "bokskie.v1-verbose", label: "bokskie.v1 + translations", sub: "Adds the other two languages" }
    ]
  };

  function modelsFor(provider) {
    return MODELS[provider] || MODELS.demo;
  }

  function defaultModel(provider) {
    var m = modelsFor(provider);
    return m.length ? m[0].id : "";
  }

  function providerInfo(provider) {
    return PROVIDERS[provider] || PROVIDERS.demo;
  }

  /** The money story for a provider, for the card badge and tooltips. */
  function costOf(provider) {
    var info = providerInfo(provider);
    return COST[info.cost] || COST.free;
  }

  /* ---------- model naming ----------
     People type "GPT-5.6 Luna", "gemini flash" or "deepseek v4 flash".
     The API wants gpt-5.6-luna, gemini-3.8-flash, deepseek-flash. So we
     squash whatever was typed into a slug, look it up, and hand back the
     real id \u2014 anything we do not recognise is passed through untouched,
     which keeps custom ids (OpenRouter, local servers) working.        */

  function normalizeId(raw) {
    return String(raw === undefined || raw === null ? "" : raw)
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /* Friendly names -> real ids. */
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

  /* Ids the providers have retired, or that we used to ship as defaults.
     A saved setting that points at one of these would 404, so we quietly
     move it to the model that serves it today. */
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
    "gemini-3-pro-preview": "gemini-2.5-pro",
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
    /* DeepSeek still accepts these two names, but they route to V4.1 Flash,
       so point them at the canonical id instead of a name that may vanish. */
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
    "deepseek-v3": "deepseek-flash"
  };

  function inTable(provider, id) {
    var list = modelsFor(provider);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return true;
    }
    return false;
  }

  /** "GPT-5.6 Luna" -> "gpt-5.6-luna". Unknown ids are left alone. */
  function resolveModel(provider, raw) {
    var input = String(raw === undefined || raw === null ? "" : raw).trim();
    if (!input) return "";
    if (inTable(provider, input)) return input;      // exact, keep it as typed
    var key = normalizeId(input);
    if (!key) return "";
    if (inTable(provider, key)) return key;
    var alias = ALIASES[provider] || {};
    if (alias[key]) return alias[key];
    if (RETIRED[key]) return RETIRED[key];
    return input;                                    // custom id: hands off
  }

  /* Which provider does a model id belong to? Used to catch the classic
     "DeepSeek model on the OpenAI endpoint" mistake before it 401s. */
  var MODEL_PREFIX = [
    ["deepseek", /^deepseek-/],
    ["gemini", /^gemini-/],
    ["anthropic", /^claude-/],
    ["openai", /^(gpt|chatgpt|chat-latest|o[1-9][0-9]?(-|$))/]
  ];

  function providerOfModel(raw) {
    var key = normalizeId(raw);
    if (!key) return null;
    var names = Object.keys(MODELS);
    for (var i = 0; i < names.length; i++) {
      if (inTable(names[i], key)) return names[i];
    }
    for (var j = 0; j < MODEL_PREFIX.length; j++) {
      if (MODEL_PREFIX[j][1].test(key)) return MODEL_PREFIX[j][0];
    }
    return null;
  }

  /* Reasoning-first models reject `temperature` outright, and sending it
     turns a perfectly good key into HTTP 400. GPT-5.6/GPT-6 and the
     o-series are in that group. DeepSeek V4.1 Flash thinks by default too,
     so we simply leave the field out for those two providers. */
  function omitTemperature(provider, model) {
    if (provider === "deepseek") return true;
    if (provider !== "openai") return false;
    var id = normalizeId(model);
    return /^(gpt-([5-9])|gpt-oss|o[1-9])/.test(id);
  }

  /* ---------- SSE reading ---------- */

  async function* sseLines(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    while (true) {
      var res = await reader.read();
      if (res.done) break;
      buffer += decoder.decode(res.value, { stream: true });
      var parts = buffer.split("\n");
      buffer = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim();
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  }

  async function readError(response) {
    var body = "";
    try { body = await response.text(); } catch (e) { /* ignore */ }
    var msg = body;
    try {
      var j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error)) || j.message || body;
      if (typeof msg !== "string") msg = JSON.stringify(msg);
    } catch (e) { /* not json */ }
    return "HTTP " + response.status + " - " + (msg || response.statusText);
  }

  function buildMessages(settings, history) {
    var msgs = [];
    if (settings.system) {
      msgs.push({ role: "system", content: settings.system });
    }
    history.forEach(function (m) {
      msgs.push({ role: m.role, content: m.content });
    });
    return msgs;
  }

  /* ---------- OpenAI / Ollama (OpenAI-compatible) ---------- */

  async function* streamOpenAI(settings, history, signal) {
    var provider = settings.provider === "deepseek" || settings.provider === "ollama"
      ? settings.provider
      : "openai";
    var base = (settings.baseUrl || providerInfo(provider).base).replace(/\/+$/, "");
    var model = settings.model || defaultModel(provider);

    var headers = { "Content-Type": "application/json" };
    /* Ollama ignores auth entirely, so a blank "Bearer " is just noise. */
    if (settings.key) headers.Authorization = "Bearer " + settings.key;

    var body = {
      model: model,
      messages: buildMessages(settings, history),
      stream: true
    };
    if (!omitTemperature(provider, model)) {
      body.temperature = typeof settings.temperature === "number" ? settings.temperature : 0.7;
    }

    var res = await fetch(base + "/chat/completions", {
      method: "POST",
      signal: signal,
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(await readError(res));

    for await (var line of sseLines(res)) {
      if (!line.startsWith("data:")) continue;
      var data = line.slice(5).trim();
      if (data === "[DONE]") break;
      try {
        var j = JSON.parse(data);
        var delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (delta && delta.content) yield delta.content;
      } catch (e) { /* skip malformed frame */ }
    }
  }

  /* ---------- Anthropic ---------- */

  async function* streamAnthropic(settings, history, signal) {
    var base = (settings.baseUrl || providerInfo("anthropic").base).replace(/\/+$/, "");
    var msgs = buildMessages(settings, history).filter(function (m) {
      return m.role !== "system";
    });

    var res = await fetch(base + "/v1/messages", {
      method: "POST",
      signal: signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: settings.model || defaultModel("anthropic"),
        max_tokens: 4096,
        system: settings.system || undefined,
        temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7,
        messages: msgs,
        stream: true
      })
    });

    if (!res.ok) throw new Error(await readError(res));

    for await (var line of sseLines(res)) {
      if (!line.startsWith("data:")) continue;
      var data = line.slice(5).trim();
      try {
        var j = JSON.parse(data);
        if (j.type === "content_block_delta" && j.delta && j.delta.text) {
          yield j.delta.text;
        }
      } catch (e) { /* skip */ }
    }
  }

  /* ---------- Google Gemini ---------- */

  async function* streamGemini(settings, history, signal) {
    var base = (settings.baseUrl || providerInfo("gemini").base).replace(/\/+$/, "");
    var model = settings.model || defaultModel("gemini");

    var contents = history.map(function (m) {
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      };
    });

    var res = await fetch(base + "/models/" + model + ":streamGenerateContent?alt=sse", {
      method: "POST",
      signal: signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.key },
      body: JSON.stringify({
        systemInstruction: settings.system ? { parts: [{ text: settings.system }] } : undefined,
        contents: contents,
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: typeof settings.temperature === "number" ? settings.temperature : 0.7
        }
      })
    });

    if (!res.ok) throw new Error(await readError(res));

    for await (var line of sseLines(res)) {
      if (!line.startsWith("data:")) continue;
      try {
        var j = JSON.parse(line.slice(5).trim());
        var parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
        // Skip thought parts (thinking models) - they are the model's
        // reasoning summary, not the answer. See the same guard in api.js.
        if (parts) for (var p of parts) { if (p.thought) continue; if (p.text) yield p.text; }
      } catch (e) { /* skip */ }
    }
  }
  /* ---------- Demo (offline, no key) ----------
     Demo mode is a script, not a brain. It cannot think, so it says
     so plainly. What it can do is answer in the voice of whichever
     mode is active and actually use what you typed, instead of
     repeating one canned paragraph forever.                        */

  function lastUser(history) {
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") return history[i].content;
    }
    return "";
  }

  // A real, working mini project so Build mode's file blocks, copy,
  // save and Download-all buttons are all genuinely exercised offline.
  var DEMO_SITE = [
    ["index.html", [
      "<!DOCTYPE html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"UTF-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      "  <title>Todos</title>",
      "  <link rel=\"stylesheet\" href=\"style.css\">",
      "</head>",
      "<body>",
      "  <main class=\"wrap\">",
      "    <h1>Todos</h1>",
      "    <form id=\"add\">",
      "      <input id=\"text\" placeholder=\"What needs doing?\" autocomplete=\"off\">",
      "      <button type=\"submit\">Add</button>",
      "    </form>",
      "    <ul id=\"list\"></ul>",
      "    <p class=\"count\" id=\"count\"></p>",
      "  </main>",
      "  <script src=\"app.js\"></script>",
      "</body>",
      "</html>"
    ].join("\n")],

    ["style.css", [
      ":root { --accent: #02969c; --bg: #0b0f12; --fg: #e8f1f2; }",
      "* { box-sizing: border-box; }",
      "body {",
      "  margin: 0; min-height: 100vh; display: grid; place-items: center;",
      "  font: 16px/1.5 system-ui, sans-serif;",
      "  background: var(--bg); color: var(--fg);",
      "}",
      ".wrap { width: min(440px, 92vw); }",
      "h1 { margin: 0 0 16px; font-size: 24px; }",
      "form { display: flex; gap: 8px; }",
      "input {",
      "  flex: 1; padding: 10px 12px; border-radius: 8px;",
      "  border: 1px solid #24323a; background: #111a1e; color: inherit;",
      "}",
      "button {",
      "  padding: 10px 18px; border: 0; border-radius: 8px; cursor: pointer;",
      "  background: var(--accent); color: #04252a; font-weight: 600;",
      "}",
      "ul { list-style: none; margin: 16px 0 0; padding: 0; }",
      "li {",
      "  display: flex; align-items: center; gap: 10px; padding: 10px 0;",
      "  border-bottom: 1px solid #1b262c;",
      "}",
      "li.done span { text-decoration: line-through; opacity: .5; }",
      "li span { flex: 1; }",
      "li button { background: none; color: #7d8f96; padding: 4px 8px; }",
      ".count { color: #7d8f96; font-size: 13px; }"
    ].join("\n")],

    ["app.js", [
      "const list = document.getElementById('list');",
      "const form = document.getElementById('add');",
      "const text = document.getElementById('text');",
      "const count = document.getElementById('count');",
      "",
      "let todos = [];",
      "",
      "function render() {",
      "  list.innerHTML = '';",
      "  todos.forEach((t, i) => {",
      "    const li = document.createElement('li');",
      "    if (t.done) li.className = 'done';",
      "    const span = document.createElement('span');",
      "    span.textContent = t.text;",
      "    const toggle = document.createElement('button');",
      "    toggle.textContent = 'v';",
      "    toggle.onclick = () => { todos[i].done = !todos[i].done; render(); };",
      "    const del = document.createElement('button');",
      "    del.textContent = 'x';",
      "    del.onclick = () => { todos.splice(i, 1); render(); };",
      "    li.append(span, toggle, del);",
      "    list.appendChild(li);",
      "  });",
      "  const left = todos.filter(t => !t.done).length;",
      "  count.textContent = left + ' left';",
      "}",
      "",
      "form.addEventListener('submit', (e) => {",
      "  e.preventDefault();",
      "  const v = text.value.trim();",
      "  if (!v) return;",
      "  todos.push({ text: v, done: false });",
      "  text.value = '';",
      "  render();",
      "});",
      "",
      "render();"
    ].join("\n")]
  ];

  function demoFiles() {
    return DEMO_SITE.map(function (f) {
      return '<file name="' + f[0] + '">\n' + f[1] + "\n</file>";
    }).join("\n\n");
  }

  // A short, real Vue lesson so Study mode teaches something usable.
  function vueLesson(last) {
    // brain.js may have flagged the user as a beginner. Say so out loud,
    // and set the pace, instead of dumping the whole thing on them.
    var novice = global.Brain && Brain.level === "beginner";
    var opener = novice
      ? "Starting from the top, since you are new to this.\n\n"
      : "";

    if (/\b(reactive|ref|reactiv)\b/i.test(last)) {
      return opener + "### `ref` vs `reactive`\n\n" +
        "**The idea first.** Both hold data that Vue watches. The only real\n" +
        "difference is the *shape* of the value.\n\n" +
        "- `reactive(obj)` takes an **object**. You edit it directly.\n" +
        "- `ref(x)` takes **anything**, but you reach the value through\n" +
        "  `.value` in JavaScript. The template unwraps it for you.\n\n" +
        "```js\n" +
        "import { ref, reactive } from 'vue'\n\n" +
        "const count = ref(0)                 // primitive\n" +
        "const form = reactive({ name: '' })  // object\n\n" +
        "count.value++          // in JavaScript\n" +
        "form.name = 'bokskie'   // no .value needed\n" +
        "```\n\n" +
        "In the template, `count` needs no `.value`:\n\n" +
        "```html\n" +
        "<script setup>\n" +
        "import { ref } from 'vue'\n" +
        "const count = ref(0)\n" +
        "</script>\n\n" +
        "<template>\n" +
        "  <button @click=\"count++\">{{ count }}</button>\n" +
        "</template>\n" +
        "```\n\n" +
        "**Watch out:** passing a `reactive` object into a function loses its\n" +
        "reactivity. Use `toRefs()` to destructure safely.\n\n" +
        "> **Your turn:** if you write `const n = ref(5)` and then `n++` in a\n" +
        "> plain `.js` file, what is wrong, and what would you write instead?";
    }

    return opener + "### Vue 3 in four parts\n\n" +
      "**1. A component is just a `.vue` file**, with three optional blocks:\n" +
      "`<script setup>`, `<template>`, and `<style scoped>`.\n\n" +
      "**2. `<script setup>` is the modern way** to write logic. Anything you\n" +
      "declare there is automatically available to the template.\n\n" +
      "**3. Data is a `ref`.** Change it and the screen updates itself.\n\n" +
      "**4. Events use `@`.** `@click=\"count++\"` means: on click, add one.\n\n" +
      "Here is the smallest useful component:\n\n" +
      "```html\n" +
      "<script setup>\n" +
      "import { ref } from 'vue'\n\n" +
      "const count = ref(0)\n" +
      "</script>\n\n" +
      "<template>\n" +
      "  <button @click=\"count++\">\n" +
      "    clicked {{ count }} times\n" +
      "  </button>\n" +
      "</template>\n" +
      "```\n\n" +
      "> **Your turn:** add a second button that sets `count` back to `0`.\n" +
      "> What would that line look like?";
  }

  /* Warm replies for "I'm tired", "I'm stuck" and friends.
     Demo mode asks brain.js what mood the message sounded like, then
     answers in that mood — and in the language the user wrote in. */
  var EMPATHY = {
    tired: {
      en: "Hey. You sound worn out, and that is a real signal, not a small one.\n\n" +
          "Take five minutes first. Water, stand up, look away from the screen. " +
          "Nothing is lost by stopping.\n\n" +
          "When you come back, do not stare at the whole problem at once. " +
          "Tell me the single thing you are stuck on and we will do just that.",
      tl: "Uy. Pagod ka na, at valid yan — hindi mo palalain.\n\n" +
          "Unang limang minuto, magpahinga ka muna. Tubig, umayo, lumingon " +
          "mula sa screen. Walang nawawalang oras.\n\n" +
          "Pagbalik mo, huwag mong tingnan lahat ng problema sabay-sabay. " +
          "Sabihin mo lang yung isang bagay na hindi mo gets, at ayusin " +
          "natin iyon lang."
    },
    stuck: {
      en: "Stuck is normal. It means the idea is real and you are at the " +
          "part where it actually starts to make sense.\n\n" +
          "Two things unstick almost everything:\n" +
          "1. What exactly is not working — the code, or the idea behind it?\n" +
          "2. What did you expect to happen instead?\n\n" +
          "Paste the code or describe the step, and we will go from there.",
      tl: "Normal lang mag-stuck. Ibig sabihin, toto na ang idea at doon ka " +
          "na sa parte kung saan nagsisimula talaga.\n\n" +
          "Dalawang bagay ang kumikapas ng halos lahat:\n" +
          "1. Ano ba talaga ang hindi gumagana — yung code, o yung idea?\n" +
          "2. Ano inaasahan mong mangyari?\n\n" +
          "I-paste mo yung code o i-describe mo yung step, at mula doon tayo."
    },
    confused: {
      en: "Okay, let's untangle it.\n\n" +
          "\"I don't get it\" can mean two different things, and they need " +
          "different help:\n" +
          "- The code does not do what you expected.\n" +
          "- The code works, but you do not know why.\n\n" +
          "Which one is it? Either way we can move.",
      tl: "Okay, ayusin natin 'to.\n\n" +
          "Magkaibaw ang ibig sabihin ng \"hindi ko gets\", at iba ang tulong " +
          "kailangan sa bawat isa:\n" +
          "- Hindi ginagawa ng code ang inaasahan mo.\n" +
          "- Gumagana naman, pero hindi mo alam bakit.\n\n" +
          "Alin yon? Kaya natin mag-move."
    },
    frustrated: {
      en: "That frustration is fair. Debugging is slow, and slow is not the " +
          "same as stuck.\n\n" +
          "Try this: find the single biggest error message, send me just that " +
          "line, and forget everything else for a minute. Most of the time the " +
          "first real error is the one that matters, and everything after it " +
          "is just noise.",
      tl: "Valid yung frustration. Mabagal mag-debug, at mabagal hindi " +
          "katumbas ng stuck.\n\n" +
          "Subukan mo ito: hanapin mo yung pinakamalaking error message, " +
          "ipadala mo lang yung isang line na yon, at kalimutan muna ang lahat. " +
          "Karamihan, yung unang totoong error ang may Saysay, at lahat ng " +
          "sumunod ay lagyan na lang."
    },
    happy: {
      en: "Good, ride that energy.\n\n" +
          "When something is working, the best next move is to make it " +
          "slightly harder. Tell me what you just got running and I will give " +
          "you one thing to try next.",
      tl: "Buo, samahan ko ang energy mo.\n\n" +
          "Kapag gumagana na yung isang bagay, ang best next move ay gawing " +
          "mas mahirap nang kaunti. Sabihin mo kung ano ang gumagana na, at " +
          "bibigyan ko ka ng isang bagay na susubukan mo."
    }
  };

  function empathyReply(text) {
    if (!global.Brain) return null;
    var mood = Brain.mood;
    if (!mood || !EMPATHY[mood]) return null;
    var set = EMPATHY[mood];
    var taglish = Brain.isTaglish(text);
    return set[taglish ? "tl" : "en"];
  }

  /* Is this question even about code? Demo mode has one fixed Vue
     lesson and nothing else, so handing that to someone who asked
     about a horror film makes the whole app look broken. When the
     question is off-topic we say so honestly instead. */
  var RE_STUDY_TOPIC = /\b(vue|nuxt|pinia|vuex|vue-router|react|angular|svelte|astro|nextjs|javascript|typescript|html|css|sass|scss|tailwind|bootstrap|node|express|nestjs|flutter|swift|kotlin|python|django|flask|php|laravel|react|golang|rust|sql|mysql|postgres|mongodb|firebase|supabase|graphql|git|github|api|json|html|coding|code|function|method|class|array|object|variable|loop|component|props|emits|computed|reactive|watcher|directive|lifecycle|composition|script setup|dom|async|await|promise|fetch|axios|regex|bug|error|debug|compile|error|npm|install|framework|library|algorithm|recursion)\b/i;

  function demoBuild() {
    return "Here is a complete, working project \u2014 three real files.\n\n" +
      "The add button, the tick-off, the delete and the counter all work\n" +
      "as-is. Each file gets its own **Copy** and **Save**, and the bar\n" +
      "underneath downloads all of them at once.\n\n" + demoFiles() + "\n\n" +
      "> Ask for changes in plain language \u2014 \"add categories\", \"save to\n" +
      "> localStorage\" \u2014 and once a real model is connected I will rewrite\n" +
      "> the files instead of only describing them.";
  }

  function demoReply(history, modeId) {
    var last = lastUser(history);
    var mode = global.Modes ? global.Modes.get(modeId) : null;
    var label = mode ? mode.label : "General";

    var banner = "**Demo mode** \u2014 I am running from a built-in script, not a\n" +
      "real model, so I cannot actually think. But I am answering as\n" +
      "**" + label + "** mode below.\n\n";

    // greetings stay short
    if (/\b(hello|hi|hey|kumusta|good (morning|evening))\b/i.test(last)) {
      return "Kumusta! \u2728\n\n" +
        "I booted in **Demo mode**, so I answer from a script. Pick a mode from\n" +
        "the chip above the composer and I will answer in that voice \u2014 or\n" +
        "paste an API key in **Settings** and I will actually think.\n\n" +
        "### Go live in 30 seconds\n" +
        "1. Click **Settings** (gear, bottom-left)\n" +
        "2. Choose **OpenAI** \u2014 or Anthropic / Gemini / Ollama\n" +
        "3. Paste your key and hit **Save**\n\n" +
        "Your key never leaves this browser.";
    }

    // If the message sounded tired, stuck or frustrated, answer THAT
    // first. Nobody wants a Vue lecture when they just said they are beat.
    var empathy = empathyReply(last);
    if (empathy) {
      return banner + empathy;
    }

    // Study voice. Teach ONLY when the question is actually about code.
    // Otherwise a "what's a good horror film?" in Study mode would get a
    // Vue lecture bolted onto the end - the exact bug this guards.
    if (modeId === "study") {
      if (RE_STUDY_TOPIC.test(last)) return banner + vueLesson(last);
      return banner + "I am in **Study** mode, which teaches Vue 3 \\u2014 but that " +
        "is not what you asked, and in Demo mode I only have a fixed script " +
        "for the lesson.\n\n" +
        "Ask me a **coding** question (Vue, JavaScript, CSS\\u2026) and I will " +
        "walk you through it, or switch the chip above the composer to " +
        "**General** for everyday questions.\n\n" +
        "> To get a real answer to this one, connect a provider in " +
        "**Settings** \\u2014 a key with credit, or Gemini Flash which is free.";
    }

    // Build voice: emit real, downloadable files
    if (modeId === "build") {
      if (/\b(thanks|thank you|ok|okay|cool|nice|great|good|bye|hello|hi|hey|sure|yes|no)\b/i.test(last)) {
        return banner + "I can only hand over finished files in Build mode, and " +
          "in Demo mode that always means the same sample project.\n\n" +
          "Ask for something specific \u2014 a todo app, a landing page, a " +
          "calculator \u2014 and once a real model is connected you will get a " +
          "brand-new project instead of this one.";
      }
      return banner + demoBuild();
    }

    // General voice
    if (/\b(code|script|function|python|javascript|html|css|program)\b/i.test(last)) {
      return banner + "A quick example:\n\n" +
        "```python\n" +
        "def greet(name: str) -> str:\n" +
        "    \"\"\"Return a friendly greeting.\"\"\"\n" +
        "    return f\"Hello, {name}! Welcome to bokskie.ai.\"\n\n" +
        "\n" +
        "if __name__ == \"__main__\":\n" +
        "    print(greet(\"bokskie\"))\n" +
        "```\n\n" +
        "**What it does**\n" +
        "- Takes a `name` and returns a greeting string\n" +
        "- Runs only when executed directly\n" +
        "- Uses an f-string for interpolation\n\n" +
        "> This is a fixed sample. Once a real model is connected I can write\n" +
        "> code for *your* actual problem instead.";
    }

    if (/\b(list|steps|how|guide|tutorial)\b/i.test(last)) {
      return banner + "Here is a simple breakdown:\n\n" +
        "1. **Start small.** Pick one goal you can finish this week.\n" +
        "2. **Remove friction.** If it takes more than 2 minutes, simplify it.\n" +
        "3. **Track it.** Write down the result so progress is visible.\n" +
        "4. **Repeat.** Improve one variable per cycle.\n\n" +
        "> Want this tailored to a specific goal?";
    }

    var quoted = last.length > 200 ? last.slice(0, 200) + "\u2026" : last;
    return banner + "You said:\n\n> " + quoted + "\n\n" +
      "I am repeating a script because no API key is connected yet.\n\n" +
      "### To get real answers\n" +
      "**Settings** \u2192 pick a provider \u2192 paste your key \u2192 **Save**.\n\n" +
      "Everything around the chat already works: streaming, markdown, code\n" +
      "highlighting, chat history, and file downloads.";
  }

  async function* streamDemo(settings, history, signal) {
    var text = demoReply(history, settings.mode);
    var chunkSize = 3;
    for (var i = 0; i < text.length; i += chunkSize) {
      if (signal && signal.aborted) return;
      yield text.slice(i, i + chunkSize);
      await new Promise(function (r) { setTimeout(r, 12); });
    }
  }

  async function* streamBokskieLocal(settings, history, signal) {
    var local = global.BokskieLocal;
    if (!local || !local.stream) throw new Error("bokskie.v1 did not load. Check that bokskie-v1/engine/*.js, data/bundle.js and src/provider.js are in the page.");

    /* history is the full conversation; we only need the last user turn. */
    var last = "";
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") { last = String(history[i].content || ""); break; }
    }

    /* Translations are opt-in now - they tripled every reply and made it
       read as repetitive. Only the verbose model asks for them. */
    var model = settings.model || "bokskie.v1";
    /* The signal comes from the Stop button. Without it in here, provider
       only notices an abort after its current typing delay has elapsed. */
    var opts = { translate: model === "bokskie.v1-verbose", signal: signal };
    var it = local.stream(last, opts);
    for (;;) {
      var step = await it.next();
      if (step.done) break;
      if (signal && signal.aborted) { try { await it.return(); } catch (e) { /* already closed */ } return; }
      yield step.value;
    }
  }

  /* ---------- dispatch ---------- */

  function stream(settings, history, signal) {
    var p = settings.provider;
    /* bokskie-local composes in the page, exactly like demo: there is no
       upstream to call, so it must not be sent to the server. */
    if (p === "bokskie-local") return streamBokskieLocal(settings, history, signal);
    /* When the local server answered the probe, every real provider
       goes through it - keys stay server-side and all three dialects
       arrive as one normalized stream. Demo (and a missing server)
       keep running in the browser. */
    if (p !== "demo" && global.Backend && global.Backend.on()) {
      return global.Backend.stream(settings, history, signal);
    }
    if (p === "openai" || p === "deepseek" || p === "ollama") {
      return streamOpenAI(settings, history, signal);
    }
    if (p === "anthropic") return streamAnthropic(settings, history, signal);
    if (p === "gemini") return streamGemini(settings, history, signal);
    return streamDemo(settings, history, signal);
  }

  /* Runs before every send. A string back means "do not send this, explain
     it instead" \u2014 which is much friendlier than a raw 401 from the API. */
  function validate(settings) {
    var p = settings.provider;
    var info = providerInfo(p);
    if (p === "demo") return null;

    /* With the backend on, the keys live in server.js - the browser
       never sees them, so the "paste a key" checks below only apply
       to the direct (static/file://) path. If the server has no key
       for this provider it answers 400 with a readable needKey
       message, which runAssistant already shows to the user. */
    var viaBackend = !!(global.Backend && global.Backend.on());

    // Ollama and bokskie-local never need a key, only something to talk to.
    if (p === "ollama") {
      if (!viaBackend && !settings.baseUrl) {
        return "Ollama needs a Base URL, e.g. http://localhost:11434/v1";
      }
    } else if (p === "bokskie-local") {
      if (!global.BokskieLocal) {
        return "bokskie.v1 is not loaded. Add bokskie-v1/data/bundle.js, engine/*.js and src/provider.js to index.html.";
      }
    } else if (!viaBackend) {
      var key = String(settings.key || "").trim();
      if (!key) {
        return "No " + info.label + " API key saved yet. Open Settings, choose " + info.label +
          ", paste the key and Save." + (info.keyUrl ? " You can create one at " + info.keyUrl : "");
      }

      // A key from the wrong provider is the classic reason for a 401, so
      // catch the obvious shape mismatches here instead of guessing later.
      if (p === "gemini" && /^sk-/.test(key)) {
        return "That key starts with sk-, which is an OpenAI/DeepSeek key \u2014 but the provider is " +
          "Google Gemini. Google keys start with AIza (or AQ.). Pick the right provider in Settings.";
      }
      if (p !== "gemini" && /^(aiza|aq\.)/i.test(key)) {
        return "That key looks like a Google key (AIza or AQ.) \u2014 but the provider is " +
          info.label + ". Switch the provider to Google Gemini in Settings.";
      }
      if (p === "anthropic" && /^sk-(?!ant-)/.test(key)) {
        return "That key starts with sk- but Anthropic keys start with sk-ant-. It looks like an " +
          "OpenAI or DeepSeek key. Check which provider the key belongs to.";
      }
    }

    // A model id from another provider ("deepseek-flash" while OpenAI is
    // selected) can never work, so say so plainly. Ollama serves arbitrary
    // names from your own machine, so it is exempt.
    var owner = p === "ollama" ? null : providerOfModel(settings.model);
    if (owner && owner !== p) {
      return "The model " + settings.model + " belongs to " + providerInfo(owner).label +
        ", but the active provider is " + info.label + ". Open Settings, switch the provider to " +
        providerInfo(owner).label + ", or pick a " + info.label + " model.";
    }

    return null;
  }

  global.LLM = {
    MODELS: MODELS,
    PROVIDERS: PROVIDERS,
    COST: COST,
    providerInfo: providerInfo,
    costOf: costOf,
    modelsFor: modelsFor,
    defaultModel: defaultModel,
    resolveModel: resolveModel,
    providerOfModel: providerOfModel,
    stream: stream,
    validate: validate
  };
})(window);