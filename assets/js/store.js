/* ==========================================================
   bokskie.ai - localStorage persistence layer
   ========================================================== */
(function (global) {
  "use strict";

  var K_CHATS = "bokskie.chats";
  var K_ACTIVE = "bokskie.active";
  var K_SETTINGS = "bokskie.settings";
  var K_THEME = "bokskie.theme";
  /* Per-provider API keys, kept apart from the rest of settings so that
     switching provider loads that provider's own key instead of reusing
     whatever was pasted last. This is why an OpenAI key and a DeepSeek key
     can both be saved at once. */
  var K_KEYS = "bokskie.keys";

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      /* A full or blocked store used to fail silently: the UI would
         report "Pinned to the top" while the flag never landed, and the
         Pinned view would then be empty. Surface it instead. */
      console.warn("bokskie: storage write failed", e);
      try { localStorage.setItem("bokskie.storageError", "1"); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- settings ---------- */

  var DEFAULTS = {
    name: "bokskie",
    provider: "demo",
    key: "",
    model: "",
    baseUrl: "",
    system: "",
    mode: "study"
  };

  function getSettings() {
    var s = read(K_SETTINGS, {});
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = (s && s[k] !== undefined && s[k] !== null) ? s[k] : DEFAULTS[k];
    });
    /* The key handed out is always the one belonging to the active
       provider. Everything downstream (llm.js) can keep reading
       settings.key and will still get the right key after a switch. */
    out.key = keyFor(out.provider);
    return out;
  }

  function saveSettings(patch) {
    var next = getSettings();
    Object.keys(patch || {}).forEach(function (k) {
      next[k] = patch[k];
    });
    /* A pasted key is filed under its own provider, and the legacy single
       "key" field is kept in step for older builds. */
    if (patch && Object.prototype.hasOwnProperty.call(patch, "key")) {
      setKey(patch.provider || next.provider, patch.key);
    }
    next.key = keyFor(next.provider);
    write(K_SETTINGS, next);
    return next;
  }

  /* ---------- API keys (one per provider) ---------- */

  function getKeys() {
    var m = read(K_KEYS, {});
    if (!m || typeof m !== "object" || Array.isArray(m)) return {};
    var clean = {};
    Object.keys(m).forEach(function (k) {
      if (typeof m[k] === "string" && m[k].trim()) clean[k] = m[k].trim();
    });
    return clean;
  }

  function keyFor(provider) {
    if (!provider) return "";
    var m = getKeys();
    if (m[provider]) return m[provider];

    /* Nothing stored per provider yet: this is a first run after an older
       version that kept a single shared key, so trust it once \u2014 but only
       for the provider that was selected at the time. */
    var s = read(K_SETTINGS, {});
    var legacy = (s && typeof s.key === "string") ? s.key.trim() : "";
    if (!legacy) return "";
    if (!Object.keys(m).length && s.provider === provider) return legacy;
    return "";
  }

  function setKey(provider, value) {
    if (!provider) return getKeys();
    var m = getKeys();
    var v = (value === undefined || value === null) ? "" : String(value).trim();
    if (v) m[provider] = v;
    else delete m[provider];
    write(K_KEYS, m);
    return m;
  }

  function clearKeys() {
    try { localStorage.removeItem(K_KEYS); } catch (e) { /* ignore */ }
    return {};
  }

  /** Upgrade path: move a single legacy key into the per-provider store. */
  function migrateKeys() {
    var s = read(K_SETTINGS, {});
    if (!s || !s.provider || typeof s.key !== "string" || !s.key.trim()) return getKeys();
    if (getKeys()[s.provider]) return getKeys();
    return setKey(s.provider, s.key);
  }

  /* ---------- theme ---------- */

  function getThemePref() {
    return read(K_THEME, "dark");
  }

  function setThemePref(v) {
    write(K_THEME, v);
  }

  /* ---------- chats ---------- */

  function listChats() {
    var all = read(K_CHATS, []);
    return Array.isArray(all) ? all : [];
  }

  function saveChats(list) {
    return write(K_CHATS, list);
  }

  function newChat() {
    return { id: uid(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  }

  function getChat(id) {
    var list = listChats();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function upsertChat(chat) {
    var list = listChats();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === chat.id) {
        list[i] = chat;
        found = true;
        break;
      }
    }
    if (!found) list.unshift(chat);
    list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    saveChats(list);
    return chat;
  }

  function deleteChat(id) {
    var list = listChats().filter(function (c) { return c.id !== id; });
    saveChats(list);
    if (getActiveId() === id) setActiveId(null);
    return list;
  }

  function clearChats() {
    saveChats([]);
    setActiveId(null);
  }

  function getActiveId() {
    return read(K_ACTIVE, null);
  }

  function setActiveId(id) {
    if (id) write(K_ACTIVE, id);
    else {
      try { localStorage.removeItem(K_ACTIVE); } catch (e) { /* ignore */ }
    }
  }

  /* Is the store able to accept writes? A quota error is otherwise
     invisible: the UI reports success, the flag is lost, and the Pinned
     view comes up empty with no clue why. */
  function storageBroken() {
    try {
      if (localStorage.getItem("bokskie.storageError")) return true;
    } catch (e) { return true; }        /* reading throws = blocked */
    try {
      var probe = "__bokskie_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
    } catch (e) {
      return true;
    }
    return false;
  }

  global.Store = {
    storageBroken: storageBroken,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getKeys: getKeys,
    keyFor: keyFor,
    setKey: setKey,
    clearKeys: clearKeys,
    migrateKeys: migrateKeys,
    getThemePref: getThemePref,
    setThemePref: setThemePref,
    listChats: listChats,
    saveChats: saveChats,
    newChat: newChat,
    getChat: getChat,
    upsertChat: upsertChat,
    deleteChat: deleteChat,
    clearChats: clearChats,
    getActiveId: getActiveId,
    setActiveId: setActiveId,
    uid: uid
  };
})(window);
