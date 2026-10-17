import {
  DEFAULT_PRICES,
  countTiles,
  createGrid,
  findWinner,
  normalizePrices,
  parseQuestions
} from "./game-logic.js";
import { animateBlast, renderHexMap, updateHexCell } from "./hex-renderer.js";

const db = window.castlesDb;
const byId = id => document.getElementById(id);
const safeGridSize = value => Math.max(7, Math.min(32, Math.round(Number(value) || 15)));

let gameCode = "";
let gameRef = null;
let currentGame = null;
let previousState = null;
let endingRound = false;
let lastAnimatedAction = "";
let renderedMapSignature = "";
let teacherGridReady = false;
let winnerCheckTimer = 0;

const createSection = byId("createSection");
const lobbySection = byId("lobbySection");
const gameSection = byId("gameSection");
const gameOverOverlay = byId("gameOverOverlay");
const teacherMap = byId("teacherMap");
const priceInputs = {
  regular: "priceRegular",
  armored: "priceArmored",
  explosive1: "priceExplosive1",
  explosive2: "priceExplosive2",
  repair: "priceRepair"
};
const livePriceInputs = {
  regular: "livePriceRegular",
  armored: "livePriceArmored",
  explosive1: "livePriceExplosive1",
  explosive2: "livePriceExplosive2",
  repair: "livePriceRepair"
};

function readPrices(inputs = priceInputs) {
  return normalizePrices(Object.fromEntries(
    Object.entries(inputs).map(([type, id]) => [type, byId(id).value])
  ));
}

function writePrices(prices, inputs = priceInputs) {
  const normalized = normalizePrices(prices);
  Object.entries(inputs).forEach(([type, id]) => {
    byId(id).value = normalized[type];
  });
}

function generateCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function initialGameState() {
  return {
    state: "waiting",
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    roundId: 0,
    settings: {
      questionMode: "multiple",
      basesPerTeam: 1,
      prices: DEFAULT_PRICES
    }
  };
}

async function reserveGame() {
  for (let attempts = 0; attempts < 8; attempts += 1) {
    const candidate = generateCode();
    const candidateRef = db.ref(`games/${candidate}`);
    const result = await candidateRef.transaction(game => game === null ? initialGameState() : undefined);
    if (result.committed) return { code: candidate, ref: candidateRef };
  }
  throw new Error("Could not reserve a game code. Please try again.");
}

function showTeacherView(state) {
  createSection.classList.toggle("hidden", state !== "create");
  lobbySection.classList.toggle("hidden", state !== "lobby");
  gameSection.classList.toggle("hidden", state !== "game");
}

async function createGame() {
  const button = byId("createGameBtn");
  button.disabled = true;
  try {
    const reservation = await reserveGame();
    gameCode = reservation.code;
    gameRef = reservation.ref;
    await db.ref(`gameQuestions/${gameCode}`).remove();
    byId("gameCodeDisplay").textContent = gameCode;
    byId("teacherCode").textContent = `Game code: ${gameCode}`;
    byId("teacherCode").classList.remove("hidden");
    listenToGame();
    showTeacherView("lobby");
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = "Try again";
  }
}

