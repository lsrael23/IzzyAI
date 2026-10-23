/* =============================================================================
   IZZY AI — app.js (JavaScript NAVIGATEUR uniquement)

   - Aucun code Node.js : pas de require(), pas de module.exports, pas d'import.
   - Aucun outil de compilation requis.
   - Dépend uniquement de ce que index.html charge déjà :
       * la bibliothèque officielle Supabase v2 (window.supabase)
   - Contrat serveur respecté (voir server.js) :
       POST /chat       { message, conversationId, preferences, webSearch,
                          temporary, history }   -> { reply, conversationId }
       POST /vision     { message, conversationId, imageData, preferences,
                          temporary, history }   -> { reply, conversationId }
       POST /chat/end   { conversationId }
       GET  /health
       GET  /admin/me
       POST /admin/login-event
     Toutes les routes protégées reçoivent l'en-tête
       Authorization: Bearer <access_token Supabase>
   - Les contrôles d'administration sont décidés par le SERVEUR (/admin/me).
     Aucune vérification côté navigateur ne sert de protection.
   ============================================================================= */
(function () {
  "use strict";

  // Évite une double exécution (double balise <script>, rechargement à chaud…).
  if (window.__izzyAppStarted) {
    console.warn("[IZZY] app.js est déjà en cours d'exécution : second chargement ignoré.");
    return;
  }
  window.__izzyAppStarted = true;

  /* ===========================================================================
     1. CONFIGURATION
     =========================================================================== */

  var SUPABASE_URL = "https://xtulmimrbvzokvrglken.supabase.co";
  // Clé PUBLIQUE (publishable) : conçue pour le navigateur. Aucune clé secrète ici.
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nWnm3EA3f4qAsh-RVIkyqA_-FtTBrE0";

  var PROD_ORIGIN = "https://izzyai.onrender.com";
  // Sur le site Render, on appelle le même domaine. Ailleurs, on vise Render.
  var API_BASE = window.location.origin === PROD_ORIGIN ? "" : PROD_ORIGIN;

  var KEYS = {
    prefs: "izzyAI.prefs.v1",
    memories: "izzyAI.memories.v1",
    // Clés ajoutées par ce fichier (nouvelles données, ne remplacent rien d'existant)
    chats: "izzyAI.chats.v1",
    projects: "izzyAI.projects.v1",
    tasks: "izzyAI.tasks.v1"
  };
  var STORE_FORMAT = "izzy-per-user";

  var MAX_MESSAGE = 4000;        // limite serveur
  var MAX_HISTORY = 20;          // limite serveur
  var MAX_MEMORIES = 50;         // limite serveur
  var MAX_CHATS = 50;
  var MAX_MESSAGES_PER_CHAT = 200;
  var MAX_IMAGE_CHARS = 5500000; // le serveur refuse > 6 000 000 caractères
  var TONES = ["casual", "calm", "funny", "direct"];
  var DEFAULT_TITLE = "Nouveau chat";

  /* ===========================================================================
     2. ÉTAT
     =========================================================================== */

  var state = {
    supabase: null,
    initError: "",
    authSubscribed: false,
    user: null,
    token: null,
    mode: "signin",            // signin | signup | recovery
    authBusy: false,
    recoveryPending: false,
    appVisible: false,
    isAdmin: false,

    prefs: defaultPrefs(),
    memories: [],
    chats: [],
    activeChatId: null,
    projects: [],
    tasks: [],

    temp: false,
    tempChat: null,

    sending: false,
    abort: null,
    pendingError: null,
    webSearch: false,
    image: null,               // data URL JPEG prête à l'envoi

    recognition: null,
    listening: false,
    micLabel: "",

    toastTimer: null
  };

  var els = {};

  /* ===========================================================================
     3. OUTILS GÉNÉRAUX
     =========================================================================== */

  function $(id) {
    return document.getElementById(id);
  }

  function on(target, type, handler, options) {
    var node = typeof target === "string" ? $(target) : target;
    if (!node) return false;
    node.addEventListener(type, handler, options);
    return true;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(label, className, handler) {
    var b = el("button", className || "", label);
    b.type = "button";
    if (handler) b.addEventListener("click", handler);
    return b;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* repli ci-dessous */ }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function safeHttpUrl(value) {
    try {
      var u = new URL(value);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function toast(message, ms) {
    var box = els.toast;
    if (!box) return;
    box.textContent = String(message);
    box.classList.remove("hidden");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      box.classList.add("hidden");
    }, ms || 3800);
  }

  // Exécute une initialisation secondaire sans jamais faire tomber le reste.
  function safe(name, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[IZZY] Erreur dans « " + name + " » :", e);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { toast("Copié."); },
        function () { fallbackCopy(text); }
      );
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      toast(ok ? "Copié." : "Copie impossible sur ce navigateur.");
    } catch (e) {
      toast("Copie impossible sur ce navigateur.");
    }
  }

  /* ===========================================================================
     4. STOCKAGE LOCAL (par compte, sans écraser les anciennes données)
     =========================================================================== */

  function readJSON(key) {
    var raw = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch (e) {
      return null; // stockage indisponible (navigation privée stricte, etc.)
    }
    if (raw === null || raw === "") return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      // JSON invalide : on garde une copie de sauvegarde au lieu de la perdre.
      try {
        if (window.localStorage.getItem(key + ".corrupt") === null) {
          window.localStorage.setItem(key + ".corrupt", raw);
        }
      } catch (e2) { /* ignoré */ }
      console.warn("[IZZY] Données locales illisibles pour " + key + " (copie conservée).");
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("[IZZY] Écriture locale impossible pour " + key + ".");
      return false;
    }
  }

  function isPerUser(raw) {
    return Boolean(raw) && raw.format === STORE_FORMAT &&
      raw.users && typeof raw.users === "object" && !Array.isArray(raw.users);
  }

  // Lit la tranche d'un compte. Si les données sont à l'ancien format
  // (non rattaché à un compte), elles sont migrées vers le premier compte
  // qui se connecte, sans perte.
  function readUserSlice(key, userId, adaptLegacy, makeEmpty) {
    var raw = readJSON(key);
    if (isPerUser(raw)) {
      return Object.prototype.hasOwnProperty.call(raw.users, userId)
        ? raw.users[userId]
        : makeEmpty();
    }
    if (raw !== null && raw !== undefined && adaptLegacy) {
      var migrated = adaptLegacy(raw);
      if (migrated !== null && migrated !== undefined) {
        var wrapper = { format: STORE_FORMAT, users: {}, migratedFromLegacy: true };
        wrapper.users[userId] = migrated;
        writeJSON(key, wrapper);
        return migrated;
      }
    }
    return makeEmpty();
  }

  function writeUserSlice(key, userId, value) {
    var raw = readJSON(key);
    if (!isPerUser(raw)) raw = { format: STORE_FORMAT, users: {} };
    raw.users[userId] = value;
    return writeJSON(key, raw);
  }

  /* ---- Préférences ---- */

  function defaultPrefs() {
    return { tone: "casual", energy: 70, nickname: "", speakReplies: true };
  }

  function normalizePrefs(obj) {
    var base = defaultPrefs();
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return base;
    var tone = typeof obj.tone === "string" && TONES.indexOf(obj.tone) !== -1 ? obj.tone : base.tone;
    var energy = Number(obj.energy);
    if (!isFinite(energy)) energy = base.energy;
    var nickname = typeof obj.nickname === "string" ? obj.nickname.trim().slice(0, 32) : "";
    var speak = typeof obj.speakReplies === "boolean" ? obj.speakReplies : base.speakReplies;
    return { tone: tone, energy: clamp(Math.round(energy), 0, 100), nickname: nickname, speakReplies: speak };
  }

  /* ---- Souvenirs ---- */

  function normalizeMemories(raw) {
    var list = raw;
    if (list && !Array.isArray(list) && typeof list === "object") {
      list = list.items || list.memories || [];
    }
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (item) {
      var text = "";
      var id = null;
      var createdAt = Date.now();
      if (typeof item === "string") {
        text = item;
      } else if (item && typeof item === "object") {
        text = String(item.text || item.content || item.value || "");
        id = item.id || null;
        if (typeof item.createdAt === "number") createdAt = item.createdAt;
      }
      text = text.trim().slice(0, 180);
      if (text) out.push({ id: id ? String(id) : uid(), text: text, createdAt: createdAt });
    });
    return out.slice(0, MAX_MEMORIES);
  }

  /* ---- Chargement / sauvegarde des données du compte ---- */

  function loadUserData() {
    var id = state.user.id;
    state.prefs = normalizePrefs(readUserSlice(KEYS.prefs, id, normalizePrefs, function () { return defaultPrefs(); }));
    state.memories = normalizeMemories(readUserSlice(KEYS.memories, id, normalizeMemories, function () { return []; }));

    var chatSlice = readUserSlice(KEYS.chats, id, null, function () { return { chats: [], activeId: null }; });
    state.chats = sanitizeChats(chatSlice && chatSlice.chats);
    state.activeChatId = chatSlice && chatSlice.activeId ? chatSlice.activeId : null;
    if (!state.chats.some(function (c) { return c.id === state.activeChatId; })) {
      state.activeChatId = state.chats.length ? state.chats[0].id : null;
    }

    var projects = readUserSlice(KEYS.projects, id, null, function () { return []; });
    state.projects = Array.isArray(projects)
      ? projects.filter(function (p) { return p && typeof p.text === "string"; }).slice(0, 100)
      : [];
    var tasks = readUserSlice(KEYS.tasks, id, null, function () { return []; });
    state.tasks = Array.isArray(tasks)
      ? tasks.filter(function (t) { return t && typeof t.text === "string"; }).slice(0, 200)
      : [];
  }

  function resetUserData() {
    state.prefs = defaultPrefs();
    state.memories = [];
    state.chats = [];
    state.activeChatId = null;
    state.projects = [];
    state.tasks = [];
    state.tempChat = null;
    state.pendingError = null;
  }

  function sanitizeChats(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || !Array.isArray(c.messages)) return;
      var messages = [];
      c.messages.forEach(function (m) {
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
          messages.push({
            id: typeof m.id === "string" ? m.id : uid(),
            role: m.role,
            content: m.content,
            ts: typeof m.ts === "number" ? m.ts : Date.now(),
            image: m.image === true
          });
        }
      });
      out.push({
        id: c.id.slice(0, 100),
        title: typeof c.title === "string" && c.title ? c.title.slice(0, 80) : DEFAULT_TITLE,
        createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
        updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
        messages: messages.slice(-MAX_MESSAGES_PER_CHAT)
      });
    });
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return out.slice(0, MAX_CHATS);
  }

  function savePrefs() {
    if (!state.user) return;
    writeUserSlice(KEYS.prefs, state.user.id, state.prefs);
  }

  function saveMemories() {
    if (!state.user) return;
    writeUserSlice(KEYS.memories, state.user.id, state.memories);
  }

  function saveChats() {
    if (!state.user) return;
    state.chats.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (state.chats.length > MAX_CHATS) state.chats.length = MAX_CHATS;
    var ok = writeUserSlice(KEYS.chats, state.user.id, { chats: state.chats, activeId: state.activeChatId });
    if (!ok) toast("Stockage local plein ou indisponible : l'historique n'a pas pu être enregistré.");
  }

  function saveProjects() {
    if (state.user) writeUserSlice(KEYS.projects, state.user.id, state.projects);
  }

  function saveTasks() {
    if (state.user) writeUserSlice(KEYS.tasks, state.user.id, state.tasks);
  }

  /* ===========================================================================
     5. MESSAGES D'AUTHENTIFICATION
     =========================================================================== */

  function showAuthMessage(text, kind) {
    if (!els.authError) return;
    els.authError.textContent = text || "";
    els.authError.style.color = kind === "info" ? "#b9dfa8" : "";
  }

  function showAuthError(text) { showAuthMessage(text, "error"); }
  function showAuthInfo(text) { showAuthMessage(text, "info"); }

  function translateAuthError(err) {
    var msg = String((err && err.message) || "");
    var code = String((err && err.code) || "");
    var status = err && typeof err.status === "number" ? err.status : null;
    var name = String((err && err.name) || "");

    if (name === "AuthRetryableFetchError" || status === 0 || /failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      return "Impossible de joindre le service de connexion. Vérifie ta connexion Internet, puis réessaie.";
    }
    if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
      return "Adresse e-mail ou mot de passe incorrect.";
    }
    if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
      return "Ton adresse e-mail n'est pas encore confirmée. Ouvre le message de confirmation reçu par e-mail (pense aux spams).";
    }
    if (code === "user_already_exists" || /already registered|already been registered/i.test(msg)) {
      return "Un compte existe déjà avec cette adresse. Connecte-toi ou utilise « Mot de passe oublié ? ».";
    }
    if (code === "weak_password" || /password should|weak password|at least \d+ characters/i.test(msg)) {
      return "Mot de passe trop faible : 8 caractères minimum et évite les mots de passe trop courants.";
    }
    if (code === "same_password" || /different from the old password/i.test(msg)) {
      return "Le nouveau mot de passe doit être différent de l'ancien.";
    }
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429 || /rate limit|too many/i.test(msg)) {
      return "Trop de tentatives ou d'e-mails envoyés. Patiente une minute, puis réessaie.";
    }
    if (code === "signup_disabled" || /signups? not allowed|signup is disabled/i.test(msg)) {
      return "Les inscriptions sont désactivées pour le moment.";
    }
    if (code === "user_banned" || /banned|suspended/i.test(msg)) {
      return "Ce compte est suspendu.";
    }
    if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(msg)) {
      return "Cette adresse e-mail n'est pas valide.";
    }
    if (code === "session_not_found" || /session.*(missing|not found|expired)/i.test(msg)) {
      return "Ta session a expiré. Reconnecte-toi.";
    }
    return "Erreur d'authentification" + (msg ? " : " + msg : ".");
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
  }

  function redirectUrl() {
    var origin = /^https?:$/.test(window.location.protocol) ? window.location.origin : PROD_ORIGIN;
    return origin + "/";
  }

  /* ===========================================================================
     6. ÉCRAN DE CONNEXION
     =========================================================================== */

  function setAuthMode(mode) {
    state.mode = mode;
    var emailLabel = els.authForm ? els.authForm.querySelector('label[for="authEmail"]') : null;
    var recovery = mode === "recovery";
    var signup = mode === "signup";

    if (els.authEmail) els.authEmail.classList.toggle("hidden", recovery);
    if (emailLabel) emailLabel.classList.toggle("hidden", recovery);
    if (els.forgotBtn) els.forgotBtn.classList.toggle("hidden", signup || recovery);

    if (els.authSubtitle) {
      els.authSubtitle.textContent = recovery
        ? "Choisis un nouveau mot de passe pour ton compte."
        : signup
          ? "Crée ton compte pour retrouver IZZY AI partout."
          : "Connecte-toi à ton compagnon intelligent.";
    }
    if (els.authPasswordLabel) els.authPasswordLabel.textContent = recovery ? "Nouveau mot de passe" : "Mot de passe";
    if (els.authPassword) {
      els.authPassword.setAttribute("autocomplete", signup || recovery ? "new-password" : "current-password");
      if (recovery) els.authPassword.value = "";
    }
    if (els.authSubmit) {
      els.authSubmit.textContent = recovery ? "Enregistrer le mot de passe" : signup ? "Créer mon compte" : "Se connecter";
    }
    if (els.authToggle) {
      els.authToggle.textContent = recovery ? "Annuler" : signup ? "J'ai déjà un compte" : "Créer un compte";
    }
  }

  function setAuthBusy(busy, label) {
    state.authBusy = busy;
    [els.authSubmit, els.authToggle, els.forgotBtn].forEach(function (b) {
      if (b) b.disabled = busy;
    });
    if (busy && els.authSubmit && label) els.authSubmit.textContent = label;
    if (!busy) setAuthMode(state.mode); // restaure les libellés
  }

  function showAuthScreen() {
    state.appVisible = false;
    if (els.authScreen) els.authScreen.classList.remove("hidden");
    if (els.app) els.app.classList.add("hidden");
  }

  function showAppScreen() {
    state.appVisible = true;
    if (els.authScreen) els.authScreen.classList.add("hidden");
    if (els.app) els.app.classList.remove("hidden");
  }

  async function handleAuthSubmit(ev) {
    if (ev) ev.preventDefault();
    if (state.authBusy) return;
    showAuthMessage("");

    if (!state.supabase) {
      showAuthError(state.initError || "Le service de connexion n'est pas disponible. Recharge la page.");
      return;
    }

    var email = els.authEmail ? els.authEmail.value.trim() : "";
    var password = els.authPassword ? els.authPassword.value : "";

    try {
      // ---- Nouveau mot de passe (après le lien reçu par e-mail) ----
      if (state.mode === "recovery") {
        if (password.length < 8) {
          showAuthError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
          return;
        }
        setAuthBusy(true, "Enregistrement…");
        var upd = await state.supabase.auth.updateUser({ password: password });
        if (upd.error) throw upd.error;
        state.recoveryPending = false;
        cleanAuthUrl();
        if (els.authPassword) els.authPassword.value = "";
        state.mode = "signin";
        var sess = await state.supabase.auth.getSession();
        if (sess.data && sess.data.session && sess.data.session.user) {
          toast("Mot de passe mis à jour.");
          enterApp(sess.data.session.user);
        } else {
          setAuthMode("signin");
          showAuthInfo("Mot de passe mis à jour. Tu peux te connecter.");
        }
        return;
      }

      // ---- Validation commune ----
      if (!email) { showAuthError("Saisis ton adresse e-mail."); if (els.authEmail) els.authEmail.focus(); return; }
      if (!validEmail(email)) { showAuthError("Cette adresse e-mail n'a pas un format valide."); if (els.authEmail) els.authEmail.focus(); return; }
      if (!password) { showAuthError("Saisis ton mot de passe."); if (els.authPassword) els.authPassword.focus(); return; }

      // ---- Création de compte ----
      if (state.mode === "signup") {
        if (password.length < 8) {
          showAuthError("Le mot de passe doit contenir au moins 8 caractères.");
          return;
        }
        setAuthBusy(true, "Création…");
        var su = await state.supabase.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: redirectUrl() }
        });
        if (su.error) throw su.error;

        var data = su.data || {};
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          // Supabase masque volontairement l'existence d'un compte déjà confirmé.
          showAuthError("Impossible de créer un nouveau compte avec cette adresse. Si tu as déjà un compte, connecte-toi ou utilise « Mot de passe oublié ? ».");
          return;
        }
        if (data.session && data.session.user) {
          if (els.authPassword) els.authPassword.value = "";
          enterApp(data.session.user);
          recordLogin();
          return;
        }
        if (els.authPassword) els.authPassword.value = "";
        state.mode = "signin";
        setAuthMode("signin");
        showAuthInfo("Compte créé. Un e-mail de confirmation a été envoyé à " + email + ". Clique sur le lien qu'il contient (vérifie aussi les spams), puis reviens te connecter ici.");
        return;
      }

      // ---- Connexion ----
      setAuthBusy(true, "Connexion…");
      var si = await state.supabase.auth.signInWithPassword({ email: email, password: password });
      if (si.error) throw si.error;
      if (!si.data || !si.data.session || !si.data.session.user) {
        throw new Error("Aucune session n'a été renvoyée par le service de connexion.");
      }
      if (els.authPassword) els.authPassword.value = "";
      enterApp(si.data.session.user);
      recordLogin();
    } catch (err) {
      // Jamais le mot de passe dans les logs : seulement le code et le statut.
      console.warn("[IZZY] Échec d'authentification (mode " + state.mode + ") :", err && err.code, err && err.status);
      showAuthError(translateAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleForgot() {
    if (state.authBusy) return;
    showAuthMessage("");
    if (!state.supabase) {
      showAuthError(state.initError || "Le service de connexion n'est pas disponible. Recharge la page.");
      return;
    }
    var email = els.authEmail ? els.authEmail.value.trim() : "";
    if (!email) {
      showAuthError("Saisis d'abord ton adresse e-mail, puis clique sur « Mot de passe oublié ? ».");
      if (els.authEmail) els.authEmail.focus();
      return;
    }
    if (!validEmail(email)) {
      showAuthError("Cette adresse e-mail n'a pas un format valide.");
      return;
    }
    try {
      setAuthBusy(true, "Envoi…");
      var res = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
      if (res.error) throw res.error;
      showAuthInfo("Demande envoyée. Si un compte existe pour " + email + ", un e-mail contenant le lien de réinitialisation arrivera dans quelques minutes (pense aux spams).");
    } catch (err) {
      console.warn("[IZZY] Échec de la réinitialisation :", err && err.code, err && err.status);
      showAuthError(translateAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAuthToggle() {
    if (state.authBusy) return;
    showAuthMessage("");
    if (state.mode === "recovery") {
      state.recoveryPending = false;
      cleanAuthUrl();
      try { if (state.supabase) await state.supabase.auth.signOut(); } catch (e) { /* ignoré */ }
      setAuthMode("signin");
      return;
    }
    setAuthMode(state.mode === "signin" ? "signup" : "signin");
  }

  function cleanAuthUrl() {
    try {
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, document.title, window.location.pathname);
      }
    } catch (e) { /* ignoré */ }
  }

  // Erreurs renvoyées par Supabase dans l'URL (lien expiré, etc.)
  function readAuthUrlProblems() {
    try {
      var params = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      var search = new URLSearchParams(window.location.search || "");
      var code = params.get("error_code") || search.get("error_code");
      var error = params.get("error") || search.get("error");
      if (!code && !error) return;
      if (code === "otp_expired") {
        showAuthError("Ce lien a expiré ou a déjà été utilisé. Redemande un nouvel e-mail depuis cet écran.");
      } else {
        var desc = params.get("error_description") || search.get("error_description") || "";
        showAuthError("Le lien reçu par e-mail n'est pas valide" + (desc ? " (" + desc.replace(/\+/g, " ") + ")" : "") + ".");
      }
      cleanAuthUrl();
    } catch (e) { /* ignoré */ }
  }

  /* ===========================================================================
     7. SESSION SUPABASE
     =========================================================================== */

  function initSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      state.initError = "La bibliothèque Supabase n'a pas pu être chargée (cdn.jsdelivr.net). Vérifie ta connexion, désactive un éventuel bloqueur de contenu, puis recharge la page.";
      return false;
    }
    try {
      state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return true;
    } catch (e) {
      console.error("[IZZY] Création du client Supabase impossible :", e);
      state.initError = "Impossible d'initialiser le service de connexion (" + (e && e.message ? e.message : "erreur inconnue") + ").";
      return false;
    }
  }

  function subscribeAuth() {
    if (!state.supabase || state.authSubscribed) return;
    state.authSubscribed = true;
    state.supabase.auth.onAuthStateChange(function (event, session) {
      // Règle Supabase : ne jamais appeler d'autre méthode auth dans ce callback.
      setTimeout(function () { handleAuthEvent(event, session); }, 0);
    });
  }

  function handleAuthEvent(event, session) {
    state.token = session && session.access_token ? session.access_token : null;

    if (event === "PASSWORD_RECOVERY") {
      state.recoveryPending = true;
      showAuthScreen();
      setAuthMode("recovery");
      showAuthInfo("Lien vérifié. Choisis ton nouveau mot de passe.");
      return;
    }

    if (event === "SIGNED_OUT") {
      onSignedOut();
      return;
    }

    if (session && session.user) {
      if (state.recoveryPending) return; // on reste sur l'écran « nouveau mot de passe »
      if ((event === "TOKEN_REFRESHED" || event === "USER_UPDATED") &&
          state.user && state.user.id === session.user.id) {
        state.user = session.user;
        updateProfile();
        return;
      }
      enterApp(session.user);
      return;
    }

    if (event === "INITIAL_SESSION" && !state.appVisible && !state.recoveryPending) {
      showAuthScreen();
      if (els.authError && /session/i.test(els.authError.textContent)) showAuthMessage("");
      setStatus("● Déconnecté", "");
    }
  }

  async function getAccessToken(forceRefresh) {
    if (!state.supabase) throw apiError("Auth", "Le service de connexion n'est pas disponible.");
    var result;
    try {
      if (forceRefresh) {
        result = await state.supabase.auth.refreshSession();
      } else {
        result = await state.supabase.auth.getSession(); // renouvelle si nécessaire
      }
    } catch (e) {
      throw apiError("Network", "Impossible de vérifier ta session. Vérifie ta connexion.");
    }
    var session = result && result.data ? result.data.session : null;
    if (!session || !session.access_token) {
      throw apiError("Auth", "Ta session a expiré. Reconnecte-toi.");
    }
    state.token = session.access_token;
    return session.access_token;
  }

  async function signOut() {
    cancelSpeech();
    stopListening();
    if (state.abort) { try { state.abort.abort(); } catch (e) { /* ignoré */ } }
    if (state.temp && state.tempChat) endServerConversation(state.tempChat.id);
    try {
      if (state.supabase) {
        var res = await state.supabase.auth.signOut();
        if (res && res.error) console.warn("[IZZY] Déconnexion : ", res.error.message);
      }
    } catch (e) {
      console.warn("[IZZY] Déconnexion :", e && e.message);
    }
    // Même si le réseau a échoué, on quitte l'espace connecté côté interface.
    onSignedOut();
  }

  function onSignedOut() {
    cancelSpeech();
    stopListening();
    if (state.abort) { try { state.abort.abort(); } catch (e) { /* ignoré */ } }
    state.user = null;
    state.token = null;
    state.isAdmin = false;
    state.temp = false;
    resetUserData();
    clearImage();
    document.body.classList.remove("temp-mode");
    if (els.tempBanner) els.tempBanner.classList.add("hidden");
    if (els.adminBtn) els.adminBtn.classList.add("hidden");
    if (els.adminTag) els.adminTag.classList.add("hidden");
    clearNode(els.messages);
    showAuthScreen();
    if (!state.recoveryPending) setAuthMode("signin");
    if (els.authPassword) els.authPassword.value = "";
    setStatus("● Déconnecté", "");
    showPanel("chat", true);
  }

  async function handleSessionExpired() {
    try { if (state.supabase) await state.supabase.auth.signOut({ scope: "local" }); } catch (e) { /* ignoré */ }
    onSignedOut();
    showAuthError("Ta session a expiré. Reconnecte-toi pour continuer.");
  }

  /* ===========================================================================
     8. APPEL DU SERVEUR
     =========================================================================== */

  function apiError(kind, message, status, data) {
    var e = new Error(message);
    e.kind = kind;
    e.status = status || 0;
    e.data = data || null;
    return e;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    var method = opts.method || "GET";
    var timeoutMs = opts.timeoutMs || 30000;
    var attempt = 0;

    for (;;) {
      var headers = {};
      var hasBody = opts.body !== undefined;
      if (hasBody) headers["Content-Type"] = "application/json";

      if (opts.auth !== false) {
        var token = await getAccessToken(attempt > 0);
        headers["Authorization"] = "Bearer " + token;
      }

      var ctrl = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
      var ext = opts.signal || null;
      var onExt = null;
      if (ext) {
        if (ext.aborted) ctrl.abort();
        else { onExt = function () { ctrl.abort(); }; ext.addEventListener("abort", onExt); }
      }

      var res, text;
      try {
        res = await fetch(API_BASE + path, {
          method: method,
          headers: headers,
          body: hasBody ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
          cache: "no-store",
          keepalive: Boolean(opts.keepalive)
        });
        text = await res.text();
      } catch (e) {
        clearTimeout(timer);
        if (ext && onExt) ext.removeEventListener("abort", onExt);
        if (ext && ext.aborted) throw apiError("UserAbort", "Interrompu.");
        if (timedOut) {
          throw apiError("Timeout", "Le serveur n'a pas répondu à temps. Il est peut-être en train de démarrer : réessaie dans quelques instants.");
        }
        throw apiError("Network", "Impossible de joindre le serveur IZZY AI. Vérifie ta connexion Internet, puis réessaie.");
      }
      clearTimeout(timer);
      if (ext && onExt) ext.removeEventListener("abort", onExt);

      var data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
      }

      if (res.status === 401 && opts.auth !== false) {
        if (attempt === 0) { attempt++; continue; } // un seul renouvellement de session
        throw apiError("Auth", (data && data.error) || "Session invalide ou expirée. Reconnecte-toi.", 401, data);
      }

      return { ok: res.ok, status: res.status, data: data, text: text };
    }
  }

  function httpErrorFrom(res, path) {
    var serverMsg = res.data && typeof res.data.error === "string" ? res.data.error : "";
    if (path === "/vision" && res.status === 404 && /route introuvable/i.test(serverMsg)) {
      return apiError("Http",
        "L'analyse de photos n'est pas disponible : le serveur ne possède pas (ou plus) la route /vision.",
        res.status, res.data);
    }
    if (serverMsg) return apiError("Http", serverMsg, res.status, res.data);
    if (res.data === null && res.text) {
      return apiError("Http", "Le serveur a renvoyé une réponse inattendue (HTTP " + res.status + "). Réessaie dans un instant.", res.status);
    }
    if (res.status === 429) return apiError("Http", "Trop de demandes. Réessaie dans une minute.", 429);
    if (res.status >= 500) return apiError("Http", "Le serveur rencontre un problème (HTTP " + res.status + "). Réessaie.", res.status);
    return apiError("Http", "Erreur inattendue (HTTP " + res.status + ").", res.status);
  }

  function userFacingMessage(err) {
    if (!err) return "Une erreur inconnue est survenue.";
    if (err.kind === "Auth") return err.message || "Ta session a expiré. Reconnecte-toi.";
    return err.message || "Une erreur est survenue. Réessaie.";
  }

  function setStatus(text, cls) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.remove("good", "bad");
    if (cls) els.status.classList.add(cls);
  }

  async function fetchHealth() {
    try {
      var res = await apiFetch("/health", { auth: false, timeoutMs: 60000 });
      if (!res.ok || !res.data) return { reachable: false };
      return { reachable: true, data: res.data };
    } catch (e) {
      return { reachable: false };
    }
  }

  async function checkHealth() {
    setStatus("● Connexion…", "");
    var h = await fetchHealth();
    if (!h.reachable) {
      setStatus("● Serveur indisponible", "bad");
    } else if (h.data.aiConfigured === false) {
      setStatus("● IA non configurée", "bad");
    } else if (h.data.supabaseConfigured === false) {
      setStatus("● Comptes non configurés", "bad");
    } else {
      setStatus("● En ligne", "good");
    }
    return h;
  }

  async function checkAdmin() {
    state.isAdmin = false;
    try {
      var res = await apiFetch("/admin/me", { timeoutMs: 45000 });
      if (res.ok && res.data && res.data.isAdmin === true) state.isAdmin = true;
    } catch (e) { /* non administrateur ou serveur indisponible */ }
    if (els.adminBtn) els.adminBtn.classList.toggle("hidden", !state.isAdmin);
    if (els.adminTag) els.adminTag.classList.toggle("hidden", !state.isAdmin);
    return state.isAdmin;
  }

  // Historique de connexions : fonction du serveur, échec silencieux.
  function recordLogin() {
    apiFetch("/admin/login-event", { method: "POST", body: {}, timeoutMs: 30000 }).then(
      function (res) {
        if (!res.ok) console.info("[IZZY] Historique de connexion non enregistré (HTTP " + res.status + ").");
      },
      function () { /* ignoré */ }
    );
  }

  function endServerConversation(conversationId) {
    if (!conversationId || !state.token) return;
    try {
      fetch(API_BASE + "/chat/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + state.token },
        body: JSON.stringify({ conversationId: conversationId }),
        keepalive: true
      }).catch(function () { /* ignoré */ });
    } catch (e) { /* ignoré */ }
  }

  /* ===========================================================================
     9. ENTRÉE DANS L'APPLICATION
     =========================================================================== */

  function enterApp(user) {
    var alreadyIn = state.appVisible && state.user && state.user.id === user.id;
    state.user = user;
    if (alreadyIn) {
      updateProfile();
      return;
    }
    // Compte différent : on repart d'un état propre (aucun mélange de données).
    resetUserData();
    state.temp = false;
    document.body.classList.remove("temp-mode");
    if (els.tempBanner) els.tempBanner.classList.add("hidden");

    loadUserData();
    showAuthMessage("");
    showAppScreen();
    updateProfile();
    renderSettings();
    renderMemories();
    renderProjects();
    renderTasks();
    ensureChat();
    renderAll();
    showPanel("chat", true);
    checkHealth();
    checkAdmin();
  }

  function displayName() {
    if (state.prefs.nickname) return state.prefs.nickname;
    var email = state.user && state.user.email ? state.user.email : "";
    return email ? email.split("@")[0] : "IZZY AI";
  }

  function userInitial() {
    var n = displayName();
    return n ? n.charAt(0).toUpperCase() : "T";
  }

  function updateProfile() {
    if (els.profileName) els.profileName.textContent = displayName();
    if (els.profileEmail) els.profileEmail.textContent = state.user && state.user.email ? state.user.email : "Compte connecté";
    var orb = document.querySelector(".profile-orb");
    if (orb) orb.textContent = userInitial();
    if (els.adminAccount && state.user) {
      els.adminAccount.textContent = (state.user.email || state.user.id) +
        (state.isAdmin ? " — administrateur confirmé par le serveur" : "");
    }
  }

  /* ===========================================================================
     10. PANNEAUX / NAVIGATION
     =========================================================================== */

  var PANELS = {
    chat: "chatPanel",
    projects: "projectsPanel",
    tasks: "tasksPanel",
    memories: "memoriesPanel",
    settings: "settingsPanel",
    admin: "adminPanel"
  };

  function showPanel(name, silent) {
    if (!PANELS[name]) name = "chat";
    if (name === "admin" && !state.isAdmin) {
      if (!silent) toast("Cette zone est réservée à l'administrateur.");
      name = "chat";
    }
    Object.keys(PANELS).forEach(function (key) {
      var p = $(PANELS[key]);
      if (p) p.classList.toggle("active", key === name);
    });
    var navButtons = document.querySelectorAll(".nav-btn[data-panel]");
    Array.prototype.forEach.call(navButtons, function (b) {
      b.classList.toggle("active", b.getAttribute("data-panel") === name);
    });
    openSidebar(false);
    if (name === "admin") refreshAdminPanel();
    if (name === "chat") scrollDown();
  }

  function openSidebar(open) {
    if (els.sidebar) els.sidebar.classList.toggle("open", open);
    if (els.overlay) els.overlay.classList.toggle("show", open);
  }

  async function refreshAdminPanel() {
    if (!els.adminHealth) return;
    updateProfile();
    els.adminHealth.textContent = "Vérification…";
    var results = await Promise.all([fetchHealth(), checkAdmin()]);
    var h = results[0];
    updateProfile();
    if (!h.reachable) {
      els.adminHealth.textContent = "Serveur injoignable ou en cours de démarrage.";
      return;
    }
    var d = h.data || {};
    var yn = function (v) { return v ? "oui" : "non"; };
    els.adminHealth.textContent =
      "Serveur : en ligne · Supabase configuré : " + yn(d.supabaseConfigured) +
      " · Administration configurée : " + yn(d.adminConfigured) +
      " · IA configurée : " + yn(d.aiConfigured) +
      " · Recherche web configurée : " + yn(d.webSearchConfigured);
    if (!state.isAdmin) showPanel("chat", true);
  }

  /* ===========================================================================
     11. CONVERSATIONS
     =========================================================================== */

  function newChatObject() {
    var now = Date.now();
    return { id: uid(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, messages: [] };
  }

  function currentChat() {
    if (state.temp) return state.tempChat;
    for (var i = 0; i < state.chats.length; i++) {
      if (state.chats[i].id === state.activeChatId) return state.chats[i];
    }
    return null;
  }

  function ensureChat() {
    var chat = currentChat();
    if (chat) return chat;
    chat = newChatObject();
    if (state.temp) {
      state.tempChat = chat;
    } else {
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
    }
    return chat;
  }

  function startNewChat() {
    if (state.sending) { toast("Attends la fin de la réponse en cours."); return; }
    showPanel("chat", true);
    state.pendingError = null;
    if (state.temp) {
      if (state.tempChat) endServerConversation(state.tempChat.id);
      state.tempChat = newChatObject();
    } else {
      var chat = currentChat();
      if (!chat || chat.messages.length > 0) {
        chat = newChatObject();
        state.chats.unshift(chat);
        state.activeChatId = chat.id;
        saveChats();
      }
    }
    clearImage();
    renderAll();
    if (els.messageInput) els.messageInput.focus();
  }

  function openChat(id) {
    if (state.sending) { toast("Attends la fin de la réponse en cours."); return; }
    if (state.temp) setTemporary(false, true);
    state.activeChatId = id;
    state.pendingError = null;
    saveChats();
    showPanel("chat", true);
    renderAll();
  }

  function deleteChat(id) {
    if (state.sending) { toast("Attends la fin de la réponse en cours."); return; }
    if (!window.confirm("Supprimer cette conversation de ton historique ?")) return;
    state.chats = state.chats.filter(function (c) { return c.id !== id; });
    endServerConversation(id);
    if (state.activeChatId === id) {
      state.activeChatId = state.chats.length ? state.chats[0].id : null;
    }
    ensureChat();
    saveChats();
    renderAll();
  }

  function clearCurrentChat() {
    if (state.sending) { toast("Attends la fin de la réponse en cours."); return; }
    var chat = currentChat();
    if (!chat || chat.messages.length === 0) { toast("Cette conversation est déjà vide."); return; }
    if (!window.confirm("Effacer tous les messages de cette conversation ?")) return;
    chat.messages = [];
    chat.title = DEFAULT_TITLE;
    chat.updatedAt = Date.now();
    state.pendingError = null;
    endServerConversation(chat.id);
    if (!state.temp) saveChats();
    renderAll();
  }

  function setTemporary(on, silent) {
    on = Boolean(on);
    if (state.temp === on) return;
    if (state.sending && !silent) { toast("Attends la fin de la réponse en cours."); return; }
    if (on) {
      state.temp = true;
      state.tempChat = newChatObject();
    } else {
      if (state.tempChat) endServerConversation(state.tempChat.id);
      state.temp = false;
      state.tempChat = null;
      ensureChat();
    }
    state.pendingError = null;
    document.body.classList.toggle("temp-mode", state.temp);
    if (els.tempBanner) els.tempBanner.classList.toggle("hidden", !state.temp);
    if (els.temporaryChatBtn) {
      els.temporaryChatBtn.setAttribute("aria-pressed", state.temp ? "true" : "false");
      els.temporaryChatBtn.classList.toggle("active", state.temp);
    }
    showPanel("chat", true);
    renderAll();
  }

  function makeTitle(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return DEFAULT_TITLE;
    return t.length > 42 ? t.slice(0, 42).trim() + "…" : t;
  }

  // Historique envoyé au serveur : messages AVANT index `upTo`.
  function historyFor(chat, upTo) {
    var list = chat.messages.slice(0, upTo).slice(-MAX_HISTORY);
    return list.map(function (m) {
      var content = m.image ? ("[Photo analysée] " + m.content).trim() : m.content;
      return { role: m.role, content: content };
    });
  }

  /* ===========================================================================
     12. AFFICHAGE DES MESSAGES (sans innerHTML)
     =========================================================================== */

  function renderAll() {
    renderMessages();
    renderHistory();
    renderTitle();
  }

  function renderTitle() {
    if (!els.currentTitle) return;
    var chat = currentChat();
    els.currentTitle.textContent = state.temp ? "Chat temporaire" : (chat ? chat.title : DEFAULT_TITLE);
  }

  function scrollDown() {
    try {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    } catch (e) { /* ignoré */ }
  }


function renderMessages() {
    var box = els.messages;
    if (!box) return;
    clearNode(box);

    var chat = currentChat();
    var msgs = chat ? chat.messages : [];

    if (chat && msgs.length > 0) {
      var dateHeader = document.createElement("div");
      dateHeader.className = "conversation-date";

      var dateValue = chat.createdAt || (msgs[0] && msgs[0].ts) || Date.now();
      var date = new Date(dateValue);

      dateHeader.textContent = date.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });

      box.appendChild(dateHeader);
    }

    msgs.forEach(function (m, i) {
      box.appendChild(buildRow(m, i, msgs));
    });

    if (state.pendingError) box.appendChild(buildErrorRow());

    if (els.welcome) {
      els.welcome.classList.toggle(
        "hidden",
        msgs.length > 0 || Boolean(state.pendingError)
      );
    }

    scrollDown();
  }


  function buildRow(msg, index, all) {
    var isUser = msg.role === "user";
    var row = el("div", "message-row " + (isUser ? "user" : "ai"));
    row.appendChild(el("div", "avatar", isUser ? userInitial() : "I"));

    var body = el("div", "message-body");
    if (isUser) {
      body.textContent = (msg.image ? "📷 Photo envoyée" + (msg.content ? "\n" : "") : "") + msg.content;
   } else {
  renderRich(body, msg.content);

  if (msg.generatedImage) {
    var generatedImg = document.createElement("img");
    generatedImg.src = msg.generatedImage;
    generatedImg.alt = "Image générée par IZZY AI";
    generatedImg.loading = "lazy";
    generatedImg.style.display = "block";
    generatedImg.style.width = "100%";
    generatedImg.style.maxWidth = "512px";
    generatedImg.style.height = "auto";
    generatedImg.style.borderRadius = "14px";
    generatedImg.style.marginTop = "12px";
    generatedImg.style.border = "1px solid rgba(212,175,55,0.35)";
    body.appendChild(generatedImg);
  }
}

   
var actions = el("div", "message-actions");

    actions.appendChild(button("Copier", "", function () {
      copyText(msg.content);
    }));

    if (isUser) {
      actions.appendChild(button("Modifier", "", function () {
        editMessage(index);
      }));
    } else {
      // Réactions positives et négatives
      actions.appendChild(button("👍", "", function () {
        toast("Merci pour ton avis !");
      }));

      actions.appendChild(button("👎", "", function () {
        toast("Merci, ton avis est pris en compte.");
      }));

      // Partager la réponse
      actions.appendChild(button("Partager", "", async function () {
        var textToShare = msg.content || "";

        if (navigator.share) {
          try {
            await navigator.share({
              title: "Réponse de IZZY AI",
              text: textToShare
            });
          } catch (error) {
            if (error.name !== "AbortError") {
              toast("Impossible de partager cette réponse.");
            }
          }
        } else {
          try {
            await navigator.clipboard.writeText(textToShare);
            toast("Réponse copiée pour le partage.");
          } catch (error) {
            copyText(textToShare);
            toast("Réponse prête à être copiée.");
          }
        }
      }));

      actions.appendChild(button("🔊 Écouter", "", function () {
        if (!speakText(msg.content)) {
          toast("La synthèse vocale n'est pas disponible sur ce navigateur.");
        }
      }));

      var isLast = index === all.length - 1;
      var prev = all[index - 1];

      if (isLast && prev && prev.role === "user" && !prev.image) {
        actions.appendChild(button("↻ Régénérer", "", regenerate));
      }
    }

    body.appendChild(actions);

    row.appendChild(body);
    return row;
  }

  function buildErrorRow() {
    var row = el("div", "message-row ai");
    row.appendChild(el("div", "avatar", "!"));
    var body = el("div", "message-body");
    var p = el("p", "", state.pendingError.message);
    p.style.color = "var(--bad)";
    body.appendChild(p);
    var actions = el("div", "message-actions");
    if (typeof state.pendingError.retry === "function") {
      actions.appendChild(button("↻ Réessayer", "", function () {
        if (state.sending) return;
        state.pendingError.retry();
      }));
    }
    body.appendChild(actions);
    row.appendChild(body);
    return row;
  }

  /* ---- Mini-rendu texte enrichi, 100 % DOM (pas d'injection HTML possible) ---- */

  function renderRich(container, text) {
    var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    var i = 0;
    var isFence = function (l) { return /^\s*```/.test(l); };
    var isHeading = function (l) { return /^\s{0,3}#{1,6}\s+\S/.test(l); };
    var isBullet = function (l) { return /^\s*[-*•]\s+\S/.test(l); };
    var isNumber = function (l) { return /^\s*\d{1,3}[.)]\s+\S/.test(l); };
    var isQuote = function (l) { return /^\s*>\s?/.test(l); };
    var special = function (l) { return isFence(l) || isHeading(l) || isBullet(l) || isNumber(l) || isQuote(l); };

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (isFence(line)) {
        var code = [];
        i++;
        while (i < lines.length && !isFence(lines[i])) { code.push(lines[i]); i++; }
        i++;
        var pre = el("pre");
        var c = el("code");
        c.textContent = code.join("\n");
        pre.appendChild(c);
        container.appendChild(pre);
        continue;
      }

      if (isHeading(line)) {
        var h = el("h3");
        inline(h, line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, ""));
        container.appendChild(h);
        i++;
        continue;
      }

      if (isBullet(line)) {
        var ul = el("ul");
        while (i < lines.length && isBullet(lines[i])) {
          var li = el("li");
          inline(li, lines[i].replace(/^\s*[-*•]\s+/, ""));
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }

      if (isNumber(line)) {
        var ol = el("ol");
        var start = parseInt(line.match(/^\s*(\d{1,3})/)[1], 10);
        if (start > 1) ol.start = start;
        while (i < lines.length && isNumber(lines[i])) {
          var oli = el("li");
          inline(oli, lines[i].replace(/^\s*\d{1,3}[.)]\s+/, ""));
          ol.appendChild(oli);
          i++;
        }
        container.appendChild(ol);
        continue;
      }

      if (isQuote(line)) {
        var qParts = [];
        while (i < lines.length && isQuote(lines[i])) {
          qParts.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        var bq = el("blockquote");
        inlineLines(bq, qParts);
        container.appendChild(bq);
        continue;
      }

      var parts = [];
      while (i < lines.length && lines[i].trim() && !special(lines[i])) {
        parts.push(lines[i]);
        i++;
      }
      var p = el("p");
      inlineLines(p, parts);
      container.appendChild(p);
    }
  }

  function inlineLines(parent, parts) {
    parts.forEach(function (l, k) {
      if (k > 0) parent.appendChild(document.createElement("br"));
      inline(parent, l);
    });
  }

  function inline(parent, text) {
    var re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>"]+)/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] !== undefined) {
        parent.appendChild(el("code", "", m[1]));
      } else if (m[2] !== undefined) {
        parent.appendChild(el("strong", "", m[2]));
      } else {
        var url = m[3];
        var trail = "";
        while (/[.,;:!?)\]]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
        var href = safeHttpUrl(url);
        if (href) {
          var a = el("a", "", url);
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener noreferrer nofollow";
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(url));
        }
        if (trail) parent.appendChild(document.createTextNode(trail));
      }
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  /* ---- Historique (barre latérale) ---- */

  function renderHistory() {
    var list = els.historyList;
    if (!list) return;
    clearNode(list);
    var q = els.historySearch ? els.historySearch.value.trim().toLowerCase() : "";
    var shown = 0;
    state.chats.forEach(function (chat) {
      if (chat.messages.length === 0 && chat.id !== state.activeChatId) return;
      if (q) {
        var hay = (chat.title + " " + chat.messages.map(function (m) { return m.content; }).join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      shown++;
      var item = el("button", "history-item" + (!state.temp && chat.id === state.activeChatId ? " active" : ""));
      item.type = "button";
      item.appendChild(el("span", "", chat.title));
      var del = el("span", "del", "✕");
      del.setAttribute("role", "button");
      del.setAttribute("tabindex", "0");
      del.setAttribute("aria-label", "Supprimer cette conversation");
      del.addEventListener("click", function (ev) { ev.stopPropagation(); deleteChat(chat.id); });
      del.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); deleteChat(chat.id); }
      });
      item.appendChild(del);
      item.addEventListener("click", function () { openChat(chat.id); });
      list.appendChild(item);
    });
    if (!shown) {
      var empty = el("div", "small-note", q ? "Aucun résultat." : "Aucune conversation pour l'instant.");
      empty.style.padding = "6px 9px";
      list.appendChild(empty);
    }
  }

  /* ===========================================================================
     13. ENVOI DES MESSAGES
     =========================================================================== */

  function buildPrefsPayload() {
    return {
      tone: state.prefs.tone,
      energy: state.prefs.energy,
      nickname: state.prefs.nickname,
      memories: state.memories.slice(0, MAX_MEMORIES).map(function (m) { return m.text; }),
      speakReplies: state.prefs.speakReplies
    };
  }

  function setSendingUI(sending) {
    if (els.sendBtn) els.sendBtn.disabled = sending;
    if (els.typing) {
      els.typing.classList.toggle("hidden", !sending);
      if (sending) els.typing.textContent = "IZZY AI réfléchit…";
    }
    if (sending) scrollDown();
  }
function isImageGenerationRequest(text) {
  return /\b(génère|générer|génération|crée|créer|dessine|dessiner|fabrique|imagine|generate|create|draw|make me an image|make an image|picture of|image de|photo de)\b/i.test(
    String(text || "")
  );
}

async function requestGeneratedImage(prompt, signal) {
  var res = await apiFetch("/generate-image", {
    method: "POST",
    body: { prompt: prompt },
    timeoutMs: 180000,
    signal: signal
  });

  if (!res.ok) {
    throw httpErrorFrom(res, "/generate-image");
  }

  var imageData = res.data && res.data.imageData;

  if (
    typeof imageData !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageData)
  ) {
    throw apiError(
      "Http",
      "Le serveur n'a pas renvoyé une image valide. Réessaie.",
      res.status
    );
  }

  return imageData;
}
  async function submitMessage(textOverride) {
    if (state.sending) return;
    if (!state.user) { showAuthScreen(); return; }

    var input = els.messageInput;
    var text = (textOverride !== undefined && textOverride !== null ? String(textOverride) : (input ? input.value : "")).trim();
    var image = state.image;
    if (!text && !image) return;
    if (text.length > MAX_MESSAGE) {
      toast("Ton message est trop long (" + MAX_MESSAGE + " caractères maximum).");
      return;
    }

    showPanel("chat", true);
    cancelSpeech();
    stopListening();

    var chat = ensureChat();
    var history = historyFor(chat, chat.messages.length);
    var userMsg = { id: uid(), role: "user", content: text, ts: Date.now(), image: Boolean(image) };
    chat.messages.push(userMsg);
    if (chat.messages.length > MAX_MESSAGES_PER_CHAT) chat.messages.splice(0, chat.messages.length - MAX_MESSAGES_PER_CHAT);
    if (!chat.title || chat.title === DEFAULT_TITLE) chat.title = makeTitle(text || "Photo");
    chat.updatedAt = Date.now();
    if (!state.temp) saveChats();

    if (input && textOverride === undefined) { input.value = ""; autoResize(); }
    clearImage();
    state.pendingError = null;
    renderAll();

    await deliver(chat, userMsg, history, image);
  }

  async function deliver(chat, userMsg, history, image) {
    var ownerId = state.user ? state.user.id : null;
    state.sending = true;
    setSendingUI(true);

    var controller = new AbortController();
    state.abort = controller;
    var slowTimer = setTimeout(function () {
      if (els.typing) els.typing.textContent = "Toujours en cours… le serveur peut mettre un moment à se réveiller.";
    }, 12000);

    try {
     var wantsGeneratedImage =
  !image && isImageGenerationRequest(userMsg.content);

var generatedImage = null;
var reply;

if (image) {
  reply = await requestVision(
    chat, userMsg, history, image, controller.signal
  );
} else if (wantsGeneratedImage) {
  generatedImage = await requestGeneratedImage(
    userMsg.content, controller.signal
  );
  reply = "Voilà l’image que j’ai générée pour toi.";
} else {
  reply = await requestChat(
    chat, userMsg, history, controller.signal
  );
}

      if (!state.user || state.user.id !== ownerId) return; // déconnexion/changement de compte entre-temps

     chat.messages.push({
  id: uid(),
  role: "assistant",
  content: reply,
  ts: Date.now(),
  image: false,
  generatedImage: generatedImage
});
      chat.updatedAt = Date.now();
      state.pendingError = null;
      if (!state.temp) saveChats();
      renderAll();
      if (state.prefs.speakReplies) speakText(reply);
    } catch (err) {
      if (!state.user || state.user.id !== ownerId) return;
      if (err && err.kind === "UserAbort") {
        state.pendingError = null;
        toast("Réponse interrompue.");
      } else if (err && err.kind === "Auth") {
        await handleSessionExpired();
        return;
      } else {
        console.warn("[IZZY] Échec de la réponse :", err && err.kind, err && err.status, err && err.message);
        state.pendingError = {
          message: userFacingMessage(err),
          retry: function () {
            state.pendingError = null;
            renderAll();
            deliver(chat, userMsg, history, image);
          }
        };
        if (err && err.kind === "Network") setStatus("● Serveur indisponible", "bad");
      }
      renderAll();
    } finally {
      clearTimeout(slowTimer);
      state.sending = false;
      state.abort = null;
      setSendingUI(false);
    }
  }

  async function requestChat(chat, userMsg, history, signal) {
    var body = {
      message: userMsg.content,
      conversationId: chat.id,
      preferences: buildPrefsPayload(),
      webSearch: state.webSearch === true,
      temporary: state.temp === true,
      history: history
    };
    var res = await apiFetch("/chat", { method: "POST", body: body, timeoutMs: 120000, signal: signal });
    if (!res.ok) throw httpErrorFrom(res, "/chat");
    var reply = res.data && typeof res.data.reply === "string" ? res.data.reply.trim() : "";
    if (!reply) throw apiError("Http", "Le serveur a répondu sans texte exploitable. Réessaie.", res.status);
    setStatus("● En ligne", "good");
    return reply;
  }

  async function requestVision(chat, userMsg, history, imageData, signal) {
    var body = {
      message: userMsg.content,
      conversationId: chat.id,
      imageData: imageData,
      preferences: buildPrefsPayload(),
      temporary: state.temp === true,
      history: history
    };
    var res = await apiFetch("/vision", { method: "POST", body: body, timeoutMs: 120000, signal: signal });
    if (!res.ok) throw httpErrorFrom(res, "/vision");
    var reply = res.data && typeof res.data.reply === "string" ? res.data.reply.trim() : "";
    if (!reply) throw apiError("Http", "Le serveur n'a pas renvoyé d'analyse exploitable. Réessaie.", res.status);
    setStatus("● En ligne", "good");
    return reply;
  }

  function editMessage(index) {
    if (state.sending) { toast("Attends la fin de la réponse en cours."); return; }
    var chat = currentChat();
    if (!chat) return;
    var msg = chat.messages[index];
    if (!msg || msg.role !== "user") return;
    chat.messages.splice(index); // retire ce message et tout ce qui suit
    chat.updatedAt = Date.now();
    if (chat.messages.length === 0) chat.title = DEFAULT_TITLE;
    if (!state.temp) saveChats();
    state.pendingError = null;
    if (els.messageInput) { els.messageInput.value = msg.content; autoResize(); }
    renderAll();
    if (msg.image) toast("Modifie ton texte puis ajoute de nouveau la photo si besoin.");
    if (els.messageInput) els.messageInput.focus();
  }

  function regenerate() {
    if (state.sending) return;
    var chat = currentChat();
    if (!chat) return;
    var n = chat.messages.length;
    var last = chat.messages[n - 1];
    var userMsg = chat.messages[n - 2];
    if (!last || last.role !== "assistant" || !userMsg || userMsg.role !== "user" || userMsg.image) return;
    chat.messages.pop();
    var history = historyFor(chat, n - 2);
    chat.updatedAt = Date.now();
    if (!state.temp) saveChats();
    state.pendingError = null;
    renderAll();
    deliver(chat, userMsg, history, null);
  }

  function autoResize() {
    var ta = els.messageInput;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  /* ===========================================================================
     14. IMAGES (appareil photo / galerie → /vision)
     =========================================================================== */

  function clearImage() {
    state.image = null;
    if (els.attachPreview) els.attachPreview.classList.remove("visible");
    if (els.attachImage) els.attachImage.removeAttribute("src");
  }

  function setImage(dataUrl) {
    state.image = dataUrl;
    if (els.attachImage) els.attachImage.src = dataUrl;
    if (els.attachPreview) els.attachPreview.classList.add("visible");
  }

  function handleImageFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || "")) {
      toast("Ce fichier n'est pas une image.");
      return;
    }
    var objectUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      try {
        var maxSide = 1600;
        var quality = 0.85;
        var result = null;
        for (var attempt = 0; attempt < 4; attempt++) {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; // fond blanc pour les PNG transparents
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          result = canvas.toDataURL("image/jpeg", quality);
          if (result.length <= MAX_IMAGE_CHARS) break;
          maxSide = Math.round(maxSide * 0.75);
          quality = Math.max(0.6, quality - 0.1);
        }
        if (!result || result.length > MAX_IMAGE_CHARS) {
          toast("Cette image est trop volumineuse. Choisis-en une plus petite.");
        } else {
          setImage(result);
        }
      } catch (e) {
        console.warn("[IZZY] Traitement de l'image :", e && e.message);
        toast("Impossible de traiter cette image.");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      toast("Impossible de lire cette image. Choisis une photo JPEG, PNG ou WebP.");
    };
    img.src = objectUrl;
  }

  /* ===========================================================================
     15. VOIX : MICROPHONE ET SYNTHÈSE VOCALE
     =========================================================================== */

  function speechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function setListeningUI(listening) {
    state.listening = listening;
    if (!els.micBtn) return;
    els.micBtn.classList.toggle("active", listening);
    els.micBtn.setAttribute("aria-pressed", listening ? "true" : "false");
    els.micBtn.textContent = listening ? "🎤 J'écoute…" : state.micLabel;
  }

  function startListening() {
    var SR = speechRecognitionCtor();
    if (!SR) {
      toast("La reconnaissance vocale n'est pas disponible sur ce navigateur. Essaie Chrome, Edge ou Safari récent, ou utilise le clavier.");
      return;
    }
    cancelSpeech();
    var rec;
    try {
      rec = new SR();
    } catch (e) {
      toast("Impossible de démarrer la reconnaissance vocale.");
      return;
    }
    var base = els.messageInput ? els.messageInput.value : "";
    if (base && !/\s$/.test(base)) base += " ";

    rec.lang = navigator.language || "fr-FR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = function (ev) {
      var transcript = "";
      for (var i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript;
      }
      if (els.messageInput) {
        els.messageInput.value = (base + transcript).slice(0, MAX_MESSAGE);
        autoResize();
      }
    };
    rec.onerror = function (ev) {
      var code = ev && ev.error;
      if (code === "aborted") return;
      var msg = "La reconnaissance vocale a échoué.";
      if (code === "not-allowed" || code === "service-not-allowed") msg = "Accès au micro refusé. Autorise le micro pour ce site dans les réglages du navigateur.";
      else if (code === "no-speech") msg = "Je n'ai rien entendu. Réessaie en parlant un peu plus près du micro.";
      else if (code === "audio-capture") msg = "Aucun micro détecté sur cet appareil.";
      else if (code === "network") msg = "La reconnaissance vocale a besoin d'une connexion Internet.";
      else if (code === "language-not-supported") msg = "Cette langue n'est pas prise en charge par la reconnaissance vocale.";
      toast(msg, 5000);
    };
    rec.onend = function () {
      state.recognition = null;
      setListeningUI(false);
    };

    try {
      state.recognition = rec;
      rec.start();
      setListeningUI(true);
    } catch (e) {
      state.recognition = null;
      setListeningUI(false);
      toast("Impossible de démarrer le micro. Réessaie.");
    }
  }

  function stopListening() {
    if (state.recognition) {
      try { state.recognition.stop(); } catch (e) { /* ignoré */ }
    }
    if (state.listening) setListeningUI(false);
  }

  function toggleMic() {
    if (state.listening) stopListening();
    else startListening();
  }

  function speechSupported() {
    return "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined";
  }

  function cancelSpeech() {
    if (speechSupported()) {
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignoré */ }
    }
  }

  function guessLang(t) {
    var en = (t.match(/\b(the|and|you|is|are|with|that|this|for|have|what|your)\b/gi) || []).length;
    var fr = (t.match(/\b(le|la|les|des|est|une|que|pour|avec|vous|tu|je|et|dans|pas|sur)\b/gi) || []).length;
    return en > fr ? "en-US" : "fr-FR";
  }

  function chunkText(t, max) {
    var sentences = t.match(/[^.!?\n]+[.!?]*\s*/g) || [t];
    var chunks = [];
    var cur = "";
    sentences.forEach(function (s) {
      if ((cur + s).length > max && cur) { chunks.push(cur); cur = ""; }
      while (s.length > max) { chunks.push(s.slice(0, max)); s = s.slice(max); }
      cur += s;
    });
    if (cur.trim()) chunks.push(cur);
    return chunks;
  }

  // Retourne false si la lecture n'a pas pu démarrer.
  function speakText(raw) {
    if (!speechSupported()) return false;
    var t = String(raw || "").split(/\n\s*\n?\s*Sources consult[ée]es\s*:/i)[0];
    t = t.replace(/https?:\/\/\S+/g, "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
    if (!t) return false;
    try {
      window.speechSynthesis.cancel();
      var lang = guessLang(t);
      chunkText(t, 180).forEach(function (chunk) {
        var u = new window.SpeechSynthesisUtterance(chunk);
        u.lang = lang;
        window.speechSynthesis.speak(u);
      });
      return true;
    } catch (e) {
      console.warn("[IZZY] Synthèse vocale :", e && e.message);
      return false;
    }
  }

  function updateVoiceButton() {
    if (!els.voiceBtn) return;
    var on = state.prefs.speakReplies;
    els.voiceBtn.textContent = on ? "🔊 Voix activée" : "🔇 Voix coupée";
    els.voiceBtn.classList.toggle("active", on);
    els.voiceBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (els.speakReplies) els.speakReplies.checked = on;
  }

  function setSpeakReplies(on) {
    state.prefs.speakReplies = Boolean(on);
    savePrefs();
    updateVoiceButton();
    if (!on) cancelSpeech();
    else if (!speechSupported()) toast("La synthèse vocale n'est pas disponible sur ce navigateur : les réponses resteront écrites.", 5000);
  }

  function stopAll() {
    cancelSpeech();
    stopListening();
    if (state.abort) {
      try { state.abort.abort(); } catch (e) { /* ignoré */ }
    }
  }

  /* ===========================================================================
     16. PARAMÈTRES, SOUVENIRS, PROJETS, TÂCHES
     =========================================================================== */

  function renderSettings() {
    if (els.tone) els.tone.value = state.prefs.tone;
    if (els.energy) els.energy.value = String(state.prefs.energy);
    if (els.energyValue) els.energyValue.textContent = state.prefs.energy + " %";
    if (els.nickname) els.nickname.value = state.prefs.nickname;
    updateVoiceButton();
  }

  function saveSettingsFromForm() {
    if (!state.user) return;
    var next = normalizePrefs({
      tone: els.tone ? els.tone.value : state.prefs.tone,
      energy: els.energy ? Number(els.energy.value) : state.prefs.energy,
      nickname: els.nickname ? els.nickname.value : state.prefs.nickname,
      speakReplies: els.speakReplies ? els.speakReplies.checked : state.prefs.speakReplies
    });
    state.prefs = next;
    savePrefs();
    renderSettings();
    updateProfile();
    toast("Réglages enregistrés. Ils sont envoyés avec chaque message.");
  }

  function renderMemories() {
    var list = els.memoryList;
    if (!list) return;
    clearNode(list);
    if (!state.memories.length) {
      list.appendChild(el("div", "small-note", "Aucun souvenir pour l'instant."));
      return;
    }
    state.memories.forEach(function (m) {
      var item = el("div", "list-item");
      item.appendChild(el("span", "", m.text));
      item.appendChild(button("✕", "danger", function () {
        state.memories = state.memories.filter(function (x) { return x.id !== m.id; });
        saveMemories();
        renderMemories();
      }));
      list.appendChild(item);
    });
  }

  function addMemory() {
    if (!state.user || !els.memoryInput) return;
    var text = els.memoryInput.value.trim().slice(0, 180);
    if (!text) return;
    if (state.memories.length >= MAX_MEMORIES) {
      toast("Maximum " + MAX_MEMORIES + " souvenirs : supprime-en un avant d'en ajouter.");
      return;
    }
    if (state.memories.some(function (m) { return m.text.toLowerCase() === text.toLowerCase(); })) {
      toast("Ce souvenir existe déjà.");
      return;
    }
    state.memories.unshift({ id: uid(), text: text, createdAt: Date.now() });
    saveMemories();
    els.memoryInput.value = "";
    renderMemories();
  }

  function exportMemories() {
    if (!state.memories.length) { toast("Aucun souvenir à exporter."); return; }
    try {
      var payload = {
        exportedAt: new Date().toISOString(),
        memories: state.memories.map(function (m) { return m.text; })
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "izzy-memoire.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      toast("Export impossible sur ce navigateur.");
    }
  }

  function deleteAllMemories() {
    if (!state.memories.length) { toast("Il n'y a aucun souvenir à effacer."); return; }
    if (!window.confirm("Effacer tous tes souvenirs de ce navigateur ? Cette action est définitive.")) return;
    state.memories = [];
    saveMemories();
    renderMemories();
    toast("Souvenirs effacés.");
  }

  function renderProjects() {
    var list = els.projectsList;
    if (!list) return;
    clearNode(list);
    if (!state.projects.length) {
      list.appendChild(el("div", "small-note", "Aucun projet pour l'instant."));
      return;
    }
    state.projects.forEach(function (p) {
      var item = el("div", "list-item");
      item.appendChild(el("span", "", p.text));
      item.appendChild(button("✕", "danger", function () {
        state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
        saveProjects();
        renderProjects();
      }));
      list.appendChild(item);
    });
  }

  function addProject() {
    if (!state.user || !els.projectInput) return;
    var text = els.projectInput.value.trim().slice(0, 100);
    if (!text) return;
    state.projects.unshift({ id: uid(), text: text, createdAt: Date.now() });
    saveProjects();
    els.projectInput.value = "";
    renderProjects();
  }

  function renderTasks() {
    var list = els.tasksList;
    if (!list) return;
    clearNode(list);
    if (!state.tasks.length) {
      list.appendChild(el("div", "small-note", "Aucune tâche pour l'instant."));
      return;
    }
    state.tasks.forEach(function (t) {
      var item = el("div", "list-item");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(t.done);
      box.setAttribute("aria-label", "Terminée : " + t.text);
      box.addEventListener("change", function () {
        t.done = box.checked;
        saveTasks();
        renderTasks();
      });
      var label = el("span", "", t.text);
      if (t.done) label.style.textDecoration = "line-through";
      if (t.done) label.style.opacity = "0.6";
      item.appendChild(box);
      item.appendChild(label);
      item.appendChild(button("✕", "danger", function () {
        state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
        saveTasks();
        renderTasks();
      }));
      list.appendChild(item);
    });
  }

  function addTask() {
    if (!state.user || !els.taskInput) return;
    var text = els.taskInput.value.trim().slice(0, 160);
    if (!text) return;
    state.tasks.unshift({ id: uid(), text: text, done: false, createdAt: Date.now() });
    saveTasks();
    els.taskInput.value = "";
    renderTasks();
  }

  /* ===========================================================================
     17. BRANCHEMENT DES ÉVÉNEMENTS (une seule fois)
     =========================================================================== */

  function cacheElements() {
    var ids = [
      "authScreen", "authForm", "authSubtitle", "authEmail", "authPassword", "authPasswordLabel",
      "authSubmit", "authToggle", "forgotBtn", "authError",
      "app", "sidebar", "overlay", "menuBtn",
      "newChatBtn", "topNewChat", "temporaryChatBtn", "searchChatsBtn", "historySearchWrap", "historySearch",
      "historyList", "adminBtn", "adminTag", "profileName", "profileEmail", "signOutBtn",
      "currentTitle", "clearChatBtn", "status",
      "chatPanel", "tempBanner", "tempExitBtn", "welcome", "messages", "typing",
      "attachPreview", "attachImage", "removeImageBtn", "messageInput", "sendBtn",
      "cameraBtn", "galleryBtn", "micBtn", "webBtn", "voiceBtn", "stopBtn", "cameraInput", "galleryInput",
      "projectInput", "addProjectBtn", "projectsList", "taskInput", "addTaskBtn", "tasksList",
      "tone", "energy", "energyValue", "nickname", "speakReplies", "savePersonality",
      "memoryInput", "addMemory", "memoryList", "exportMemory", "deleteMemory",
      "adminAccount", "adminHealth", "refreshAdmin", "toast"
    ];
    var missing = [];
    ids.forEach(function (id) {
      els[id] = $(id);
      if (!els[id]) missing.push(id);
    });
    if (missing.length) {
      console.warn("[IZZY] Éléments HTML introuvables (fonctions concernées désactivées) :", missing.join(", "));
    }
    state.micLabel = els.micBtn ? els.micBtn.textContent : "🎤 Voix";
  }

  function bindAuth() {
    if (els.authForm) els.authForm.noValidate = true; // messages d'erreur gérés par ce script
    on(els.authForm, "submit", handleAuthSubmit);
    on(els.authToggle, "click", handleAuthToggle);
    on(els.forgotBtn, "click", handleForgot);
  }

  function bindShell() {
    on(els.menuBtn, "click", function () { openSidebar(!els.sidebar.classList.contains("open")); });
    on(els.overlay, "click", function () { openSidebar(false); });

    var navButtons = document.querySelectorAll(".nav-btn[data-panel]");
    Array.prototype.forEach.call(navButtons, function (b) {
      b.addEventListener("click", function () { showPanel(b.getAttribute("data-panel")); });
    });

    on(els.signOutBtn, "click", function () { signOut(); });
    on(els.refreshAdmin, "click", function () { refreshAdminPanel(); });
  }

  function bindChat() {
    on(els.newChatBtn, "click", startNewChat);
    on(els.topNewChat, "click", startNewChat);
    on(els.clearChatBtn, "click", clearCurrentChat);

    on(els.temporaryChatBtn, "click", function () { setTemporary(!state.temp); });
    on(els.tempExitBtn, "click", function () { setTemporary(false); });

    on(els.searchChatsBtn, "click", function () {
      if (!els.historySearchWrap) return;
      var hidden = els.historySearchWrap.classList.toggle("hidden");
      if (!hidden && els.historySearch) els.historySearch.focus();
      if (hidden && els.historySearch) { els.historySearch.value = ""; renderHistory(); }
    });
    on(els.historySearch, "input", renderHistory);

    on(els.sendBtn, "click", function () { submitMessage(); });
    on(els.messageInput, "input", autoResize);
    on(els.messageInput, "keydown", function (ev) {
      if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return;
      var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (touch) return; // sur mobile, Entrée = retour à la ligne
      ev.preventDefault();
      submitMessage();
    });

    var suggestions = document.querySelectorAll(".suggestion[data-prompt]");
    Array.prototype.forEach.call(suggestions, function (b) {
      b.addEventListener("click", function () { submitMessage(b.getAttribute("data-prompt")); });
    });

    on(els.webBtn, "click", function () {
      state.webSearch = !state.webSearch;
      els.webBtn.classList.toggle("active", state.webSearch);
      els.webBtn.setAttribute("aria-pressed", state.webSearch ? "true" : "false");
      toast(state.webSearch ? "Recherche web activée pour tes prochains messages." : "Recherche web désactivée.");
    });

    on(els.cameraBtn, "click", function () { if (els.cameraInput) els.cameraInput.click(); });
    on(els.galleryBtn, "click", function () { if (els.galleryInput) els.galleryInput.click(); });
    [els.cameraInput, els.galleryInput].forEach(function (inp) {
      if (!inp) return;
      inp.addEventListener("change", function () {
        var file = inp.files && inp.files[0];
        inp.value = ""; // permet de rechoisir le même fichier
        handleImageFile(file);
      });
    });
    on(els.removeImageBtn, "click", clearImage);

    on(els.micBtn, "click", toggleMic);
    on(els.voiceBtn, "click", function () { setSpeakReplies(!state.prefs.speakReplies); });
    on(els.stopBtn, "click", stopAll);
  }

  function bindPanels() {
    on(els.energy, "input", function () {
      if (els.energyValue) els.energyValue.textContent = els.energy.value + " %";
    });
    on(els.savePersonality, "click", saveSettingsFromForm);
    on(els.speakReplies, "change", function () { setSpeakReplies(els.speakReplies.checked); });

    on(els.addMemory, "click", addMemory);
    on(els.memoryInput, "keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addMemory(); } });
    on(els.exportMemory, "click", exportMemories);
    on(els.deleteMemory, "click", deleteAllMemories);

    on(els.addProjectBtn, "click", addProject);
    on(els.projectInput, "keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addProject(); } });
    on(els.addTaskBtn, "click", addTask);
    on(els.taskInput, "keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addTask(); } });

    // Précision de portée des souvenirs (ajoutée sans modifier index.html)
    var panel = $("memoriesPanel");
    if (panel && !$("memoryScopeNote")) {
      var card = panel.querySelector(".panel-card");
      var note = el("p", "small-note",
        "Portée : ces souvenirs sont enregistrés uniquement dans ce navigateur (pas dans un cloud) et séparés par compte. " +
        "Pour personnaliser les réponses, ils sont envoyés au serveur IZZY AI avec tes messages.");
      note.id = "memoryScopeNote";
      if (card) card.appendChild(note);
    }
  }

  function bindGlobal() {
    // Fin propre d'un chat temporaire si l'onglet est fermé.
    window.addEventListener("pagehide", function () {
      if (state.temp && state.tempChat) endServerConversation(state.tempChat.id);
      cancelSpeech();
    });
    window.addEventListener("unhandledrejection", function (ev) {
      console.error("[IZZY] Promesse rejetée non gérée :", ev && ev.reason);
    });
  }

  /* ===========================================================================
     18. DÉMARRAGE
     =========================================================================== */

  function start() {
    cacheElements();

    // L'authentification est branchée EN PREMIER : les boutons réagissent
    // toujours, même si une autre partie échoue.
    safe("authentification (boutons)", bindAuth);
    safe("menu et navigation", bindShell);
    safe("conversation", bindChat);
    safe("panneaux", bindPanels);
    safe("événements globaux", bindGlobal);
    safe("mode de connexion", function () { setAuthMode("signin"); });

    var ok = initSupabase();
    if (!ok) {
      showAuthError(state.initError);
      setStatus("● Hors service", "bad");
      return;
    }

    // Lien de réinitialisation détecté dans l'URL ?
    var hash = window.location.hash || "";
    if (/type=recovery/.test(hash)) state.recoveryPending = true;
    safe("erreurs d'URL", readAuthUrlProblems);

    safe("abonnement session", subscribeAuth);

    showAuthInfo("Vérification de ta session…");
    state.supabase.auth.getSession().then(function (res) {
      // Filet de sécurité si INITIAL_SESSION n'a pas déjà tout réglé.
      var session = res && res.data ? res.data.session : null;
      if (session && session.user && !state.recoveryPending && !state.appVisible) {
        state.token = session.access_token;
        enterApp(session.user);
      } else if (!session && !state.appVisible && !state.recoveryPending) {
        showAuthScreen();
        setStatus("● Déconnecté", "");
      }
      if (!state.appVisible && els.authError && /Vérification de ta session/.test(els.authError.textContent)) {
        showAuthMessage("");
      }
    }).catch(function (e) {
      console.warn("[IZZY] Lecture de session :", e && e.message);
      showAuthError("Impossible de vérifier ta session pour l'instant. Tu peux te connecter manuellement.");
    });
  }

  function boot() {
    try {
      start();
    } catch (e) {
      console.error("[IZZY] Erreur d'initialisation :", e);
      var box = document.getElementById("authError");
      if (box) {
        box.textContent = "Erreur d'initialisation de l'application : " + (e && e.message ? e.message : "inconnue") + ". Recharge la page.";
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
