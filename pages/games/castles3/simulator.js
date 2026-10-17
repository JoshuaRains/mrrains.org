import {
  TILE_TYPES,
  applyPlacement,
  getTileCost,
  validatePlacement
} from "./game-logic.js";

const db = window.castlesDb;
const byId = id => document.getElementById(id);
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const MAX_BOTS = 80;
const JOIN_BATCH_SIZE = 8;

let gameCode = "";
let gameRef = null;
let gameListeners = [];
let bots = [];
let autoplay = false;
let connecting = false;
let scheduler = 0;
let simulatorRunId = "";
let renderQueued = false;
let currentGame = emptyGame();

const stats = {
  answers: 0,
  points: 0,
  placements: 0,
  errors: 0,
  operations: []
};

function emptyGame() {
  return { state: null, settings: {}, players: {}, grid: {} };
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function setMessage(message, isError = false) {
  const element = byId("simMessage");
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setConnectedControls(connected) {
  ["simGameCode", "simBotCount", "simConnectionMode"].forEach(id => {
    byId(id).disabled = connected;
  });
  byId("simConnect").disabled = connected;
  byId("simRun").disabled = !connected || !bots.length;
  byId("simRemove").disabled = !connected;
}

function listen(ref, event, callback) {
  ref.on(event, callback);
  gameListeners.push(() => ref.off(event, callback));
}

function startGameCache(code) {
  stopGameCache();
  currentGame = emptyGame();
  gameRef = db.ref(`games/${code}`);

  listen(gameRef.child("state"), "value", snapshot => {
    const previous = currentGame.state;
    currentGame.state = snapshot.val();
    if (autoplay && previous !== "started" && currentGame.state === "started") staggerBots();
    scheduleRender();
  });
  listen(gameRef.child("settings"), "value", snapshot => {
    currentGame.settings = snapshot.val() || {};
  });
  ["gridCols", "gridRows", "gridSize"].forEach(field => {
    listen(gameRef.child(field), "value", snapshot => {
      currentGame[field] = snapshot.val();
    });
  });

  const playersRef = gameRef.child("players");
  listen(playersRef, "child_added", snapshot => {
    currentGame.players[snapshot.key] = snapshot.val();
  });
  listen(playersRef, "child_changed", snapshot => {
    currentGame.players[snapshot.key] = snapshot.val();
  });
  listen(playersRef, "child_removed", snapshot => {
    delete currentGame.players[snapshot.key];
  });

  const gridRef = gameRef.child("grid");
  listen(gridRef, "child_added", snapshot => {
    currentGame.grid[snapshot.key] = snapshot.val();
  });
  listen(gridRef, "child_changed", snapshot => {
    currentGame.grid[snapshot.key] = snapshot.val();
  });
  listen(gridRef, "child_removed", snapshot => {
    delete currentGame.grid[snapshot.key];
  });
}

function stopGameCache() {
  gameListeners.forEach(remove => remove());
  gameListeners = [];
  gameRef = null;
}

function makeBotCard(bot) {
  const card = document.createElement("article");
  card.className = "simulator-bot-card connecting";
  card.dataset.botId = bot.localId;

  const title = document.createElement("strong");
  title.className = "sim-bot-title";
  title.textContent = `Student ${bot.number}`;

  const details = document.createElement("div");
  details.className = "sim-bot-details";
  const team = document.createElement("span");
  team.dataset.field = "team";
  team.textContent = "Connecting";
  const balance = document.createElement("span");
  balance.dataset.field = "balance";
  balance.textContent = "0 tiles";
  details.append(team, balance);

  const activity = document.createElement("span");
  activity.className = "sim-bot-activity";
  activity.dataset.field = "activity";
  activity.textContent = "Joining room…";

  const latency = document.createElement("span");
  latency.className = "sim-bot-latency";
  latency.dataset.field = "latency";

  card.append(title, details, activity, latency);
  byId("simBotGrid").append(card);
  bot.card = card;
}

function updateBotCard(bot) {
  if (!bot.card) return;
  bot.card.classList.toggle("connecting", !bot.connected && !bot.failed);
  bot.card.classList.toggle("failed", bot.failed);
  bot.card.classList.toggle("green", bot.team === "green");
  bot.card.classList.toggle("blue", bot.team === "blue");
  bot.card.querySelector('[data-field="team"]').textContent = bot.failed
    ? "Failed"
    : bot.team ? `${bot.team} team` : "Connecting";
  bot.card.querySelector('[data-field="balance"]').textContent = `${Math.max(0, Number(bot.balance) || 0)} tiles`;
  bot.card.querySelector('[data-field="activity"]').textContent = bot.status || "Ready";
  bot.card.querySelector('[data-field="latency"]').textContent = bot.latency
    ? `${Math.round(bot.latency)} ms` : "";
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderSummary();
  });
}