function listenToGame() {
  currentGame = { players: {}, grid: {}, settings: {} };

  gameRef.child("state").on("value", snapshot => {
    currentGame.state = snapshot.val();
    renderFromGame(currentGame);
    previousState = currentGame.state;
  });
  gameRef.child("settings").on("value", snapshot => {
    currentGame.settings = snapshot.val() || {};
    if (previousState === null) {
      byId("questionMode").value = currentGame.settings.questionMode || "multiple";
      byId("basesPerTeam").value = String(currentGame.settings.basesPerTeam || 1);
      writePrices(currentGame.settings.prices || DEFAULT_PRICES);
    }
  });
  gameRef.child("result").on("value", snapshot => {
    currentGame.result = snapshot.val();
    if (currentGame.state === "over") displayResult(currentGame);
  });
  gameRef.child("startedAt").on("value", snapshot => { currentGame.startedAt = snapshot.val(); });
  gameRef.child("roundId").on("value", snapshot => { currentGame.roundId = snapshot.val(); });
  ["gridCols", "gridRows", "gridSize"].forEach(field => {
    gameRef.child(field).on("value", snapshot => {
      currentGame[field] = snapshot.val();
      if (currentGame.state === "started") renderTeacherMap(true);
    });
  });
  gameRef.child("lastAction").on("value", snapshot => {
    currentGame.lastAction = snapshot.val();
    animateLatestBlast(
      currentGame,
      safeGridSize(currentGame.gridCols || currentGame.gridSize),
      safeGridSize(currentGame.gridRows || currentGame.gridSize)
    );
  });

  const playersRef = gameRef.child("players");
  const applyPlayer = (snapshot, removed = false) => {
    const oldTeam = currentGame.players[snapshot.key]?.team;
    if (removed) delete currentGame.players[snapshot.key];
    else currentGame.players[snapshot.key] = snapshot.val();
    if (removed || oldTeam !== currentGame.players[snapshot.key]?.team) renderPlayerCounts();
  };
  playersRef.once("value").then(snapshot => {
    currentGame.players = snapshot.val() || {};
    renderPlayerCounts();
    playersRef.on("child_added", child => applyPlayer(child));
    playersRef.on("child_changed", child => applyPlayer(child));
    playersRef.on("child_removed", child => applyPlayer(child, true));
  });

  const gridRef = gameRef.child("grid");
  const applyGrid = (snapshot, removed = false) => {
    const [q, r] = snapshot.key.split("_").map(Number);
    const cell = removed ? { team: null, type: null } : (snapshot.val() || { team: null, type: null });
    const previous = currentGame.grid[snapshot.key];
    if (!removed && JSON.stringify(previous) === JSON.stringify(cell)) return;
    if (removed && !previous) return;
    if (removed) delete currentGame.grid[snapshot.key];
    else currentGame.grid[snapshot.key] = cell;
    if (teacherGridReady) updateHexCell(teacherMap, cell, q, r);
    updateTeacherGameStats();
  };
  gridRef.once("value").then(snapshot => {
    currentGame.grid = snapshot.val() || {};
    teacherGridReady = true;
    renderTeacherMap(true);
    updateTeacherGameStats();
    gridRef.on("child_added", child => applyGrid(child));
    gridRef.on("child_changed", child => applyGrid(child));
    gridRef.on("child_removed", child => applyGrid(child, true));
  });
}

function renderPlayerCounts() {
  const playerList = Object.values(currentGame?.players || {});
  byId("studentCount").textContent = playerList.length;
  byId("greenCount").textContent = playerList.filter(player => player.team === "green" || player.team === "red").length;
  byId("blueCount").textContent = playerList.filter(player => player.team === "blue").length;
}

function renderTeacherMap(force = false) {
  const cols = safeGridSize(currentGame?.gridCols || currentGame?.gridSize);
  const rows = safeGridSize(currentGame?.gridRows || currentGame?.gridSize);
  const signature = `${cols}x${rows}`;
  if (!force && signature === renderedMapSignature && teacherMap.childElementCount) return;
  renderHexMap(teacherMap, currentGame?.grid || {}, cols, rows);
  renderedMapSignature = signature;
}

function updateTeacherGameStats() {
  const tileCounts = countTiles(currentGame?.grid);
  byId("greenTiles").textContent = tileCounts.green;
  byId("blueTiles").textContent = tileCounts.blue;
  window.clearTimeout(winnerCheckTimer);
  winnerCheckTimer = window.setTimeout(checkForWinner, 100);
}

function checkForWinner() {
  if (currentGame?.state !== "started" || endingRound) return;
  const expectedBases = (Number(currentGame.settings?.basesPerTeam) || 1) * 2;
  const actualBases = Object.values(currentGame.grid || {}).filter(cell => cell.capital).length;
  if (actualBases < expectedBases) return;
  const winner = findWinner(
    currentGame.grid,
    safeGridSize(currentGame.gridCols || currentGame.gridSize),
    safeGridSize(currentGame.gridRows || currentGame.gridSize)
  );
  if (winner) finishRound(winner);
}

function renderFromGame(game) {
  renderPlayerCounts();

  if (game.state === "waiting") {
    showTeacherView("lobby");
    gameOverOverlay.classList.add("hidden");
  } else if (game.state === "started") {
    showTeacherView("game");
    gameOverOverlay.classList.add("hidden");
    if (previousState !== "started") writePrices(game.settings?.prices || DEFAULT_PRICES, livePriceInputs);
    renderTeacherMap();
    updateTeacherGameStats();
  } else if (game.state === "over") {
    showTeacherView("game");
    displayResult(game);
  }

}

function animateLatestBlast(game, cols, rows) {
  const action = game?.lastAction;
  if (!action || (action.tileType !== "explosive1" && action.tileType !== "explosive2")) return;
  const signature = [action.at, action.playerId, action.tileType, action.q, action.r].join(":");
  if (signature === lastAnimatedAction) return;
  lastAnimatedAction = signature;
  animateBlast(teacherMap, Number(action.q), Number(action.r), action.tileType, cols, rows);
}

