import {
  TEAM_COLORS,
  TILE_TYPES,
  applyPlacement,
  getTileCost,
  normalizeAnswer,
  validatePlacement
} from "./game-logic.js";
import { animateBlast, renderHexMap, renderTileIcon } from "./hex-renderer.js";

const db = window.castlesDb;
const byId = id => document.getElementById(id);
const safeGridSize = value => Math.max(7, Math.min(32, Math.round(Number(value) || 15)));

let gameCode = "";
let gameRef = null;
let studentId = "";
let studentTeam = "";
let currentGame = null;
let currentRoundId = null;
let questionOrder = [];
let currentQuestion = null;
let currentQuestionIndex = null;
let currentQuestionMode = "multiple";
let answering = false;
let selectedType = null;
let placementMessage = "";
let lastAnimatedAction = "";
let renderedMapSignature = "";

const joinScreen = byId("joinScreen");
const gameScreen = byId("gameScreen");
const waitingOverlay = byId("waitingOverlay");
const gameOverOverlay = byId("gameOverOverlay");
const questionText = byId("questionText");
const questionMeta = byId("questionMeta");
const answerArea = byId("answerArea");
const feedback = byId("answerFeedback");
const studentMap = byId("studentMap");

function shuffled(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function sanitizeQuestion(question) {
  return String(question).replace(/[.#$\[\]/]/g, "_").slice(0, 180);
}

async function joinGame() {
  const input = byId("gameCodeInput");
  const error = byId("joinError");
  const button = byId("joinGameBtn");
  gameCode = input.value.trim().toUpperCase();
  error.textContent = "";
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(gameCode)) {
    error.textContent = "Enter the six-character game code.";
    return;
  }

  button.disabled = true;
  gameRef = db.ref(`games/${gameCode}`);
  const playersRef = gameRef.child("players");
  studentId = playersRef.push().key;
  let assignedTeam = "";

  try {
    // Read the room before starting a transaction. A transaction's first local
    // callback can receive null before Firebase has downloaded the room; treating
    // that provisional null as "not found" caused valid codes to be rejected.
    const roomSnapshot = await gameRef.once("value");
    if (!roomSnapshot.exists()) {
      error.textContent = "Game not found. Check the code and try again.";
      button.disabled = false;
      return;
    }

    const result = await gameRef.transaction(game => {
      if (!game || !["waiting", "started"].includes(game.state)) return;
      const players = game.players || {};
      if (Object.keys(players).length >= 100) return;
      const counts = Object.values(players).reduce((total, player) => {
        if (player.team === "green" || player.team === "red") total.green += 1;
        if (player.team === "blue") total.blue += 1;
        return total;
      }, { green: 0, blue: 0 });
      assignedTeam = counts.green < counts.blue
        ? "green"
        : counts.blue < counts.green
          ? "blue"
          : Math.random() < 0.5 ? "green" : "blue";
      return {
        ...game,
        players: {
          ...players,
          [studentId]: {
            team: assignedTeam,
            balance: 0,
            joinedAt: Date.now()
          }
        }
      };
    });

    if (!result.committed) {
      error.textContent = "This game is no longer accepting players.";
      button.disabled = false;
      return;
    }
    studentTeam = result.snapshot.child(`players/${studentId}/team`).val() || assignedTeam;
    await gameRef.child(`players/${studentId}`).onDisconnect().remove();
    byId("teamChip").textContent = `Team: ${studentTeam.toUpperCase()}`;
    byId("teamChip").style.color = TEAM_COLORS[studentTeam];
    byId("codeChip").textContent = `Code: ${gameCode}`;
    joinScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    buildShop();
    gameRef.on("value", handleGameSnapshot);
  } catch (exception) {
    console.error(exception);
    error.textContent = "Could not connect to the game. Please try again.";
    button.disabled = false;
  }
}

function handleGameSnapshot(snapshot) {
  currentGame = snapshot.val();
  if (!currentGame) {
    waitingOverlay.classList.add("hidden");
    gameOverOverlay.classList.remove("hidden");
    byId("studentWinnerText").textContent = "This game room has closed.";
    return;
  }

  if (currentGame.players?.[studentId]?.team) {
    studentTeam = currentGame.players[studentId].team;
  }
  updateBalance();
  renderShop();

  if (currentGame.state === "waiting") {
    waitingOverlay.classList.remove("hidden");
    gameOverOverlay.classList.add("hidden");
    questionText.textContent = "Waiting for the round to start…";
    questionMeta.textContent = "You're still connected";
    answerArea.replaceChildren();
    renderMap();
    return;
  }

  if (currentGame.state === "over") {
    waitingOverlay.classList.add("hidden");
    gameOverOverlay.classList.remove("hidden");
    const winner = currentGame.result?.winner;
    byId("studentWinnerText").textContent = winner === "tie"
      ? "The round ended in a tie."
      : winner
        ? `${winner === "green" ? "Green" : "Blue"} team wins!`
        : "The round has ended.";
    renderMap();
    return;
  }

  waitingOverlay.classList.add("hidden");
  gameOverOverlay.classList.add("hidden");
  const mapSignature = `${currentGame.roundId || 0}:${JSON.stringify(currentGame.grid || {})}`;
  if (mapSignature !== renderedMapSignature) renderMap();
  animateLatestBlast();

  if (currentRoundId !== currentGame.roundId) {
    currentRoundId = currentGame.roundId;
    questionOrder = [];
    answering = false;
    showNextQuestion();
  }
}

function chooseQuestionMode(question) {
  const settings = currentGame.settings || {};
  let mode = settings.questionMode || "multiple";
  if (mode === "multiple" && (!question.options || question.options.length < 2)) mode = "typing";
  return mode;
}

function showNextQuestion() {
  const questions = currentGame?.questions
    ? (Array.isArray(currentGame.questions) ? currentGame.questions : Object.values(currentGame.questions))
    : [];
  feedback.textContent = "";
  feedback.className = "feedback";
  answering = false;

  if (!questions.length) {
    questionText.textContent = "Waiting for questions…";
    questionMeta.textContent = "Your teacher has not added any questions yet";
    answerArea.replaceChildren();
    return;
  }

  if (!questionOrder.length) questionOrder = shuffled(questions.map((_, index) => index));
  currentQuestionIndex = questionOrder.pop();
  currentQuestion = questions[currentQuestionIndex];
  currentQuestionMode = chooseQuestionMode(currentQuestion);
  questionText.textContent = currentQuestion.question;
  questionMeta.textContent = `${currentQuestionMode === "typing" ? "Type" : "Choose"} the answer · +1 tile`;

  if (currentQuestionMode === "typing") renderTypingAnswer();
  else renderMultipleChoice();
}

function renderMultipleChoice() {
  answerArea.className = "options";
  answerArea.replaceChildren();
  shuffled(currentQuestion.options || []).forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option;
    button.addEventListener("click", () => gradeAnswer(option, button));
    answerArea.appendChild(button);
  });
}