function renderSummary() {
  const connected = bots.filter(bot => bot.connected).length;
  byId("simConnected").textContent = String(connected);
  byId("simAnswers").textContent = String(stats.answers);
  byId("simPoints").textContent = String(stats.points);
  byId("simPlacements").textContent = String(stats.placements);
  byId("simErrors").textContent = String(stats.errors);
  byId("simRoomState").textContent = currentGame.state
    ? currentGame.state[0].toUpperCase() + currentGame.state.slice(1)
    : "Not connected";
  const cutoff = Date.now() - 10000;
  stats.operations = stats.operations.filter(time => time >= cutoff);
  byId("simRate").textContent = (stats.operations.length / 10).toFixed(1);
}

function recordOperation() {
  stats.operations.push(Date.now());
  scheduleRender();
}

function makeClient(mode, number) {
  if (mode === "shared") {
    return { app: null, database: db };
  }
  const appName = `castles-simulator-${simulatorRunId}-${number}`;
  const app = firebase.initializeApp(window.castlesFirebaseConfig, appName);
  return { app, database: app.database() };
}

async function addBot(number, mode) {
  const bot = {
    number,
    localId: `${simulatorRunId}-${number}`,
    app: null,
    database: null,
    playerRef: null,
    listeners: [],
    connected: false,
    failed: false,
    team: "",
    balance: 0,
    status: "Joining room…",
    latency: 0,
    questionsLoaded: false,
    nextAnswerAt: 0,
    nextPlacementAt: 0,
    busyAnswer: false,
    busyPlacement: false
  };
  bots.push(bot);
  makeBotCard(bot);

  try {
    const client = makeClient(mode, number);
    bot.app = client.app;
    bot.database = client.database;
    const botGameRef = bot.database.ref(`games/${gameCode}`);
    const playersRef = botGameRef.child("players");
    bot.playerRef = playersRef.push();

    let assignedTeam = "";
    const result = await playersRef.transaction(players => {
      const currentPlayers = players || {};
      if (Object.keys(currentPlayers).length >= 100) return;
      const counts = Object.values(currentPlayers).reduce((totals, player) => {
        if (player?.team === "green" || player?.team === "red") totals.green += 1;
        if (player?.team === "blue") totals.blue += 1;
        return totals;
      }, { green: 0, blue: 0 });
      assignedTeam = counts.green < counts.blue
        ? "green"
        : counts.blue < counts.green
          ? "blue"
          : Math.random() < 0.5 ? "green" : "blue";
      return {
        ...currentPlayers,
        [bot.playerRef.key]: {
          team: assignedTeam,
          balance: 0,
          joinedAt: Date.now()
        }
      };
    });

    if (!result.committed) throw new Error("The room is full or no longer available.");
    const playerSnapshot = await bot.playerRef.once("value");
    if (!playerSnapshot.exists()) throw new Error("The bot could not be added.");

    bot.team = playerSnapshot.child("team").val() || assignedTeam;
    bot.balance = Number(playerSnapshot.child("balance").val()) || 0;
    await bot.playerRef.onDisconnect().remove();

    const botListen = (ref, event, callback) => {
      ref.on(event, callback);
      bot.listeners.push(() => ref.off(event, callback));
    };
    botListen(bot.playerRef.child("balance"), "value", snapshot => {
      bot.balance = Number(snapshot.val()) || 0;
      updateBotCard(bot);
    });
    botListen(botGameRef.child("state"), "value", snapshot => {
      bot.roomState = snapshot.val();
    });
    botListen(bot.database.ref(`gameQuestions/${gameCode}`), "value", snapshot => {
      bot.questionsLoaded = snapshot.exists();
    });

    // Prime this client's local game cache. Later placement transactions then
    // behave like real student clients and retry against fresh server state.
    await botGameRef.once("value");
    bot.gameRef = botGameRef;
    bot.connected = true;
    bot.status = "Ready";
    updateBotCard(bot);
  } catch (error) {
    console.error(`Simulator student ${number} failed`, error);
    bot.failed = true;
    bot.status = error?.message || "Could not connect";
    stats.errors += 1;
    updateBotCard(bot);
  }
}

