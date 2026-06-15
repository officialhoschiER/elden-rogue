/* ============================================================
   Elden Rogue – Fortschritt, Achievements & Bestenliste
   ------------------------------------------------------------
   Firebase ist konfiguriert – Login (Google + E-Mail), Online-
   Bestenliste (getrennt nach Normal/Hard) und Cloud-Speicher
   sind aktiv. Lokaler Fallback greift automatisch, falls
   Firebase nicht erreichbar ist.
   ============================================================ */
(function () {
  "use strict";

  /* ====== 1) FIREBASE-KONFIG ====== */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBwgP06wTi9uygJxiJA_w5aP-M5JyMule8",
    authDomain: "elden-rogue.firebaseapp.com",
    projectId: "elden-rogue",
    storageBucket: "elden-rogue.firebasestorage.app",
    messagingSenderId: "156704144299",
    appId: "1:156704144299:web:49ae7f6d3a6afd14b9f0ee",
    measurementId: "G-XLB96HHTPF"
  };

  const ONLINE = !!FIREBASE_CONFIG.apiKey && typeof firebase !== "undefined";
  let fbAuth = null, fbDB = null, currentUser = null;
  const userListeners = [];

  if (ONLINE) {
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      fbAuth = firebase.auth();
      fbDB = firebase.firestore();
      fbAuth.onAuthStateChanged(function (u) {
        currentUser = u;
        if (u) cloudSyncOnLogin();
        userListeners.forEach(function (cb) { try { cb(u); } catch (e) {} });
      });
    } catch (e) { console.warn("[ER] Firebase-Init fehlgeschlagen:", e); }
  }

  /* ====== 2) SPEICHER-HELFER ====== */
  // Aktuelle Spielversion. Runs, die ab jetzt abgeschlossen werden, werden
  // in der Bestenliste mit diesem Patch markiert. Bei neuem Patch hier hochzählen.
  const GAME_PATCH = "1.4";

  const STATS_KEY = "eldenRogueStats";
  const RUN_KEY   = "eldenRogueRun";
  const ACH_KEY   = "eldenRogueAchievements";
  const BOARD_KEY = "eldenRogueLocalBoard";
  const NAME_KEY  = "eldenRogueName";

  function lsGet(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  const DEFAULT_STATS = {
    fightsWon: 0, bossesKilled: 0, elitesKilled: 0, minibossesKilled: 0, invadersKilled: 0,
    runsStarted: 0, deaths: 0, dungeonsCleared: 0, talismansFound: 0, weaponsFound: 0,
    armorsFound: 0, blaiddDefeats: 0, gamesCompleted: 0, furthestStage: 0,
    bestRunBosses: 0, bestScore: 0, flasksDrunk: 0, bossKills: {},
    // --- NEU: Hard-Mode & Challenges ---
    hardCompleted: 0, challenges: {},
    // --- NEU: getrennte Hard-Mode-Bestenliste ---
    bestScoreHard: 0, bestRunBossesHard: 0, furthestStageHard: 0,
    // --- NEU: Patch-Version, auf der die jeweilige Bestleistung erzielt wurde ---
    bestScorePatch: "", bestScoreHardPatch: ""
  };

  function getStats() {
    var s = Object.assign({}, DEFAULT_STATS, lsGet(STATS_KEY, {}));
    s.bossKills = s.bossKills || {};
    s.challenges = s.challenges || {};
    return s;
  }
  function saveStats(s) { lsSet(STATS_KEY, s); }
  function getRun() { return lsGet(RUN_KEY, { stage: 0, bosses: 0, fights: 0, mode: "normal" }); }
  function saveRun(r) { lsSet(RUN_KEY, r); }
  function getUnlocked() { return lsGet(ACH_KEY, []); }
  function saveUnlocked(a) { lsSet(ACH_KEY, a); }

  // Aktueller Run-Modus (überlebt endRun, damit hardCompleted() nach
  // gameCompleted() noch den richtigen Modus kennt)
  let runMode = (getRun().mode === "hard") ? "hard" : "normal";

  /* ====== 3) ACHIEVEMENTS ====== */
  // Liste der Halbgötter für das "Götterdämmerung"-Achievement
  const DEMIGODS = [
    "Godrick, der Verpflanzte",
    "Sternengeißel Radahn",
    "Morgott, der Omenkönig",
    "Feuerriese",
    "Maliketh, die Schwarze Klinge"
  ];
  function maleniaBesiegt(s) {
    return (s.bossKills["Malenia, Goddess of Rot"] || 0) >= 1
        || (s.bossKills["Malenia, Blade of Miquella"] || 0) >= 1;
  }
  function alleHalbgoetterBesiegt(s) {
    var bk = s.bossKills || {};
    for (var i = 0; i < DEMIGODS.length; i++) { if ((bk[DEMIGODS[i]] || 0) < 1) return false; }
    return maleniaBesiegt(s);
  }

  const ACHIEVEMENTS = [
    { id: "first_win",  name: "Erster Sieg",            icon: "⚔️", desc: "Gewinne deinen ersten Kampf.",            check: s => s.fightsWon >= 1 },
    { id: "win_100",    name: "Kriegsveteran",          icon: "🗡️", desc: "Gewinne 100 Kämpfe.",                    check: s => s.fightsWon >= 100 },
    { id: "win_500",    name: "Schlachtenmeister",      icon: "🏹", desc: "Gewinne 500 Kämpfe.",                    check: s => s.fightsWon >= 500 },
    { id: "win_1000",   name: "Tausendsassa",           icon: "👑", desc: "Gewinne 1000 Kämpfe.",                   check: s => s.fightsWon >= 1000 },
    { id: "win_2500",   name: "Kriegsgott",             icon: "⚡", desc: "Gewinne 2500 Kämpfe.",                   check: s => s.fightsWon >= 2500 },
    { id: "boss_1",     name: "Halbgott-Jäger",         icon: "💀", desc: "Besiege deinen ersten Boss.",            check: s => s.bossesKilled >= 1 },
    { id: "boss_10",    name: "Halbgott-Schlächter",    icon: "☠️", desc: "Besiege 10 Bosse.",                      check: s => s.bossesKilled >= 10 },
    { id: "boss_50",    name: "Gott unter Göttern",     icon: "🌟", desc: "Besiege 50 Bosse.",                      check: s => s.bossesKilled >= 50 },
    { id: "godrick",    name: "Sturmschleier gemeistert", icon: "🦴", desc: "Besiege Godrick.",                     check: s => (s.bossKills["Godrick, der Verpflanzte"] || 0) >= 1 },
    { id: "radahn",     name: "Die Sterne fallen",      icon: "🌌", desc: "Besiege Radahn.",                        check: s => (s.bossKills["Sternengeißel Radahn"] || 0) >= 1 },
    { id: "morgott",    name: "Omenkönig gefallen",     icon: "👑", desc: "Besiege Morgott.",                       check: s => (s.bossKills["Morgott, der Omenkönig"] || 0) >= 1 },
    { id: "firegiant",  name: "Schmiede erloschen",     icon: "🔥", desc: "Besiege den Feuerriesen.",               check: s => (s.bossKills["Feuerriese"] || 0) >= 1 },
    { id: "maliketh",   name: "Schwarze Klinge",        icon: "🐕", desc: "Besiege Maliketh.",                      check: s => (s.bossKills["Maliketh, die Schwarze Klinge"] || 0) >= 1 },
    { id: "loretta",    name: "Ritterin gefallen",      icon: "🌹", desc: "Besiege Loretta.",                       check: s => (s.bossKills["Loretta, Knight of the Haligtree"] || 0) >= 1 },
    { id: "niall",      name: "Kommandant besiegt",     icon: "⚔️", desc: "Besiege Commander Niall.",               check: s => (s.bossKills["Commander Niall"] || 0) >= 1 },
    { id: "malenia",    name: "Scarlet Bloom",          icon: "🌸", desc: "Besiege Malenia.",                       check: s => maleniaBesiegt(s) },
    { id: "all_bosses", name: "Götterdämmerung",        icon: "🌗", desc: "Besiege jeden Halbgott mindestens einmal.", check: s => alleHalbgoetterBesiegt(s) },
    { id: "elden_lord", name: "Elden Lord",             icon: "👑", desc: "Schließe einen Run ab und werde Elden Lord.", check: s => s.gamesCompleted >= 1 },
    { id: "complete_10", name: "Veteran",               icon: "🎖️", desc: "Schließe 10 Runs ab.",                  check: s => s.gamesCompleted >= 10 },
    { id: "complete_25", name: "Legende",               icon: "🏆", desc: "Schließe 25 Runs ab.",                  check: s => s.gamesCompleted >= 25 },
    { id: "hard_lord",  name: "Wahrer Elden Lord",      icon: "🔴", desc: "Schließe einen Hard-Mode-Run ab.",        check: s => s.hardCompleted >= 1 },
    { id: "hard_5",     name: "Masochist",              icon: "🔁", desc: "Schließe Hard-Mode 5x ab.",              check: s => s.hardCompleted >= 5 },
    { id: "challenge_noarmor",   name: "Nacktläufer",   icon: "🩲", desc: "Schließe einen No-Armor-Run ab.",        check: s => (s.challenges.noarmor || 0) >= 1 },
    { id: "challenge_noblaidd",  name: "Einsamer Wolf", icon: "🐺", desc: "Schließe einen No-Blaidd-Run ab.",       check: s => (s.challenges.noblaidd || 0) >= 1 },
    { id: "challenge_auto",      name: "Zuschauer",     icon: "🍿", desc: "Schließe einen Auto-Battle-Run ab.",      check: s => (s.challenges.autobattle || 0) >= 1 },
    { id: "first_death",name: "Du bist gestorben",      icon: "💀", desc: "Stirb zum ersten Mal.",                  check: s => s.deaths >= 1 },
    { id: "death_50",   name: "Hartnäckig",             icon: "⚰️", desc: "Stirb 50 Mal und gib nicht auf.",        check: s => s.deaths >= 50 },
    { id: "death_100",  name: "Unsterblich",            icon: "👻", desc: "Stirb 100 Mal.",                         check: s => s.deaths >= 100 },
    { id: "dungeon_1",  name: "Gruft-Plünderer",        icon: "🏰", desc: "Schließe einen Dungeon ab.",             check: s => s.dungeonsCleared >= 1 },
    { id: "dungeon_10", name: "Katakomben-Kenner",      icon: "🗝️", desc: "Schließe 10 Dungeons ab.",              check: s => s.dungeonsCleared >= 10 },
    { id: "blaidd",     name: "Blaidds Gefährte",       icon: "🐺", desc: "Schließe Blaidds Quest ab.",             check: s => s.blaiddDefeats >= 4 },
    { id: "talisman_25",name: "Talisman-Sammler",       icon: "💍", desc: "Finde 25 Talismane.",                    check: s => s.talismansFound >= 25 },
    { id: "weapon_25",  name: "Waffennarr",             icon: "🗡️", desc: "Finde 25 Waffen.",                      check: s => s.weaponsFound >= 25 },
    { id: "armor_10",   name: "Gut gerüstet",           icon: "🛡️", desc: "Finde 10 Rüstungen.",                   check: s => s.armorsFound >= 10 },
    { id: "flask_500",  name: "Estus-süchtig",          icon: "🧪", desc: "Trinke 500 Flakons.",                    check: s => s.flasksDrunk >= 500 }
  ];

  // Übersetzt Name/Beschreibung eines Achievements via i18n (Fallback: hartkodiert)
  function locAch(a) {
    var nm = a.name, ds = a.desc;
    if (window.i18n) {
      var n = window.i18n.t("ach_" + a.id + "_nm"); if (n && n !== "ach_" + a.id + "_nm") nm = n;
      var d = window.i18n.t("ach_" + a.id + "_ds"); if (d && d !== "ach_" + a.id + "_ds") ds = d;
    }
    return { id: a.id, icon: a.icon, name: nm, desc: ds };
  }

  function checkAchievements() {
    var s = getStats();
    var unlocked = getUnlocked();
    var neu = [];
    ACHIEVEMENTS.forEach(function (a) {
      if (unlocked.indexOf(a.id) === -1 && a.check(s)) {
        unlocked.push(a.id); neu.push(a);
      }
    });
    if (neu.length) {
      saveUnlocked(unlocked);
      neu.forEach(function (a) { if (typeof window.onERAchievement === "function") { try { window.onERAchievement(locAch(a)); } catch (e) {} } });
      cloudPush();
    }
    return neu;
  }

  /* ====== 4) STATISTIK-MUTATIONEN ====== */
  function bump(key, n) { var s = getStats(); s[key] = (s[key] || 0) + (n || 1); saveStats(s); checkAchievements(); }
  function setMax(key, val) { var s = getStats(); if (val > (s[key] || 0)) { s[key] = val; saveStats(s); checkAchievements(); } }
  function runBump(key, n) { var r = getRun(); r[key] = (r[key] || 0) + (n || 1); saveRun(r); }

  /* ====== 5) ÖFFENTLICHE API (window.ER) ====== */
  const ER = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    isOnline: function () { return ONLINE; },

    /* --- Run-Lebenszyklus --- */
    startRun: function (mode) {
      runMode = (mode === "hard") ? "hard" : "normal";
      saveRun({ stage: 1, bosses: 0, fights: 0, mode: runMode });
      bump("runsStarted");
      setMax("furthestStage", 1);
    },
    endRun: function () {
      var r = getRun();
      var mode = (r.mode === "hard") ? "hard" : "normal";
      var score = (r.stage || 0) * 1000 + (r.bosses || 0) * 200 + (r.fights || 0) * 10;
      var prev = getStats();
      if (mode === "hard") {
        if (score > (prev.bestScoreHard || 0)) { var sh = getStats(); sh.bestScoreHardPatch = GAME_PATCH; saveStats(sh); }
        setMax("bestScoreHard", score);
        setMax("bestRunBossesHard", r.bosses || 0);
        setMax("furthestStageHard", r.stage || 0);
      } else {
        if (score > (prev.bestScore || 0)) { var sn = getStats(); sn.bestScorePatch = GAME_PATCH; saveStats(sn); }
        setMax("bestScore", score);
        setMax("bestRunBosses", r.bosses || 0);
      }
      submitToBoard(score, { stage: r.stage || 0, bosses: r.bosses || 0, fights: r.fights || 0 }, mode);
      saveRun({ stage: 0, bosses: 0, fights: 0, mode: mode });
      return score;
    },

    /* --- Einzel-Events --- */
    fightWon:     function () { bump("fightsWon"); runBump("fights"); },
    bossKilled:   function (name) { bump("bossesKilled"); runBump("bosses"); var s = getStats(); s.bossKills = s.bossKills || {}; s.bossKills[name] = (s.bossKills[name] || 0) + 1; saveStats(s); checkAchievements(); },
    eliteKilled:  function () { bump("elitesKilled"); },
    minibossKilled: function () { bump("minibossesKilled"); },
    invaderKilled:  function () { bump("invadersKilled"); },
    death:        function () { bump("deaths"); ER.endRun(); },
    dungeonCleared: function () { bump("dungeonsCleared"); },
    talismanFound: function () { bump("talismansFound"); },
    weaponFound:  function () { bump("weaponsFound"); },
    armorFound:   function () { bump("armorsFound"); },
    blaiddDefeat: function () { bump("blaiddDefeats"); },
    gameCompleted: function () { bump("gamesCompleted"); ER.endRun(); },
    flaskDrunk:   function () { bump("flasksDrunk"); },
    reachStage:   function (n) { if (n) { setMax("furthestStage", n); var r = getRun(); if (n > (r.stage || 0)) { r.stage = n; saveRun(r); } } },

    // NEU: Hard-Mode-Abschluss (wird nach gameCompleted aufgerufen)
    hardCompleted: function () {
      bump("hardCompleted");
    },
    // NEU: Challenge-Abschluss. ch = "noarmor" | "noblaidd" | "autobattle" | "haligtree"
    challengeCompleted: function (ch) {
      if (!ch) return;
      var s = getStats();
      s.challenges = s.challenges || {};
      s.challenges[ch] = (s.challenges[ch] || 0) + 1;
      saveStats(s);
      checkAchievements();
    },

    /* --- Abfragen --- */
    getStats: getStats,
    getAchievements: function () { var u = getUnlocked(); return ACHIEVEMENTS.map(function (a) { var l = locAch(a); l.unlocked = u.indexOf(a.id) !== -1; return l; }); },
    getPlayerName: function () { var custom = lsGet(NAME_KEY, null); if (custom) return custom; return (currentUser && currentUser.displayName) || (window.i18n ? window.i18n.t("lb_th_player") : "Befleckter"); },
    setPlayerName: function (n) { lsSet(NAME_KEY, n); cloudPush(); },

    /* --- Auth --- */
    onUserChange: function (cb) { userListeners.push(cb); try { cb(currentUser); } catch (e) {} },
    currentUser: function () { return currentUser; },
    signInWithGoogle: function () {
      if (!ONLINE) { alert("Online-Login ist noch nicht konfiguriert (Firebase fehlt)."); return Promise.reject("offline"); }
      var provider = new firebase.auth.GoogleAuthProvider();
      return fbAuth.signInWithPopup(provider);
    },
    // NEU: E-Mail-Anmeldung
    signInWithEmail: function (email, pass) {
      if (!ONLINE || !fbAuth) { return Promise.reject({ code: "offline", message: "Online-Login ist nicht verfügbar (Firebase fehlt)." }); }
      return fbAuth.signInWithEmailAndPassword(email, pass);
    },
    // NEU: E-Mail-Registrierung (setzt optional den Anzeigenamen)
    signUpWithEmail: function (email, pass, displayName) {
      if (!ONLINE || !fbAuth) { return Promise.reject({ code: "offline", message: "Online-Registrierung ist nicht verfügbar (Firebase fehlt)." }); }
      return fbAuth.createUserWithEmailAndPassword(email, pass).then(function (cred) {
        if (displayName && cred && cred.user) {
          lsSet(NAME_KEY, displayName);
          return cred.user.updateProfile({ displayName: displayName }).then(function () { return cred; }).catch(function () { return cred; });
        }
        return cred;
      });
    },
    signOut: function () { if (fbAuth) return fbAuth.signOut(); return Promise.resolve(); },

    /* --- Bestenliste (mode: "normal" | "hard") --- */
    getLeaderboard: function (limit, cb, mode) {
      limit = limit || 20;
      mode = (mode === "hard") ? "hard" : "normal";
      var scoreField = mode === "hard" ? "bestScoreHard" : "bestScore";
      if (ONLINE && fbDB) {
        fbDB.collection("users").orderBy(scoreField, "desc").limit(limit).get()
          .then(function (snap) {
            var rows = [];
            snap.forEach(function (d) {
              var x = d.data();
              var sc = mode === "hard" ? (x.bestScoreHard || 0) : (x.bestScore || 0);
              if (sc <= 0) return; // Spieler ohne Wertung in diesem Modus überspringen
              rows.push({
                name: x.displayName || "Befleckter",
                score: sc,
                stage: mode === "hard" ? (x.furthestStageHard || 0) : (x.furthestStage || 0),
                bosses: mode === "hard" ? (x.bestRunBossesHard || 0) : (x.bestRunBosses || 0),
                patch: mode === "hard" ? (x.bestScoreHardPatch || "") : (x.bestScorePatch || ""),
                photo: x.photoURL || ""
              });
            });
            cb(rows, true);
          })
          .catch(function (e) { console.warn("[ER] Bestenliste online fehlgeschlagen, lokal:", e); cb(localBoard(limit, mode), false); });
      } else {
        cb(localBoard(limit, mode), false);
      }
    }
  };

  /* ====== 6) LOKALE BESTENLISTE (getrennt nach Modus) ====== */
  function localBoard(limit, mode) {
    mode = (mode === "hard") ? "hard" : "normal";
    var b = lsGet(BOARD_KEY, []);
    b = b.filter(function (x) { return (x.mode || "normal") === mode; });
    b.sort(function (a, c) { return c.score - a.score; });
    return b.slice(0, limit).map(function (x) {
      return { name: x.name, score: x.score, stage: x.stage, bosses: x.bosses, patch: x.patch || "", photo: x.photo || "" };
    });
  }
  function submitToBoard(score, meta, mode) {
    if (score <= 0) return;
    mode = (mode === "hard") ? "hard" : "normal";
    var name = ER.getPlayerName();
    var b = lsGet(BOARD_KEY, []);
    var mine = b.find(function (x) { return x.name === name && x.local && (x.mode || "normal") === mode; });
    if (mine) {
      // Nur bei neuer Bestleistung aktualisieren – Patch dann auf aktuellen Patch setzen
      if (score > mine.score) { mine.score = score; mine.stage = meta.stage; mine.bosses = meta.bosses; mine.patch = GAME_PATCH; }
    } else {
      b.push({ name: name, score: score, stage: meta.stage, bosses: meta.bosses, mode: mode, patch: GAME_PATCH, local: true });
    }
    lsSet(BOARD_KEY, b);
    cloudPush();
  }

  /* ====== 7) CLOUD-SYNC (Firestore) ====== */
  function cloudPush() {
    if (!ONLINE || !fbDB || !currentUser) return;
    var s = getStats();
    var doc = {
      displayName: ER.getPlayerName(),
      photoURL: currentUser.photoURL || "",
      stats: s,
      achievements: getUnlocked(),
      bestScore: s.bestScore || 0,
      bestRunBosses: s.bestRunBosses || 0,
      furthestStage: s.furthestStage || 0,
      // NEU: getrennte Hard-Mode-Wertung
      bestScoreHard: s.bestScoreHard || 0,
      bestRunBossesHard: s.bestRunBossesHard || 0,
      furthestStageHard: s.furthestStageHard || 0,
      // NEU: Patch, auf dem die jeweilige Bestleistung erzielt wurde
      bestScorePatch: s.bestScorePatch || "",
      bestScoreHardPatch: s.bestScoreHardPatch || "",
      updatedAt: (firebase.firestore && firebase.firestore.FieldValue ? firebase.firestore.FieldValue.serverTimestamp() : Date.now())
    };
    try { fbDB.collection("users").doc(currentUser.uid).set(doc, { merge: true }); } catch (e) { console.warn("[ER] cloudPush:", e); }
  }

  function cloudSyncOnLogin() {
    if (!ONLINE || !fbDB || !currentUser) return;
    fbDB.collection("users").doc(currentUser.uid).get().then(function (snap) {
      var local = getStats();
      var localAch = getUnlocked();
      if (snap.exists) {
        var cloud = snap.data();
        var cs = cloud.stats || {};
        var merged = Object.assign({}, DEFAULT_STATS, local);
        Object.keys(DEFAULT_STATS).forEach(function (k) {
          if (k === "bossKills") {
            merged.bossKills = Object.assign({}, cs.bossKills || {}, local.bossKills || {});
            Object.keys(cs.bossKills || {}).forEach(function (bk) { merged.bossKills[bk] = Math.max(cs.bossKills[bk] || 0, (local.bossKills || {})[bk] || 0); });
          } else if (k === "challenges") {
            merged.challenges = Object.assign({}, cs.challenges || {}, local.challenges || {});
            Object.keys(cs.challenges || {}).forEach(function (ck) { merged.challenges[ck] = Math.max(cs.challenges[ck] || 0, (local.challenges || {})[ck] || 0); });
          } else {
            merged[k] = Math.max(local[k] || 0, cs[k] || 0);
          }
        });
        saveStats(merged);
        var ach = localAch.slice();
        (cloud.achievements || []).forEach(function (id) { if (ach.indexOf(id) === -1) ach.push(id); });
        saveUnlocked(ach);
      }
      if (currentUser.displayName && !lsGet(NAME_KEY, null)) lsSet(NAME_KEY, currentUser.displayName);
      checkAchievements();
      cloudPush();
    }).catch(function (e) { console.warn("[ER] Login-Sync:", e); });
  }

  window.ER = ER;
})();
