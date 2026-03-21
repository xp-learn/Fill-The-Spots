// ============================================================
// FILL THE BOARD — Trace one path to fill every cell
// ============================================================

(function () {
    "use strict";

    // ── YouTube Playables SDK ─────────────────────────────────
    const hasYTSDK = (typeof ytgame !== 'undefined') &&
        (typeof ytgame?.game?.firstFrameReady === 'function') &&
        (ytgame.IN_PLAYABLES_ENV === true || window.self !== window.top || location.hostname.includes('youtube') || location.hostname.includes('usercontent.goog'));

    let cloudLoadDone = !hasYTSDK;
    let audioMuted = false;

    // Interstitial ads
    let lastAdTime = Date.now();
    const AD_COOLDOWN_MS = 180000;

    function tryShowInterstitial() {
        if (!hasYTSDK) return;
        const now = Date.now();
        if (now - lastAdTime < AD_COOLDOWN_MS) return;
        try {
            ytgame.ads.requestInterstitialAd();
            lastAdTime = now;
        } catch (_) {}
    }

    // Cloud save/load
    function loadLocalSave() {
        try {
            const json = localStorage.getItem("flowfree_save");
            if (json) return JSON.parse(json);
        } catch (_) {}
        return null;
    }

    async function loadCloudSave() {
        if (!hasYTSDK) return loadLocalSave();
        try {
            const loadPromise = ytgame.game.loadData();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('loadData timeout')), 4000)
            );
            const data = await Promise.race([loadPromise, timeoutPromise]);
            if (data && data !== '') {
                try {
                    const cloudData = JSON.parse(data);
                    cloudLoadDone = true;
                    return cloudData;
                } catch (_) {}
            }
            cloudLoadDone = true;
            return loadLocalSave();
        } catch (e) {
            cloudLoadDone = true;
            try { ytgame.health.logError('loadData failed: ' + String(e)); } catch (_) {}
            return loadLocalSave();
        }
    }

    function getSaveObj() {
        return {
            saveVersion: 2,
            coins, totalLevelsCompleted, totalFlowsCompleted, threeStarCount,
            packsCompleted, randomPuzzlesCompleted, packsAllStars, bigGridCleared, totalCoinsSpent,
            collectedObjectives, ownedThemes, activeTheme, lightMode,
            completedLevels, unlockedPacks,
        };
    }

    function saveToCloud() {
        const json = JSON.stringify(getSaveObj());
        // Always save to localStorage as fallback
        try { localStorage.setItem("flowfree_save", json); } catch (_) {}
        if (!hasYTSDK || !cloudLoadDone) return;
        try {
            const p = ytgame.game.saveData(json);
            if (p && typeof p.then === 'function') {
                p.then(() => {}, (e) => {
                    try { ytgame.health.logError('saveData failed: ' + String(e)); } catch (_) {}
                });
            }
        } catch (_) {}
    }

    function applyCloudData(data) {
        if (!data) return;
        if (data.coins !== undefined) coins = data.coins;
        if (data.totalLevelsCompleted !== undefined) totalLevelsCompleted = data.totalLevelsCompleted;
        if (data.totalFlowsCompleted !== undefined) totalFlowsCompleted = data.totalFlowsCompleted;
        if (data.threeStarCount !== undefined) threeStarCount = data.threeStarCount;
        if (data.packsCompleted !== undefined) packsCompleted = data.packsCompleted;
        if (data.randomPuzzlesCompleted !== undefined) randomPuzzlesCompleted = data.randomPuzzlesCompleted;
        if (data.packsAllStars !== undefined) packsAllStars = data.packsAllStars;
        if (data.bigGridCleared !== undefined) bigGridCleared = data.bigGridCleared;
        if (data.totalCoinsSpent !== undefined) totalCoinsSpent = data.totalCoinsSpent;
        if (data.collectedObjectives !== undefined) collectedObjectives = data.collectedObjectives;
        if (data.ownedThemes !== undefined) ownedThemes = data.ownedThemes;
        if (data.activeTheme !== undefined) activeTheme = data.activeTheme;
        if (data.lightMode !== undefined) lightMode = data.lightMode;
        if (data.unlockedPacks !== undefined) unlockedPacks = data.unlockedPacks;
        // Old save format: clear level progress (levels are generated differently now)
        if (!data.saveVersion || data.saveVersion < 2) {
            completedLevels = {};
        } else {
            if (data.completedLevels !== undefined) completedLevels = data.completedLevels;
        }
    }

    function sendScoreToSDK(score) {
        if (!hasYTSDK) return;
        try {
            ytgame.engagement.sendScore({ value: score });
        } catch (_) {}
    }

    // ── Canvas & context ──────────────────────────────────────
    const canvas = document.getElementById("game-canvas");
    const ctx = canvas.getContext("2d");
    let W, H;

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // state may not be initialized yet on first call
        try {
            if (state === "playing" || state === "levelComplete") {
                calculateGridLayout();
            }
        } catch (_) {}
    }
    window.addEventListener("resize", resize);
    resize();

    // ── Theme palettes ─────────────────────────────────────────
    // Themes can use either:
    //   hueStart/hueRange/sat/lit — HSL sweep
    //   colors: [[h,s,l], ...] — explicit color stops to lerp between
    const THEMES = [
        // Free
        { id: "rainbow",    name: "Rainbow",    price: 0,   colors: [[0,75,58],[60,80,55],[120,65,48],[195,75,52],[270,70,58],[330,75,58]] },
        // Cheap (50-75)
        { id: "sunset",     name: "Sunset",     price: 50,  colors: [[55,85,60],[35,90,55],[15,85,55],[350,80,50],[330,70,45]] },
        { id: "ocean",      name: "Ocean",      price: 50,  colors: [[195,80,65],[210,75,55],[225,70,48],[200,60,40],[185,65,55]] },
        { id: "fire-ice",   name: "Fire & Ice", price: 75,  colors: [[0,85,55],[20,90,50],[45,85,55],[190,70,55],[210,80,55],[240,70,50]] },
        { id: "bw",         name: "B & W",      price: 75,  colors: [[0,0,90],[0,0,72],[0,0,55],[0,0,38],[0,0,22]] },
        { id: "forest",     name: "Forest",     price: 75,  colors: [[80,50,55],[100,55,45],[130,60,40],[155,50,38],[120,45,50]] },
        { id: "candy",      name: "Candy",      price: 50,  colors: [[330,70,70],[290,65,62],[260,60,58],[320,75,65],[350,80,68]] },
        { id: "retro",      name: "Retro",      price: 75,  colors: [[45,80,55],[15,75,50],[165,60,45],[195,70,50],[340,65,55]] },
        // Mid (100-150)
        { id: "neon",       name: "Neon",        price: 100, colors: [[320,100,55],[280,95,52],[180,100,48],[120,95,50],[60,100,52],[0,100,55]] },
        { id: "pastel",     name: "Pastel",      price: 100, colors: [[350,55,78],[30,50,78],[170,45,78],[220,50,78],[280,45,78]] },
        { id: "tropical",   name: "Tropical",    price: 100, colors: [[50,85,55],[80,70,50],[150,65,48],[180,70,50],[35,80,55]] },
        { id: "synthwave",  name: "Synthwave",   price: 125, colors: [[300,80,55],[320,85,50],[280,75,48],[190,90,52],[175,85,55]] },
        { id: "bubblegum",  name: "Bubblegum",   price: 100, colors: [[340,65,72],[320,60,68],[300,55,65],[330,70,70],[350,75,72]] },
        { id: "earth",      name: "Earth",       price: 125, colors: [[25,55,40],[40,50,45],[75,40,42],[150,35,40],[30,45,38]] },
        { id: "rasta",      name: "Rasta",       price: 125, colors: [[0,75,45],[30,80,50],[55,85,50],[120,65,42],[0,70,40]] },
        { id: "monochrome", name: "Mono",         price: 150, colors: [[220,8,78],[220,8,62],[220,8,48],[220,8,35],[220,8,22]] },
        { id: "coral",      name: "Coral Reef",   price: 100, colors: [[5,70,65],[20,75,60],[175,60,55],[190,65,50],[165,55,58]] },
        { id: "berry",      name: "Berry Mix",    price: 125, colors: [[340,65,42],[310,60,45],[280,55,48],[330,70,50],[350,75,55]] },
        { id: "lime",       name: "Lime Soda",    price: 100, colors: [[90,75,55],[110,70,48],[80,80,52],[60,85,55],[100,65,50]] },
        { id: "steel",      name: "Steel",        price: 150, colors: [[210,20,65],[215,18,55],[220,15,45],[210,12,38],[205,18,58]] },
        { id: "rose",       name: "Rose Gold",    price: 125, colors: [[350,50,72],[15,45,68],[30,55,62],[5,40,58],[345,48,65]] },
        // Upper-mid (175-250)
        { id: "midnight",   name: "Midnight",     price: 175, colors: [[230,60,32],[250,55,35],[270,50,38],[220,65,30],[240,58,28]] },
        { id: "unicorn",    name: "Unicorn",      price: 175, colors: [[330,65,72],[280,60,68],[220,55,65],[180,60,68],[300,55,72]] },
        { id: "gold",       name: "Gold Rush",    price: 200, colors: [[45,80,55],[35,85,48],[25,75,42],[40,90,58],[50,70,52]] },
        { id: "autumn",     name: "Autumn",       price: 200, colors: [[15,70,48],[30,75,45],[50,65,42],[20,60,40],[5,65,45]] },
        { id: "galaxy",     name: "Galaxy",       price: 250, colors: [[260,65,38],[280,60,42],[300,55,48],[250,70,35],[270,65,32]] },
        { id: "cyber",      name: "Cyberpunk",    price: 250, colors: [[180,90,50],[300,85,48],[60,95,52],[190,80,45],[320,80,52]] },
        { id: "ember",      name: "Ember",        price: 175, colors: [[5,85,42],[15,90,38],[25,80,35],[0,75,45],[10,85,40]] },
        { id: "frost",      name: "Frost",        price: 200, colors: [[195,40,80],[200,45,75],[210,38,78],[190,35,82],[205,42,72]] },
        { id: "cotton",     name: "Cotton Candy",  price: 200, colors: [[340,60,75],[200,55,72],[330,55,78],[210,50,75],[350,60,72]] },
        { id: "jungle",     name: "Jungle",       price: 225, colors: [[100,60,40],[120,55,38],[90,50,42],[140,65,35],[110,55,38]] },
        { id: "matrix",     name: "Matrix",       price: 225, colors: [[120,100,20],[120,90,30],[120,80,42],[120,95,35],[120,85,25]] },
        { id: "dusk",       name: "Dusk",         price: 250, colors: [[270,50,42],[290,45,45],[310,40,48],[260,55,38],[280,48,40]] },
        // Expensive (300-500)
        { id: "royal",      name: "Royal",         price: 300, colors: [[260,70,42],[275,65,45],[245,75,38],[280,60,48],[255,70,40]] },
        { id: "diamond",    name: "Diamond",       price: 350, colors: [[190,30,82],[200,35,78],[210,25,85],[180,28,80],[195,32,76]] },
        { id: "inferno",    name: "Inferno",       price: 400, colors: [[0,95,45],[15,100,42],[30,90,48],[45,85,52],[60,80,55]] },
        { id: "aurora",     name: "Aurora",        price: 500, colors: [[120,70,52],[160,65,48],[200,75,55],[260,60,50],[300,65,55],[80,70,48]] },
        { id: "pop-art",    name: "Pop Art",       price: 300, colors: [[0,85,50],[55,90,52],[240,80,50],[120,75,45],[300,80,52]] },
        { id: "sapphire",   name: "Sapphire",      price: 350, colors: [[215,75,48],[225,70,45],[230,80,42],[210,65,50],[220,75,38]] },
        { id: "blossom",    name: "Blossom",       price: 300, colors: [[340,55,75],[350,50,72],[0,45,70],[330,55,68],[345,50,72]] },
        { id: "thunder",    name: "Thunder",       price: 400, colors: [[240,80,35],[250,75,38],[55,90,55],[245,80,32],[260,75,38]] },
        { id: "jade",       name: "Jade",          price: 350, colors: [[150,60,42],[160,55,45],[155,65,38],[145,50,48],[165,55,42]] },
        { id: "vintage",    name: "Vintage",       price: 300, colors: [[25,40,55],[40,35,52],[15,45,48],[50,38,55],[30,42,50]] },
        // Premium (600-1000)
        { id: "spectrum",   name: "Spectrum",      price: 600, colors: [[0,80,55],[60,85,52],[120,75,48],[180,80,50],[240,75,55],[300,80,55]] },
        { id: "eclipse",    name: "Eclipse",       price: 600, colors: [[260,75,30],[280,70,32],[300,65,35],[320,70,38],[340,75,35]] },
        { id: "prism",      name: "Prism",         price: 750, colors: [[0,70,65],[72,75,60],[144,65,55],[216,70,60],[288,65,65]] },
        { id: "nebula",     name: "Nebula",        price: 750, colors: [[270,70,45],[290,65,48],[310,60,52],[250,75,42],[280,68,40]] },
        { id: "opal",       name: "Opal",          price: 800, colors: [[180,45,78],[210,50,72],[240,45,75],[300,40,78],[340,42,75],[30,48,78]] },
        { id: "phoenix",    name: "Phoenix",       price: 900, colors: [[0,95,55],[20,100,50],[45,95,55],[30,90,48],[10,100,52]] },
        { id: "obsidian",   name: "Obsidian",      price: 1000,colors: [[0,0,18],[270,15,22],[0,0,28],[210,12,25],[0,0,15]] },
    ];

    // ── Objectives ──────────────────────────────────────────────
    const OBJECTIVES = [
        // ── Levels completed (every completion counts) ──
        { id: "levels_1",       stat: "totalLevelsCompleted",   target: 1,      reward: 5,    desc: "Complete your first level" },
        { id: "levels_3",       stat: "totalLevelsCompleted",   target: 3,      reward: 5,    desc: "Complete 3 levels" },
        { id: "levels_5",       stat: "totalLevelsCompleted",   target: 5,      reward: 10,   desc: "Complete 5 levels" },
        { id: "levels_10",      stat: "totalLevelsCompleted",   target: 10,     reward: 20,   desc: "Complete 10 levels" },
        { id: "levels_25",      stat: "totalLevelsCompleted",   target: 25,     reward: 30,   desc: "Complete 25 levels" },
        { id: "levels_50",      stat: "totalLevelsCompleted",   target: 50,     reward: 50,   desc: "Complete 50 levels" },
        { id: "levels_100",     stat: "totalLevelsCompleted",   target: 100,    reward: 100,  desc: "Complete 100 levels" },
        { id: "levels_250",     stat: "totalLevelsCompleted",   target: 250,    reward: 200,  desc: "Complete 250 levels" },
        { id: "levels_500",     stat: "totalLevelsCompleted",   target: 500,    reward: 400,  desc: "Complete 500 levels" },
        { id: "levels_750",     stat: "totalLevelsCompleted",   target: 750,    reward: 500,  desc: "Complete 750 levels" },
        { id: "levels_1000",    stat: "totalLevelsCompleted",   target: 1000,   reward: 750,  desc: "Complete 1,000 levels" },
        { id: "levels_2000",    stat: "totalLevelsCompleted",   target: 2000,   reward: 1000, desc: "Complete 2,000 levels" },
        { id: "levels_5000",    stat: "totalLevelsCompleted",   target: 5000,   reward: 2000, desc: "Complete 5,000 levels" },
        { id: "levels_10000",   stat: "totalLevelsCompleted",   target: 10000,  reward: 5000, desc: "Complete 10,000 levels" },

        // ── Boards filled ──
        { id: "flows_5",        stat: "totalFlowsCompleted",    target: 5,      reward: 5,    desc: "Fill 5 boards" },
        { id: "flows_10",       stat: "totalFlowsCompleted",    target: 10,     reward: 5,    desc: "Fill 10 boards" },
        { id: "flows_25",       stat: "totalFlowsCompleted",    target: 25,     reward: 10,   desc: "Fill 25 boards" },
        { id: "flows_50",       stat: "totalFlowsCompleted",    target: 50,     reward: 15,   desc: "Fill 50 boards" },
        { id: "flows_100",      stat: "totalFlowsCompleted",    target: 100,    reward: 25,   desc: "Fill 100 boards" },
        { id: "flows_250",      stat: "totalFlowsCompleted",    target: 250,    reward: 50,   desc: "Fill 250 boards" },
        { id: "flows_500",      stat: "totalFlowsCompleted",    target: 500,    reward: 100,  desc: "Fill 500 boards" },
        { id: "flows_1000",     stat: "totalFlowsCompleted",    target: 1000,   reward: 200,  desc: "Fill 1,000 boards" },
        { id: "flows_2500",     stat: "totalFlowsCompleted",    target: 2500,   reward: 400,  desc: "Fill 2,500 boards" },
        { id: "flows_5000",     stat: "totalFlowsCompleted",    target: 5000,   reward: 750,  desc: "Fill 5,000 boards" },
        { id: "flows_10000",    stat: "totalFlowsCompleted",    target: 10000,  reward: 1500, desc: "Fill 10,000 boards" },
        { id: "flows_25000",    stat: "totalFlowsCompleted",    target: 25000,  reward: 3000, desc: "Fill 25,000 boards" },
        { id: "flows_50000",    stat: "totalFlowsCompleted",    target: 50000,  reward: 5000, desc: "Fill 50,000 boards" },

        // ── Perfect levels (board fully filled) ──
        { id: "stars_1",        stat: "threeStarCount",         target: 1,      reward: 10,   desc: "Perfect your first level" },
        { id: "stars_5",        stat: "threeStarCount",         target: 5,      reward: 20,   desc: "Perfect 5 levels" },
        { id: "stars_10",       stat: "threeStarCount",         target: 10,     reward: 40,   desc: "Perfect 10 levels" },
        { id: "stars_25",       stat: "threeStarCount",         target: 25,     reward: 100,  desc: "Perfect 25 levels" },
        { id: "stars_50",       stat: "threeStarCount",         target: 50,     reward: 200,  desc: "Perfect 50 levels" },
        { id: "stars_100",      stat: "threeStarCount",         target: 100,    reward: 400,  desc: "Perfect 100 levels" },
        { id: "stars_200",      stat: "threeStarCount",         target: 200,    reward: 600,  desc: "Perfect 200 levels" },
        { id: "stars_300",      stat: "threeStarCount",         target: 300,    reward: 800,  desc: "Perfect 300 levels" },
        { id: "stars_500",      stat: "threeStarCount",         target: 500,    reward: 1500, desc: "Perfect 500 levels" },

        // ── Level packs ──
        { id: "pack_1",         stat: "packsCompleted",         target: 1,      reward: 50,   desc: "Complete a level pack" },
        { id: "pack_2",         stat: "packsCompleted",         target: 2,      reward: 100,  desc: "Complete 2 level packs" },
        { id: "pack_3",         stat: "packsCompleted",         target: 3,      reward: 150,  desc: "Complete 3 level packs" },
        { id: "pack_4",         stat: "packsCompleted",         target: 4,      reward: 250,  desc: "Complete 4 level packs" },
        { id: "pack_5",         stat: "packsCompleted",         target: 5,      reward: 500,  desc: "Complete all 5 level packs" },

        // ── Perfect packs (all levels perfected in a pack) ──
        { id: "pack_all_stars",   stat: "packsAllStars",        target: 1,      reward: 250,  desc: "Perfect every level in a pack" },
        { id: "pack_all_stars_2", stat: "packsAllStars",        target: 2,      reward: 500,  desc: "Perfect 2 full packs" },
        { id: "pack_all_stars_3", stat: "packsAllStars",        target: 3,      reward: 750,  desc: "Perfect 3 full packs" },
        { id: "pack_all_stars_5", stat: "packsAllStars",        target: 5,      reward: 2000, desc: "Perfect all 5 packs" },

        // ── Random puzzles ──
        { id: "random_1",       stat: "randomPuzzlesCompleted", target: 1,      reward: 5,    desc: "Complete a random puzzle" },
        { id: "random_5",       stat: "randomPuzzlesCompleted", target: 5,      reward: 15,   desc: "Complete 5 random puzzles" },
        { id: "random_10",      stat: "randomPuzzlesCompleted", target: 10,     reward: 30,   desc: "Complete 10 random puzzles" },
        { id: "random_25",      stat: "randomPuzzlesCompleted", target: 25,     reward: 60,   desc: "Complete 25 random puzzles" },
        { id: "random_50",      stat: "randomPuzzlesCompleted", target: 50,     reward: 100,  desc: "Complete 50 random puzzles" },
        { id: "random_100",     stat: "randomPuzzlesCompleted", target: 100,    reward: 200,  desc: "Complete 100 random puzzles" },
        { id: "random_250",     stat: "randomPuzzlesCompleted", target: 250,    reward: 500,  desc: "Complete 250 random puzzles" },
        { id: "random_500",     stat: "randomPuzzlesCompleted", target: 500,    reward: 1000, desc: "Complete 500 random puzzles" },

        // ── 9x9 big grid ──
        { id: "big_grid",       stat: "bigGridCleared",         target: 1,      reward: 40,   desc: "Complete a 9x9 level" },
        { id: "big_grid_10",    stat: "bigGridCleared",         target: 10,     reward: 150,  desc: "Complete 10 levels of 9x9" },
        { id: "big_grid_25",    stat: "bigGridCleared",         target: 25,     reward: 300,  desc: "Complete 25 levels of 9x9" },
        { id: "big_grid_50",    stat: "bigGridCleared",         target: 50,     reward: 500,  desc: "Complete 50 levels of 9x9" },
        { id: "big_grid_100",   stat: "bigGridCleared",         target: 100,    reward: 1000, desc: "Complete 100 levels of 9x9" },

        // ── Coin spending ──
        { id: "coins_100",      stat: "totalCoinsSpent",        target: 100,    reward: 25,   desc: "Spend 100 coins" },
        { id: "coins_500",      stat: "totalCoinsSpent",        target: 500,    reward: 75,   desc: "Spend 500 coins" },
        { id: "coins_1000",     stat: "totalCoinsSpent",        target: 1000,   reward: 150,  desc: "Spend 1,000 coins" },
        { id: "coins_5000",     stat: "totalCoinsSpent",        target: 5000,   reward: 500,  desc: "Spend 5,000 coins" },

        // ── Theme collection ──
        { id: "themes_3",       stat: "themesOwned",            target: 3,      reward: 30,   desc: "Own 3 themes" },
        { id: "themes_5",       stat: "themesOwned",            target: 5,      reward: 50,   desc: "Own 5 themes" },
        { id: "themes_10",      stat: "themesOwned",            target: 10,     reward: 100,  desc: "Own 10 themes" },
        { id: "themes_20",      stat: "themesOwned",            target: 20,     reward: 250,  desc: "Own 20 themes" },
        { id: "themes_30",      stat: "themesOwned",            target: 30,     reward: 500,  desc: "Own 30 themes" },
        { id: "themes_all",     stat: "themesOwned",            target: 51,     reward: 2000, desc: "Own every theme" },
    ];

    // ── Player state ────────────────────────────────────────────
    let activeTheme = "rainbow";
    let ownedThemes = ["rainbow"];
    let coins = 0;
    let totalLevelsCompleted = 0;
    let totalFlowsCompleted = 0;
    let threeStarCount = 0;
    let packsCompleted = 0;
    let randomPuzzlesCompleted = 0;
    let packsAllStars = 0;
    let bigGridCleared = 0;
    let totalCoinsSpent = 0;
    let collectedObjectives = [];
    let completedLevels = {};   // { "pack0_lvl3": { stars, moves } }
    let unlockedPacks = [0, 1, 2, 3, 4];
    let lightMode = false;

    function saveCoins() { saveToCloud(); }
    function saveCollected() { saveToCloud(); }
    function saveOwnedThemes() { saveToCloud(); }
    function saveActiveTheme() { saveToCloud(); }

    function getStatValue(statKey) {
        switch (statKey) {
            case "totalLevelsCompleted": return totalLevelsCompleted;
            case "totalFlowsCompleted": return totalFlowsCompleted;
            case "threeStarCount": return threeStarCount;
            case "packsCompleted": return packsCompleted;
            case "randomPuzzlesCompleted": return randomPuzzlesCompleted;
            case "packsAllStars": return packsAllStars;
            case "bigGridCleared": return bigGridCleared;
            case "totalCoinsSpent": return totalCoinsSpent;
            case "themesOwned": return ownedThemes.length;
            default: return 0;
        }
    }

    function getActiveThemeObj() {
        return THEMES.find(t => t.id === activeTheme) || THEMES[0];
    }

    // ── Flow colors (distinct, high-contrast set) ─────────────
    // Fixed base hues for maximum distinguishability
    const FLOW_BASE_HUES = [0, 120, 240, 30, 180, 300, 60, 200, 330];

    function getFlowHSL(colorIndex) {
        const t = getActiveThemeObj();
        const baseHue = FLOW_BASE_HUES[colorIndex % FLOW_BASE_HUES.length];
        const themeHue = t.colors ? t.colors[0][0] : (t.hueStart || 0);
        const themeSat = t.colors ? t.colors[0][1] : (t.sat || 65);
        const hue = (baseHue + themeHue) % 360;
        const sat = Math.max(themeSat, 65);
        const lit = lightMode ? 52 : 58;
        return { h: hue, s: sat, l: lit };
    }
    function getFlowColor(colorIndex) {
        const c = getFlowHSL(colorIndex);
        return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
    }
    function getFlowShadow(colorIndex) {
        const c = getFlowHSL(colorIndex);
        return `hsl(${c.h}, ${c.s}%, ${Math.max(c.l - 18, 15)}%)`;
    }
    function getFlowHighlight(colorIndex) {
        const c = getFlowHSL(colorIndex);
        return `hsl(${c.h}, ${Math.max(c.s - 10, 30)}%, ${Math.min(c.l + 18, 85)}%)`;
    }

    // Interpolate between theme color stops
    function lerpThemeHSL(progress, litOffset) {
        const t = getActiveThemeObj();
        const p = Math.max(0, Math.min(1, progress));
        if (t.colors) {
            const stops = t.colors;
            const pos = p * (stops.length - 1);
            const i = Math.min(Math.floor(pos), stops.length - 2);
            const frac = pos - i;
            const a = stops[i], b = stops[i + 1];
            const h = a[0] + (b[0] - a[0]) * frac;
            const s = a[1] + (b[1] - a[1]) * frac;
            const l = a[2] + (b[2] - a[2]) * frac + litOffset;
            return [h, s, l];
        }
        // Fallback for legacy hueStart/hueRange themes
        const hue = (t.hueStart + t.hueRange * p) % 360;
        const sat = Math.max(t.sat, 65);
        const lit = (lightMode ? 52 : 58) + litOffset;
        return [hue, sat, lit];
    }

    function getPathColorAt(progress) {
        const [h, s, l] = lerpThemeHSL(progress, lightMode ? -4 : 0);
        return `hsl(${h}, ${s}%, ${l}%)`;
    }
    function getPathGlowAt(progress) {
        const [h, s, l] = lerpThemeHSL(progress, 12);
        return `hsl(${h}, ${Math.min(s + 5, 100)}%, ${l}%)`;
    }
    function getPathShadowAt(progress) {
        const [h, s, l] = lerpThemeHSL(progress, -20);
        return `hsl(${h}, ${s}%, ${l}%)`;
    }
    // Convenience: color at start of theme
    function getPathColor() { return getPathColorAt(0); }

    // ── Audio system (synthesized) ────────────────────────────
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function ensureAudio() {
        if (!audioCtx) {
            audioCtx = new AudioCtx();
        }
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }
    }

    function playTone(freq, duration, type = "sine", volume = 0.15) {
        if (!audioCtx || audioMuted) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    // Flow-specific sounds
    function playFlowDraw(pathLength) {
        ensureAudio();
        const semitones = [0, 2, 4, 7, 9, 12];
        const idx = pathLength % semitones.length;
        const freq = 330 * Math.pow(2, semitones[idx] / 12);
        playTone(freq, 0.08, "sine", 0.05);
    }

    function playFlowConnect() {
        ensureAudio();
        playTone(523, 0.1, "sine", 0.1);
        setTimeout(() => playTone(784, 0.15, "sine", 0.08), 50);
        setTimeout(() => playTone(1047, 0.2, "sine", 0.06), 100);
    }

    function playFlowBreak() {
        ensureAudio();
        playTone(300, 0.1, "triangle", 0.05);
        setTimeout(() => playTone(200, 0.12, "triangle", 0.03), 60);
    }

    function playLevelComplete() {
        ensureAudio();
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((n, i) => {
            setTimeout(() => playTone(n, 0.3, "sine", 0.08 - i * 0.01), i * 80);
        });
    }

    // UI sounds
    function playButtonPress() {
        ensureAudio();
        playTone(600, 0.08, "sine", 0.08);
        playTone(800, 0.06, "sine", 0.04);
    }

    function playCollect() {
        ensureAudio();
        playTone(523, 0.15, "sine", 0.1);
        setTimeout(() => playTone(659, 0.12, "sine", 0.08), 70);
        setTimeout(() => playTone(784, 0.2, "sine", 0.07), 140);
    }

    function playCollectAll() {
        ensureAudio();
        playTone(523, 0.12, "sine", 0.1);
        setTimeout(() => playTone(659, 0.12, "sine", 0.09), 60);
        setTimeout(() => playTone(784, 0.12, "sine", 0.08), 120);
        setTimeout(() => playTone(1047, 0.3, "sine", 0.07), 180);
    }

    function playMenuTap() {
        ensureAudio();
        playTone(440, 0.1, "triangle", 0.08);
        setTimeout(() => playTone(660, 0.08, "triangle", 0.05), 50);
    }

    function playOpenOverlay() {
        ensureAudio();
        playTone(400, 0.1, "sine", 0.06);
        setTimeout(() => playTone(600, 0.12, "sine", 0.05), 60);
    }

    function playCloseOverlay() {
        ensureAudio();
        playTone(500, 0.1, "sine", 0.06);
        setTimeout(() => playTone(350, 0.1, "sine", 0.04), 60);
    }

    function playBuy() {
        ensureAudio();
        playTone(350, 0.1, "sine", 0.08);
        setTimeout(() => playTone(440, 0.08, "sine", 0.07), 60);
        setTimeout(() => playTone(523, 0.12, "sine", 0.06), 120);
        setTimeout(() => playTone(700, 0.2, "sine", 0.05), 180);
    }

    function playEquip() {
        ensureAudio();
        playTone(500, 0.08, "sine", 0.07);
        setTimeout(() => playTone(700, 0.12, "sine", 0.06), 70);
    }

    function playNewBest() {
        ensureAudio();
        const notes = [523, 659, 784, 1047];
        notes.forEach((n, i) => {
            setTimeout(() => playTone(n, 0.25 - i * 0.04, "sine", 0.08 - i * 0.01), i * 100);
        });
    }

    function playThemeToggle() {
        ensureAudio();
        playTone(440, 0.06, "triangle", 0.06);
        setTimeout(() => playTone(550, 0.08, "triangle", 0.05), 50);
    }

    // ── Seeded PRNG (deterministic levels) ─────────────────────
    function seededRNG(seed) {
        let s = seed | 0;
        return function() {
            s = (s * 1664525 + 1013904223) | 0;
            return (s >>> 0) / 0x100000000;
        };
    }

    // ── Level Pack definitions (levels generated on demand) ─────
    const LEVEL_PACKS = [
        { name: "Starter",  gridSize: 5, count: 100, baseSeed: 1000, minCells: 10, maxCells: 16 },
        { name: "Classic",  gridSize: 6, count: 100, baseSeed: 2000, minCells: 16, maxCells: 25 },
        { name: "Advanced", gridSize: 7, count: 100, baseSeed: 96800, minCells: 20, maxCells: 35 },
        { name: "Expert",   gridSize: 8, count: 100, baseSeed: 88908, minCells: 30, maxCells: 50 },
        { name: "Master",   gridSize: 9, count: 100, baseSeed: 42800, minCells: 40, maxCells: 65 },
    ];

    const generatedLevelCache = {};

    function generateSeededLevel(pack, seed) {
        const key = `${pack.gridSize}_${seed}`;
        if (generatedLevelCache[key]) return generatedLevelCache[key];

        for (let attempt = 0; attempt < 10; attempt++) {
            const rng = seededRNG(seed + attempt * 97);
            const result = generateBoardShape(pack.gridSize, pack.minCells, pack.maxCells, rng);
            if (result && result.totalCells >= pack.minCells) {
                generatedLevelCache[key] = result;
                return result;
            }
        }
        return fullGridFallback(pack.gridSize);
    }

    // Random walk to create an irregular board shape.
    // The walk itself IS a valid solution → guaranteed solvable.
    function generateBoardShape(gridSize, minCells, maxCells, rng) {
        const targetCells = minCells + Math.floor(rng() * (maxCells - minCells + 1));
        const visited = new Set();
        const path = [];
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

        const sr = Math.floor(rng() * gridSize);
        const sc = Math.floor(rng() * gridSize);
        path.push({ r: sr, c: sc });
        visited.add(`${sr}_${sc}`);

        while (path.length < targetCells) {
            const cur = path[path.length - 1];
            const nbrs = [];
            for (const [dr, dc] of dirs) {
                const nr = cur.r + dr, nc = cur.c + dc;
                if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize && !visited.has(`${nr}_${nc}`)) {
                    let onward = 0;
                    for (const [dr2, dc2] of dirs) {
                        const r2 = nr + dr2, c2 = nc + dc2;
                        if (r2 >= 0 && r2 < gridSize && c2 >= 0 && c2 < gridSize && !visited.has(`${r2}_${c2}`)) onward++;
                    }
                    nbrs.push({ r: nr, c: nc, onward });
                }
            }
            if (nbrs.length === 0) break;

            nbrs.sort((a, b) => a.onward - b.onward);
            const next = (nbrs.length > 1 && rng() < 0.3)
                ? nbrs[Math.floor(rng() * nbrs.length)]
                : nbrs[0];
            path.push({ r: next.r, c: next.c });
            visited.add(`${next.r}_${next.c}`);
        }

        return {
            shape: visited,
            start: path[0],
            gridSize: gridSize,
            totalCells: path.length
        };
    }

    // Fallback: full NxN grid
    function fullGridFallback(gridSize) {
        const shape = new Set();
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                shape.add(`${r}_${c}`);
            }
        }
        return {
            shape: shape,
            start: { r: 0, c: 0 },
            gridSize: gridSize,
            totalCells: gridSize * gridSize
        };
    }

    function getPackLevel(packIndex, levelIndex) {
        const pack = LEVEL_PACKS[packIndex];
        const seed = pack.baseSeed + levelIndex;
        return generateSeededLevel(pack, seed);
    }

    // ── Game state ────────────────────────────────────────────────
    let state = "start"; // start, levelSelect, playing, levelComplete, paused
    let stateBeforePause = null;

    // Grid
    let grid = [];          // grid[row][col] = { type: 'wall'|'empty'|'start'|'filled' }
    let gridSize = 5;
    let playerPath = [];    // [{r, c}, ...] single continuous path
    let boardShape = null;  // Set of "r_c" keys — active cells
    let startCell = null;   // {r, c}
    let totalActiveCells = 0;

    // Drawing state
    let drawing = false;

    // Level state
    let currentPackIndex = 0;
    let currentLevelIndex = 0;
    let isRandomPuzzle = false;
    let moveCount = 0;

    // Grid layout (calculated in resize)
    let cellSize = 0;
    let gridPixelSize = 0;
    let gridOriginX = 0;
    let gridOriginY = 0;

    // Level select layout
    let levelSelectScroll = 0;
    let levelSelectDragging = false;
    let levelSelectDragStartY = 0;
    let levelSelectDragStartScroll = 0;
    let selectedPackTab = 0;

    // Animations
    let completionAnim = 0;
    let cellFillFlash = 0;       // visual pulse on fill
    let dotAnims = {};           // { "r_c": { t: 0..1, color } } — pop + ripple per dot
    let levelCompleteFlash = 0;  // screen flash timer
    let dotPressScale = {};      // { "r_c": timeRemaining }

    // ── UI elements ──────────────────────────────────────────────
    const menuScreen = document.getElementById("menu-screen");
    const menuBestEl = document.getElementById("menu-best");
    const menuTapZone = document.getElementById("menu-tap-zone");
    const btnStore = document.getElementById("btn-store");
    const btnObjectives = document.getElementById("btn-objectives");
    const objectivesScreen = document.getElementById("objectives-screen");
    const objectivesClose = document.getElementById("objectives-close");
    const objectivesList = document.getElementById("objectives-list");
    const storeScreen = document.getElementById("store-screen");
    const storeClose = document.getElementById("store-close");
    const storeList = document.getElementById("store-list");
    const storeCoinsEl = document.getElementById("store-coins");
    const menuCoinsEl = document.getElementById("menu-coins");
    const gameOverScreen = document.getElementById("game-over-screen");
    const endScoreEl = document.getElementById("end-score");
    const endBestEl = document.getElementById("end-best");
    const newBestLabel = document.getElementById("new-best-label");
    const restartBtn = document.getElementById("restart-btn");
    const nextLevelBtn = document.getElementById("next-level-btn");

    const btnPlayLevel = document.getElementById("btn-play-level");

    const COIN_ICON = '<img src="Coin.png" class="coin-icon">';
    const COIN_ICON_LG = '<img src="Coin.png" class="coin-icon-lg">';
    const COIN_ICON_SM = '<img src="Coin.png" class="coin-icon-sm">';

    function updateCoinDisplay() {
        menuCoinsEl.innerHTML = coins > 0 ? `${COIN_ICON} ${coins}` : "";
        storeCoinsEl.innerHTML = `${COIN_ICON} ${coins}`;
    }

    function getNextUncompletedLevel() {
        for (let p = 0; p < LEVEL_PACKS.length; p++) {
            for (let l = 0; l < LEVEL_PACKS[p].count; l++) {
                if (!completedLevels[`pack${p}_lvl${l}`]) {
                    return { packIndex: p, levelIndex: l };
                }
            }
        }
        return { packIndex: 0, levelIndex: 0 };
    }

    function updateBestDisplay() {
        // Count only real level keys (exclude _packDone_ and _allStars_ flags)
        const total = Object.keys(completedLevels).filter(k => k.startsWith("pack") && k.includes("_lvl")).length;
        if (total > 0) {
            menuBestEl.textContent = `${total} LEVELS COMPLETED`;
        } else {
            menuBestEl.textContent = "";
        }
        updateCoinDisplay();
    }
    updateBestDisplay();

    // ── Grid layout ──────────────────────────────────────────────
    function calculateGridLayout() {
        const padding = 20;
        // Scale HUD height based on canvas size — smaller in landscape
        const hudHeight = Math.max(50, Math.min(80, H * 0.12));
        const bottomSpace = Math.max(10, H * 0.03);
        const availW = W - padding * 2;
        const availH = H - hudHeight - bottomSpace - padding * 2;
        cellSize = Math.floor(Math.min(availW, availH) / gridSize);
        gridPixelSize = cellSize * gridSize;
        gridOriginX = (W - gridPixelSize) / 2;
        gridOriginY = hudHeight + (availH - gridPixelSize) / 2;
    }

    // ── Grid helpers ─────────────────────────────────────────────
    function initGrid(size, shape) {
        gridSize = size;
        grid = [];
        for (let r = 0; r < size; r++) {
            grid[r] = [];
            for (let c = 0; c < size; c++) {
                if (shape.has(`${r}_${c}`)) {
                    grid[r][c] = { type: 'empty' };
                } else {
                    grid[r][c] = { type: 'wall' };
                }
            }
        }
    }

    function clearPath() {
        playerPath = [];
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (grid[r][c].type !== 'wall') {
                    grid[r][c] = { type: 'empty' };
                }
            }
        }
        if (startCell) {
            grid[startCell.r][startCell.c] = { type: 'start' };
        }
    }

    function loadLevel(packIndex, levelIndex) {
        const pack = LEVEL_PACKS[packIndex];
        const level = getPackLevel(packIndex, levelIndex);
        if (!level) return;
        boardShape = level.shape;
        startCell = level.start;
        totalActiveCells = level.totalCells;
        initGrid(pack.gridSize, boardShape);
        grid[startCell.r][startCell.c] = { type: 'start' };
        playerPath = [];
        moveCount = 0;
        drawing = false;
        completionAnim = 0;
        calculateGridLayout();
    }

    function screenToGrid(sx, sy) {
        const col = Math.floor((sx - gridOriginX) / cellSize);
        const row = Math.floor((sy - gridOriginY) / cellSize);
        if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return null;
        return { r: row, c: col };
    }

    // ── Path management ──────────────────────────────────────────
    function clearPlayerPath() {
        for (const cell of playerPath) {
            if (grid[cell.r][cell.c].type === 'filled') {
                grid[cell.r][cell.c] = { type: 'empty' };
            }
        }
        playerPath = [];
        dotAnims = {};
    }

    function truncatePathAt(r, c) {
        const idx = playerPath.findIndex(p => p.r === r && p.c === c);
        if (idx < 0) return;
        const removed = playerPath.splice(idx + 1);
        for (const cell of removed) {
            if (grid[cell.r][cell.c].type === 'filled') {
                grid[cell.r][cell.c] = { type: 'empty' };
            }
        }
    }

    function getFilledCount() {
        let filled = 0;
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                const t = grid[r][c].type;
                if (t === 'filled' || t === 'start') filled++;
            }
        }
        return filled;
    }

    function isBoardComplete() {
        return getFilledCount() >= totalActiveCells;
    }

    function checkLevelComplete() {
        return isBoardComplete();
    }

    // ── Input handling ─────────────────────────────────────────
    function onPointerDown(e) {
        if (state !== "playing") return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const cell = screenToGrid(sx, sy);
        if (!cell) return;

        const g = grid[cell.r][cell.c];
        if (g.type === 'wall') return;

        if (playerPath.length === 0) {
            // Can only start from the start cell
            if (g.type === 'start') {
                playerPath = [{ r: cell.r, c: cell.c }];
                drawing = true;
                didDragMove = false;
                dotPressScale[`${cell.r}_${cell.c}`] = 1.0;
                dotAnims[`${cell.r}_${cell.c}`] = { t: 0, color: getPathColorAt(0) };
            }
        } else {
            const last = playerPath[playerPath.length - 1];
            if (cell.r === last.r && cell.c === last.c) {
                // Tap on end of path — continue extending
                drawing = true;
                didDragMove = false;
            } else {
                // Tap on existing path cell to truncate
                const idx = playerPath.findIndex(p => p.r === cell.r && p.c === cell.c);
                if (idx >= 0) {
                    truncatePathAt(cell.r, cell.c);
                    drawing = true;
                    didDragMove = false;
                } else if (g.type === 'start') {
                    // Tap start cell resets path
                    clearPlayerPath();
                    playerPath = [{ r: cell.r, c: cell.c }];
                    drawing = true;
                    didDragMove = false;
                    dotPressScale[`${cell.r}_${cell.c}`] = 1.0;
                    dotAnims[`${cell.r}_${cell.c}`] = { t: 0, color: getPathColorAt(0) };
                }
            }
        }
    }

    function onPointerMove(e) {
        if (!drawing || state !== "playing") return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const cell = screenToGrid(sx, sy);
        if (!cell) return;

        if (playerPath.length === 0) return;
        const last = playerPath[playerPath.length - 1];
        if (cell.r === last.r && cell.c === last.c) return;

        // Must be Manhattan adjacent
        const dr = Math.abs(cell.r - last.r);
        const dc = Math.abs(cell.c - last.c);
        if (dr + dc !== 1) return;

        const g = grid[cell.r][cell.c];

        // Cannot enter wall cells
        if (g.type === 'wall') return;

        // Backtracking: if cell is in path, truncate to it
        const selfIdx = playerPath.findIndex(p => p.r === cell.r && p.c === cell.c);
        if (selfIdx >= 0) {
            const removed = playerPath.splice(selfIdx + 1);
            for (const rc of removed) {
                if (grid[rc.r][rc.c].type === 'filled') {
                    grid[rc.r][rc.c] = { type: 'empty' };
                }
            }
            return;
        }

        // Add cell to path
        playerPath.push({ r: cell.r, c: cell.c });
        didDragMove = true;
        if (g.type === 'empty') {
            grid[cell.r][cell.c] = { type: 'filled' };
        }
        // Trigger fill animation
        const fillProgress = (playerPath.length - 1) / Math.max(totalActiveCells - 1, 1);
        dotAnims[`${cell.r}_${cell.c}`] = { t: 0, color: getPathColorAt(fillProgress) };
        playFlowDraw(playerPath.length);
    }

    let didDragMove = false;

    function onPointerUp(e) {
        if (!drawing) return;
        drawing = false;
        if (didDragMove) {
            moveCount++;
        }
        didDragMove = false;

        if (checkLevelComplete()) {
            onLevelComplete();
        }
    }

    // Single consolidated pointerdown handler for canvas
    canvas.addEventListener("pointerdown", (e) => {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (state === "playing" || state === "levelComplete") {
            // Check HUD buttons first
            const btn = hitTestFlowButtons(sx, sy);
            if (btn === "open_pause") {
                playButtonPress();
                openPauseMenu();
                return;
            } else if (btn === "pause_bg") {
                return; // block canvas interaction when paused
            }
            if (showPauseMenu) return;
            if (state !== "playing") return;
            // Otherwise handle flow drawing
            onPointerDown(e);
        } else if (state === "levelSelect") {
            levelSelectDragging = true;
            levelSelectDragStartY = sy;
            levelSelectDragStartScroll = levelSelectScroll;
            handleLevelSelectTap(sx, sy);
        }
    });
    canvas.addEventListener("pointermove", (e) => {
        if (state === "levelSelect" && levelSelectDragging) {
            const rect = canvas.getBoundingClientRect();
            const sy = e.clientY - rect.top;
            const dy = levelSelectDragStartY - sy;
            if (Math.abs(dy) > 5) {
                levelSelectScroll = Math.max(0, levelSelectDragStartScroll + dy);
            }
        }
        onPointerMove(e);
    });
    canvas.addEventListener("pointerup", (e) => {
        levelSelectDragging = false;
        onPointerUp(e);
    });
    canvas.addEventListener("pointercancel", (e) => {
        levelSelectDragging = false;
        onPointerUp(e);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
        if (state === "levelSelect") {
            e.preventDefault();
            levelSelectScroll = Math.max(0, levelSelectScroll + e.deltaY);
        }
    }, { passive: false });

    // ── Level select input ──────────────────────────────────────
    function handleLevelSelectTap(sx, sy) {
        const pack = LEVEL_PACKS[selectedPackTab];
        if (!pack) return;
        const ls = calculateLevelSelectLayout();

        // Check pack tabs
        for (let i = 0; i < LEVEL_PACKS.length; i++) {
            const tx = ls.tabStartX + i * (ls.tabW + ls.tabGap);
            if (sx >= tx && sx <= tx + ls.tabW && sy >= ls.tabY && sy <= ls.tabY + ls.tabH) {
                selectedPackTab = i;
                levelSelectScroll = 0;
                playButtonPress();
                return;
            }
        }

        // Check "Play Next Level" button
        if (sx >= ls.nextBtnX && sx <= ls.nextBtnX + ls.nextBtnW &&
            sy >= ls.rowY && sy <= ls.rowY + ls.btnH) {
            playMenuTap();
            const next = getNextUncompletedLevel();
            currentPackIndex = next.packIndex;
            currentLevelIndex = next.levelIndex;
            isRandomPuzzle = false;
            loadLevel(currentPackIndex, currentLevelIndex);
            state = "playing";
            menuScreen.style.display = "none";
            document.getElementById("ui-overlay").style.opacity = "1";
            return;
        }

        // Check level tiles (account for scroll)
        for (let i = 0; i < pack.count; i++) {
            const row = Math.floor(i / ls.cols);
            const col = i % ls.cols;
            const lx = ls.startX + col * (ls.circleSize + ls.gap);
            const ly = ls.startY + row * (ls.circleSize + ls.gap) - levelSelectScroll;
            if (ly + ls.circleSize < ls.startY || ly > H) continue;
            if (sx >= lx && sx <= lx + ls.circleSize && sy >= ly && sy <= ly + ls.circleSize) {
                playMenuTap();
                currentPackIndex = selectedPackTab;
                currentLevelIndex = i;
                isRandomPuzzle = false;
                loadLevel(currentPackIndex, currentLevelIndex);
                state = "playing";
                menuScreen.style.display = "none";
                document.getElementById("ui-overlay").style.opacity = "1";
                return;
            }
        }

        // Check back button
        if (sx >= ls.backX && sx <= ls.backX + ls.backW && sy >= ls.backY && sy <= ls.backY + ls.backH) {
            playCloseOverlay();
            state = "start";
            menuScreen.style.display = "block";
            menuScreen.classList.remove("exiting");
            return;
        }
    }

    // ── Procedural level generation ─────────────────────────────
    function generateRandomLevel(size) {
        const pack = LEVEL_PACKS.find(p => p.gridSize === size) || LEVEL_PACKS[0];
        const randomSeed = Math.floor(Math.random() * 1000000);
        const result = generateSeededLevel(pack, randomSeed);
        if (result) {
            boardShape = result.shape;
            startCell = result.start;
            totalActiveCells = result.totalCells;
            initGrid(size, boardShape);
            grid[startCell.r][startCell.c] = { type: 'start' };
            playerPath = [];
            moveCount = 0;
            drawing = false;
            completionAnim = 0;
            calculateGridLayout();
            return;
        }
        const packIdx = LEVEL_PACKS.indexOf(pack);
        loadLevel(packIdx, 0);
    }

    // ── Scoring ──────────────────────────────────────────────────
    function isPerfect() {
        // In Fill the Board, completion always means the board is fully filled
        return true;
    }

    function calculateLevelCoins(gs, perfect, isFirst) {
        let base = gs;
        if (perfect) base *= 3;
        if (isFirst) base += gs * 2;
        return base;
    }

    // ── Level completion ─────────────────────────────────────────
    let earnedCoins = 0;

    let earnedPerfect = false;

    function onLevelComplete() {
        closePauseMenu();
        state = "levelComplete";
        completionAnim = 1;
        levelCompleteFlash = 1.0;

        earnedPerfect = isPerfect();

        const levelId = isRandomPuzzle ? `random_${gridSize}` : `pack${currentPackIndex}_lvl${currentLevelIndex}`;
        const isFirst = !completedLevels[levelId];

        earnedCoins = calculateLevelCoins(gridSize, earnedPerfect, isFirst);
        coins += earnedCoins;

        // Update stats
        totalLevelsCompleted++;
        totalFlowsCompleted += 1;
        const wasPerfect = completedLevels[levelId] ? completedLevels[levelId].perfect : false;
        if (earnedPerfect && !wasPerfect) threeStarCount++;
        if (gridSize >= 9) bigGridCleared++;
        if (isRandomPuzzle) randomPuzzlesCompleted++;

        // Save level completion
        if (!completedLevels[levelId] || (earnedPerfect && !completedLevels[levelId].perfect)) {
            completedLevels[levelId] = { perfect: earnedPerfect, moves: moveCount };
        }

        // Check pack completion
        if (!isRandomPuzzle) {
            const pack = LEVEL_PACKS[currentPackIndex];
            let allDone = true;
            for (let i = 0; i < pack.count; i++) {
                if (!completedLevels[`pack${currentPackIndex}_lvl${i}`]) { allDone = false; break; }
            }
            if (allDone) {
                // Track pack completion (use a flag key so we only count once per pack)
                const packDoneKey = `_packDone_${currentPackIndex}`;
                if (!completedLevels[packDoneKey]) {
                    completedLevels[packDoneKey] = true;
                    packsCompleted++;
                }
                const nextPack = currentPackIndex + 1;
                if (nextPack < LEVEL_PACKS.length && !unlockedPacks.includes(nextPack)) {
                    unlockedPacks.push(nextPack);
                }
                // Check if all levels perfected
                let allPerfect = true;
                for (let i = 0; i < pack.count; i++) {
                    const lid = `pack${currentPackIndex}_lvl${i}`;
                    if (!completedLevels[lid] || !completedLevels[lid].perfect) { allPerfect = false; break; }
                }
                const packAllStarsKey = `_allStars_pack${currentPackIndex}`;
                if (allPerfect && !completedLevels[packAllStarsKey]) {
                    completedLevels[packAllStarsKey] = true;
                    packsAllStars++;
                }
            }
        }

        sendScoreToSDK(totalLevelsCompleted);
        tryShowInterstitial();
        playLevelComplete();

        // Show level complete screen after animation
        setTimeout(() => {
            if (earnedPerfect) {
                endScoreEl.innerHTML = '<span style="font-size: clamp(24px, 8vmin, 40px); color: #FFD036;">PERFECT!</span>';
                newBestLabel.classList.remove("show");
                playNewBest();
                setTimeout(() => startConfetti(GOLD_COLORS), 100);
            } else {
                endScoreEl.innerHTML = '<span style="font-size: clamp(24px, 8vmin, 40px); color: #5BC85F;">COMPLETE</span>';
                newBestLabel.classList.remove("show");
                setTimeout(() => startConfetti(RAINBOW_COLORS), 100);
            }
            endBestEl.textContent = `MOVES: ${moveCount}`;
            document.getElementById("end-coins").innerHTML = earnedCoins > 0 ? `${COIN_ICON_LG} +${earnedCoins}` : "";
            gameOverScreen.classList.add("show");
        }, 600);

        saveToCloud();
    }

    // ── Drawing ─────────────────────────────────────────────────
    function drawBackground() {
        ctx.fillStyle = lightMode ? "#e8e0d4" : "#151520";
        ctx.fillRect(0, 0, W, H);
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // Build a lookup: "r_c" → index in playerPath (for gradient coloring)
    function buildPathIndexMap() {
        const map = {};
        for (let i = 0; i < playerPath.length; i++) {
            map[`${playerPath[i].r}_${playerPath[i].c}`] = i;
        }
        return map;
    }

    function drawGrid() {
        const gx = gridOriginX, gy = gridOriginY;
        const pathMap = buildPathIndexMap();
        const total = Math.max(totalActiveCells - 1, 1);
        const dotR = cellSize * 0.38; // circle radius for filled nodes
        const emptyR = cellSize * 0.18; // smaller circle for empty nodes

        // Draw path lines FIRST (behind circles)
        if (playerPath.length >= 2) {
            ctx.lineWidth = cellSize * 0.22;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            for (let i = 1; i < playerPath.length; i++) {
                const progress = i / total;
                const prevProgress = (i - 1) / total;
                const x0 = gx + playerPath[i - 1].c * cellSize + cellSize / 2;
                const y0 = gy + playerPath[i - 1].r * cellSize + cellSize / 2;
                const x1 = gx + playerPath[i].c * cellSize + cellSize / 2;
                const y1 = gy + playerPath[i].r * cellSize + cellSize / 2;
                ctx.strokeStyle = getPathColorAt((prevProgress + progress) / 2);
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // Draw circles
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                const g = grid[r][c];
                if (g.type === 'wall') continue;

                const centerX = gx + c * cellSize + cellSize / 2;
                const centerY = gy + r * cellSize + cellSize / 2;
                const key = `${r}_${c}`;

                if (g.type === 'filled' || g.type === 'start') {
                    const idx = pathMap[key];
                    const progress = idx !== undefined ? idx / total : 0;
                    const color = getPathColorAt(progress);

                    // Pop/bounce scale
                    const anim = dotAnims[key];
                    let scale = 1;
                    if (anim) {
                        const t = anim.t;
                        // Elastic ease out: overshoot then settle
                        if (t < 0.3) {
                            scale = 1 + 0.4 * (t / 0.3); // grow to 1.4
                        } else if (t < 0.55) {
                            scale = 1.4 - 0.5 * ((t - 0.3) / 0.25); // shrink to 0.9
                        } else if (t < 0.75) {
                            scale = 0.9 + 0.15 * ((t - 0.55) / 0.2); // bounce to 1.05
                        } else {
                            scale = 1.05 - 0.05 * ((t - 0.75) / 0.25); // settle to 1.0
                        }
                    }

                    // Filled circle with bounce
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, dotR * scale, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // Empty node — small subtle circle
                    ctx.fillStyle = lightMode ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)";
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, emptyR, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = lightMode ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.15)";
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }
        }

        // Draw ripple rings for recently filled dots
        for (const key in dotAnims) {
            const anim = dotAnims[key];
            const [rs, cs] = key.split('_').map(Number);
            const centerX = gx + cs * cellSize + cellSize / 2;
            const centerY = gy + rs * cellSize + cellSize / 2;
            const t = anim.t;
            const rippleR = dotR + cellSize * 0.5 * t;
            const alpha = Math.max(0, 0.5 * (1 - t));
            ctx.strokeStyle = anim.color;
            ctx.lineWidth = Math.max(1, 3 * (1 - t));
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(centerX, centerY, rippleR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    function drawPaths() {
        // Path lines are now drawn inside drawGrid (behind circles)
    }

    function drawDots() {
        // Start cell is drawn as part of drawGrid — nothing extra needed
    }

    let showPauseMenu = false;
    const pauseScreenEl = document.getElementById("pause-screen");

    function openPauseMenu() {
        showPauseMenu = true;
        pauseScreenEl.classList.add("show");
    }
    function closePauseMenu() {
        showPauseMenu = false;
        pauseScreenEl.classList.remove("show");
    }

    // Pause screen button handlers
    document.getElementById("pause-resume-btn").addEventListener("click", () => {
        playButtonPress();
        closePauseMenu();
    });
    document.getElementById("pause-restart-btn").addEventListener("click", () => {
        playButtonPress();
        closePauseMenu();
        clearPath();
        moveCount = 0;
    });
    document.getElementById("pause-menu-btn").addEventListener("click", () => {
        playCloseOverlay();
        closePauseMenu();
        returnToMenu();
    });

    function drawFlowHUD() {
        const filled = getFilledCount();
        const total = totalActiveCells;
        const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

        const hudSpace = gridOriginY;
        const titleSize = Math.max(12, Math.min(22, hudSpace * 0.28, cellSize * 0.4));
        const statsSize = Math.max(10, Math.min(16, hudSpace * 0.2, cellSize * 0.28));
        const vminHud = Math.min(W, H);
        const menuBtnH = Math.max(vminHud * 0.065, Math.min(vminHud * 0.09, hudSpace * 0.4));
        const menuBtnW = Math.max(vminHud * 0.11, menuBtnH * 1.7);

        // Level number
        let globalNum = 0;
        if (!isRandomPuzzle) {
            for (let p = 0; p < currentPackIndex; p++) globalNum += LEVEL_PACKS[p].count;
            globalNum += currentLevelIndex + 1;
        }
        const levelName = isRandomPuzzle
            ? `Random ${gridSize}x${gridSize}`
            : `Level ${globalNum}`;
        ctx.fillStyle = lightMode ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)";
        ctx.font = `${titleSize}px 'Fredoka One', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const titleY = Math.max(6, gridOriginY - menuBtnH - statsSize - titleSize - 16);
        ctx.fillText(levelName, W / 2, titleY);

        // Progress
        ctx.fillStyle = lightMode ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.5)";
        ctx.font = `${statsSize}px 'Fredoka One', sans-serif`;
        ctx.fillText(`${filled}/${total}  (${pct}%)`, W / 2, titleY + titleSize + 4);

        // Menu button
        const menuBtnX = gridOriginX;
        const menuBtnY = gridOriginY - menuBtnH - 6 - H * 0.025;
        drawButton(menuBtnX, menuBtnY, menuBtnW, menuBtnH, "☰", "#888", "#666");
    }

    function drawButton(x, y, w, h, text, bg, shadow) {
        const r = 8;
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.moveTo(x + r, y + 3);
        ctx.lineTo(x + w - r, y + 3);
        ctx.quadraticCurveTo(x + w, y + 3, x + w, y + 3 + r);
        ctx.lineTo(x + w, y + h + 3 - r);
        ctx.quadraticCurveTo(x + w, y + h + 3, x + w - r, y + h + 3);
        ctx.lineTo(x + r, y + h + 3);
        ctx.quadraticCurveTo(x, y + h + 3, x, y + h + 3 - r);
        ctx.lineTo(x, y + 3 + r);
        ctx.quadraticCurveTo(x, y + 3, x + r, y + 3);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(9, h * 0.35)}px 'Fredoka One', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + w / 2, y + h / 2);
    }

    function hitTestFlowButtons(sx, sy) {
        if (showPauseMenu) return "pause_bg"; // block canvas interaction when paused

        // Menu hamburger button (top-left of grid) — same sizing as drawFlowHUD
        const hudSpace = gridOriginY;
        const menuBtnH = Math.max(40, Math.min(56, hudSpace * 0.4));
        const menuBtnW = Math.max(65, menuBtnH * 1.7);
        const menuBtnX = gridOriginX;
        const menuBtnY = gridOriginY - menuBtnH - 6 - H * 0.025;
        if (sx >= menuBtnX && sx <= menuBtnX + menuBtnW && sy >= menuBtnY && sy <= menuBtnY + menuBtnH) {
            return "open_pause";
        }
        return null;
    }

    // Button taps handled in consolidated canvas pointerdown handler above

    // ── Level Select Layout (vmin-based scaling) ────────────────
    function calculateLevelSelectLayout() {
        const vmin = Math.min(W, H);
        const cols = 5;
        const circleSize = Math.min(Math.round(vmin * 0.1), Math.round((W - vmin * 0.16) / cols));
        const gap = Math.round(vmin * 0.025);
        const gridW = cols * (circleSize + gap) - gap;

        const backW = Math.round(vmin * 0.15);
        const backH = Math.round(vmin * 0.075);
        const backX = (W - gridW) / 2 - W * 0.05;
        const backY = Math.round(vmin * 0.03);

        const tabY = Math.round(vmin * 0.12);
        const tabH = Math.round(vmin * 0.075);
        const tabW = Math.round(vmin * 0.14);
        const tabGap = Math.round(vmin * 0.016);
        const totalTabW = LEVEL_PACKS.length * (tabW + tabGap);
        const tabStartX = (W - totalTabW) / 2;

        const rowY = Math.round(vmin * 0.26);
        const rowX = (W - gridW) / 2;
        const nextBtnW = gridW;
        const btnH = Math.round(vmin * 0.14);
        const nextBtnX = rowX;

        const startY = rowY + btnH + Math.round(vmin * 0.03);
        const startX = (W - gridW) / 2;

        return {
            cols, circleSize, gap, gridW,
            backW, backH, backX, backY,
            tabY, tabH, tabW, tabGap, totalTabW, tabStartX,
            rowY, rowX, nextBtnW, btnH, nextBtnX,
            startY, startX,
        };
    }

    // ── Level Select Drawing ─────────────────────────────────────
    function drawLevelSelect() {
        // Background already drawn in gameLoop
        const ls = calculateLevelSelectLayout();

        // Back button
        drawButton(ls.backX, ls.backY, ls.backW, ls.backH, "BACK", "#FF6B6B", "#D44848");

        // Completion stats — centered at top
        const totalAll = LEVEL_PACKS.reduce((s, p) => s + p.count, 0);
        let completedCount = 0;
        let perfectedCount = 0;
        for (let pi = 0; pi < LEVEL_PACKS.length; pi++) {
            for (let li = 0; li < LEVEL_PACKS[pi].count; li++) {
                const key = `pack${pi}_lvl${li}`;
                const c = completedLevels[key];
                if (c) { completedCount++; if (c.perfect) perfectedCount++; }
            }
        }
        const completePct = Math.floor((completedCount / totalAll) * 100);
        const perfectPct = Math.floor((perfectedCount / totalAll) * 100);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = lightMode ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)";
        ctx.font = `${Math.max(13, ls.backH * 0.38)}px 'Fredoka One', sans-serif`;
        ctx.fillText(`${completePct}% COMPLETE`, W / 2, ls.backY + ls.backH * 0.33);

        ctx.fillStyle = "#FFD036";
        ctx.font = `${Math.max(10, ls.backH * 0.28)}px 'Fredoka One', sans-serif`;
        ctx.fillText(`${perfectPct}% PERFECTED`, W / 2, ls.backY + ls.backH * 0.75);

        // Pack tabs
        for (let i = 0; i < LEVEL_PACKS.length; i++) {
            const tx = ls.tabStartX + i * (ls.tabW + ls.tabGap);
            const isSelected = i === selectedPackTab;
            if (isSelected) {
                drawButton(tx, ls.tabY, ls.tabW, ls.tabH, LEVEL_PACKS[i].name, "#4DABF7", "#2B8AD4");
            } else {
                drawButton(tx, ls.tabY, ls.tabW, ls.tabH, LEVEL_PACKS[i].name, "#888", "#666");
            }
        }

        const pack = LEVEL_PACKS[selectedPackTab];
        if (!pack) return;

        const nextLevel = getNextUncompletedLevel();

        // Play Next Level button (full width)
        drawButton(ls.nextBtnX, ls.rowY, ls.nextBtnW, ls.btnH, "", "#5BC85F", "#3DA841");
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(9, ls.btnH * 0.3)}px 'Fredoka One', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PLAY NEXT", ls.nextBtnX + ls.nextBtnW / 2, ls.rowY + ls.btnH * 0.36);
        let globalNum = 0;
        for (let p = 0; p < nextLevel.packIndex; p++) globalNum += LEVEL_PACKS[p].count;
        globalNum += nextLevel.levelIndex + 1;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = `${Math.max(8, ls.btnH * 0.22)}px 'Fredoka One', sans-serif`;
        ctx.fillText(`LEVEL: ${globalNum}`, ls.nextBtnX + ls.nextBtnW / 2, ls.rowY + ls.btnH * 0.7);

        // Level grid (scrollable)
        const { startY, startX, cols, circleSize, gap } = ls;
        const totalRows = Math.ceil(pack.count / cols);
        const contentH = totalRows * (circleSize + gap) + 40;
        const visibleH = H - startY;
        const maxScroll = Math.max(0, contentH - visibleH);
        levelSelectScroll = Math.max(0, Math.min(levelSelectScroll, maxScroll));

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, startY, W, H - startY);
        ctx.clip();

        let packOffset = 0;
        for (let p = 0; p < selectedPackTab; p++) packOffset += LEVEL_PACKS[p].count;

        for (let i = 0; i < pack.count; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const lx = startX + col * (circleSize + gap);
            const ly = startY + row * (circleSize + gap) - levelSelectScroll;
            const cx = lx + circleSize / 2;
            const cy = ly + circleSize / 2;
            const br = Math.max(8, circleSize * 0.22);

            // Skip offscreen tiles
            if (ly + circleSize < startY || ly > H) continue;

            const levelId = `pack${selectedPackTab}_lvl${i}`;
            const completed = completedLevels[levelId];

            // Rounded square background — same neutral style for all
            ctx.fillStyle = lightMode ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
            roundRect(lx, ly, circleSize, circleSize, br);
            ctx.fill();

            // Border
            ctx.strokeStyle = lightMode ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Level number (global)
            ctx.fillStyle = lightMode ? "#333" : "#ddd";
            ctx.font = `${Math.max(12, circleSize * 0.35)}px 'Fredoka One', sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(packOffset + i + 1), cx, cy);

            // Completion badges
            const badgeR = Math.max(7, circleSize * 0.16);
            const badgeFont = `bold ${Math.max(7, badgeR * 1.1)}px sans-serif`;
            if (completed) {
                // Green circle badge — bottom right
                const bx = lx + circleSize - badgeR - 2;
                const by = ly + circleSize - badgeR - 2;
                ctx.fillStyle = "#5BC85F";
                ctx.beginPath();
                ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.font = badgeFont;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("✓", bx, by + 1);
            }
            if (completed && completed.perfect) {
                // Gold circle badge — bottom left
                const bx = lx + badgeR + 2;
                const by = ly + circleSize - badgeR - 2;
                ctx.fillStyle = "#FFD036";
                ctx.beginPath();
                ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.font = badgeFont;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("★", bx, by);
            }
        }

        // Pack info at bottom of scrollable area
        const infoY = startY + totalRows * (circleSize + gap) + 10 - levelSelectScroll;
        if (infoY > startY && infoY < H) {
            ctx.fillStyle = lightMode ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.4)";
            ctx.font = `${Math.max(11, 14)}px 'Fredoka One', sans-serif`;
            ctx.textAlign = "center";
            let completedCount = 0;
            for (let i = 0; i < pack.count; i++) {
                if (completedLevels[`pack${selectedPackTab}_lvl${i}`]) completedCount++;
            }
            ctx.fillText(`${completedCount}/${pack.count} completed  |  ${pack.gridSize}x${pack.gridSize} grid`, W / 2, infoY);
        }

        ctx.restore();
    }

    // ── Start screen animation ──────────────────────────────────
    function drawStartAnimation(t) {
        // Demo: single path filling an irregular shape
        const demoSize = 5;
        const vmin = Math.min(W, H);
        const demoCellSize = Math.min(
            Math.round(vmin * 0.065),
            Math.round((W - vmin * 0.3) / demoSize),
            Math.round((H * 0.2) / demoSize)
        );
        const demoGridSize = demoCellSize * demoSize;
        const demoX = (W - demoGridSize) / 2;
        const demoY = H * 0.31;

        // Irregular shape
        const demoShapeCells = [
            [0,0],[0,1],[0,2],
            [1,0],[1,1],[1,2],
            [2,0],[2,1],
            [3,0],[3,1],
            [4,0],[4,1]
        ];
        const demoShapeSet = new Set(demoShapeCells.map(([r,c]) => `${r}_${c}`));

        // Valid path through the shape
        const demoPath = [
            [0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[3,1],[2,1],[1,1],[1,2]
        ];

        const padding = demoCellSize * 0.06;
        const cr = demoCellSize * 0.15;
        const totalPathLen = demoPath.length;

        // Draw shape cells
        const animPhase = (t * 0.001) % 6;
        const visibleLen = Math.min(totalPathLen, Math.max(0, Math.floor(animPhase * 2.5)));
        const filledMap = new Map(); // key -> path index
        for (let i = 0; i < visibleLen; i++) {
            filledMap.set(`${demoPath[i][0]}_${demoPath[i][1]}`, i);
        }

        const dotR = demoCellSize * 0.38;
        const emptyR = demoCellSize * 0.18;

        // Draw path lines first (behind circles)
        if (visibleLen >= 2) {
            ctx.lineWidth = demoCellSize * 0.22;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            for (let i = 1; i < visibleLen; i++) {
                const [pr, pc] = demoPath[i - 1];
                const [nr, nc] = demoPath[i];
                const px = demoX + pc * demoCellSize + demoCellSize / 2;
                const py = demoY + pr * demoCellSize + demoCellSize / 2;
                const nx = demoX + nc * demoCellSize + demoCellSize / 2;
                const ny = demoY + nr * demoCellSize + demoCellSize / 2;
                const progress = i / Math.max(1, totalPathLen - 1);
                ctx.strokeStyle = getPathColorAt(progress);
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(nx, ny);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // Draw circles
        for (const [r, c] of demoShapeCells) {
            const centerX = demoX + c * demoCellSize + demoCellSize / 2;
            const centerY = demoY + r * demoCellSize + demoCellSize / 2;
            const key = `${r}_${c}`;

            if (filledMap.has(key)) {
                const progress = filledMap.get(key) / Math.max(1, totalPathLen - 1);
                ctx.fillStyle = getPathColorAt(progress);
                ctx.beginPath();
                ctx.arc(centerX, centerY, dotR, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = lightMode ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)";
                ctx.beginPath();
                ctx.arc(centerX, centerY, emptyR, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = lightMode ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.15)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Start cell is already drawn as a filled circle in the loop above
    }

    // ── Objectives rendering ────────────────────────────────────
    function renderObjectives() {
        objectivesList.innerHTML = "";
        const completed = OBJECTIVES.filter(o => collectedObjectives.includes(o.id)).length;
        const pct = Math.round((completed / OBJECTIVES.length) * 100);
        document.getElementById("obj-completion").innerHTML = `${completed} / ${OBJECTIVES.length} &mdash; ${pct}%<div class="obj-bar obj-bar-overall"><div class="obj-fill" style="width:${pct}%"></div></div>`;
        for (const obj of OBJECTIVES) {
            const current = getStatValue(obj.stat);
            const progress = Math.min(current / obj.target, 1);
            const isCollected = collectedObjectives.includes(obj.id);
            const isComplete = current >= obj.target;

            const item = document.createElement("div");
            item.className = "obj-item";
            item.innerHTML = `
                <div class="obj-header">
                    <span class="obj-desc">${obj.desc}</span>
                    <span class="obj-reward">${COIN_ICON_SM} ${obj.reward}</span>
                </div>
                <div class="obj-bar"><div class="obj-fill" style="width:${progress * 100}%"></div></div>
                <div class="obj-footer">
                    <span class="obj-progress">${Math.min(current, obj.target)} / ${obj.target}</span>
                    ${isCollected
                        ? '<span class="obj-collected">COLLECTED</span>'
                        : `<button class="obj-collect" data-id="${obj.id}" ${!isComplete ? "disabled" : ""}>${isComplete ? "COLLECT" : "IN PROGRESS"}</button>`}
                </div>`;
            objectivesList.appendChild(item);
        }
        objectivesList.querySelectorAll(".obj-collect:not(:disabled)").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const obj = OBJECTIVES.find(o => o.id === btn.dataset.id);
                if (obj && !collectedObjectives.includes(obj.id)) {
                    coins += obj.reward;
                    saveCoins();
                    collectedObjectives.push(obj.id);
                    saveCollected();
                    updateCoinDisplay();
                    renderObjectives();
                    checkObjectiveNotify();
                    startCoinShower();
                    playCollect();
                }
            });
        });
        updateCollectAllBtn();
    }

    // ── Collect All button ──────────────────────────────────────
    const collectAllBtn = document.getElementById("objectives-collect-all");
    collectAllBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    collectAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        let totalReward = 0;
        for (const obj of OBJECTIVES) {
            const val = getStatValue(obj.stat);
            if (val >= obj.target && !collectedObjectives.includes(obj.id)) {
                totalReward += obj.reward;
                collectedObjectives.push(obj.id);
            }
        }
        if (totalReward > 0) {
            coins += totalReward;
            saveCoins();
            saveCollected();
            updateCoinDisplay();
            renderObjectives();
            checkObjectiveNotify();
            startCoinShower();
            playCollectAll();
        }
    });

    function updateCollectAllBtn() {
        const hasAny = OBJECTIVES.some(obj => {
            return getStatValue(obj.stat) >= obj.target && !collectedObjectives.includes(obj.id);
        });
        collectAllBtn.style.display = hasAny ? "flex" : "none";
    }

    function checkObjectiveNotify() {
        const btn = document.getElementById("btn-objectives");
        const hasCollectible = OBJECTIVES.some(obj => {
            const val = getStatValue(obj.stat);
            return val >= obj.target && !collectedObjectives.includes(obj.id);
        });
        if (hasCollectible) {
            btn.classList.add("btn-shake");
        } else {
            btn.classList.remove("btn-shake");
        }
    }

    // ── Coin Shower Animation ─────────────────────────────────
    const coinShowerCanvas = document.getElementById("coin-shower-canvas");
    const coinShowerCtx = coinShowerCanvas.getContext("2d");
    let coinShowerParticles = [];
    let coinShowerAnim = null;
    const coinImg = new Image();
    coinImg.src = "Coin.png";

    function startCoinShower() {
        coinShowerCanvas.width = window.innerWidth;
        coinShowerCanvas.height = window.innerHeight;
        coinShowerParticles = [];
        for (let i = 0; i < 40; i++) {
            coinShowerParticles.push({
                x: Math.random() * coinShowerCanvas.width,
                y: -Math.random() * coinShowerCanvas.height,
                vy: 2 + Math.random() * 3,
                vx: (Math.random() - 0.5) * 2,
                size: 16 + Math.random() * 20,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.15,
                alpha: 0.7 + Math.random() * 0.3,
            });
        }
        if (coinShowerAnim) cancelAnimationFrame(coinShowerAnim);
        animateCoinShower();
    }

    function animateCoinShower() {
        coinShowerCtx.clearRect(0, 0, coinShowerCanvas.width, coinShowerCanvas.height);
        let alive = false;
        for (const p of coinShowerParticles) {
            p.y += p.vy;
            p.x += p.vx;
            p.rot += p.rotSpeed;
            p.alpha -= 0.003;
            if (p.y < coinShowerCanvas.height + 40 && p.alpha > 0) {
                alive = true;
                coinShowerCtx.save();
                coinShowerCtx.globalAlpha = Math.max(0, p.alpha);
                coinShowerCtx.translate(p.x, p.y);
                coinShowerCtx.rotate(p.rot);
                coinShowerCtx.drawImage(coinImg, -p.size / 2, -p.size / 2, p.size, p.size);
                coinShowerCtx.restore();
            }
        }
        if (alive) {
            coinShowerAnim = requestAnimationFrame(animateCoinShower);
        } else {
            coinShowerCtx.clearRect(0, 0, coinShowerCanvas.width, coinShowerCanvas.height);
            coinShowerAnim = null;
        }
    }

    // ── Confetti Shower Animation ─────────────────────────────
    const confettiCanvas = document.getElementById("confetti-canvas");
    const confettiCtx = confettiCanvas.getContext("2d");
    let confettiParticles = [];
    let confettiAnim = null;
    const RAINBOW_COLORS = ["#FF6B6B","#FFD036","#5BC95F","#4DABF7","#FF6B9D","#9775FA","#FF9F43","#00D2D3"];
    const GOLD_COLORS = ["#FFD036","#FFC107","#FFB300","#FFCA28","#FFE082","#F9A825","#FDD835","#FFECB3"];

    function startConfetti(colors) {
        const palette = colors || RAINBOW_COLORS;
        confettiCanvas.width = window.innerWidth;
        confettiCanvas.height = window.innerHeight;
        confettiParticles = [];
        for (let i = 0; i < 100; i++) {
            confettiParticles.push({
                x: Math.random() * confettiCanvas.width,
                y: -Math.random() * confettiCanvas.height * 0.5,
                vy: 1.5 + Math.random() * 3,
                vx: (Math.random() - 0.5) * 3,
                w: 6 + Math.random() * 6,
                h: 10 + Math.random() * 10,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.2,
                color: palette[Math.floor(Math.random() * palette.length)],
                alpha: 1,
            });
        }
        if (confettiAnim) cancelAnimationFrame(confettiAnim);
        animateConfetti();
    }

    function animateConfetti() {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        let alive = false;
        for (const p of confettiParticles) {
            p.y += p.vy;
            p.x += p.vx;
            p.vx += (Math.random() - 0.5) * 0.1;
            p.rot += p.rotSpeed;
            if (p.y > confettiCanvas.height * 0.7) p.alpha -= 0.02;
            if (p.y < confettiCanvas.height + 20 && p.alpha > 0) {
                alive = true;
                confettiCtx.save();
                confettiCtx.globalAlpha = Math.max(0, p.alpha);
                confettiCtx.translate(p.x, p.y);
                confettiCtx.rotate(p.rot);
                confettiCtx.fillStyle = p.color;
                confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                confettiCtx.restore();
            }
        }
        if (alive) {
            confettiAnim = requestAnimationFrame(animateConfetti);
        } else {
            confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
            confettiAnim = null;
        }
    }

    // ── Store rendering ──────────────────────────────────────────
    function getThemeSwatches(theme) {
        const swatches = [];
        // Sample 5 points along the actual theme gradient
        const saved = activeTheme;
        activeTheme = theme.id;
        for (let i = 0; i < 5; i++) {
            swatches.push(getPathColorAt(i / 4));
        }
        activeTheme = saved;
        return swatches;
    }

    function renderStore() {
        storeList.innerHTML = "";
        updateCoinDisplay();

        for (const theme of THEMES) {
            const isOwned = ownedThemes.includes(theme.id);
            const isEquipped = activeTheme === theme.id;
            const canAfford = coins >= theme.price;
            const swatches = getThemeSwatches(theme);

            const item = document.createElement("div");
            item.className = "store-item" + (isEquipped ? " equipped" : "");

            const swatchHTML = swatches.map(c =>
                `<div class="swatch" style="background:${c}"></div>`
            ).join("");

            let btnText, btnClass, btnDisabled;
            if (isEquipped) {
                btnText = "EQUIPPED"; btnClass = "store-buy-btn equipped-btn"; btnDisabled = true;
            } else if (isOwned) {
                btnText = "EQUIP"; btnClass = "store-buy-btn owned"; btnDisabled = false;
            } else {
                btnText = `${COIN_ICON_SM} ${theme.price}`; btnClass = "store-buy-btn"; btnDisabled = false;
                if (!canAfford) btnClass += " cant-afford";
            }

            item.innerHTML = `
                <div class="store-palette-preview">${swatchHTML}</div>
                <div class="store-item-info">
                    <span class="store-item-name">${theme.name}</span>
                    <span class="store-item-price">${theme.price === 0 ? "FREE" : COIN_ICON_SM + " " + theme.price}</span>
                </div>
                <button class="${btnClass}" data-id="${theme.id}" ${btnDisabled ? "disabled" : ""}>${btnText}</button>`;
            storeList.appendChild(item);
        }

        storeList.querySelectorAll(".store-buy-btn:not(:disabled)").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const theme = THEMES.find(t => t.id === btn.dataset.id);
                if (!theme) return;
                if (ownedThemes.includes(theme.id)) {
                    activeTheme = theme.id;
                    saveActiveTheme();
                    playEquip();
                } else if (coins >= theme.price) {
                    coins -= theme.price;
                    totalCoinsSpent += theme.price;
                    saveCoins();
                    ownedThemes.push(theme.id);
                    saveOwnedThemes();
                    activeTheme = theme.id;
                    saveActiveTheme();
                    playBuy();
                } else {
                    playTone(150, 0.15, "square", 0.08);
                    btn.textContent = "NOT ENOUGH!";
                    btn.classList.add("btn-shake");
                    setTimeout(() => {
                        btn.classList.remove("btn-shake");
                        btn.innerHTML = `${COIN_ICON_SM} ${theme.price}`;
                    }, 800);
                    return;
                }
                updateCoinDisplay();
                renderStore();
            });
        });
    }

    // ── Menu / Navigation ────────────────────────────────────────
    function returnToMenu() {
        gameOverScreen.classList.remove("show");
        menuScreen.classList.remove("exiting");
        menuScreen.style.display = "block";
        document.getElementById("ui-overlay").style.opacity = "0";
        state = "start";
        updateBestDisplay();
        checkObjectiveNotify();
    }

    function goToLevelSelect() {
        menuScreen.classList.add("exiting");
        state = "levelSelect";
        selectedPackTab = currentPackIndex;

        setTimeout(() => {
            menuScreen.style.display = "none";
            menuScreen.classList.remove("exiting");
        }, 550);
    }

    // ── Input handling ────────────────────────────────────────

    // Play button — goes to level select
    btnPlayLevel.addEventListener("pointerdown", (e) => e.stopPropagation());
    btnPlayLevel.addEventListener("click", (e) => {
        if (state !== "start") return;
        e.stopPropagation();
        ensureAudio();
        playMenuTap();
        goToLevelSelect();
    });

    // Menu buttons — stop propagation
    btnStore.addEventListener("pointerdown", (e) => e.stopPropagation());
    btnObjectives.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.getElementById("btn-theme").addEventListener("pointerdown", (e) => e.stopPropagation());

    btnStore.addEventListener("click", (e) => {
        if (state === "paused") return;
        e.stopPropagation();
        playOpenOverlay();
        renderStore();
        storeScreen.classList.add("show");
    });

    btnObjectives.addEventListener("click", (e) => {
        if (state === "paused") return;
        e.stopPropagation();
        playOpenOverlay();
        renderObjectives();
        objectivesScreen.classList.add("show");
    });

    storeClose.addEventListener("click", (e) => {
        if (state === "paused") return;
        e.stopPropagation();
        playCloseOverlay();
        storeScreen.classList.remove("show");
    });

    objectivesClose.addEventListener("click", (e) => {
        if (state === "paused") return;
        e.stopPropagation();
        playCloseOverlay();
        objectivesScreen.classList.remove("show");
    });

    storeScreen.addEventListener("pointerdown", (e) => {
        if (state === "paused") return;
        if (e.target === storeScreen) { playCloseOverlay(); storeScreen.classList.remove("show"); }
    });

    objectivesScreen.addEventListener("pointerdown", (e) => {
        if (state === "paused") return;
        if (e.target === objectivesScreen) { playCloseOverlay(); objectivesScreen.classList.remove("show"); }
    });

    // Level select taps handled in consolidated canvas pointerdown handler above

    // Keyboard
    document.addEventListener("keydown", (e) => {
        if (state === "paused") return;
        if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            ensureAudio();
            if (state === "start") {
                goToLevelSelect();
            }
        }
    });

    const loadingScreen = document.getElementById("loading-screen");

    // Collect/Next button on level complete
    restartBtn.addEventListener("click", (e) => {
        if (state === "paused") return;
        e.stopPropagation();
        ensureAudio();
        playCollect();

        // Go to level select
        gameOverScreen.classList.remove("show");
        state = "levelSelect";
        document.getElementById("ui-overlay").style.opacity = "0";
        updateBestDisplay();
        checkObjectiveNotify();
    });

    if (nextLevelBtn) {
        nextLevelBtn.addEventListener("click", (e) => {
            if (state === "paused") return;
            e.stopPropagation();
            ensureAudio();
            playCollect();

            gameOverScreen.classList.remove("show");

            // Load next level
            if (!isRandomPuzzle) {
                const pack = LEVEL_PACKS[currentPackIndex];
                if (currentLevelIndex + 1 < pack.count) {
                    currentLevelIndex++;
                    loadLevel(currentPackIndex, currentLevelIndex);
                    state = "playing";
                    return;
                }
            }

            // No next level, go to level select
            state = "levelSelect";
            document.getElementById("ui-overlay").style.opacity = "0";
            updateBestDisplay();
            checkObjectiveNotify();
        });
    }

    // ── Light / Dark mode toggle ─────────────────────────────
    function applyThemeUI() {
        const body = document.body;
        const menuTap = document.querySelector(".menu-tap");

        if (lightMode) {
            body.style.background = "#c8c4ba";
            if (menuTap) menuTap.style.color = "rgba(0,0,0,0.45)";
            menuBestEl.style.color = "rgba(0,0,0,0.35)";
            menuCoinsEl.style.color = "#b8860b";
        } else {
            body.style.background = "#1a1a2e";
            if (menuTap) menuTap.style.color = "rgba(255,255,255,0.6)";
            menuBestEl.style.color = "rgba(255,255,255,0.4)";
            menuCoinsEl.style.color = "#ffd700";
        }
    }

    const menuThemeBtn = document.getElementById("btn-theme");
    const themeIcon = document.getElementById("theme-icon");

    function updateThemeLabels() {
        themeIcon.src = lightMode ? "moon.png" : "sun.png";
    }

    updateThemeLabels();
    applyThemeUI();

    function toggleTheme(e) {
        if (state === "paused") return;
        e.stopPropagation();
        ensureAudio();
        lightMode = !lightMode;
        updateThemeLabels();
        applyThemeUI();
        playThemeToggle();
        saveToCloud();
    }

    menuThemeBtn.addEventListener("click", toggleTheme);

    // ── Game loop ─────────────────────────────────────────────
    let lastTime = 0;

    function gameLoop(timestamp) {
        if (state === "paused") {
            lastTime = timestamp;
            requestAnimationFrame(gameLoop);
            return;
        }

        const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
        lastTime = timestamp;

        // Tick animation timers
        if (cellFillFlash > 0) cellFillFlash -= dt * 3;
        for (const key in dotPressScale) {
            dotPressScale[key] -= dt * 4;
            if (dotPressScale[key] <= 0) delete dotPressScale[key];
        }
        for (const key in dotAnims) {
            dotAnims[key].t += dt * 2.8;
            if (dotAnims[key].t >= 1) delete dotAnims[key];
        }
        if (levelCompleteFlash > 0) levelCompleteFlash -= dt * 2.5;

        drawBackground();

        if (state === "start") {
            drawStartAnimation(timestamp);
        } else if (state === "levelSelect") {
            drawLevelSelect();
        } else if (state === "playing" || state === "levelComplete") {
            drawGrid();
            drawPaths();
            drawDots();
            drawFlowHUD();

            // Level complete white flash
            if (levelCompleteFlash > 0) {
                ctx.fillStyle = `rgba(255,255,255,${levelCompleteFlash * 0.3})`;
                ctx.fillRect(0, 0, W, H);
            }
        }

        requestAnimationFrame(gameLoop);
    }

    // ── YouTube Playables SDK: firstFrameReady ─────────────────
    if (hasYTSDK) {
        try { ytgame.game.firstFrameReady(); } catch (_) {}
        window.__sdkSignaled = true;
    }

    // ── Cloud save load + splash screen ──────────────────────
    const splashScreen = document.getElementById("splash-screen");

    function finishInit(cloudData) {
        if (cloudData) {
            applyCloudData(cloudData);
            updateBestDisplay();
            updateCoinDisplay();
            if (typeof applyThemeUI === 'function') applyThemeUI();
        }
        cloudLoadDone = true;

        if (splashScreen) {
            setTimeout(() => {
                splashScreen.classList.add("fade-out");
                setTimeout(() => {
                    splashScreen.remove();
                    if (hasYTSDK) {
                        try { ytgame.game.gameReady(); } catch (_) {}
                    }
                }, 500);
            }, 1200);
        } else {
            if (hasYTSDK) {
                try { ytgame.game.gameReady(); } catch (_) {}
            }
        }
    }

    loadCloudSave().then(finishInit).catch(() => finishInit(null));

    // ── YouTube Playables SDK: Runtime hooks ─────────────────
    if (hasYTSDK) {
        try {
            const audioEnabled = ytgame.system.isAudioEnabled();
            if (!audioEnabled) audioMuted = true;
        } catch (_) {}

        try {
            ytgame.system.onAudioEnabledChange((enabled) => {
                audioMuted = !enabled;
                if (!enabled && audioCtx) {
                    audioCtx.suspend();
                } else if (enabled && audioCtx) {
                    audioCtx.resume();
                }
            });
        } catch (_) {}

        const pauseOverlay = document.getElementById("yt-pause-overlay");

        try {
            ytgame.system.onPause(() => {
                stateBeforePause = state;
                state = "paused";
                audioMuted = true;
                if (audioCtx) audioCtx.suspend();
                document.getElementById("store-screen").classList.remove("show");
                document.getElementById("objectives-screen").classList.remove("show");
                if (pauseOverlay) pauseOverlay.classList.add("show");
                saveToCloud();
            });
        } catch (_) {}

        try {
            ytgame.system.onResume(() => {
                if (pauseOverlay) pauseOverlay.classList.remove("show");
                if (stateBeforePause) {
                    state = stateBeforePause;
                    stateBeforePause = null;
                } else {
                    state = "start";
                }
                if (state === "start") {
                    menuScreen.style.display = "block";
                    menuScreen.classList.remove("exiting");
                }
                try {
                    const audioEnabled = ytgame.system.isAudioEnabled();
                    audioMuted = !audioEnabled;
                    if (audioEnabled && audioCtx) audioCtx.resume();
                } catch (_) {}
            });
        } catch (_) {}
    }

    // ── Init & Start ────────────────────────────────────────────
    checkObjectiveNotify();
    requestAnimationFrame(gameLoop);
})();
