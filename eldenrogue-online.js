/* ============================================================
   Elden Rogue – Fortschritt, Achievements & Bestenliste
   ------------------------------------------------------------
   Firebase ist konfiguriert – Login, Online-Bestenliste und
   Cloud-Speicher sind aktiv. Lokaler Fallback greift automatisch,
   falls Firebase nicht erreichbar ist.

   v1.4 – synchron zu game.html / lang.js:
     • 37 Achievements (vorher 22)
     • Schwierigkeit (normal/hard) wird durchgängig getrackt
     • getrennte Bestenlisten für Normal und Hard
     • neue API: hardCompleted(), challengeCompleted(name)
     • startRun(difficulty) wertet die Schwierigkeit jetzt aus
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
  const PATCH = "1.4"; // aktuelle Spielversion – wird an neue Bestenlisten-Einträge angehängt
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

  /* ====== 2) SPEICHER-HELFER (robust, fällt nie auf die Nase) ====== */
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
    bestRunBosses: 0, bestScore: 0, flasksDrunk: 0,
    // --- pro Schwierigkeit getrennt ---
    bestScoreNormal: 0, bestScoreHard: 0,
    bestRunBossesNormal: 0, bestRunBossesHard: 0,
    furthestStageNormal: 0, furthestStageHard: 0,
    // --- Hard-/Challenge-Fortschritt ---
    hardModeCompletions: 0, hardNoDeath: false,
    challengesCompleted: {},
    // --- Bestwerte pro Patch: { "1_3": { normal:{score,stage,bosses}, hard:{...} }, "1_4": {...} } ---
    patchBest: {},
    bossKills: {}
  };

  // Objekt-Felder werden kopiert, damit niemals der gemeinsame DEFAULT_STATS mutiert wird
  function getStats() {
    var s = Object.assign({}, DEFAULT_STATS, lsGet(STATS_KEY, {}));
    s.bossKills = Object.assign({}, s.bossKills || {});
    s.challengesCompleted = Object.assign({}, s.challengesCompleted || {});
    s.patchBest = JSON.parse(JSON.stringify(s.patchBest || {}));
    return s;
  }
  function saveStats(s) { lsSet(STATS_KEY, s); }
  function getRun() { return lsGet(RUN_KEY, { stage: 0, bosses: 0, fights: 0, difficulty: "normal", hadDeath: false }); }
  function saveRun(r) { lsSet(RUN_KEY, r); }
  function getUnlocked() { return lsGet(ACH_KEY, []); }
  function saveUnlocked(a) { lsSet(ACH_KEY, a); }

  // Die fünf Haupt-Halbgötter (für "Götterdämmerung")
  const HAUPTBOSSE = [
    "Godrick, der Verpflanzte",
    "Sternengeißel Radahn",
    "Morgott, der Omenkönig",
    "Feuerriese",
    "Maliketh, die Schwarze Klinge"
  ];

  /* ====== 3) ACHIEVEMENTS (37) ====== */
  const ACHIEVEMENTS = [
    /* --- Kämpfe --- */
    { id: "first_win",  name: "Erster Sieg",            icon: "⚔️", desc: "Gewinne deinen ersten Kampf.",            check: s => s.fightsWon >= 1 },
    { id: "win_100",    name: "Kriegsveteran",          icon: "🗡️", desc: "Gewinne 100 Kämpfe.",                    check: s => s.fightsWon >= 100 },
    { id: "win_500",    name: "Schlachtenmeister",      icon: "🏹", desc: "Gewinne 500 Kämpfe.",                    check: s => s.fightsWon >= 500 },
    { id: "win_1000",   name: "Tausendsassa",           icon: "👑", desc: "Gewinne 1000 Kämpfe.",                   check: s => s.fightsWon >= 1000 },
    { id: "win_2500",   name: "Kriegsgott",             icon: "🔱", desc: "Gewinne 2500 Kämpfe.",                   check: s => s.fightsWon >= 2500 },
    /* --- Bosse --- */
    { id: "boss_1",     name: "Halbgott-Jäger",         icon: "💀", desc: "Besiege deinen ersten Boss.",            check: s => s.bossesKilled >= 1 },
    { id: "boss_10",    name: "Halbgott-Schlächter",    icon: "☠️", desc: "Besiege 10 Bosse.",                      check: s => s.bossesKilled >= 10 },
    { id: "boss_50",    name: "Gott unter Göttern",     icon: "🌟", desc: "Besiege 50 Bosse.",                      check: s => s.bossesKilled >= 50 },
    { id: "godrick",    name: "Sturmschleier gemeistert", icon: "🦴", desc: "Besiege Godrick.",                     check: s => (s.bossKills["Godrick, der Verpflanzte"] || 0) >= 1 },
    { id: "radahn",     name: "Die Sterne fallen",      icon: "🌌", desc: "Besiege Radahn.",                        check: s => (s.bossKills["Sternengeißel Radahn"] || 0) >= 1 },
    { id: "morgott",    name: "Omenkönig gefallen",     icon: "👑", desc: "Besiege Morgott.",                       check: s => (s.bossKills["Morgott, der Omenkönig"] || 0) >= 1 },
    { id: "firegiant",  name: "Schmiede erloschen",     icon: "🔥", desc: "Besiege den Feuerriesen.",               check: s => (s.bossKills["Feuerriese"] || 0) >= 1 },
    { id: "maliketh",   name: "Schwarze Klinge",        icon: "🐕", desc: "Besiege Maliketh.",                      check: s => (s.bossKills["Maliketh, die Schwarze Klinge"] || 0) >= 1 },
    { id: "all_bosses", name: "Götterdämmerung",        icon: "🌒", desc: "Besiege jeden Halbgott mindestens einmal.", check: s => HAUPTBOSSE.every(b => (s.bossKills[b] || 0) >= 1) },
    /* --- Runs / Abschluss --- */
    { id: "elden_lord", name: "Elden Lord",             icon: "👑", desc: "Schließe einen Run ab und werde Elden Lord.", check: s => s.gamesCompleted >= 1 },
    { id: "complete_10",name: "Veteran",                icon: "🎖️", desc: "Schließe 10 Runs ab.",                  check: s => s.gamesCompleted >= 10 },
    { id: "complete_25",name: "Legende",                icon: "🏆", desc: "Schließe 25 Runs ab.",                  check: s => s.gamesCompleted >= 25 },
    /* --- Tode --- */
    { id: "first_death",name: "Du bist gestorben",      icon: "💀", desc: "Stirb zum ersten Mal.",                  check: s => s.deaths >= 1 },
    { id: "death_50",   name: "Hartnäckig",             icon: "⚰️", desc: "Stirb 50 Mal und gib nicht auf.",        check: s => s.deaths >= 50 },
    { id: "death_100",  name: "Unsterblich",            icon: "👻", desc: "Stirb 100 Mal.",                         check: s => s.deaths >= 100 },
    /* --- Dungeons --- */
    { id: "dungeon_1",  name: "Gruft-Plünderer",        icon: "🏰", desc: "Schließe einen Dungeon ab.",             check: s => s.dungeonsCleared >= 1 },
    { id: "dungeon_10", name: "Katakomben-Kenner",      icon: "🗝️", desc: "Schließe 10 Dungeons ab.",              check: s => s.dungeonsCleared >= 10 },
    /* --- Blaidd --- */
    { id: "blaidd",     name: "Blaidds Gefährte",       icon: "🐺", desc: "Schließe Blaidds Quest ab.",             check: s => s.blaiddDefeats >= 4 },
    /* --- Sammeln --- */
    { id: "talisman_25",name: "Talisman-Sammler",       icon: "💍", desc: "Finde 25 Talismane.",                    check: s => s.talismansFound >= 25 },
    { id: "weapon_25",  name: "Waffennarr",             icon: "🗡️", desc: "Finde 25 Waffen.",                      check: s => s.weaponsFound >= 25 },
    { id: "armor_10",   name: "Gut gerüstet",           icon: "🛡️", desc: "Finde 10 Rüstungen.",                   check: s => s.armorsFound >= 10 },
    { id: "flask_500",  name: "Estus-süchtig",          icon: "🧪", desc: "Trinke 500 Flakons.",                    check: s => s.flasksDrunk >= 500 },
    /* --- Hard Mode --- */
    { id: "hard_lord",     name: "Wahrer Elden Lord",   icon: "👑", desc: "Schließe einen Hard-Mode-Run ab.",       check: s => (s.hardModeCompletions || 0) >= 1 },
    { id: "hard_5",        name: "Masochist",           icon: "🩸", desc: "Schließe Hard-Mode 5x ab.",              check: s => (s.hardModeCompletions || 0) >= 5 },
    { id: "hard_no_death", name: "Flawless",            icon: "✨", desc: "Schließe Hard-Mode ab, ohne zu sterben.", check: s => !!s.hardNoDeath },
    /* --- Challenges --- */
    { id: "challenge_auto",      name: "Zuschauer",        icon: "👁️", desc: "Schließe einen Auto-Battle-Run ab.", check: s => !!(s.challengesCompleted && s.challengesCompleted.autobattle) },
    { id: "challenge_noarmor",   name: "Nacktläufer",      icon: "🏃", desc: "Schließe einen No-Armor-Run ab.",     check: s => !!(s.challengesCompleted && s.challengesCompleted.noarmor) },
    { id: "challenge_noblaidd",  name: "Einsamer Wolf",    icon: "🐺", desc: "Schließe einen No-Blaidd-Run ab.",    check: s => !!(s.challengesCompleted && s.challengesCompleted.noblaidd) }
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

  /* ====== 4) STATISTIK-MUTATIONEN (vom Spiel aufgerufen) ====== */
  function bump(key, n) { var s = getStats(); s[key] = (s[key] || 0) + (n || 1); saveStats(s); checkAchievements(); }
  function setMax(key, val) { var s = getStats(); if (val > (s[key] || 0)) { s[key] = val; saveStats(s); checkAchievements(); } }

  function runBump(key, n) { var r = getRun(); r[key] = (r[key] || 0) + (n || 1); saveRun(r); }

  function normDiff(d) { return d === "hard" ? "hard" : "normal"; }
  function patchKey(p) { return String(p || PATCH).replace(/\./g, "_"); } // "1.4" -> "1_4"
  function leererPatchSlot() { return { normal: { score: 0, stage: 0, bosses: 0 }, hard: { score: 0, stage: 0, bosses: 0 } }; }

  /* ====== 5) ÖFFENTLICHE API (window.ER) ====== */
  const ER = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    isOnline: function () { return ONLINE; },

    /* --- Run-Lebenszyklus --- */
    startRun: function (difficulty) {
      var diff = normDiff(difficulty);
      saveRun({ stage: 1, bosses: 0, fights: 0, difficulty: diff, hadDeath: false });
      bump("runsStarted");
      setMax("furthestStage", 1);
      setMax(diff === "hard" ? "furthestStageHard" : "furthestStageNormal", 1);
    },
    endRun: function () {
      var r = getRun();
      var diff = normDiff(r.difficulty);
      var score = (r.stage || 0) * 1000 + (r.bosses || 0) * 200 + (r.fights || 0) * 10;
      // kombiniert (für die Stat-Anzeige) ...
      setMax("bestScore", score);
      setMax("bestRunBosses", r.bosses || 0);
      // ... getrennt nach Schwierigkeit (Stat-Anzeige/Cloud-Kompatibilität) ...
      setMax(diff === "hard" ? "bestScoreHard" : "bestScoreNormal", score);
      setMax(diff === "hard" ? "bestRunBossesHard" : "bestRunBossesNormal", r.bosses || 0);
      // ... und pro Patch + Schwierigkeit (das ist die Quelle für die Bestenliste)
      if (score > 0) {
        var s = getStats();
        var pk = patchKey(PATCH);
        s.patchBest = s.patchBest || {};
        if (!s.patchBest[pk]) s.patchBest[pk] = leererPatchSlot();
        var slot = s.patchBest[pk][diff];
        if (score > (slot.score || 0)) { slot.score = score; slot.stage = r.stage || 0; slot.bosses = r.bosses || 0; }
        saveStats(s);
      }
      submitToBoard(score, { stage: r.stage || 0, bosses: r.bosses || 0, fights: r.fights || 0, difficulty: diff });
      // Zähler zurücksetzen – Schwierigkeit & hadDeath bleiben bis zum nächsten startRun erhalten
      saveRun({ stage: 0, bosses: 0, fights: 0, difficulty: diff, hadDeath: r.hadDeath });
      return score;
    },

    /* --- Einzel-Events --- */
    fightWon:     function () { bump("fightsWon"); runBump("fights"); },
    bossKilled:   function (name) { bump("bossesKilled"); runBump("bosses"); var s = getStats(); s.bossKills[name] = (s.bossKills[name] || 0) + 1; saveStats(s); checkAchievements(); },
    eliteKilled:  function () { bump("elitesKilled"); },
    minibossKilled: function () { bump("minibossesKilled"); },
    invaderKilled:  function () { bump("invadersKilled"); },
    death:        function () { var r = getRun(); r.hadDeath = true; saveRun(r); bump("deaths"); ER.endRun(); },
    dungeonCleared: function () { bump("dungeonsCleared"); },
    talismanFound: function () { bump("talismansFound"); },
    weaponFound:  function () { bump("weaponsFound"); },
    armorFound:   function () { bump("armorsFound"); },
    blaiddDefeat: function () { bump("blaiddDefeats"); },
    gameCompleted: function () { bump("gamesCompleted"); ER.endRun(); },
    flaskDrunk:   function () { bump("flasksDrunk"); },
    reachStage:   function (n) { if (n) { setMax("furthestStage", n); var r = getRun(); var diff = normDiff(r.difficulty); setMax(diff === "hard" ? "furthestStageHard" : "furthestStageNormal", n); if (n > (r.stage || 0)) { r.stage = n; saveRun(r); } } },

    /* --- Hard Mode & Challenges --- */
    hardCompleted: function () {
      var s = getStats();
      s.hardModeCompletions = (s.hardModeCompletions || 0) + 1;
      if (!getRun().hadDeath) s.hardNoDeath = true; // dieser Run wurde ohne Tod abgeschlossen
      saveStats(s);
      checkAchievements();
    },
    challengeCompleted: function (name) {
      if (!name) return;
      var s = getStats();
      s.challengesCompleted = s.challengesCompleted || {};
      s.challengesCompleted[name] = true;
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
      if (!ONLINE) { alert("Online-Login ist noch nicht konfiguriert (Firebase fehlt). Siehe FIREBASE_SETUP.md."); return Promise.reject("offline"); }
      var provider = new firebase.auth.GoogleAuthProvider();
      return fbAuth.signInWithPopup(provider);
    },
    signOut: function () { if (fbAuth) return fbAuth.signOut(); return Promise.resolve(); },

    /* --- Bestenliste (getrennt nach Patch + Schwierigkeit) --- */
    getLeaderboard: function (limit, cb, difficulty, patch) {
      limit = limit || 20;
      var diff = normDiff(difficulty);
      var pk = patchKey(patch || PATCH);
      var scoreField = "lb." + pk + "." + (diff === "hard" ? "hardScore" : "normalScore");
      var stageField = "lb." + pk + "." + (diff === "hard" ? "hardStage" : "normalStage");
      var bossField  = "lb." + pk + "." + (diff === "hard" ? "hardBosses" : "normalBosses");
      if (ONLINE && fbDB) {
        fbDB.collection("users").orderBy(scoreField, "desc").limit(limit).get()
          .then(function (snap) {
            var rows = [];
            snap.forEach(function (d) {
              var x = d.data();
              var box = (x.lb && x.lb[pk]) ? x.lb[pk] : {};
              var sc = (diff === "hard" ? box.hardScore : box.normalScore) || 0;
              if (sc <= 0) return; // keine leeren Einträge im jeweiligen Board
              rows.push({
                name: x.displayName || "Befleckter",
                score: sc,
                stage: (diff === "hard" ? box.hardStage : box.normalStage) || 0,
                bosses: (diff === "hard" ? box.hardBosses : box.normalBosses) || 0,
                photo: x.photoURL || "",
                patch: pk.replace(/_/g, ".")
              });
            });
            cb(rows, true);
          })
          .catch(function (e) { console.warn("[ER] Bestenliste online fehlgeschlagen, lokal:", e); cb(localBoard(limit, diff, pk), false); });
      } else {
        cb(localBoard(limit, diff, pk), false);
      }
    }
  };

  /* ====== 6) LOKALE BESTENLISTE ====== */
  function localBoard(limit, difficulty, patch) {
    var diff = normDiff(difficulty);
    var pk = patchKey(patch || PATCH);
    var b = lsGet(BOARD_KEY, []).filter(function (x) {
      // Einträge ohne Patch-Feld stammen aus der Zeit vor v1.4 -> als "1.3" behandeln
      var entryPk = patchKey(x.patch || "1.3");
      return normDiff(x.difficulty) === diff && entryPk === pk;
    });
    b.sort(function (a, c) { return c.score - a.score; });
    return b.slice(0, limit);
  }
  function submitToBoard(score, meta) {
    if (score <= 0) return;
    var name = ER.getPlayerName();
    var diff = normDiff(meta.difficulty);
    // lokal – ein bester Eintrag pro Name UND Schwierigkeit
    var b = lsGet(BOARD_KEY, []);
    var mine = b.find(function (x) { return x.name === name && x.local && normDiff(x.difficulty) === diff; });
    if (mine) { if (score > mine.score) { mine.score = score; mine.stage = meta.stage; mine.bosses = meta.bosses; mine.patch = PATCH; } }
    else { b.push({ name: name, score: score, stage: meta.stage, bosses: meta.bosses, difficulty: diff, patch: PATCH, local: true }); }
    lsSet(BOARD_KEY, b);
    // cloud
    cloudPush();
  }

  /* ====== 7) CLOUD-SYNC (Firestore) ====== */
  // Baut aus stats.patchBest die "lb"-Map, nach der die Online-Bestenliste sortiert.
  function baueLbMap(s) {
    var lb = {};
    var pb = s.patchBest || {};
    Object.keys(pb).forEach(function (pk) {
      var slot = pb[pk] || {};
      var n = slot.normal || {}, h = slot.hard || {};
      lb[pk] = {
        normalScore: n.score || 0, normalStage: n.stage || 0, normalBosses: n.bosses || 0,
        hardScore: h.score || 0,   hardStage: h.stage || 0,   hardBosses: h.bosses || 0
      };
    });
    return lb;
  }

  // Vereint zwei patchBest-Maps: pro Patch + Schwierigkeit gewinnt der höhere Score.
  function mergePatchBest(localPB, cloudPB) {
    localPB = localPB || {}; cloudPB = cloudPB || {};
    var out = {}, keys = {};
    Object.keys(localPB).forEach(function (k) { keys[k] = true; });
    Object.keys(cloudPB).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (pk) {
      var lSlot = localPB[pk] || {}, cSlot = cloudPB[pk] || {};
      out[pk] = {};
      ["normal", "hard"].forEach(function (diff) {
        var l = lSlot[diff] || { score: 0, stage: 0, bosses: 0 };
        var c = cSlot[diff] || { score: 0, stage: 0, bosses: 0 };
        var win = (l.score || 0) >= (c.score || 0) ? l : c;
        out[pk][diff] = { score: win.score || 0, stage: win.stage || 0, bosses: win.bosses || 0 };
      });
    });
    return out;
  }

  function cloudPush() {
    if (!ONLINE || !fbDB || !currentUser) return;
    var s = getStats();
    var doc = {
      displayName: ER.getPlayerName(),
      photoURL: currentUser.photoURL || "",
      stats: s,
      achievements: getUnlocked(),
      patch: PATCH,
      bestScore: s.bestScore || 0,
      bestRunBosses: s.bestRunBosses || 0,
      furthestStage: s.furthestStage || 0,
      // Legacy-Felder (Stat-Anzeige / Abwärtskompatibilität)
      bestScoreNormal: s.bestScoreNormal || 0,
      bestScoreHard: s.bestScoreHard || 0,
      bestRunBossesNormal: s.bestRunBossesNormal || 0,
      bestRunBossesHard: s.bestRunBossesHard || 0,
      furthestStageNormal: s.furthestStageNormal || 0,
      furthestStageHard: s.furthestStageHard || 0,
      // Pro-Patch-Bestwerte – Quelle für die patch-getrennte Bestenliste
      lb: baueLbMap(s),
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
        // Merge: Zahlen -> Maximum, Objekte -> vereinen, Booleans -> ODER
        var merged = Object.assign({}, DEFAULT_STATS, local);
        Object.keys(DEFAULT_STATS).forEach(function (k) {
          if (k === "bossKills" || k === "challengesCompleted") {
            var localObj = local[k] || {}, cloudObj = cs[k] || {};
            var mergedObj = Object.assign({}, cloudObj, localObj);
            Object.keys(cloudObj).forEach(function (kk) {
              if (typeof cloudObj[kk] === "number") mergedObj[kk] = Math.max(cloudObj[kk] || 0, localObj[kk] || 0);
              else if (!(kk in localObj)) mergedObj[kk] = cloudObj[kk];
            });
            merged[k] = mergedObj;
          } else if (k === "patchBest") {
            merged.patchBest = mergePatchBest(local.patchBest || {}, cs.patchBest || {});
          } else if (k === "hardNoDeath") {
            merged[k] = !!(local[k] || cs[k]);
          } else {
            merged[k] = Math.max(local[k] || 0, cs[k] || 0);
          }
        });
        // Einmalige Migration: alte (Pre-1.4-)Cloud-Bestwerte als Patch "1_3" übernehmen,
        // falls noch kein 1_3-Eintrag existiert. So bleiben alte Online-Läufe unter v1.3 sichtbar.
        if (!merged.patchBest["1_3"]) {
          var legacyN = cloud.bestScoreNormal || 0, legacyH = cloud.bestScoreHard || 0;
          // Ganz alte 1.3-Dokumente hatten nur einen kombinierten bestScore (ohne Schwierigkeit) -> als Normal werten.
          if (legacyN === 0 && legacyH === 0 && (cloud.bestScore || 0) > 0) legacyN = cloud.bestScore || 0;
          if (legacyN > 0 || legacyH > 0) {
            merged.patchBest["1_3"] = {
              normal: { score: legacyN, stage: cloud.furthestStageNormal || cloud.furthestStage || 0, bosses: cloud.bestRunBossesNormal || cloud.bestRunBosses || 0 },
              hard:   { score: legacyH, stage: cloud.furthestStageHard   || 0, bosses: cloud.bestRunBossesHard   || 0 }
            };
          }
        }
        saveStats(merged);
        var ach = localAch.slice();
        (cloud.achievements || []).forEach(function (id) { if (ach.indexOf(id) === -1) ach.push(id); });
        saveUnlocked(ach);
      }
      // Namen aus Google übernehmen, falls vorhanden
      if (currentUser.displayName && !lsGet(NAME_KEY, null)) lsSet(NAME_KEY, currentUser.displayName);
      checkAchievements();
      cloudPush();
    }).catch(function (e) { console.warn("[ER] Login-Sync:", e); });
  }

  window.ER = ER;
})();
