/* ============================================================
   Elden Rogue – Fortschritt, Achievements & Bestenliste
   ------------------------------------------------------------
   Firebase ist konfiguriert – Login, Online-Bestenliste und
   Cloud-Speicher sind aktiv. Lokaler Fallback greift automatisch,
   falls Firebase nicht erreichbar ist.
   ============================================================ */
(function () {
  "use strict";

  /* ====== 1) FIREBASE-KONFIG — HIER EINTRAGEN FÜR ONLINE ====== */
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
    bestRunBosses: 0, bestScore: 0, flasksDrunk: 0, bossKills: {}
  };

  function getStats() { return Object.assign({}, DEFAULT_STATS, lsGet(STATS_KEY, {})); }
  function saveStats(s) { lsSet(STATS_KEY, s); }
  function getRun() { return lsGet(RUN_KEY, { stage: 0, bosses: 0, fights: 0 }); }
  function saveRun(r) { lsSet(RUN_KEY, r); }
  function getUnlocked() { return lsGet(ACH_KEY, []); }
  function saveUnlocked(a) { lsSet(ACH_KEY, a); }

  /* ====== 3) ACHIEVEMENTS ====== */
  const ACHIEVEMENTS = [
    { id: "first_win",  name: "Erster Sieg",            icon: "⚔️", desc: "Gewinne deinen ersten Kampf.",            check: s => s.fightsWon >= 1 },
    { id: "win_100",    name: "Kriegsveteran",          icon: "🗡️", desc: "Gewinne 100 Kämpfe.",                    check: s => s.fightsWon >= 100 },
    { id: "win_500",    name: "Schlachtenmeister",      icon: "🏹", desc: "Gewinne 500 Kämpfe.",                    check: s => s.fightsWon >= 500 },
    { id: "win_1000",   name: "Tausendsassa",           icon: "👑", desc: "Gewinne 1000 Kämpfe.",                   check: s => s.fightsWon >= 1000 },
    { id: "boss_1",     name: "Halbgott-Jäger",         icon: "💀", desc: "Besiege deinen ersten Boss.",            check: s => s.bossesKilled >= 1 },
    { id: "boss_10",    name: "Halbgott-Schlächter",    icon: "☠️", desc: "Besiege 10 Bosse.",                      check: s => s.bossesKilled >= 10 },
    { id: "boss_50",    name: "Gott unter Göttern",     icon: "🌟", desc: "Besiege 50 Bosse.",                      check: s => s.bossesKilled >= 50 },
    { id: "godrick",    name: "Sturmschleier gemeistert", icon: "🦴", desc: "Besiege Godrick.",                     check: s => (s.bossKills["Godrick, der Verpflanzte"] || 0) >= 1 },
    { id: "radahn",     name: "Die Sterne fallen",      icon: "🌌", desc: "Besiege Radahn.",                        check: s => (s.bossKills["Sternengeißel Radahn"] || 0) >= 1 },
    { id: "morgott",    name: "Omenkönig gefallen",     icon: "👑", desc: "Besiege Morgott.",                       check: s => (s.bossKills["Morgott, der Omenkönig"] || 0) >= 1 },
    { id: "firegiant",  name: "Schmiede erloschen",     icon: "🔥", desc: "Besiege den Feuerriesen.",               check: s => (s.bossKills["Feuerriese"] || 0) >= 1 },
    { id: "maliketh",   name: "Schwarze Klinge",        icon: "🐕", desc: "Besiege Maliketh.",                      check: s => (s.bossKills["Maliketh, die Schwarze Klinge"] || 0) >= 1 },
    { id: "elden_lord", name: "Elden Lord",             icon: "👑", desc: "Schließe einen Run ab und werde Elden Lord.", check: s => s.gamesCompleted >= 1 },
    { id: "first_death",name: "Du bist gestorben",      icon: "💀", desc: "Stirb zum ersten Mal.",                  check: s => s.deaths >= 1 },
    { id: "death_50",   name: "Hartnäckig",             icon: "⚰️", desc: "Stirb 50 Mal und gib nicht auf.",        check: s => s.deaths >= 50 },
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

  /* ====== 4) STATISTIK-MUTATIONEN (vom Spiel aufgerufen) ====== */
  function bump(key, n) { var s = getStats(); s[key] = (s[key] || 0) + (n || 1); saveStats(s); checkAchievements(); }
  function setMax(key, val) { var s = getStats(); if (val > (s[key] || 0)) { s[key] = val; saveStats(s); checkAchievements(); } }

  function runBump(key, n) { var r = getRun(); r[key] = (r[key] || 0) + (n || 1); saveRun(r); }

  /* ====== 5) ÖFFENTLICHE API (window.ER) ====== */
  const ER = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    isOnline: function () { return ONLINE; },

    /* --- Run-Lebenszyklus --- */
    startRun: function () { saveRun({ stage: 1, bosses: 0, fights: 0 }); bump("runsStarted"); setMax("furthestStage", 1); },
    endRun: function () {
      var r = getRun();
      var score = (r.stage || 0) * 1000 + (r.bosses || 0) * 200 + (r.fights || 0) * 10;
      setMax("bestScore", score);
      setMax("bestRunBosses", r.bosses || 0);
      submitToBoard(score, { stage: r.stage || 0, bosses: r.bosses || 0, fights: r.fights || 0 });
      saveRun({ stage: 0, bosses: 0, fights: 0 });
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

    /* --- Bestenliste --- */
    getLeaderboard: function (limit, cb) {
      limit = limit || 20;
      if (ONLINE && fbDB) {
        fbDB.collection("users").orderBy("bestScore", "desc").limit(limit).get()
          .then(function (snap) {
            var rows = [];
            snap.forEach(function (d) { var x = d.data(); rows.push({ name: x.displayName || "Befleckter", score: x.bestScore || 0, stage: x.furthestStage || 0, bosses: x.bestRunBosses || 0, photo: x.photoURL || "" }); });
            cb(rows, true);
          })
          .catch(function (e) { console.warn("[ER] Bestenliste online fehlgeschlagen, lokal:", e); cb(localBoard(limit), false); });
      } else {
        cb(localBoard(limit), false);
      }
    }
  };

  /* ====== 6) LOKALE BESTENLISTE ====== */
  function localBoard(limit) {
    var b = lsGet(BOARD_KEY, []);
    b.sort(function (a, c) { return c.score - a.score; });
    return b.slice(0, limit);
  }
  function submitToBoard(score, meta) {
    if (score <= 0) return;
    var name = ER.getPlayerName();
    // lokal
    var b = lsGet(BOARD_KEY, []);
    var mine = b.find(function (x) { return x.name === name && x.local; });
    if (mine) { if (score > mine.score) { mine.score = score; mine.stage = meta.stage; mine.bosses = meta.bosses; } }
    else { b.push({ name: name, score: score, stage: meta.stage, bosses: meta.bosses, local: true }); }
    lsSet(BOARD_KEY, b);
    // cloud
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
        // Merge: pro Zahl das Maximum, Achievements vereinen
        var merged = Object.assign({}, DEFAULT_STATS, local);
        Object.keys(DEFAULT_STATS).forEach(function (k) {
          if (k === "bossKills") {
            merged.bossKills = Object.assign({}, cs.bossKills || {}, local.bossKills || {});
            Object.keys(cs.bossKills || {}).forEach(function (bk) { merged.bossKills[bk] = Math.max(cs.bossKills[bk] || 0, (local.bossKills || {})[bk] || 0); });
          } else {
            merged[k] = Math.max(local[k] || 0, cs[k] || 0);
          }
        });
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
