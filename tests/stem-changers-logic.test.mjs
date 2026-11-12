import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logicPath = new URL("../pages/games/stem-changers-speed/logic.js", import.meta.url);
const logicSource = readFileSync(logicPath, "utf8");
const testableSource = `${logicSource}\nexport default StemChangersLogic;`;
const logicModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString("base64")}`);

const {
  VERBS,
  DECIR_FORMS,
  answerMatches,
  avoidRepeatedOrder,
  formatElapsed,
  normalizeAnswer,
  shuffleVerbs
} = logicModule.default;

test("contains the 15 worksheet verbs and 51 total blanks", () => {
  assert.equal(VERBS.length, 15);
  assert.equal(new Set(VERBS.map((verb) => verb.infinitive)).size, 15);
  assert.equal(DECIR_FORMS.length, 6);
  assert.equal((VERBS.length * 3) + DECIR_FORMS.length, 51);
  assert.deepEqual(DECIR_FORMS.map((form) => form.answer), ["digo", "dices", "dice", "decimos", "decís", "dicen"]);
});

test("matches accepted answers without case or extra whitespace", () => {
  assert.equal(normalizeAnswer("  TO   SLEEP! "), "to sleep");
  assert.equal(answerMatches("START", VERBS.find((verb) => verb.infinitive === "empezar").acceptedEnglish), true);
  assert.equal(answerMatches("sleepy", ["sleep"]), false);
});

test("shuffle returns a new array containing every verb", () => {
  const values = [0.2, 0.8, 0.1, 0.6, 0.3, 0.9, 0.4, 0.7, 0.05, 0.55, 0.15, 0.65, 0.25, 0.75];
  let index = 0;
  const shuffled = shuffleVerbs(VERBS, () => values[index++ % values.length]);
  assert.notEqual(shuffled, VERBS);
  assert.deepEqual([...shuffled].sort((a, b) => a.infinitive.localeCompare(b.infinitive)), [...VERBS].sort((a, b) => a.infinitive.localeCompare(b.infinitive)));
});

test("identical consecutive orders are rotated", () => {
  const repeated = avoidRepeatedOrder([...VERBS], VERBS);
  assert.equal(repeated[0], VERBS[1]);
  assert.equal(repeated.at(-1), VERBS[0]);
});

test("formats the stopwatch with hundredths", () => {
  assert.equal(formatElapsed(0), "00:00.00");
  assert.equal(formatElapsed(62_349), "01:02.34");
});
