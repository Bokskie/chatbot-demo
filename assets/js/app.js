/* ==========================================================
   bokskie.ai - application logic
   ========================================================== */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    app: $("app"),
    sidebar: $("sidebar"),
    scrim: $("scrim"),
    chatList: $("chatList"),
    searchInput: $("searchInput"),
    newChatBtn: $("newChatBtn"),
    collapseBtn: $("collapseBtn"),
    sidebarRail: $("sidebarRail"),
    sideNav: $("sideNav"),
    navAllCount: $("navAllCount"),
    navPinnedCount: $("navPinnedCount"),
    navProjectCount: $("navProjectCount"),
    navLibCount: $("navLibCount"),
    brandBar: $("brandBar"),
    railCount: $("railCount"),
    provChip: $("provChip"),
    provChipDot: $("provChipDot"),
    provChipName: $("provChipName"),
    provChipCost: $("provChipCost"),
    chatStat: $("chatStat"),
    exportAllBtn: $("exportAllBtn"),
    clearAllBtn: $("clearAllBtn"),
    openSidebarBtn: $("openSidebarBtn"),
    settingsBtn: $("settingsBtn"),
    themeBtn: $("themeBtn"),
    shareBtn: $("shareBtn"),
    modelBtn: $("modelBtn"),
    modelMenu: $("modelMenu"),
    modelNameLabel: $("modelNameLabel"),
    welcome: $("welcome"),
    suggestions: $("suggestions"),
    thread: $("thread"),
    scrollArea: $("scrollArea"),
    input: $("input"),
    sendBtn: $("sendBtn"),
    stopBtn: $("stopBtn"),
    micBtn: $("micBtn"),
    attachBtn: $("attachBtn"),
    fileInput: $("fileInput"),
    attachments: $("attachments"),
    settingsModal: $("settingsModal"),
    closeSettings: $("closeSettings"),
    saveSettings: $("saveSettings"),
    cancelSettings: $("cancelSettings"),
    setName: $("setName"),
    setProvider: $("setProvider"),
    setProviderHelp: $("setProviderHelp"),
    setKey: $("setKey"),
    setKeyHelp: $("setKeyHelp"),
    keyProviderTag: $("keyProviderTag"),
    setModel: $("setModel"),
    setModelHelp: $("setModelHelp"),
    modelOptions: $("modelOptions"),
    setUrl: $("setUrl"),
    setSystem: $("setSystem"),
    setMode: $("setMode"),
    setModeHelp: $("setModeHelp"),
    keyField: $("keyField"),
    modelField: $("modelField"),
    urlField: $("urlField"),
    backendTag: $("backendTag"),
    provGrid: $("provGrid"),
    keyEditor: $("keyEditor"),
    keyEditorHead: $("keyEditorHead"),
    keyRows: $("keyRows"),
    keyAddInput: $("keyAddInput"),
    keyAddBtn: $("keyAddBtn"),
    backendHelp: $("backendHelp"),
    themeSwitch: $("themeSwitch"),
    tempChip: $("tempChip"),
    tempVal: $("tempVal"),
    modeChip: $("modeChip"),
    modeMenu: $("modeMenu"),
    modeVal: $("modeVal"),
    welcomeTitle: $("welcomeTitle"),
    welcomeHint: $("welcomeHint"),
    welcomeEyebrow: $("welcomeEyebrow"),
    dlBar: $("dlBar"),
    clarify: $("clarify"),
    clarifyText: $("clarifyText"),
    clarifyOpts: $("clarifyOpts"),
    clarifyX: $("clarifyX"),
    dlInfo: $("dlInfo"),
    dlAll: $("dlAll"),
    dlCopyAll: $("dlCopyAll"),
    dlClose: $("dlClose"),
    userAvatar: $("userAvatar"),
    userNameLabel: $("userNameLabel"),
    toasts: $("toasts")
  };

  /* One-time upgrade on boot, before anything reads the settings:
     1. older builds kept a single shared API key, so file it under the
        provider it belonged to;
     2. a saved model id the provider has since retired (gemini-2.0-flash
        was shut down, the Claude 3.x/4.x ids are legacy, o3-mini is
        deprecated) is moved to the model that serves it today \u2014 a stale
        id would otherwise fail every single request. */
  if (window.Store && Store.migrateKeys) Store.migrateKeys();

  function loadSettings() {
    var s = Store.getSettings();
    if (!window.LLM) return s;
    var model = LLM.resolveModel(s.provider, s.model);
    if (model !== s.model) s = Store.saveSettings({ model: model });
    return s;
  }

  var state = {
    settings: loadSettings(),
    formProvider: null,
    activeId: null,
    chat: null,
    streaming: false,
    controller: null,
    attachments: [],
    temperature: 0.7,
    autoMode: true,
    pendingText: null,
    skipDetect: false,
    backendStatus: null,   // last /api/status payload from the local server
    keyEditorFor: null     // provider whose keys the settings editor shows
  };

  /* ---------- modes ----------
     A mode is just a named bundle of instructions + welcome copy.
     Switching modes does NOT clear the chat, so you can compare
     answers, but it does swap the system prompt sent upstream.   */

  function currentMode() {
    return Modes.get(state.settings.mode);
  }

  function renderSuggestions() {
    var m = currentMode();
    el.suggestions.innerHTML = m.suggestions.map(function (s) {
      return '<button class="card" data-prompt="' + esc(s.prompt) + '">' +
        '<span class="card-title">' + esc(s.title) + "</span>" +
        '<span class="card-sub">' + esc(s.sub) + "</span>" +
        '<span class="card-ico"><svg viewBox="0 0 24 24" class="ico"><use href="#' + esc(s.icon) + '"/></svg></span>' +
      "</button>";
    }).join("");

    el.welcomeTitle.textContent = m.welcomeTitle;
    el.welcomeHint.textContent = m.welcomeHint;
  }

  function updateModeLabel() {
    var m = currentMode();
    el.modeVal.textContent = m.chip;
    var ico = el.modeChip.querySelector("use");
    if (ico) ico.setAttribute("href", "#" + m.icon);
    el.modeChip.classList.toggle("auto", state.autoMode);
    el.modeChip.title = state.autoMode
      ? "Mode: " + m.chip + " (auto \u2014 click to pin one)"
      : "Mode: " + m.chip + " (pinned)";
    /* The hunger bar breathes only while auto-detect is watching, so the
       sidebar quietly says whether bokskie is choosing the mode for you. */
    if (el.brandBar) {
      el.brandBar.classList.toggle("live", !!state.autoMode);
      el.brandBar.title = state.autoMode
        ? "Auto mode is on \u00b7 hide sidebar (Ctrl+B)"
        : "Mode pinned to " + m.label + " \u00b7 hide sidebar (Ctrl+B)";
    }
  }

  function openModeMenu() {
    var cur = state.settings.mode;
    var autoSel = state.autoMode ? " sel" : "";
    var auto = '<button class="model-opt' + autoSel + '" data-mode="auto" role="option">' +
      '<span class="m-lead"><svg viewBox="0 0 24 24" class="ico"><use href="#i-spark"/></svg></span>' +
      '<span class="m-body"><span class="m-title">Auto</span><br>' +
      '<span class="m-sub">Pick the mode from what I say.</span></span>' +
      '<svg viewBox="0 0 24 24" class="ico m-check"><use href="#i-check"/></svg>' +
    "</button>" + '<div class="mm-sep"></div>';

    el.modeMenu.innerHTML = auto + Modes.all().map(function (m) {
      var sel = !state.autoMode && m.id === cur ? " sel" : "";
      return '<button class="model-opt' + sel + '" data-mode="' + esc(m.id) + '" role="option">' +
        '<span class="m-lead"><svg viewBox="0 0 24 24" class="ico"><use href="#' + esc(m.icon) + '"/></svg></span>' +
        '<span class="m-body"><span class="m-title">' + esc(m.label) + "</span><br>" +
        '<span class="m-sub">' + esc(m.blurb) + "</span></span>" +
        '<svg viewBox="0 0 24 24" class="ico m-check"><use href="#i-check"/></svg>' +
      "</button>";
    }).join("");
    el.modeMenu.hidden = false;
    el.modeChip.setAttribute("aria-expanded", "true");
  }

  function closeModeMenu() {
    el.modeMenu.hidden = true;
    el.modeChip.setAttribute("aria-expanded", "false");
  }

  /** Manual pick: pins the mode so auto-detect stops overriding it. */
  function setMode(id) {
    if (id === "auto") {
      state.autoMode = true;
      closeModeMenu();
      updateModeLabel();
      toast("Mode: Auto \u2014 I'll pick the right one from what you say.");
      return;
    }
    if (!id) return;
    state.autoMode = false;
    if (id === state.settings.mode) {
      closeModeMenu();
      updateModeLabel();
      return;
    }
    state.settings = Store.saveSettings({ mode: id });
    closeModeMenu();
    updateModeLabel();
    renderSuggestions();
    toast("Mode: " + Modes.get(id).label);
  }

  /* ---------- temperature chip ---------- */

  function updateTempLabel() {
    if (el.tempVal) el.tempVal.textContent = state.temperature.toFixed(1);
  }

  function withTemp(settings, text) {
    var s = {};
    for (var k in settings) if (Object.prototype.hasOwnProperty.call(settings, k)) s[k] = settings[k];
    s.temperature = state.temperature;

    /* Which prompt goes out is decided per message, not just from the
       pinned mode. Pinning Study and then asking "what is a good horror
       film" used to ship "you are a Vue 3 study partner" to the provider,
       and the model tried to answer a film question like a tutor. The
       pinned chip is a preference, not a straitjacket: if the message
       itself clearly reads as general, send the General prompt for this
       one turn and leave the user's choice alone. */
    var mode = settings.mode;
    if (text) {
      var guess = Modes.detect(text);
      if (guess && guess.confident && guess.mode !== mode) {
        mode = guess.mode;
      } else if (!guess && mode === "study") {
        /* No learn/build signal at all. A Study prompt here is a pure
           gamble, and a wrong guess costs the user a nonsense answer,
           while a General prompt only loses a bit of structure. */
        mode = "general";
      }
    }

    var sys = Modes.systemFor(mode, settings.system);
    /* brain.js adds what we remember about the user: their name, the
       current topic, and a short recap. Returns "" when it knows
       nothing yet, so this is a no-op until then. */
    if (window.Brain) sys += Brain.context();
    s.system = sys;
    return s;
  }

  function cycleTemp() {
    var steps = [0, 0.3, 0.7, 1, 1.4];
    var i = steps.indexOf(state.temperature);
    if (i === -1) i = 2;
    state.temperature = steps[(i + 1) % steps.length];
    updateTempLabel();
    toast("Temperature " + state.temperature.toFixed(1));
  }

  /* ---------- utils ---------- */

  function esc(s) {
    return MD.escapeHtml(s);
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind === "err" ? " err" : "");
    t.innerHTML = '<svg viewBox="0 0 24 24" class="ico"><use href="#' + (kind === "err" ? "i-close" : "i-check") + '"/></svg>' +
      "<span></span>";
    t.lastChild.textContent = msg;
    el.toasts.appendChild(t);
    setTimeout(function () {
      t.classList.add("out");
      setTimeout(function () { t.remove(); }, 260);
    }, 2400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    var d = Math.floor(hr / 24);
    if (d === 1) return "Yesterday";
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function groupLabel(ts) {
    var d = new Date(ts);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var yest = new Date(today.getTime() - 86400000);
    if (d >= today) return "Today";
    if (d >= yest) return "Yesterday";
    if (Date.now() - ts < 7 * 86400000) return "Previous 7 days";
    if (Date.now() - ts < 30 * 86400000) return "Previous 30 days";
    return "Older";
  }

  /* ---------- sidebar ---------- */

  /* ChatGPT-style view switcher. Unlike ChatGPT's Images/Codex, each of
     these four does something real here, because bokskie has no image
     generator and no coding agent to link to. */
  var VIEWS = ["all", "pinned", "projects", "library"];

  function setCount(node, n) {
    if (!node) return;
    node.textContent = n ? String(n) : "";
    node.setAttribute("data-zero", n ? "0" : "1");
  }

  function renderNavCounts(all) {
    all = all || Store.listChats();
    var projects = {}, pinned = 0;
    all.forEach(function (c) {
      if (c.pinned) pinned++;
      if (c.project) projects[c.project] = 1;
    });
    setCount(el.navAllCount, all.length);
    setCount(el.navPinnedCount, pinned);
    setCount(el.navProjectCount, Object.keys(projects).length);
    setCount(el.navLibCount, all.length);

    /* Keep the highlight on whichever view is showing. */
    if (el.sideNav) {
      var cur = VIEWS.indexOf(state.view) === -1 ? "all" : state.view;
      var items = el.sideNav.querySelectorAll("[data-view]");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("is-active", items[i].getAttribute("data-view") === cur);
      }
    }
  }

  function emptyText(view, q) {
    if (q) return "No chats match &ldquo;" + esc(q) + "&rdquo;.";
    if (view === "pinned") return "Nothing pinned yet.<br>Hover a chat and tap the <strong>star</strong> to keep it here.";
    if (view === "projects") return "No projects yet.<br>Hover a chat and tap the <strong>folder</strong> to group it.";
    return "No chats yet.<br>Start a new conversation &rarr;";
  }

  function chatRow(c) {
    var active = c.id === state.activeId ? " active" : "";
    var pinnedCls = c.pinned ? " pinned" : "";
    var projCls = c.project ? " on" : "";
    return '<div class="chat-item' + active + pinnedCls + '" data-id="' + c.id + '" title="' + esc(c.title) + '">' +
      '<button class="chat-pin' + (c.pinned ? " on" : "") + '" data-pin="' + c.id + '" ' +
        'title="' + (c.pinned ? "Unpin" : "Pin this chat") + '" aria-label="' + (c.pinned ? "Unpin" : "Pin this chat") + '">' +
        '<svg viewBox="0 0 24 24" class="ico"><use href="#i-star"/></svg></button>' +
      '<span class="chat-title">' + esc(c.title) + "</span>" +
      '<button class="chat-proj' + projCls + '" data-proj="' + c.id + '" ' +
        'title="' + (c.project ? "Project: " + esc(c.project) : "Add to a project") + '" aria-label="Project">' +
        '<svg viewBox="0 0 24 24" class="ico"><use href="#i-folder"/></svg></button>' +
      '<button class="chat-del" data-del="' + c.id + '" title="Delete chat" aria-label="Delete chat">' +
        '<svg viewBox="0 0 24 24" class="ico"><use href="#i-trash"/></svg></button>' +
      "</div>";
  }

  function renderChatList() {
    var q = el.searchInput.value.trim().toLowerCase();
    var view = VIEWS.indexOf(state.view) === -1 ? "all" : state.view;
    var everything = Store.listChats();
    var chats = everything;

    if (view === "pinned") chats = chats.filter(function (c) { return c.pinned; });
    if (q) {
      chats = chats.filter(function (c) {
        return String(c.title || "").toLowerCase().indexOf(q) !== -1;
      });
    }
    renderNavCounts(everything);

    var html = "";

    /* Library leads with a real summary of what is stored locally. */
    if (view === "library") {
      var msgs = 0, chars = 0, files = 0;
      everything.forEach(function (c) {
        (c.messages || []).forEach(function (m) {
          if (m.error || !m.content) return;
          msgs++;
          chars += String(m.content).length;
        });
        files += (c.attachments || []).length;
      });
      html += '<div class="lib-stats">' +
        '<div class="lib-stat"><b>' + everything.length + "</b><span>Chats</span></div>" +
        '<div class="lib-stat"><b>' + msgs + "</b><span>Messages</span></div>" +
        '<div class="lib-stat"><b>' + (chars > 999 ? Math.round(chars / 1000) + "k" : chars) + "</b><span>Characters</span></div>" +
        '<div class="lib-stat"><b>' + files + "</b><span>Files</span></div>" +
        "</div>";
    }

    if (!chats.length) {
      el.chatList.innerHTML = html + '<div class="chat-empty">' + emptyText(view, q) + "</div>";
      return;
    }

    /* Projects: grouped by folder name, unfiled last. */
    if (view === "projects") {
      var byProj = {}, order = [];
      chats.forEach(function (c) {
        var p = c.project || "Unfiled";
        if (!byProj[p]) { byProj[p] = []; order.push(p); }
        byProj[p].push(c);
      });
      order.sort(function (a, b) {
        if (a === "Unfiled") return 1;
        if (b === "Unfiled") return -1;
        return a < b ? -1 : 1;
      });
      order.forEach(function (p) {
        html += '<div class="chat-group-title">' + esc(p) + " \u00b7 " + byProj[p].length + "</div>";
        byProj[p].forEach(function (c) { html += chatRow(c); });
      });
      el.chatList.innerHTML = html;
      return;
    }

    /* Pinned floats to the top; the rest stay grouped by date. */
    if (view !== "pinned") {
      var pinnedList = chats.filter(function (c) { return c.pinned; });
      if (pinnedList.length) {
        html += '<div class="chat-group-title">Pinned</div>';
        pinnedList.forEach(function (c) { html += chatRow(c); });
      }
    }

    var groups = {}, gorder = [];
    chats.filter(function (c) { return !c.pinned; }).forEach(function (c) {
      var g = groupLabel(c.updatedAt);
      if (!groups[g]) { groups[g] = []; gorder.push(g); }
      groups[g].push(c);
    });

    gorder.forEach(function (g) {
      html += '<div class="chat-group-title">' + esc(g) + "</div>";
      groups[g].forEach(function (c) {
        html += chatRow(c);
      });
    });

    el.chatList.innerHTML = html;
  }

  /* Pinning keeps a chat at the top of every view - the point being that
     the conversation you want to come back to never scrolls away. */
  function togglePin(id) {
    var c = Store.getChat(id);
    if (!c) return;
    c.pinned = !c.pinned;
    var saved = Store.upsertChat(c) !== false;
    renderAll();
    if (!saved) { toast(storageErrorMessage(), 9000); return; }
    checkStorage();
    toast(c.pinned ? "Pinned to the top" : "Unpinned");
  }

  function setProject(id) {
    var c = Store.getChat(id);
    if (!c) return;
    var name = prompt("Project name for this chat\n(leave it empty to remove it)", c.project || "");
    if (name === null) return;
    name = name.trim();
    if (name) c.project = name;
    else delete c.project;
    Store.upsertChat(c);
    renderAll();
    toast(name ? "Moved to " + name : "Removed from its project");
  }

  /* ---------- thread ---------- */

  function messageHtml(msg, idx) {
    if (msg.role === "user") {
      /* If the turn right after this message failed, offer a Resend right
         here on the user's own bubble. The AI row also has a retry button,
         but that is hover-only and hidden on touch - and the message you
         actually want to re-send is the one you typed, not the error text
         sitting under it. */
      var next = state.chat.messages[idx + 1];
      var failed = !!(next && next.error);
      var resend = failed
        ? '<button class="resend-btn" data-uat="resend" data-idx="' + idx + '" ' +
          'title="Send this message again">' +
          '<svg viewBox="0 0 24 24" class="ico"><use href="#i-refresh"/></svg>' +
          "<span>Resend</span></button>"
        : "";

      /* User bubbles get their own actions: copy, and edit-and-resend.
         Editing re-runs the turn, so a typo in the middle of a chat no
         longer costs you everything after it. */
      return '<div class="msg msg-user"><div class="u-wrap" data-uidx="' + idx + '">' +
        '<div class="bubble' + (failed ? " failed" : "") + '">' + esc(msg.content) + "</div>" +
        resend +
        '<div class="msg-actions">' +
          '<button class="icon-btn" data-uat="copy" data-idx="' + idx + '" title="Copy message">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-copy"/></svg></button>' +
          '<button class="icon-btn" data-uat="edit" data-idx="' + idx + '" title="Edit and resend">' +
            '<svg viewBox="0 0 24 24" class="ico"><use href="#i-edit"/></svg></button>' +
        "</div>" +
      "</div></div>";
    }

    var isError = msg.error ? " error-box" : "";
    var content = msg.error
      ? esc(msg.content)
      : MD.render(msg.content);

    /* Before the first token arrives, show what is genuinely happening
       rather than an empty box. The stages are real: they are the steps
       runAssistant actually walks through. */
    var inner = msg.pending && !msg.content
      ? '<div class="thinking"><span class="typing-dot"></span>' +
        '<span class="think-text" id="thinkText">Reading what you said&hellip;</span></div>'
      : content;

    return '<div class="msg msg-ai">' +
      '<img class="ai-avatar" src="assets/img/bokskie-logo-96.png" alt="" width="34" height="34" />' +
      '<div class="ai-body">' +
        '<div class="ai-content' + isError + '">' + inner + "</div>" +
        (msg.pending ? "" :
          /* Pin the actions open on a failure - hovering to discover the
             retry is a bad time to make someone hunt for it. */
          '<div class="msg-actions' + (msg.error ? " pinned" : "") + '">' +
            '<button class="icon-btn" data-act="copy" data-idx="' + idx + '" title="Copy">' +
              '<svg viewBox="0 0 24 24" class="ico"><use href="#i-copy"/></svg></button>' +
            '<button class="icon-btn" data-act="retry" data-idx="' + idx + '" title="Regenerate">' +
              '<svg viewBox="0 0 24 24" class="ico"><use href="#i-refresh"/></svg></button>' +
            '<button class="icon-btn" data-act="up" data-idx="' + idx + '" title="Good response">' +
              '<svg viewBox="0 0 24 24" class="ico"><use href="#i-up"/></svg></button>' +
            '<button class="icon-btn" data-act="down" data-idx="' + idx + '" title="Bad response">' +
              '<svg viewBox="0 0 24 24" class="ico"><use href="#i-down"/></svg></button>' +
          "</div>") +
      "</div>" +
    "</div>";
  }

  function renderThread() {
    var msgs = state.chat ? state.chat.messages : [];
    if (!msgs.length) {
      el.thread.hidden = true;
      el.welcome.hidden = false;
      return;
    }
    el.thread.hidden = false;
    el.welcome.hidden = true;
    el.thread.innerHTML = msgs.map(messageHtml).join("");
  }

  function scrollToBottom(smooth) {
    requestAnimationFrame(function () {
      el.scrollArea.scrollTo({
        top: el.scrollArea.scrollHeight,
        behavior: smooth === false ? "auto" : "smooth"
      });
    });
  }

  function renderAll() {
    renderChatList();
    renderThread();
    updateModelLabel();
    updateUser();
    renderSidebarMeta();
    collectFiles();
  }

  /* ---------- chat lifecycle ---------- */

  function ensureChat() {
    if (state.chat) return state.chat;
    state.chat = Store.newChat();
    state.activeId = state.chat.id;
    Store.setActiveId(state.activeId);
    return state.chat;
  }

  function startNewChat() {
    if (state.streaming) stopStream();
    state.chat = null;
    state.activeId = null;
    Store.setActiveId(null);
    el.input.value = "";
    autoGrow();
    updateSendState();
    renderAll();
    el.input.focus();
    closeMobileSidebar();
  }

  function openChat(id) {
    if (state.streaming) stopStream();
    var c = Store.getChat(id);
    if (!c) return;
    state.chat = c;
    state.activeId = id;
    Store.setActiveId(id);
    renderAll();
    scrollToBottom(false);
    closeMobileSidebar();
  }

  function titleFrom(text) {
    var t = text.replace(/\s+/g, " ").trim();
    if (t.length <= 42) return t;
    var cut = t.slice(0, 42);
    var sp = cut.lastIndexOf(" ");
    return (sp > 20 ? cut.slice(0, sp) : cut) + "\u2026";
  }

  function persist() {
    if (!state.chat) return;
    state.chat.updatedAt = Date.now();
    Store.upsertChat(state.chat);
  }

  /* ---------- sending ---------- */

  function updateSendState() {
    var has = el.input.value.trim().length > 0;
    el.sendBtn.disabled = !has || state.streaming;
  }

  function setStreaming(on) {
    state.streaming = on;
    el.stopBtn.hidden = !on;
    el.sendBtn.hidden = on;
    updateSendState();
  }

  function stopStream() {
    if (state.controller) {
      try { state.controller.abort(); } catch (e) { /* ignore */ }
      state.controller = null;
    }
    setStreaming(false);
    finalizeStream();
  }

  function finalizeStream() {
    if (!state.chat) return;
    var last = state.chat.messages[state.chat.messages.length - 1];
    if (last && last.role === "assistant" && last.pending) {
      last.pending = false;
      if (!last.content) {
        last.content = "_Response was stopped before it finished._";
        last.stopped = true;
      }
    }
    persist();
    renderAll();
  }

  /**
   * Read the user's own words and decide what to do before sending.
   * - confident guess  -> switch mode and send
   * - not confident    -> show the "which one?" picker and hold the message
   * - no signal        -> just send in the current mode
   * Returns "sent" when the caller may continue, "ask" when it must stop.
   */
  function autoSwitchMode(text) {
    if (!state.autoMode || state.skipDetect) return "sent";
    var guess = Modes.detect(text);
    if (!guess) return "sent";

    if (!guess.confident) {
      state.pendingText = text;
      showClarify(guess.reason);
      return "ask";
    }

    if (guess.mode === state.settings.mode) return "sent";
    state.settings = Store.saveSettings({ mode: guess.mode });
    updateModeLabel();
    renderSuggestions();
    toast("Switched to " + Modes.get(guess.mode).label + " \u2014 " + guess.reason + ".");
    return "sent";
  }

  /* ---------- the "not sure" picker ---------- */

  function showClarify(reason) {
    el.clarifyText.textContent = reason + " \u2014";
    el.clarifyOpts.innerHTML = Modes.all().map(function (m) {
      return '<button class="clarify-opt" type="button" data-clarify="' + esc(m.id) + '">' +
        '<svg viewBox="0 0 24 24" class="ico"><use href="#' + esc(m.icon) + '"/></svg><span>' +
        esc(m.label) + "</span></button>";
    }).join("");
    el.clarify.hidden = false;
  }

  function hideClarify() {
    el.clarify.hidden = true;
    el.clarifyOpts.innerHTML = "";
    state.pendingText = null;
  }

  /** The user answered the picker: switch, then send the held message. */
  function resolveClarify(id) {
    var text = state.pendingText;
    hideClarify();
    if (!text) return;
    if (id && id !== state.settings.mode) {
      state.settings = Store.saveSettings({ mode: id });
      updateModeLabel();
      renderSuggestions();
    }
    // the user has already chosen, so do not ask again for this message
    state.skipDetect = true;
    send(text);
    state.skipDetect = false;
  }

  async function send(text) {
    if (state.streaming) return;
    text = (text !== undefined ? text : el.input.value).trim();
    if (!text) return;

    var problem = LLM.validate(state.settings);
    if (problem) {
      toast(problem);
      openSettings();
      return;
    }

    // auto mode switch, based on what the user typed. If the message is
    // too vague to classify, this shows the picker and holds the text.
    if (autoSwitchMode(text) === "ask") {
      el.input.focus();
      return;
    }

    if (state.attachments.length) {
      text += "\n\n" + state.attachments.map(function (a) {
        var lang = MD.langFromName(a.name);
        return "Here is the content of **" + a.name + "** that I attached:\n\n" +
          "```" + lang + "\n" + a.text + "\n```";
      }).join("\n\n");
    }

    /* brain.js reads the message before it goes out: it learns the
       user's name, tracks the topic, and rewrites short follow-ups
       like "next" so they still make sense to the model. */
    var asked = text;
    if (window.Brain) {
      var thought = Brain.ingest(text);
      text = thought.text;
      if (thought.learnedName) toast("Nice to meet you, " + thought.learnedName + ".");
    }

    ensureChat();
    el.input.value = "";
    state.attachments = [];
    renderAttachments();
    autoGrow();

    var chat = state.chat;
    chat.messages.push({ role: "user", content: text, ts: Date.now() });
    if (chat.messages.filter(function (m) { return m.role === "user"; }).length === 1) {
      chat.title = titleFrom(text);
    }
    persist();
    renderAll();
    scrollToBottom();

    await runAssistant(chat, undefined, asked);
  }

  /* ---------- the "thinking" status line ----------

     These are not decoration. Each line names a step runAssistant
     genuinely performs, so the wait is explained rather than hidden.

     NOTE, to be straight with you: this is NOT web search. bokskie
     has no search tool and no internet access. It reads your message,
     checks its own memory, picks a mode, and asks the provider you
     connected. A real "searching..." would be a lie until a search
     API is wired into llm.js.                              */

  /* Provider labels live in llm.js so there is exactly one list. */
  function providerLabel(p) {
    return LLM.providerInfo(p).label;
  }

  function thinkStages() {
    var s = ["Reading what you said\u2026"];
    if (window.Brain && (Brain.name || Brain.topic)) {
      s.push("Recalling what I know about you\u2026");
    }
    if (state.autoMode) s.push("Working out which mode fits\u2026");
    var p = state.settings.provider;
    if (p === "demo") {
      s.push("Composing a demo reply\u2026");
    } else if (p === "bokskie-local") {
      /* Nothing is sent anywhere - it answers from the page's own
         knowledge bank - so "Sending to..." would be a lie. */
      s.push("Searching the knowledge bank\u2026");
    } else {
      s.push("Sending to " + providerLabel(p) + "\u2026");
    }
    s.push("Writing the reply\u2026");
    return s;
  }

  var thinkTimer = null;

  function startThinking() {
    stopThinking();
    if (!el.thread.querySelector("#thinkText")) return;
    var stages = thinkStages();
    var i = 0;

    /* A self-cancelling one-shot chain rather than setInterval, so no
       timer is ever left running once the reply lands. */
    (function step() {
      if (i > 0) {
        var n = el.thread.querySelector("#thinkText");
        if (!n) { thinkTimer = null; return; } // reply started, stop
        n.textContent = stages[i % stages.length];
      }
      i++;
      if (i > stages.length) { thinkTimer = null; return; } // shown them all
      thinkTimer = setTimeout(step, 1100);
    })();
  }

  function stopThinking() {
    if (thinkTimer) clearTimeout(thinkTimer);
    thinkTimer = null;
  }

  /* ---------- editing a message you already sent ---------- */

  function openEdit(idx) {
    var msg = state.chat && state.chat.messages[idx];
    if (!msg || msg.role !== "user") return;
    var wrap = el.thread.querySelector('.u-wrap[data-uidx="' + idx + '"]');
    if (!wrap) return;

    wrap.innerHTML =
      '<textarea class="edit-box" rows="3" aria-label="Edit your message">' +
        esc(msg.content) + "</textarea>" +
      '<div class="edit-actions">' +
        '<button class="btn btn-sm" data-uat="cancel" data-idx="' + idx + '">Cancel</button>' +
        '<button class="btn btn-sm btn-primary" data-uat="save" data-idx="' + idx + '">Save &amp; resend</button>' +
      "</div>";

    var ta = wrap.querySelector(".edit-box");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function cancelEdit() {
    renderAll();
  }

  function saveEdit(idx) {
    var chat = state.chat;
    if (!chat) return;
    var wrap = el.thread.querySelector('.u-wrap[data-uidx="' + idx + '"]');
    var ta = wrap && wrap.querySelector(".edit-box");
    var text = ta ? ta.value.trim() : "";
    if (!text) { toast("Message cannot be empty."); return; }

    /* Everything from this message onward is dropped, including the
       old answer, so the new text is answered properly instead of
       piling up under a stale reply. */
    chat.messages.splice(idx);
    if (!chat.messages.length) chat.title = "";
    renderAll();
    send(text);
  }

  /* Re-send a message whose reply failed. The user message itself stays
     exactly where it was; the failed turn and anything after it is
     dropped, so the retry re-runs the last exchange cleanly instead of
     re-sending on top of a dead reply. */
  async function resendUser(idx) {
    if (state.streaming || !state.chat) return;
    var chat = state.chat;
    var msg = chat.messages[idx];
    if (!msg || msg.role !== "user") return;

    var next = chat.messages[idx + 1];
    if (next && next.role === "assistant") chat.messages.splice(idx + 1);

    persist();
    renderAll();
    scrollToBottom();
    /* replaceIdx = idx + 1 is now past the end, so nothing is spliced
       again - the history is already clean. */
    await runAssistant(chat, chat.messages.length > idx + 1 ? idx + 1 : undefined, msg.content);
  }

  async function runAssistant(chat, replaceIdx, askedText) {
    if (replaceIdx !== undefined) chat.messages.splice(replaceIdx);

    var history = chat.messages
      .filter(function (m) { return !m.error && !m.stopped; })
      .map(function (m) { return { role: m.role, content: m.content }; });

    var reply = { role: "assistant", content: "", ts: Date.now(), pending: true };
    chat.messages.push(reply);
    persist();
    renderAll();
    scrollToBottom();
    startThinking();

    setStreaming(true);
    state.controller = new AbortController();

    var nearBottom = true;
    var onScroll = function () {
      var gap = el.scrollArea.scrollHeight - el.scrollArea.scrollTop - el.scrollArea.clientHeight;
      nearBottom = gap < 140;
    };
    el.scrollArea.addEventListener("scroll", onScroll);

    /* The last user turn decides the prompt, so pass it in. */
    var lastUserText = "";
    for (var hi = history.length - 1; hi >= 0; hi--) {
      if (history[hi].role === "user") { lastUserText = String(history[hi].content || ""); break; }
    }
    lastUserText = (askedText || lastUserText || "").trim();

    try {
      for await (var chunk of LLM.stream(
        withTemp(state.settings, lastUserText),
        history,
        state.controller.signal
      )) {
        if (!reply.content) stopThinking(); // first token landed
        reply.content += chunk;
        updateLastMessage(reply);
        if (nearBottom) scrollToBottom(false);
      }
      if (!reply.content) {
        reply.content = "_No response received._";
        reply.stopped = true;
      }
    } catch (e) {
      var aborted = e && (e.name === "AbortError" || /abort/i.test(e.message || ""));
      if (!aborted) {
        reply.error = true;
        reply.content = describeError(e);
        toast("Request failed \u2014 see the message for details.");
      }
    } finally {
      el.scrollArea.removeEventListener("scroll", onScroll);
      state.controller = null;
      reply.pending = false;
      stopThinking();
      setStreaming(false);
      /* brain.js files this exchange away: short-term memory now, and
         the "recent chats" list that survives a refresh. Only real
         replies are remembered, never errors. */
      if (window.Brain && !reply.error && reply.content) {
        var lastUser = chat.messages.length >= 2 ? chat.messages[chat.messages.length - 2] : null;
        if (lastUser && lastUser.role === "user") {
          Brain.remember(askedText || lastUser.content, reply.content);
        }
      }
      persist();
      renderAll();
      scrollToBottom();
    }
  }

  function updateLastMessage(reply) {
    var nodes = el.thread.querySelectorAll(".msg-ai");
    var node = nodes[nodes.length - 1];
    if (!node) return;
    var c = node.querySelector(".ai-content");
    if (c) c.innerHTML = MD.render(reply.content);
  }

  function describeError(e) {
    var raw = (e && e.message) ? e.message : String(e);
    var p = state.settings.provider;
    var info = LLM.providerInfo(p);
    var model = state.settings.model || LLM.defaultModel(p);

    if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
      return "Could not reach " + info.label + ".\n\nThis is usually a network or CORS block.\n\nFixes:\n" +
        "- Check your internet connection\n" +
        "- For Ollama, make sure the server is running and the Base URL is correct\n" +
        "- Some networks block direct browser-to-API calls";
    }
    if (/401|unauthorized|invalid[_ -]?api[_ -]?key|incorrect api key|authentication/i.test(raw)) {
      return "Authentication failed for " + info.label + ".\n\n" + info.keyHint + ".\n\nFixes:\n" +
        "- Open Settings and re-check the key saved for " + info.label + "\n" +
        "- Make sure the whole key was pasted, with no spaces\n" +
        "- Each provider keeps its own key, so switching provider loads that one";
    }
    /* Check the body BEFORE the status. OpenAI reports "out of credits"
       as 429 insufficient_quota, not 402, so a pure status check told
       people to wait for a rate-limit reset that would never come. */
    if (/insufficient[_-]?quota|billing[_-]?hard[_-]?limit|billing[_-]?not[_-]?active|exceeded your current quota|402|insufficient|balance|no credit|out of credit/i.test(raw)) {
      return "Out of credits on " + info.label + ".\n\n" +
        "**Heads up:** a ChatGPT Plus or Pro subscription does *not* include\n" +
        "API credit - the API is billed separately. Add a payment method and\n" +
        "check the **Billing** tab at " + (info.keyUrl || "your provider's dashboard") + ".\n\n" +
        "Or move to something free right now:\n" +
        "- **Google Gemini Flash / Flash-Lite** - free tier, no card needed\n" +
        "- **Ollama** - runs on your own machine, 100% free\n" +
        "- **Demo mode** - offline script, so you can try the UI";
    }
    if (/429|rate limit|too many requests|quota/i.test(raw)) {
      return "Rate limited on " + info.label + ".\n\nWait a moment and try again. On a free tier you may have " +
        "hit the daily limit \u2014 picking a different model usually gets you going again.\n\n" +
        "> If this keeps happening even after waiting, it is probably billing " +
        "rather than a rate limit \u2014 re-check the Billing tab.";
    }
    if (/400|404|model.*(not found|does not exist|unsupported)/i.test(raw)) {
      return "The request was rejected for the model " + model + ".\n\nFixes:\n" +
        "- Check the model id in Settings (currently " + model + ")\n" +
        "- Make sure that model belongs to " + info.label + "\n" +
        "- Or clear the field to fall back to " + LLM.defaultModel(p);
    }
    return raw;
  }

  async function regenerate(idx) {
    if (state.streaming || !state.chat) return;
    var chat = state.chat;
    if (idx === undefined) {
      idx = chat.messages.length - 1;
      while (idx >= 0 && chat.messages[idx].role !== "assistant") idx--;
    }
    if (idx === null || idx < 0) return;
    if (chat.messages[idx].error || chat.messages[idx].stopped) chat.messages.splice(idx);
    await runAssistant(chat, idx);
  }

  /* ---------- model picker ---------- */

  function updateModelLabel() {
    var p = state.settings.provider;
    var list = LLM.modelsFor(p);
    var cur = state.settings.model;
    var found = list.filter(function (m) { return m.id === cur; })[0];
    /* An empty setting means the provider default is what will be sent, so
       show that instead of a vague "Select model". */
    var label = found ? found.label : (cur || LLM.defaultModel(p) || "Select model");
    el.modelNameLabel.textContent = label;
    el.modelBtn.title = LLM.providerInfo(p).label + " \u00b7 " + (cur || LLM.defaultModel(p));
  }

  function openModelMenu() {
    var provider = state.settings.provider;
    var list = LLM.modelsFor(provider);
    var cur = state.settings.model || LLM.defaultModel(provider);
    var html = list.map(function (m) {
      var sel = m.id === cur ? " sel" : "";
      var tag = m.tag
        ? '<span class="m-tag' + (/^free$/i.test(m.tag) ? " free" : "") + '">' + esc(m.tag) + "</span>"
        : "";
      return '<button class="model-opt' + sel + '" data-model="' + esc(m.id) + '" role="option">' +
        '<span><span class="m-title">' + esc(m.label) + "</span>" + tag + "<br>" +
        '<span class="m-sub">' + esc(m.sub) + "</span></span>" +
        '<svg viewBox="0 0 24 24" class="ico m-check"><use href="#i-check"/></svg>' +
      "</button>";
    }).join("");
    html += '<div class="mm-sep"></div>' +
      '<button class="model-opt" data-model-action="settings" role="option">' +
        '<svg viewBox="0 0 24 24" class="ico"><use href="#i-settings"/></svg>' +
        '<span class="m-title">Provider settings</span></button>';
    el.modelMenu.innerHTML = html;

    el.modelMenu.hidden = false;
    el.modelBtn.setAttribute("aria-expanded", "true");
  }

  function closeModelMenu() {
    el.modelMenu.hidden = true;
    el.modelBtn.setAttribute("aria-expanded", "false");
  }

  /* ---------- theme ---------- */

  function resolveTheme(pref) {
    if (pref === "auto") {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return pref;
  }

  function applyTheme(pref) {
    var resolved = resolveTheme(pref);
    document.documentElement.setAttribute("data-theme", resolved);
    if (el.themeSwitch) {
      var on = resolved === "light";
      el.themeSwitch.classList.toggle("on", on);
      el.themeSwitch.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  function updateUser() {
    var n = state.settings.name || "bokskie";
    el.userNameLabel.textContent = n;
    if (el.userAvatar) el.userAvatar.title = n;
    el.input.placeholder = "Message " + (state.settings.name ? state.settings.name : "bokskie.ai");
  }

  /* ---------- composer ---------- */

  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 260) + "px";
    updateSendState();
  }

  /* ---------- attachments ----------
     The file's real text is read here and sent to the model, so
     "review my component" actually works instead of just sending
     the filename. Very large files are truncated to stay inside
     a sane token budget.                                      */

  var MAX_FILE_BYTES = 120 * 1024;
  var MAX_TOTAL_BYTES = 300 * 1024;

  function readTextFile(file, cb) {
    if (file.size > MAX_FILE_BYTES) {
      cb(null);
      toast(file.name + " is too large (" + fmtBytes(file.size) + "). Max " + fmtBytes(MAX_FILE_BYTES) + ".");
      return;
    }
    var r = new FileReader();
    r.onload = function () { cb(String(r.result || "")); };
    r.onerror = function () { cb(null); };
    r.readAsText(file);
  }

  function addAttachment(file, text) {
    var used = state.attachments.reduce(function (n, a) { return n + a.text.length; }, 0);
    if (used + text.length > MAX_TOTAL_BYTES) {
      toast("Attachments are full. Remove one before adding more.");
      return;
    }
    state.attachments.push({
      name: file.name,
      size: file.size,
      type: file.type || "",
      text: text
    });
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function renderAttachments() {
    if (!state.attachments.length) {
      el.attachments.hidden = true;
      el.attachments.innerHTML = "";
      return;
    }
    el.attachments.hidden = false;
    el.attachments.innerHTML = state.attachments.map(function (a, i) {
      return '<span class="attach-chip">' +
        '<span class="a-name" title="' + esc(a.name) + " · " + fmtBytes(a.size) + '">' +
          esc(a.name) + "</span>" +
        '<button class="a-x" data-rm="' + i + '" title="Remove" aria-label="Remove attachment">' +
          '<svg viewBox="0 0 24 24" class="ico"><use href="#i-close"/></svg>' +
        "</button></span>";
    }).join("");
  }

  var recognition = null;
  var listening = false;

  function toggleMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (listening && recognition) {
      recognition.stop();
      return;
    }
    recognition = new SR();
    recognition.lang = "en-PH";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = function () {
      listening = true;
      el.micBtn.classList.add("recording");
    };

    recognition.onresult = function (e) {
      var text = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      el.input.value = (el.input.value ? el.input.value + " " : "") + text;
      autoGrow();
    };

    recognition.onerror = function (e) {
      if (e.error === "not-allowed") toast("Microphone permission was denied.");
      else if (e.error !== "aborted") toast("Voice input error: " + e.error);
    };

    recognition.onend = function () {
      listening = false;
      el.micBtn.classList.remove("recording");
    };

    try {
      recognition.start();
    } catch (e) {
      toast("Could not start voice input.");
    }
  }

  /* ---------- settings ---------- */

  function keyHelpHtml(p) {
    var info = LLM.providerInfo(p);
    var link = info.keyUrl
      ? ' \u00b7 <a href="' + esc(info.keyUrl) + '" target="_blank" rel="noopener">get a ' +
        esc(info.label) + " key</a>"
      : "";
    return esc(info.keyHint) + link;
  }

  function renderModelOptions(p) {
    if (!el.modelOptions) return;
    el.modelOptions.innerHTML = LLM.modelsFor(p).map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.label + " \u00b7 " + m.sub) + "</option>";
    }).join("");
  }

  /* The Base URL box is only worth persisting when it differs from the
     provider's own endpoint. Storing "" means "use the built-in default",
     which also stops a leftover Ollama URL from hijacking a later OpenAI
     call after you switch provider. */
  function normalizeBase(provider, value) {
    var v = String(value || "").trim().replace(/\/+$/, "");
    if (!v) return "";
    var def = LLM.providerInfo(provider).base.replace(/\/+$/, "");
    return v === def ? "" : v;
  }

  /** File whatever is in the key box under the provider it was typed for. */
  function stashFormKey() {
    if (!state.formProvider || state.formProvider === "demo") return;
    var typed = el.setKey.value.trim();
    if (Store.keyFor(state.formProvider) === typed) return;
    Store.setKey(state.formProvider, typed);
  }

  function openSettings() {
    var s = state.settings;
    el.setName.value = s.name || "";
    el.setProvider.value = s.provider;
    el.setModel.value = s.model || "";
    el.setUrl.value = s.baseUrl || "";
    el.setSystem.value = s.system || "";
    el.setMode.value = s.mode || Modes.defaultId();
    syncProviderFields();
    syncModeHelp();
    refreshBackendStatus();   // fresh /api/status while the modal opens
    applyTheme(Store.getThemePref());
    el.settingsModal.hidden = false;
  }

  function syncModeHelp() {
    if (!el.setModeHelp) return;
    var m = Modes.get(el.setMode.value);
    el.setModeHelp.textContent = m.blurb +
      " Your extra instructions below are added on top of it.";
  }

  function closeSettings() {
    el.settingsModal.hidden = true;
  }

  function syncProviderFields() {
    var p = el.setProvider.value;
    var info = LLM.providerInfo(p);
    var isDemo = (p === "demo");

    var viaBackend = !!(window.Backend && Backend.on());
    el.keyField.hidden = isDemo || viaBackend;   // server-held keys: the card editor owns them
    el.urlField.hidden = isDemo;

    /* Load the key that belongs to this provider. This is the whole point of
       the per-provider key store: picking DeepSeek shows your DeepSeek key,
       not the OpenAI one you saved earlier. */
    el.setKey.value = isDemo ? "" : Store.keyFor(p);
    el.setKey.placeholder = isDemo ? "" : info.keyHint;
    if (el.keyProviderTag) el.keyProviderTag.textContent = isDemo ? "" : info.label;
    if (el.setKeyHelp) {
      el.setKeyHelp.innerHTML = isDemo
        ? "Stored only in this browser. Demo mode never sends anything."
        : viaBackend
          ? "Keys are held by the local server (<code>keys.local.json</code>) and never sent to the browser. Manage them on the provider cards above."
          : keyHelpHtml(p);
    }
    if (el.setProviderHelp) el.setProviderHelp.innerHTML = esc(info.note);
    if (el.setUrl) {
      el.setUrl.placeholder = info.base || "http://localhost:11434/v1";
      /* Show the endpoint that will actually be called, so Ollama users are
         not left guessing. Saving strips a value that equals the default. */
      if (!isDemo && !el.setUrl.value) el.setUrl.value = info.base;
    }

    renderModelOptions(p);

    /* A saved model from a different provider can never work, so drop it and
       let the placeholder show what this provider will actually use. */
    var owner = (p === "ollama") ? null : LLM.providerOfModel(el.setModel.value);
    if (owner && owner !== p) el.setModel.value = "";
    if (!el.setModel.value) el.setModel.placeholder = LLM.defaultModel(p);
    if (el.setModelHelp) {
      var free = LLM.modelsFor(p).filter(function (m) { return m.tag === "Free"; }).length;
      var msg = "Suggested: <code>" + esc(LLM.defaultModel(p)) + "</code>.";
      if (free) msg += " " + free + " free " + (free === 1 ? "model is" : "models are") + " marked Free in the list.";
      msg += " Any other model id works too \u2014 just type it.";
      el.setModelHelp.innerHTML = msg;
    }

    state.formProvider = p;
    state.keyEditorFor = p;
    renderBackendField();
    renderKeyEditor();
  }

  /* ---------- local backend (server.js) ----------
     The settings modal shows one card per provider. With the server
     running, the cards read live key state from /api/status and the
     key editor writes to keys.local.json; with no server they fall
     back to the localStorage path the static build has always used. */

  function backendOn() { return !!(window.Backend && Backend.on()); }

  function providerStatus(p) {
    var st = state.backendStatus;
    if (!st || !st.providers) return null;
    for (var i = 0; i < st.providers.length; i++) {
      if (st.providers[i].id === p) return st.providers[i];
    }
    return null;
  }

  async function refreshBackendStatus() {
    if (!backendOn()) {
      state.backendStatus = null;
      renderBackendField();
      renderKeyEditor();
      return;
    }
    try {
      state.backendStatus = await Backend.status();
    } catch (e) {
      state.backendStatus = null;
    }
    renderBackendField();
    renderKeyEditor();
  }

  var CARD_ORDER = ["openai", "deepseek", "anthropic", "gemini", "bokskie-local", "ollama", "demo"];

  function renderBackendField() {
    if (!el.backendTag || !el.provGrid) return;
    var on = backendOn();
    el.backendTag.textContent = on ? "connected · keys stay on this machine" : "not running · browser-only mode";
    el.backendTag.className = "field-note " + (on ? "be-on" : "be-off");

    if (el.backendHelp) {
      el.backendHelp.innerHTML = on
        ? "Keys live in <code>" +
          esc((state.backendStatus && state.backendStatus.storeFile) || "keys.local.json") +
          "</code> on this machine and are never sent to the browser. Click a provider card to manage its keys."
        : "The local server is offline, so the browser talks to providers directly and keys stay in localStorage. " +
          "Run <code>node server.js --open</code> to switch.";
    }

    var active = el.setProvider.value;
    el.provGrid.innerHTML = CARD_ORDER.map(function (id) {
      var info = LLM.providerInfo(id);
      var ps = providerStatus(id);
      var connected = on && ps && ps.connected;
      var sub;
      if (id === "demo") sub = "Offline · no key needed";
      else if (id === "bokskie-local") {
        /* Say whether the offline provider actually loaded, rather than
           promising something the page may not have. When it is missing
           we say THAT instead, because a card that quietly says
           "Own API Provider" over a broken script is a lie. */
        sub = window.BokskieLocal
          ? "Own API Provider"
          : "Offline · files did not load";
      }
      else if (id === "ollama") {
        /* api.js assumes "connected" for any keyless provider, so use the
           server's real probe result. This is the difference between
           "Ollama is up" and "you have not installed it yet". */
        if (!on) sub = "No key needed · start Ollama";
        else if (ps && ps.localRunning) {
          sub = ps.installedModels && ps.installedModels.length
            ? "Running · " + ps.installedModels.length + " model" + (ps.installedModels.length > 1 ? "s" : "")
            : "Running · local";
        } else sub = "Not running · ollama.com/download";
      } else if (on) {
        sub = ps
          ? (ps.keyCount ? ps.keyCount + (ps.keyCount === 1 ? " key on server" : " keys on server") : "No key yet")
          : "Status unknown";
      } else {
        sub = Store.keyFor(id) ? "Local key saved" : "No key yet";
      }
      var cost = LLM.costOf(id);
      var tip = (info.note || "") + "\n\nCost: " + cost.label + " \u2014 " + cost.note;
      /* Ollama is software you install, not a key you paste, so spell the
         three steps out. "No key needed" alone reads as a dead end. */
      if (id === "ollama") {
        tip += "\n\nSETUP (3 steps, all free):\n" +
          "1. Install it \u2014 https://ollama.com/download\n" +
          "2. Start the server \u2014  ollama serve\n" +
          "3. Download a model \u2014  ollama pull llama3.2\n" +
          "No account, no card, no key. It runs entirely on this PC, and\n" +
          "nothing you type leaves your machine.";
      }
      return '<button type="button" class="prov-card' + (id === active ? " active" : "") +
        (connected ? " connected" : "") + '" data-p="' + esc(id) + '" title="' + esc(tip) + '">' +
        '<span class="prov-top"><span class="prov-name">' + esc(info.label) + "</span>" +
        '<span class="prov-cost ' + cost.cls + '">' + esc(cost.label) + "</span>" +
        '<span class="prov-dot"></span></span>' +
        '<span class="prov-sub">' + esc(sub) + "</span>" +
        "</button>";
    }).join("");
  }

  function renderKeyEditor() {
    if (!el.keyEditor) return;
    var p = state.keyEditorFor;
    var show = backendOn() && p && p !== "demo" && p !== "ollama";
    el.keyEditor.hidden = !show;
    if (!show) return;

    var info = providerStatus(p);
    var keys = (info && info.keys) || [];
    if (el.keyEditorHead) el.keyEditorHead.textContent = LLM.providerInfo(p).label + " keys on the server";
    if (el.keyRows) {
      el.keyRows.innerHTML = (backendOn() && !state.backendStatus)
        ? '<li class="key-empty">Loading key list…</li>'
        : keys.length
        ? keys.map(function (k) {
            return '<li class="key-row">' +
              '<span class="key-prev">' + esc(k.preview) + "</span>" +
              '<span class="key-src">' + esc(k.source) + "</span>" +
              (k.removable
                ? '<button type="button" class="key-del" data-id="' + esc(k.id) +
                  '" title="Remove this key" aria-label="Remove this key">✕</button>'
                : "") +
              "</li>";
          }).join("")
        : '<li class="key-empty">No key yet — paste one below.</li>';
    }
    if (el.keyAddInput) {
      el.keyAddInput.value = "";
      el.keyAddInput.placeholder = LLM.providerInfo(p).keyHint || "Paste an API key";
    }
  }

  async function backendAddKey() {
    var p = state.keyEditorFor;
    if (!p || p === "demo") return;
    var key = el.keyAddInput.value.trim();
    if (!key) return toast("Paste a key first.");
    try {
      var res = await Backend.addKey({ provider: p, key: key });
      state.backendStatus = res.status || state.backendStatus;
      renderBackendField();
      renderKeyEditor();
      toast(res.warning ? ("Key saved. Heads up: " + res.warning) : "Key saved to keys.local.json.");
    } catch (e) {
      toast(e.message || "Could not save the key.");
    }
  }

  async function backendRemoveKey(id) {
    var p = state.keyEditorFor;
    if (!p) return;
    try {
      var res = await Backend.removeKey(p, id);
      state.backendStatus = res.status || state.backendStatus;
      renderBackendField();
      renderKeyEditor();
      toast("Key removed from keys.local.json.");
    } catch (e) {
      toast(e.message || "Could not remove the key.");
    }
  }

  function saveSettingsFromForm() {
    var provider = el.setProvider.value;
    var typedKey = el.setKey.value.trim();
    var model = LLM.resolveModel(provider, el.setModel.value) || LLM.defaultModel(provider);

    /* Warn once if the typed model belongs to another provider \u2014 that
       combination cannot work, and a silent 401 is a terrible way to find
       out. We still save, so nothing the user typed is lost. */
    var owner = (provider === "ollama") ? null : LLM.providerOfModel(model);
    if (owner && owner !== provider) {
      toast("Heads up: " + model + " is a " + LLM.providerInfo(owner).label +
        " model. Switch the provider to " + LLM.providerInfo(owner).label + " for it to work.");
    }

    /* File the key under its own provider so an OpenAI key and a DeepSeek
       key can both be saved and each is used where it belongs. */
    if (provider !== "demo") Store.setKey(provider, typedKey);
    stashFormKey(); // covers a key typed for a provider we then switched away from

    var modeChanged = el.setMode.value !== state.settings.mode;
    state.settings = Store.saveSettings({
      name: el.setName.value.trim() || "bokskie",
      provider: provider,
      key: provider === "demo" ? "" : typedKey,
      model: model,
      baseUrl: normalizeBase(provider, el.setUrl.value),
      system: el.setSystem.value,
      mode: el.setMode.value
    });
    state.formProvider = provider;
    // choosing a mode by hand pins it, so auto-detect stops overriding
    if (modeChanged) state.autoMode = false;
    updateModelLabel();
    updateUser();
    updateModeLabel();
    renderSuggestions();
    closeSettings();

    var info = LLM.providerInfo(provider);
    var onServer = backendOn() && provider !== "demo" && provider !== "ollama";
    var ps = onServer ? providerStatus(provider) : null;
    if (provider === "demo") {
      toast("Settings saved \u2014 still in Demo mode.");
    } else if (onServer && (!ps || !ps.connected)) {
      toast("Saved, but no " + info.label + " key on the server yet \u2014 add one on its provider card.");
    } else if (!onServer && provider !== "ollama" && !state.settings.key) {
      toast("Saved, but no " + info.label + " key yet \u2014 chat stays offline until you add one.");
    } else {
      toast("Saved \u2014 " + info.label + " \u00b7 " + (model || LLM.defaultModel(provider)));
    }
  }

  /* ---------- export ---------- */

  function chatToMarkdown(chat) {
    var lines = ["# " + chat.title, "", "_Exported from bokskie.ai \u00b7 " + new Date(chat.updatedAt).toLocaleString() + "_", ""];
    chat.messages.forEach(function (m) {
      if (m.error || m.stopped) return;
      lines.push("### " + (m.role === "user" ? state.settings.name || "You" : "bokskie.ai"), "");
      lines.push(m.content, "");
    });
    return lines.join("\n");
  }

  function download(filename, content, type) {
    var blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var MIME = {
    html: "text/html;charset=utf-8",
    htm: "text/html;charset=utf-8",
    css: "text/css;charset=utf-8",
    js: "text/javascript;charset=utf-8",
    mjs: "text/javascript;charset=utf-8",
    json: "application/json;charset=utf-8",
    vue: "text/plain;charset=utf-8",
    svg: "image/svg+xml",
    md: "text/markdown;charset=utf-8"
  };

  function mimeForName(name) {
    var ext = (String(name).match(/\.([\w+#-]+)$/) || [])[1];
    return (ext && MIME[ext.toLowerCase()]) || "text/plain;charset=utf-8";
  }

  /* ---------- generated project files ----------
     Build mode returns <file name="..."> blocks. The last message
     that contains them drives a "Download all" bar so a whole
     generated site can be saved without a zip dependency.      */

  var lastFiles = [];

  function refreshFileBar() {
    if (!lastFiles.length) {
      el.dlBar.hidden = true;
      return;
    }
    el.dlBar.hidden = false;
    var total = lastFiles.reduce(function (n, f) { return n + f.code.length; }, 0);
    el.dlInfo.textContent = lastFiles.length + " file" + (lastFiles.length === 1 ? "" : "s") +
      " ready \u00b7 " + fmtBytes(total);
  }

  function collectFiles() {
    if (!state.chat) return;
    var msgs = state.chat.messages;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && !msgs[i].error) {
        var f = MD.extractFiles(msgs[i].content);
        if (f.length) {
          lastFiles = f;
          refreshFileBar();
          return;
        }
      }
    }
    lastFiles = [];
    refreshFileBar();
  }

  function downloadAllFiles() {
    if (!lastFiles.length) return;
    // browsers throttle rapid downloads, so stagger them slightly
    lastFiles.forEach(function (f, i) {
      setTimeout(function () { download(f.name, f.code, mimeForName(f.name)); }, i * 220);
    });
    toast("Downloading " + lastFiles.length + " file" + (lastFiles.length === 1 ? "" : "s") + " \u2014 check your Downloads folder.");
  }

  /* ---------- mobile sidebar ---------- */

  function closeMobileSidebar() {
    if (isMobile()) el.app.classList.add("collapsed");
  }

  function openMobileSidebar() {
    el.app.classList.remove("collapsed");
  }

  /* ============================================================
     SIDEBAR VISIBILITY
     Collapsing used to be a one-way door on a desktop. The only
     button that reopens the sidebar is .openSidebarBtn, which is
     .only-mobile (display:none above 760px), and the sidebar's own
     toggle button slid off screen together with the panel. So a
     desktop user who hid it had no way back.

     The rail in index.html is the way back now, and the choice is
     remembered so a reload does not silently undo it.
     ============================================================ */

  var K_RAIL = "bokskie.sidebarHidden";

  /* ---------- storage health ----------
     When the browser store is full or blocked, writes fail. That used to
     look like "my pin disappeared" with no explanation anywhere on
     screen, so it gets a real warning instead of a console line. */

  var storageWarned = false;

  function storageErrorMessage() {
    return "Browser storage is full or blocked, so changes are not being saved. " +
      "Use Export in the sidebar to keep your chats, then delete some old ones.";
  }

  function checkStorage() {
    if (storageWarned) return false;
    if (!Store.storageBroken()) return false;
    storageWarned = true;
    toast(storageErrorMessage(), 9000);
    return true;
  }

  function sidebarHidden() { return el.app.classList.contains("collapsed"); }

  function setSidebar(visible, remember) {
    el.app.classList.toggle("collapsed", !visible);
    if (el.sidebarRail) el.sidebarRail.setAttribute("aria-expanded", visible ? "true" : "false");
    if (remember !== false) {
      try { localStorage.setItem(K_RAIL, visible ? "0" : "1"); } catch (e) { /* storage blocked */ }
    }
  }

  function toggleSidebar() {
    if (isMobile()) { openMobileSidebar(); return; }
    setSidebar(sidebarHidden());
  }

  function restoreSidebar() {
    var saved = null;
    try { saved = localStorage.getItem(K_RAIL); } catch (e) { /* ignore */ }
    if (isMobile()) { el.app.classList.add("collapsed"); return; }
    /* Open by default; only an explicit "hidden" keeps it hidden. */
    setSidebar(saved !== "1", false);
  }

  /* Who is answering, and does it cost money? Plus a chat count.
     Both are checked constantly and both used to live only in
     Settings, which is why "does DeepSeek cost?" kept coming up. */
  function renderSidebarMeta() {
    var p = state.settings.provider;
    var info = LLM.providerInfo(p);
    var cost = LLM.costOf ? LLM.costOf(p) : { label: "", cls: "", note: "" };

    if (el.provChipName) el.provChipName.textContent = info.label;
    if (el.provChipCost) {
      el.provChipCost.textContent = cost.label;
      el.provChipCost.className = "pc-cost " + (cost.cls || "");
    }
    if (el.provChip) {
      el.provChip.title = (info.note || "") + "\n\nCost: " + cost.label + " — " + cost.note;
    }
    if (el.provChipDot) {
      var ps = providerStatus(p);
      var ready = p === "demo" ? true : (ps ? !!ps.connected : !!Store.keyFor(p));
      el.provChipDot.classList.toggle("on", ready);
    }

    var n = (Store.listChats() || []).length;
    if (el.chatStat) el.chatStat.textContent = n ? n + " chat" + (n === 1 ? "" : "s") : "Personal AI";
    if (el.railCount) el.railCount.textContent = n > 99 ? "99+" : String(n);
  }

  /* Every chat as one Markdown file - the one export you actually
     want before clearing or switching machines. */
  function exportAllChats() {
    var chats = Store.listChats() || [];
    if (!chats.length) { toast("No chats to export yet."); return; }
    var out = ["# bokskie.ai — chat archive", "", "_Exported " + new Date().toLocaleString() + "_", ""];
    chats.forEach(function (c) {
      var msgs = (c.messages || []).filter(function (m) { return !m.error && !m.stopped && m.content; });
      if (!msgs.length) return;
      out.push("## " + (c.title || "Untitled"), "");
      msgs.forEach(function (m) {
        out.push("**" + (m.role === "user" ? "You" : "bokskie") + ":**", "", String(m.content), "");
      });
      out.push("---", "");
    });
    download("bokskie-chats-" + new Date().toISOString().slice(0, 10) + ".md",
             out.join("\n"), "text/markdown;charset=utf-8");
    toast("Exported " + chats.length + " chat" + (chats.length === 1 ? "" : "s"));
  }

  function clearAllChats() {
    var n = (Store.listChats() || []).length;
    if (!n) { toast("There are no chats to delete."); return; }
    if (!confirm("Delete all " + n + " chat" + (n === 1 ? "" : "s") + "? This cannot be undone.")) return;
    Store.clearChats();
    state.chat = null;
    state.activeId = null;
    renderAll();
    toast("All chats deleted");
  }

  function isMobile() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  /* ---------- events ---------- */

  function bindEvents() {

    el.newChatBtn.addEventListener("click", startNewChat);

    el.collapseBtn.addEventListener("click", toggleSidebar);

    /* The rail is the way back on a desktop - the sidebar's own button
       disappears with the panel, and .openSidebarBtn is mobile-only.
       Below 761px the rail is hidden and the topbar button does this. */
    if (el.sidebarRail) {
      el.sidebarRail.addEventListener("click", function () {
        if (isMobile()) openMobileSidebar();
        else setSidebar(true);
      });
    }

    if (el.provChip) el.provChip.addEventListener("click", openSettings);
    if (el.exportAllBtn) el.exportAllBtn.addEventListener("click", exportAllChats);
    if (el.clearAllBtn) el.clearAllBtn.addEventListener("click", clearAllChats);

    /* The hunger bar beside the logo folds the sidebar away - it is the
       same affordance as the rail, just for when the panel is open. */
    if (el.brandBar) {
      el.brandBar.addEventListener("click", function () {
        if (!isMobile()) setSidebar(false);
        else closeMobileSidebar();
      });
    }

    el.openSidebarBtn.addEventListener("click", openMobileSidebar);

    el.scrim.addEventListener("click", closeMobileSidebar);

    // chat list: pin, project, open, delete
    if (el.sideNav) {
      el.sideNav.addEventListener("click", function (e) {
        var nav = e.target.closest("[data-view]");
        if (!nav) return;
        state.view = nav.dataset.view;
        if (el.searchInput) el.searchInput.value = "";
        renderAll();
      });
    }

    el.chatList.addEventListener("click", function (e) {
      var pin = e.target.closest("[data-pin]");
      if (pin) { e.stopPropagation(); togglePin(pin.dataset.pin); return; }
      var proj = e.target.closest("[data-proj]");
      if (proj) { e.stopPropagation(); setProject(proj.dataset.proj); return; }
      var del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        var id = del.dataset.del;
        var chat = Store.getChat(id);
        var name = chat ? "\"" + chat.title + "\"" : "this chat";
        if (confirm("Delete " + name + "? This cannot be undone.")) {
          Store.deleteChat(id);
          if (state.activeId === id) {
            state.chat = null;
            state.activeId = null;
          }
          renderAll();
          toast("Chat deleted");
        }
        return;
      }
      var item = e.target.closest(".chat-item");
      if (item && item.dataset.id) openChat(item.dataset.id);
    });

    el.searchInput.addEventListener("input", renderChatList);

    // suggestions
    el.suggestions.addEventListener("click", function (e) {
      var card = e.target.closest(".card");
      if (!card) return;
      el.input.value = card.dataset.prompt;
      autoGrow();
      el.input.focus();
      send();
    });

    // composer
    el.input.addEventListener("input", autoGrow);

    el.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!el.sendBtn.disabled) send();
      }
    });

    el.sendBtn.addEventListener("click", function () { send(); });
    el.stopBtn.addEventListener("click", stopStream);

    if (el.tempChip) el.tempChip.addEventListener("click", cycleTemp);
    el.micBtn.addEventListener("click", toggleMic);

    // mode picker
    el.modeChip.addEventListener("click", function (e) {
      e.stopPropagation();
      if (el.modeMenu.hidden) openModeMenu();
      else closeModeMenu();
    });

    el.modeMenu.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-mode]");
      if (opt) setMode(opt.dataset.mode);
    });

    el.clarifyOpts.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-clarify]");
      if (opt) resolveClarify(opt.dataset.clarify);
    });

    // dismissing the picker means "just ask in the current mode"
    el.clarifyX.addEventListener("click", function () {
      resolveClarify(null);
    });

    // generated-file download bar
    el.dlAll.addEventListener("click", downloadAllFiles);
    el.dlClose.addEventListener("click", function () {
      lastFiles = [];
      refreshFileBar();
    });
    el.dlCopyAll.addEventListener("click", function () {
      if (!lastFiles.length) return;
      var text = lastFiles.map(function (f) {
        return "/* ===== " + f.name + " ===== */\n" + f.code;
      }).join("\n\n");
      copyText(text).then(function (ok) {
        toast(ok ? "Copied " + lastFiles.length + " files" : "Copy failed");
      });
    });

    el.attachBtn.addEventListener("click", function () { el.fileInput.click(); });
    el.fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(el.fileInput.files || []);
      el.fileInput.value = "";
      if (!files.length) return;
      var pending = files.length;
      var failed = 0;
      files.forEach(function (f) {
        readTextFile(f, function (text) {
          if (text === null) { failed++; } else { addAttachment(f, text); }
          if (--pending === 0) {
            renderAttachments();
            if (failed) toast(failed + " file" + (failed === 1 ? "" : "s") + " could not be read.");
          }
        });
      });
    });

    el.attachments.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rm]");
      if (!btn) return;
      state.attachments.splice(+btn.dataset.rm, 1);
      renderAttachments();
    });

    // thread actions
    el.thread.addEventListener("click", function (e) {
      var codeBtn = e.target.closest(".code-copy");
      if (codeBtn) {
        var block = codeBtn.closest(".code-block, .file-block");
        var code = block.querySelector("code");
        copyText(code.innerText).then(function (ok) {
          if (!ok) return toast("Copy failed");
          codeBtn.classList.add("copied");
          codeBtn.querySelector("span").textContent = "Copied";
          setTimeout(function () {
            codeBtn.classList.remove("copied");
            codeBtn.querySelector("span").textContent = "Copy";
          }, 1600);
        });
        return;
      }

      /* Save a code block as a file. textContent, not innerText, for
         the same reason the attachment save uses it: the leading
         indentation of a 370-line page has to survive being saved,
         and innerText can normalise it. */
      var dlBtn = e.target.closest(".code-dl");
      if (dlBtn) {
        var dblock = dlBtn.closest(".code-block");
        var dname = dlBtn.dataset.name || "code.txt";
        var dbody = dblock.querySelector("code").textContent;
        download(dname, dbody, mimeForName(dname));
        toast("Saved " + dname);
        return;
      }

      var saveBtn = e.target.closest(".file-save");
      if (saveBtn) {
        var fblock = saveBtn.closest(".file-block");
        var fname = fblock.dataset.fname;
        // textContent, not innerText: keeps leading indentation exact
        var body = fblock.querySelector("code").textContent;
        download(fname, body, mimeForName(fname));
        toast("Saved " + fname);
        return;
      }

      /* Actions on the user's own bubbles: copy, edit, save, cancel. */
      var uact = e.target.closest("[data-uat]");
      if (uact && state.chat) {
        var uidx = +uact.dataset.idx;
        var what = uact.dataset.uat;
        if (what === "copy") {
          var umsg = state.chat.messages[uidx];
          if (umsg) {
            copyText(umsg.content).then(function (ok) {
              toast(ok ? "Message copied" : "Copy failed");
            });
          }
        } else if (what === "edit") {
          openEdit(uidx);
        } else if (what === "resend") {
          resendUser(uidx);
        } else if (what === "cancel") {
          cancelEdit();
        } else if (what === "save") {
          saveEdit(uidx);
        }
        return;
      }

      var btn = e.target.closest("[data-act]");
      if (!btn || !state.chat) return;
      var idx = +btn.dataset.idx;
      var act = btn.dataset.act;

      if (act === "copy") {
        var msg = state.chat.messages[idx];
        copyText(msg.content).then(function (ok) {
          toast(ok ? "Copied to clipboard" : "Copy failed");
        });
      } else if (act === "retry") {
        regenerate(idx);
      } else if (act === "up" || act === "down") {
        btn.classList.toggle("on");
        toast(act === "up" ? "Thanks for the feedback!" : "Thanks \u2014 we'll try to improve.");
      }
    });

    // model picker
    el.modelBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (el.modelMenu.hidden) openModelMenu();
      else closeModelMenu();
    });

    el.modelMenu.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-model]");
      if (opt) {
        state.settings = Store.saveSettings({ model: opt.dataset.model });
        updateModelLabel();
        closeModelMenu();
        return;
      }
      if (e.target.closest("[data-model-action]")) {
        closeModelMenu();
        openSettings();
      }
    });

    // theme
    function toggleTheme() {
      var cur = resolveTheme(Store.getThemePref());
      var next = cur === "dark" ? "light" : "dark";
      Store.setThemePref(next);
      applyTheme(next);
    }

    el.themeBtn.addEventListener("click", toggleTheme);
    if (el.themeSwitch) el.themeSwitch.addEventListener("click", toggleTheme);

    // settings modal
    el.settingsBtn.addEventListener("click", openSettings);
    el.closeSettings.addEventListener("click", closeSettings);
    el.cancelSettings.addEventListener("click", closeSettings);
    el.saveSettings.addEventListener("click", saveSettingsFromForm);
    el.settingsModal.addEventListener("click", function (e) {
      if (e.target === el.settingsModal) closeSettings();
    });
    el.setProvider.addEventListener("change", function () {
      /* Whatever is in the key box belongs to the provider that was showing,
         so file it there before we load the next provider's key. Without
         this, switching provider used to quietly reuse the wrong key. */
      stashFormKey();
      el.setModel.value = "";
      /* A Base URL typed for the old provider must not follow us across. */
      el.setUrl.value = "";
      syncProviderFields();
    });
    el.setMode.addEventListener("change", syncModeHelp);

    // provider cards + server key editor (settings modal)
    if (el.provGrid) {
      el.provGrid.addEventListener("click", function (e) {
        var btn = e.target.closest(".prov-card");
        if (!btn) return;
        var p = btn.getAttribute("data-p");
        if (el.setProvider.value !== p) {
          stashFormKey();
          el.setProvider.value = p;
          el.setModel.value = "";
          el.setUrl.value = "";
          syncProviderFields();   // re-renders the cards and the key editor too
        }
      });
    }
    if (el.keyRows) {
      el.keyRows.addEventListener("click", function (e) {
        var b = e.target.closest(".key-del");
        if (!b) return;
        backendRemoveKey(b.getAttribute("data-id"));
      });
    }
    if (el.keyAddBtn) el.keyAddBtn.addEventListener("click", backendAddKey);
    if (el.keyAddInput) {
      el.keyAddInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); backendAddKey(); }
      });
    }

    /* The backend probe reports in whenever it finishes (page load, or
       a re-check after the server was started). */
    window.addEventListener("bokskie:backend", function (e) {
      var up = !!(e && e.detail && e.detail.up);
      if (up) toast("Local backend connected \u2014 keys stay on this machine.");
      if (!el.settingsModal.hidden) refreshBackendStatus();
      else renderBackendField();
    });

    el.exportAllBtn.addEventListener("click", function () {
      var chats = Store.listChats();
      if (!chats.length) return toast("No chats to export yet.");
      var all = chats.map(chatToMarkdown).join("\n\n---\n\n");
      download("bokskie-chats.md", all, "text/markdown;charset=utf-8");
      toast("Exported " + chats.length + " chat" + (chats.length === 1 ? "" : "s"));
    });

    el.clearAllBtn.addEventListener("click", function () {
      if (!confirm("Delete ALL chats? This cannot be undone.")) return;
      Store.clearChats();
      state.chat = null;
      state.activeId = null;
      renderAll();
      toast("All chats deleted");
    });

    // share current chat
    el.shareBtn.addEventListener("click", function () {
      if (!state.chat || !state.chat.messages.length) {
        return toast("Nothing to export yet.");
      }
      var safe = state.chat.title.replace(/[^\w\-]+/g, "_").slice(0, 50);
      download(safe + ".md", chatToMarkdown(state.chat), "text/markdown;charset=utf-8");
      toast("Chat exported as Markdown");
    });

    // close model menu on outside click
    document.addEventListener("click", function (e) {
      if (!el.modelMenu.hidden && !e.target.closest("#modelPickerWrap")) closeModelMenu();
      if (!el.modeMenu.hidden && !e.target.closest("#modeWrap")) closeModeMenu();
    });

    // escape closes overlays
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!el.settingsModal.hidden) closeSettings();
        else if (!el.modelMenu.hidden) closeModelMenu();
        else if (!el.modeMenu.hidden) closeModeMenu();
        else closeMobileSidebar();
      }
    });

    // shortcuts
    document.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isMobile()) openMobileSidebar();
        el.searchInput.focus();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        el.input.focus();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        startNewChat();
      }
    });

    // keep sidebar usable after resize
    window.addEventListener("resize", function () {
      /* Only react when crossing the desktop/mobile boundary. The old
         code stripped .collapsed on *every* resize, which silently threw
         away a desktop user's choice every time they nudged the window. */
      var mobile = isMobile();
      if (el.__wasMobile === undefined) { el.__wasMobile = mobile; return; }
      if (mobile === el.__wasMobile) return;
      el.__wasMobile = mobile;
      if (mobile) el.app.classList.add("collapsed");
      else restoreSidebar();
    });

    // follow OS theme when pref is auto
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
      if (Store.getThemePref() === "auto") applyTheme("auto");
    });
  }

  /* ---------- init ---------- */

  function init() {
    applyTheme(Store.getThemePref());

    // populate the settings mode dropdown from the Modes module
    el.setMode.innerHTML = Modes.all().map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.label) + "</option>";
    }).join("");

    // Phones start with the sidebar closed (it is a drawer there).
    // A desktop keeps whatever the user chose last time.
    restoreSidebar();

    /* A full or blocked localStorage loses pins, chats and settings
       without a word. Say so once, up front. */
    checkStorage();

    // default model for the active provider when unset, and repair a model
    // that belongs to a different provider (or one that was retired)
    var fixed = LLM.resolveModel(state.settings.provider, state.settings.model);
    var owner = state.settings.provider === "ollama" ? null : LLM.providerOfModel(fixed);
    if (!fixed || (owner && owner !== state.settings.provider)) {
      fixed = LLM.defaultModel(state.settings.provider);
    }
    if (fixed !== state.settings.model) {
      state.settings = Store.saveSettings({ model: fixed });
    }

    // restore last chat
    var lastId = Store.getActiveId();
    if (lastId) {
      var c = Store.getChat(lastId);
      if (c) {
        state.chat = c;
        state.activeId = lastId;
      }
    }

    bindEvents();
    renderAll();
    updateTempLabel();
    updateModeLabel();
    renderSuggestions();
    refreshFileBar();
    scrollToBottom(false);
    el.input.focus();

    var m = currentMode();
    console.log("%cbokskie.ai", "color:#00c8cc;font-weight:bold",
      "ready \u2014 mode: " + m.label + ". Open Settings to connect a real model.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();