function renderTypingAnswer() {
  answerArea.className = "typing-wrap";
  answerArea.replaceChildren();
  const row = document.createElement("div");
  row.className = "typing-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type your answer";
  input.autocomplete = "off";
  input.maxLength = 200;
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "primary";
  submit.textContent = "Submit";
  submit.addEventListener("click", () => gradeAnswer(input.value, input));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") gradeAnswer(input.value, input);
  });
  row.append(input, submit);

  const accents = document.createElement("div");
  accents.className = "accent-row";
  ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"].forEach(symbol => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = symbol;
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(symbol, start, end, "end");
      input.focus();
    });
    accents.appendChild(button);
  });
  answerArea.append(row, accents);
  window.setTimeout(() => input.focus(), 0);
}

async function gradeAnswer(givenAnswer, sourceElement) {
  if (answering || currentGame?.state !== "started") return;
  answering = true;
  [...answerArea.querySelectorAll("button, input")].forEach(element => { element.disabled = true; });

  try {
    const result = await recordAnswer(givenAnswer);

    if (currentQuestionMode === "multiple") {
      [...answerArea.querySelectorAll("button")].forEach(button => {
        if (normalizeAnswer(button.textContent) === normalizeAnswer(result.correctAnswer)) button.classList.add("correct");
      });
      if (!result.isCorrect) sourceElement.classList.add("incorrect");
    }

    if (result.isCorrect) {
      feedback.textContent = `Correct! +${result.reward} ${result.reward === 1 ? "tile" : "tiles"}`;
      feedback.className = "feedback good";
      showRewardAnimation(result.reward);
    } else {
      feedback.textContent = `Answer: ${result.correctAnswer}`;
      feedback.className = "feedback bad";
    }
    window.setTimeout(showNextQuestion, result.isCorrect ? 750 : 1400);
  } catch (error) {
    feedback.textContent = "That answer could not be verified. Please try again.";
    feedback.className = "feedback bad";
    answering = false;
    [...answerArea.querySelectorAll("button, input")].forEach(element => { element.disabled = false; });
  }
}