async function connectBots() {
  if (connecting || bots.length) return;
  const code = byId("simGameCode").value.trim().toUpperCase();
  const count = Math.round(clamp(byId("simBotCount").value, 1, MAX_BOTS, 24));
  const mode = byId("simConnectionMode").value;
  byId("simGameCode").value = code;
  byId("simBotCount").value = String(count);

  if (!ROOM_CODE_PATTERN.test(code)) {
    setMessage("Enter a valid six-character game code.", true);
    return;
  }

  connecting = true;
  byId("simConnect").disabled = true;
  const stateSnapshot = await db.ref(`games/${code}/state`).once("value");
  if (!["waiting", "started"].includes(stateSnapshot.val())) {
    connecting = false;
    byId("simConnect").disabled = false;
    setMessage("That room was not found or is no longer accepting players.", true);
    return;
  }

  gameCode = code;
  simulatorRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  stats.answers = 0;
  stats.points = 0;
  stats.placements = 0;
  stats.errors = 0;
  stats.operations = [];
  setConnectedControls(true);
  startGameCache(code);
  setMessage(`Connecting ${count} bot students…`);

  for (let start = 0; start < count; start += JOIN_BATCH_SIZE) {
    const jobs = [];
    for (let index = start; index < Math.min(start + JOIN_BATCH_SIZE, count); index += 1) {
      jobs.push(addBot(index + 1, mode));
    }
    await Promise.all(jobs);
    setMessage(`Connected ${bots.filter(bot => bot.connected).length} of ${count} bot students…`);
    scheduleRender();
  }

  const connected = bots.filter(bot => bot.connected).length;
  byId("simRun").disabled = connected === 0;
  setMessage(connected
    ? `${connected} bots are connected. Start autoplay, then start the round on the teacher page.`
    : "No bots could connect to this room.", connected === 0);
}

function staggerBots() {
  const answerDelay = clamp(byId("simAnswerDelay").value, 250, 30000, 1250);
  const placeDelay = clamp(byId("simPlaceDelay").value, 500, 60000, 2500);
  const now = performance.now();
  bots.forEach(bot => {
    bot.nextAnswerAt = now + Math.random() * answerDelay;
    bot.nextPlacementAt = now + Math.random() * placeDelay;
  });
}

function setAutoplay(running) {
  autoplay = running;
  byId("simRun").textContent = running ? "Pause autoplay" : "Start autoplay";
  byId("simRun").classList.toggle("primary", running);
  if (running) {
    staggerBots();
    setMessage(currentGame.state === "started"
      ? "Bots are answering and placing tiles."
      : "Autoplay is ready and will begin when the teacher starts the round.");
  } else {
    setMessage("Autoplay paused. The bots remain connected.");
  }
}

async function answerAsBot(bot) {
  if (bot.busyAnswer || !bot.connected) return;
  bot.busyAnswer = true;
  const started = performance.now();
  const accuracy = clamp(byId("simAccuracy").value, 0, 100, 85) / 100;
  const correct = Math.random() < accuracy;
  stats.answers += 1;
  recordOperation();

  try {
    if (correct) {
      const result = await bot.playerRef.child("balance").transaction(balance => {
        if (balance === null || balance === undefined) return;
        return (Number(balance) || 0) + 1;
      });
      if (!result.committed) throw new Error("Point update was not committed.");
      stats.points += 1;
      bot.status = "Correct answer +1";
    } else {
      bot.status = "Incorrect answer";
    }
    bot.latency = performance.now() - started;
  } catch (error) {
    console.error("Simulated answer failed", error);
    bot.status = "Answer failed";
    stats.errors += 1;
  } finally {
    bot.busyAnswer = false;
    updateBotCard(bot);
    scheduleRender();
  }
}

function rotated(values, start) {
  return values.map((_, index) => values[(start + index) % values.length]);
}

