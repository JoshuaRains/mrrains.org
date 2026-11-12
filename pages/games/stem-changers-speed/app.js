const {
  VERBS,
  DECIR_FORMS,
  answerMatches,
  avoidRepeatedOrder,
  formatElapsed,
  shuffleVerbs
} = window.StemChangersLogic;

const startScreen = document.querySelector("#start-screen");
const practiceScreen = document.querySelector("#practice-screen");
const startButton = document.querySelector("#start-button");
const newRoundButton = document.querySelector("#new-round-button");
const leftTableBody = document.querySelector("#left-verb-rows");
const rightTableBody = document.querySelector("#right-verb-rows");
const decirGrid = document.querySelector("#decir-grid");
const timer = document.querySelector("#timer");
const progress = document.querySelector("#progress");
const status = document.querySelector("#status");
const finishMessage = document.querySelector("#finish-message");

const TOTAL_BLANKS = (VERBS.length * 3) + DECIR_FORMS.length;
let fields = [];
let currentFieldIndex = -1;
let previousOrder = null;
let solvedCount = 0;
let revealedCount = 0;
let startedAt = 0;
let elapsedAtFinish = 0;
let timerInterval = null;
let roundActive = false;

function fieldMarkup(label, canonical, accepted, extraClass = "") {
  return `
    <input
      class="answer-input ${extraClass}"
      type="text"
      inputmode="text"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      aria-label="${label}"
      data-canonical="${canonical}"
      data-accepted='${JSON.stringify(accepted)}'
      readonly
    >`;
}

function verbRowMarkup(verb) {
  return `
    <tr>
      <th scope="row">${verb.infinitive}</th>
      <td>${fieldMarkup(`English meaning for ${verb.infinitive}`, verb.english, verb.acceptedEnglish)}</td>
      <td>
        <div class="stem-change">
          ${fieldMarkup(`Original stem vowel for ${verb.infinitive}`, verb.from, [verb.from], "stem-input")}
          <span aria-hidden="true">→</span>
          ${fieldMarkup(`Changed stem letters for ${verb.infinitive}`, verb.to, [verb.to], "stem-input")}
        </div>
      </td>
    </tr>`;
}

function renderRound(order) {
  leftTableBody.innerHTML = order.slice(0, 10).map(verbRowMarkup).join("");
  rightTableBody.innerHTML = order.slice(10).map(verbRowMarkup).join("");
  decirGrid.innerHTML = DECIR_FORMS.map((form) => `
    <div class="decir-cell">
      ${fieldMarkup(form.label, form.answer, [form.answer], "decir-input")}
    </div>
  `).join("");

  fields = [
    ...leftTableBody.querySelectorAll(".answer-input"),
    ...rightTableBody.querySelectorAll(".answer-input"),
    ...decirGrid.querySelectorAll(".answer-input")
  ];

  fields.forEach((field) => {
    field.addEventListener("beforeinput", handleBeforeInput);
    field.addEventListener("input", handleInput);
    field.addEventListener("keydown", handleKeydown);
  });
}

function handleBeforeInput(event) {
  if (event.currentTarget.classList.contains("stem-input") && /\s/.test(event.data || "")) {
    event.preventDefault();
  }
}

function updateProgress() {
  const completed = solvedCount + revealedCount;
  progress.textContent = `${completed} / ${TOTAL_BLANKS}`;
  progress.setAttribute("aria-label", `${completed} of ${TOTAL_BLANKS} blanks completed`);
}

function clearCurrentMarker() {
  document.querySelector(".is-current-cell")?.classList.remove("is-current-cell");
  document.querySelector(".answer-input.is-current")?.classList.remove("is-current");
}

function activateField(index) {
  clearCurrentMarker();
  currentFieldIndex = index;

  if (index >= fields.length) {
    finishRound();
    return;
  }

  const field = fields[index];
  field.readOnly = false;
  field.classList.add("is-current");
  field.closest("td, .decir-cell")?.classList.add("is-current-cell");
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function completeCurrentField(mode) {
  const field = fields[currentFieldIndex];
  if (!field || field.readOnly) return;

  if (mode === "correct") {
    solvedCount += 1;
    field.classList.add("is-correct");
  } else {
    revealedCount += 1;
    field.value = field.dataset.canonical;
    field.classList.add("is-revealed");
  }

  field.readOnly = true;
  updateProgress();
  window.requestAnimationFrame(() => activateField(currentFieldIndex + 1));
}

function handleInput(event) {
  const field = event.currentTarget;
  if (field.classList.contains("stem-input")) {
    field.value = field.value.replace(/\s/g, "");
  }
  const accepted = JSON.parse(field.dataset.accepted);
  if (field === fields[currentFieldIndex] && answerMatches(field.value, accepted)) {
    completeCurrentField("correct");
  }
}

function handleKeydown(event) {
  if (event.key !== "Enter" || event.currentTarget !== fields[currentFieldIndex]) return;
  event.preventDefault();
  completeCurrentField("revealed");
}

function updateTimer() {
  const elapsed = roundActive ? performance.now() - startedAt : elapsedAtFinish;
  timer.textContent = formatElapsed(elapsed);
}

function startRound() {
  window.clearInterval(timerInterval);
  let order = shuffleVerbs(VERBS);
  order = avoidRepeatedOrder(order, previousOrder);
  previousOrder = order;

  solvedCount = 0;
  revealedCount = 0;
  elapsedAtFinish = 0;
  roundActive = true;
  finishMessage.hidden = true;
  status.textContent = "Round started.";
  startScreen.hidden = true;
  practiceScreen.hidden = false;

  renderRound(order);
  updateProgress();
  startedAt = performance.now();
  updateTimer();
  timerInterval = window.setInterval(updateTimer, 50);
  activateField(0);
}

function finishRound() {
  roundActive = false;
  elapsedAtFinish = performance.now() - startedAt;
  window.clearInterval(timerInterval);
  updateTimer();
  clearCurrentMarker();
  finishMessage.hidden = false;
  finishMessage.textContent = `Finished in ${formatElapsed(elapsedAtFinish)} — ${solvedCount} correct, ${revealedCount} revealed.`;
  status.textContent = finishMessage.textContent;
  newRoundButton.focus();
}

startButton.addEventListener("click", startRound);
newRoundButton.addEventListener("click", startRound);

timer.textContent = formatElapsed(0);
updateProgress();