async function recordAnswer(givenAnswer) {
  const selectedAnswer = String(givenAnswer);
  if (selectedAnswer.length > 200) throw new Error("Answer is too long.");
  const responseId = gameRef.child(`players/${studentId}/responses`).push().key;
  let verified = null;

  const transaction = await gameRef.transaction(game => {
    if (!game || game.state !== "started" || !game.players?.[studentId]) return;
    const questions = Array.isArray(game.questions)
      ? game.questions
      : Object.values(game.questions || {});
    const question = questions[currentQuestionIndex];

    // Verify against the room's stored question, never against editable page text.
    if (!question || question.question !== currentQuestion?.question) return;

    const isCorrect = normalizeAnswer(selectedAnswer) === normalizeAnswer(question.answer);
    const reward = isCorrect ? 1 : 0;
    const player = game.players[studentId];
    const performanceKey = sanitizeQuestion(question.question);
    const performance = game.questionPerformance?.[performanceKey] || {};
    verified = { isCorrect, reward, correctAnswer: question.answer };

    return {
      ...game,
      players: {
        ...game.players,
        [studentId]: {
          ...player,
          balance: (Number(player.balance) || 0) + reward,
          responses: {
            ...(player.responses || {}),
            [responseId]: {
              question: question.question,
              selected: selectedAnswer,
              correctAnswer: question.answer,
              correct: isCorrect,
              reward,
              timestamp: Date.now()
            }
          }
        }
      },
      questionPerformance: {
        ...(game.questionPerformance || {}),
        [performanceKey]: {
          correctCount: (Number(performance.correctCount) || 0) + (isCorrect ? 1 : 0),
          totalCount: (Number(performance.totalCount) || 0) + 1
        }
      }
    };
  });

  if (!transaction.committed || !verified) throw new Error("Answer verification failed.");
  return verified;
}

function showRewardAnimation(amount) {
  const pop = document.createElement("span");
  pop.className = "reward-pop";
  pop.textContent = `+${amount}`;
  byId("balanceDisplay").appendChild(pop);
  pop.addEventListener("animationend", () => pop.remove());
}

function updateBalance() {
  byId("balanceValue").textContent = Number(currentGame?.players?.[studentId]?.balance) || 0;
}

