import {
  DEFAULT_PRICES,
  countTiles,
  createGrid,
  findWinner,
  normalizePrices,
  parseQuestions
} from "./game-logic.js";
import { animateBlast, renderHexMap } from "./hex-renderer.js";

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

function readPrices() {
  return normalizePrices(Object.fromEntries(
    Object.entries(priceInputs).map(([type, id]) => [type, byId(id).value])
  ));
}

function writePrices(prices) {
  const normalized = normalizePrices(prices);
  Object.entries(priceInputs).forEach(([type, id]) => {
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
  gameRef.on("value", snapshot => {
    currentGame = snapshot.val();
    if (!currentGame) return;
    renderFromGame(currentGame);
    if (currentGame.state === "started" && !endingRound) {
      const winner = findWinner(
        currentGame.grid,
        safeGridSize(currentGame.gridCols || currentGame.gridSize),
        safeGridSize(currentGame.gridRows || currentGame.gridSize)
      );
      if (winner) finishRound(winner);
    }
    previousState = currentGame.state;
  });
}

function renderFromGame(game) {
  const players = game.players || {};
  const playerList = Object.values(players);
  byId("studentCount").textContent = playerList.length;
  byId("greenCount").textContent = playerList.filter(player => player.team === "green" || player.team === "red").length;
  byId("blueCount").textContent = playerList.filter(player => player.team === "blue").length;

  if (game.state === "waiting") {
    showTeacherView("lobby");
    gameOverOverlay.classList.add("hidden");
  } else if (game.state === "started") {
    showTeacherView("game");
    gameOverOverlay.classList.add("hidden");
    const cols = safeGridSize(game.gridCols || game.gridSize);
    const rows = safeGridSize(game.gridRows || game.gridSize);
    const mapSignature = `${game.roundId || 0}:${JSON.stringify(game.grid || {})}`;
    if (mapSignature !== renderedMapSignature) {
      renderHexMap(teacherMap, game.grid || {}, cols, rows);
      renderedMapSignature = mapSignature;
    }
    animateLatestBlast(game, cols, rows);
    const tileCounts = countTiles(game.grid);
    byId("greenTiles").textContent = tileCounts.green;
    byId("blueTiles").textContent = tileCounts.blue;
  } else if (game.state === "over") {
    showTeacherView("game");
    displayResult(game);
  }

  let correct = 0;
  let total = 0;
  Object.values(game.questionPerformance || {}).forEach(item => {
    correct += Number(item.correctCount) || 0;
    total += Number(item.totalCount) || 0;
  });
  byId("accuracyValue").textContent = total ? `${Math.round(correct / total * 100)}%` : "0%";

  if (previousState === null && game.settings) {
    byId("questionMode").value = game.settings.questionMode || "multiple";
    byId("basesPerTeam").value = String(game.settings.basesPerTeam || 1);
    writePrices(game.settings.prices || DEFAULT_PRICES);
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
        roundId: (Number(game.roundId) || 0) + 1,
        startedAt: Date.now(),
        gridCols: gridSize,
        gridRows: gridSize,
        gridSize,
        grid: newGrid,
        questions,
        settings,
        players,
        questionPerformance: null,
        result: null,
        lastAction: null
      };
    });
  } finally {
    byId("startGameBtn").disabled = false;
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
    await gameRef.transaction(game => {
      if (!game) return game;
      return {
        ...game,
        state: "waiting",
        grid: null,
        result: null,
        questionPerformance: null,
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