function displayResult(game) {
  const result = game.result || {};
  const counts = result.tileCounts || countTiles(game.grid);
  const winner = result.winner;
  byId("winnerText").textContent = winner === "tie"
    ? "The round ended in a tie."
    : winner
      ? `${winner === "green" ? "Green" : "Blue"} team wins!`
      : "The round has ended.";
  byId("tileCounts").textContent = `Green: ${counts.green || 0} tiles · Blue: ${counts.blue || 0} tiles`;
  const elapsed = Number(result.roundSeconds);
  byId("roundTime").textContent = Number.isFinite(elapsed) ? `Round time: ${elapsed} seconds` : "";
  gameOverOverlay.classList.remove("hidden");
}

async function startGame() {
  const error = byId("lobbyError");
  error.textContent = "";
  const questions = parseQuestions(byId("questionBox").value);
  if (!questions.length) {
    error.textContent = "Add at least one valid question before starting.";
    return;
  }

  const gridSize = safeGridSize(byId("gridSizeInput").value);
  const questionMode = byId("questionMode").value;
  if (questionMode === "multiple" && questions.some(question => question.options.length < 2)) {
    error.textContent = "Multiple-choice mode needs four choices and an answer on every line.";
    return;
  }

  const settings = {
    questionMode,
    basesPerTeam: Math.max(1, Math.min(4, Math.round(Number(byId("basesPerTeam").value) || 1))),
    prices: readPrices()
  };
  let newGrid;
  try {
    newGrid = createGrid(gridSize, gridSize, settings.basesPerTeam);
  } catch (createError) {
    error.textContent = createError.message;
    return;
  }

  byId("startGameBtn").disabled = true;
  try {
    const nextRoundId = (Number(currentGame.roundId) || 0) + 1;
    await db.ref(`gameQuestions/${gameCode}`).set({ roundId: nextRoundId, items: questions });
    await gameRef.transaction(game => {
      if (!game) return game;
      const players = {};
      Object.entries(game.players || {}).forEach(([id, player]) => {
        players[id] = {
          team: player.team === "red" ? "green" : player.team,
          joinedAt: player.joinedAt || Date.now(),
          balance: 0
        };
      });
      return {
        ...game,
        state: "started",
        roundId: nextRoundId,
        startedAt: Date.now(),
        gridCols: gridSize,
        gridRows: gridSize,
        gridSize,
        grid: newGrid,
        questions: null,
        questionSet: null,
        settings,
        players,
        questionPerformance: null,
        result: null,
        lastAction: null
      };
    });
  } catch (startError) {
    console.error(startError);
    error.textContent = "Could not start the game. Check the connection and try again.";
  } finally {
    byId("startGameBtn").disabled = false;
  }
}

async function updateLivePrices() {
  if (!gameRef || currentGame?.state !== "started") return;
  const button = byId("applyPricesBtn");
  const status = byId("priceUpdateStatus");
  const prices = readPrices(livePriceInputs);
  button.disabled = true;
  status.textContent = "Saving…";
  try {
    await gameRef.child("settings/prices").set(prices);
    writePrices(prices, livePriceInputs);
    writePrices(prices);
    status.textContent = "Prices updated";
    window.setTimeout(() => {
      if (status.textContent === "Prices updated") status.textContent = "";
    }, 1400);
  } catch (error) {
    console.error(error);
    status.textContent = "Could not update prices";
  } finally {
    button.disabled = false;
  }
}

async function finishRound(forcedWinner = null) {
  if (!gameRef || endingRound) return;
  endingRound = true;
  try {
    await gameRef.transaction(game => {
      if (!game || game.state !== "started") return game;
      const tileCounts = countTiles(game.grid);
      let winner = forcedWinner;
      if (!winner) {
        if (tileCounts.green > tileCounts.blue) winner = "green";
        else if (tileCounts.blue > tileCounts.green) winner = "blue";
        else winner = "tie";
      }
      return {
        ...game,
        state: "over",
        result: {
          winner,
          tileCounts,
          roundSeconds: Math.max(0, Math.floor((Date.now() - Number(game.startedAt || Date.now())) / 1000)),
          endedAt: Date.now()
        }
      };
    });
  } finally {
    endingRound = false;
  }
}

async function newGame() {
  byId("newGameBtn").disabled = true;
  try {
    await db.ref(`gameQuestions/${gameCode}`).remove();
    await gameRef.transaction(game => {
      if (!game) return game;
      return {
        ...game,
        state: "waiting",
        grid: null,
        questions: null,
        questionSet: null,
        result: null,
        lastAction: null,
        startedAt: null
      };
    });
  } finally {
    byId("newGameBtn").disabled = false;
  }
}

byId("createGameBtn").addEventListener("click", createGame);
byId("startGameBtn").addEventListener("click", startGame);
byId("endGameBtn").addEventListener("click", () => finishRound());
byId("newGameBtn").addEventListener("click", newGame);
byId("applyPricesBtn").addEventListener("click", updateLivePrices);