function buildShop() {
  const shop = byId("shopList");
  shop.replaceChildren();
  Object.entries(TILE_TYPES).forEach(([type, definition]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shop-item";
    button.dataset.type = type;
    button.title = definition.description;

    const name = document.createElement("span");
    name.className = "shop-name";
    name.textContent = definition.name;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("shop-icon");
    const price = document.createElement("span");
    price.className = "shop-price";
    const priceValue = document.createElement("strong");
    priceValue.dataset.price = "";
    priceValue.textContent = definition.cost;
    price.append("Cost: ", priceValue);
    button.append(name, icon, price);
    renderTileIcon(icon, type, TEAM_COLORS[studentTeam] || TEAM_COLORS.blue);
    button.addEventListener("click", () => {
      selectedType = selectedType === type ? null : type;
      placementMessage = "";
      renderShop();
      renderMap();
    });
    shop.appendChild(button);
  });
  renderShop();
}

function renderShop() {
  const balance = Number(currentGame?.players?.[studentId]?.balance) || 0;
  byId("shopList").querySelectorAll(".shop-item").forEach(button => {
    const type = button.dataset.type;
    const cost = getTileCost(currentGame, type);
    button.querySelector("[data-price]").textContent = cost;
    const unaffordable = balance < cost || currentGame?.state !== "started";
    button.disabled = unaffordable;
    button.classList.toggle("unaffordable", unaffordable);
    button.classList.toggle("selected", selectedType === type);
  });
}

function renderMap() {
  const cols = safeGridSize(currentGame?.gridCols || currentGame?.gridSize);
  const rows = safeGridSize(currentGame?.gridRows || currentGame?.gridSize);
  const grid = currentGame?.grid || {};
  renderHexMap(studentMap, grid, cols, rows, {
    interactive: currentGame?.state === "started",
    selectedType,
    isValid: (q, r) => validatePlacement(currentGame, studentId, selectedType, q, r),
    onSelect: placeSelectedTile
  });
  renderedMapSignature = `${currentGame?.roundId || 0}:${JSON.stringify(grid)}`;

  const help = byId("mapHelp");
  if (placementMessage) help.textContent = placementMessage;
  else if (!selectedType) help.textContent = "Earn tiles, choose an item, then place it on a highlighted hex.";
  else help.textContent = `${TILE_TYPES[selectedType].name}: ${TILE_TYPES[selectedType].description}`;
}

function animateLatestBlast() {
  const action = currentGame?.lastAction;
  if (!action || (action.tileType !== "explosive1" && action.tileType !== "explosive2")) return;
  const signature = [action.at, action.playerId, action.tileType, action.q, action.r].join(":");
  if (signature === lastAnimatedAction) return;
  lastAnimatedAction = signature;
  animateBlast(
    studentMap,
    Number(action.q),
    Number(action.r),
    action.tileType,
    safeGridSize(currentGame.gridCols || currentGame.gridSize),
    safeGridSize(currentGame.gridRows || currentGame.gridSize)
  );
}

async function placeSelectedTile(q, r) {
  if (!selectedType || currentGame?.state !== "started") {
    placementMessage = "Choose an item from the tile shop first.";
    renderMap();
    return;
  }

  const localValidation = validatePlacement(currentGame, studentId, selectedType, q, r);
  if (!localValidation.ok) {
    placementMessage = localValidation.reason;
    renderMap();
    return;
  }

  const attemptedType = selectedType;
  let failureReason = "That move is no longer available.";
  const result = await gameRef.transaction(game => {
    const placement = applyPlacement(game, studentId, attemptedType, q, r);
    if (!placement.ok) {
      failureReason = placement.reason;
      return;
    }
    return placement.game;
  });

  if (result.committed) {
    placementMessage = `${TILE_TYPES[attemptedType].name} placed.`;
  } else {
    placementMessage = failureReason;
  }
  renderShop();
  if (result.committed) {
    byId("mapHelp").textContent = placementMessage;
  } else {
    renderMap();
  }
}

byId("joinGameBtn").addEventListener("click", joinGame);
byId("gameCodeInput").addEventListener("keydown", event => {
  if (event.key === "Enter") joinGame();
});

const codeFromUrl = new URLSearchParams(window.location.search).get("code");
if (codeFromUrl) byId("gameCodeInput").value = codeFromUrl.toUpperCase();