function findPlacement(bot) {
  const player = currentGame.players[bot.playerRef?.key];
  if (!player) return null;
  const balance = Number(player.balance) || 0;
  const weightedTypes = [
    "regular", "regular", "regular", "regular",
    "armored", "armored", "explosive1", "explosive2", "repair"
  ].filter(type => balance >= getTileCost(currentGame, type));
  if (!weightedTypes.length) return null;

  const uniqueTypes = [...new Set(rotated(
    weightedTypes,
    Math.floor(Math.random() * weightedTypes.length)
  ))];
  const cols = Math.max(7, Math.min(32, Number(currentGame.gridCols || currentGame.gridSize) || 15));
  const rows = Math.max(7, Math.min(32, Number(currentGame.gridRows || currentGame.gridSize) || 15));
  const total = cols * rows;
  const start = Math.floor(Math.random() * total);

  for (const tileType of uniqueTypes) {
    for (let offset = 0; offset < total; offset += 1) {
      const position = (start + offset) % total;
      const q = position % cols;
      const r = Math.floor(position / cols);
      if (validatePlacement(currentGame, bot.playerRef.key, tileType, q, r).ok) {
        return { tileType, q, r };
      }
    }
  }
  return null;
}

async function placeAsBot(bot) {
  if (bot.busyPlacement || !bot.connected || !byId("simPlaceTiles").checked) return;
  const candidate = findPlacement(bot);
  if (!candidate) return;
  bot.busyPlacement = true;
  const started = performance.now();
  let failure = "Placement was rejected.";
  recordOperation();

  try {
    const result = await bot.gameRef.transaction(game => {
      if (!game) return;
      const placement = applyPlacement(
        game,
        bot.playerRef.key,
        candidate.tileType,
        candidate.q,
        candidate.r
      );
      if (!placement.ok) {
        failure = placement.reason;
        return;
      }
      return placement.game;
    });
    if (!result.committed) {
      bot.status = failure;
    } else {
      stats.placements += 1;
      bot.status = `Placed ${TILE_TYPES[candidate.tileType].name}`;
    }
    bot.latency = performance.now() - started;
  } catch (error) {
    console.error("Simulated placement failed", error);
    bot.status = "Placement failed";
    stats.errors += 1;
  } finally {
    bot.busyPlacement = false;
    updateBotCard(bot);
    scheduleRender();
  }
}

function runScheduler() {
  if (!autoplay || currentGame.state !== "started") return;
  const now = performance.now();
  const answerDelay = clamp(byId("simAnswerDelay").value, 250, 30000, 1250);
  const placeDelay = clamp(byId("simPlaceDelay").value, 500, 60000, 2500);

  bots.forEach(bot => {
    if (!bot.connected) return;
    if (bot.questionsLoaded && now >= bot.nextAnswerAt) {
      bot.nextAnswerAt = now + answerDelay * (0.8 + Math.random() * 0.4);
      void answerAsBot(bot);
    }
    if (now >= bot.nextPlacementAt) {
      bot.nextPlacementAt = now + placeDelay * (0.8 + Math.random() * 0.4);
      void placeAsBot(bot);
    }
  });
}

async function removeBot(bot) {
  bot.listeners.forEach(remove => remove());
  bot.listeners = [];
  try {
    if (bot.playerRef) {
      await bot.playerRef.onDisconnect().cancel();
      await bot.playerRef.remove();
    }
  } catch (error) {
    console.error("Could not remove simulated student", error);
  }
  if (bot.app) {
    try {
      await bot.app.delete();
    } catch (error) {
      console.error("Could not close simulated Firebase client", error);
    }
  }
}

async function removeBots() {
  setAutoplay(false);
  byId("simRemove").disabled = true;
  setMessage(`Removing ${bots.length} bot students…`);
  const removing = [...bots];
  for (let start = 0; start < removing.length; start += JOIN_BATCH_SIZE) {
    await Promise.all(removing.slice(start, start + JOIN_BATCH_SIZE).map(removeBot));
  }
  bots = [];
  byId("simBotGrid").replaceChildren();
  stopGameCache();
  currentGame = emptyGame();
  gameCode = "";
  connecting = false;
  setConnectedControls(false);
  setMessage("Bots removed. You can connect another simulated class.");
  scheduleRender();
}

byId("simConnect").addEventListener("click", () => {
  connectBots().catch(error => {
    console.error(error);
    connecting = false;
    setConnectedControls(false);
    setMessage("The simulator could not connect to Firebase.", true);
  });
});
byId("simRun").addEventListener("click", () => setAutoplay(!autoplay));
byId("simRemove").addEventListener("click", () => void removeBots());
byId("simGameCode").addEventListener("input", event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
});

scheduler = window.setInterval(runScheduler, 100);
window.setInterval(renderSummary, 500);
window.addEventListener("beforeunload", () => {
  window.clearInterval(scheduler);
  bots.forEach(bot => {
    if (bot.playerRef) void bot.playerRef.remove();
  });
});

renderSummary();
