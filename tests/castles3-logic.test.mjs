import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPlacement,
  cellKey,
  countTiles,
  createGrid,
  findWinner,
  getTileCost,
  hexDistance,
  neighbors,
  parseCellKey,
  parseQuestions,
  validatePlacement
} from "../pages/games/castles3/game-logic.js";

function baseGame(balance = 30) {
  return {
    state: "started",
    gridCols: 7,
    gridRows: 7,
    players: { student: { team: "green", balance } },
    grid: {
      [cellKey(1, 1)]: { team: "green", type: "capital", capital: true },
      [cellKey(5, 5)]: { team: "blue", type: "capital", capital: true }
    }
  };
}

test("axial hex distance uses six-sided geometry", () => {
  assert.equal(hexDistance(0, 0, 1, 0), 1);
  assert.equal(hexDistance(1, 1, 2, 0), 1);
  assert.equal(hexDistance(1, 1, 3, 0), 2);
});

test("offset rows form a rectangular grid with six neighbors", () => {
  assert.deepEqual(
    neighbors(1, 1, 5, 5).sort(),
    [[0, 1], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]].sort()
  );
});

test("regular tiles cannot skip across empty hexes", () => {
  const game = baseGame();
  assert.equal(validatePlacement(game, "student", "regular", 2, 1).ok, true);
  assert.equal(validatePlacement(game, "student", "regular", 3, 1).ok, false);
});

test("placement rejects tampered teams, coordinates, and map dimensions", () => {
  const game = baseGame();
  assert.equal(validatePlacement(game, "student", "regular", 2.5, 1).ok, false);
  game.players.student.team = "purple";
  assert.equal(validatePlacement(game, "student", "regular", 2, 1).ok, false);
  game.players.student.team = "green";
  game.gridCols = 33;
  assert.equal(validatePlacement(game, "student", "regular", 2, 1).ok, false);
});

test("armor costs five, starts at five health, and can be repaired", () => {
  const game = baseGame();
  const armored = applyPlacement(game, "student", "armored", 2, 1);
  assert.equal(armored.ok, true);
  assert.deepEqual(armored.game.grid[cellKey(2, 1)], { team: "green", type: "armored", health: 5 });
  assert.equal(armored.game.players.student.balance, 25);

  armored.game.grid[cellKey(2, 1)].health = 4;
  const repaired = applyPlacement(armored.game, "student", "repair", 2, 1);
  assert.equal(repaired.game.grid[cellKey(2, 1)].health, 5);
  assert.equal(repaired.game.players.student.balance, 23);
});

test("room price settings control affordability and the charged amount", () => {
  const game = baseGame(3);
  game.settings = { prices: { regular: 4 } };
  assert.equal(getTileCost(game, "regular"), 4);
  assert.equal(validatePlacement(game, "student", "regular", 2, 1).ok, false);

  game.players.student.balance = 5;
  const placed = applyPlacement(game, "student", "regular", 2, 1);
  assert.equal(placed.ok, true);
  assert.equal(placed.game.players.student.balance, 1);
});

test("blast damage applies to friendly and enemy tiles", () => {
  const game = baseGame();
  game.grid[cellKey(2, 1)] = { team: "green", type: "regular" };
  game.grid[cellKey(3, 0)] = { team: "blue", type: "armored", health: 5 };
  game.grid[cellKey(1, 0)] = { team: "blue", type: "regular" };
  const blast = applyPlacement(game, "student", "explosive1", 2, 0);
  assert.equal(blast.ok, true);
  assert.equal(blast.game.grid[cellKey(2, 1)].team, null);
  assert.equal(blast.game.grid[cellKey(1, 0)].team, null);
  assert.equal(blast.game.grid[cellKey(3, 0)].health, 4);
});

test("every enemy base must be surrounded before a team wins", () => {
  const game = baseGame();
  game.grid[cellKey(4, 1)] = { team: "green", type: "capital", capital: true };
  neighbors(1, 1, 7, 7).forEach(([q, r]) => {
    game.grid[cellKey(q, r)] = { team: "blue", type: "regular" };
  });
  assert.equal(findWinner(game.grid, 7, 7), null);
  neighbors(4, 1, 7, 7).forEach(([q, r]) => {
    game.grid[cellKey(q, r)] = { team: "blue", type: "regular" };
  });
  assert.equal(findWinner(game.grid, 7, 7), "blue");
});

test("question parser supports multiple-choice and typing lines", () => {
  const questions = parseQuestions("2+2?|3|4|5|6|4\nCapital of Perú?|Lima");
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0].options, ["3", "4", "5", "6"]);
  assert.equal(questions[1].answer, "Lima");
});

test("new grids contain the requested number of well-spaced bases", () => {
  const grid = createGrid(15, 15, 3, () => 0.25);
  const capitals = Object.entries(grid).filter(([, cell]) => cell.capital);
  assert.equal(capitals.length, 6);
  assert.equal(capitals.filter(([, cell]) => cell.team === "green").length, 3);
  assert.equal(capitals.filter(([, cell]) => cell.team === "blue").length, 3);
  for (let first = 0; first < capitals.length; first += 1) {
    for (let second = first + 1; second < capitals.length; second += 1) {
      const [aq, ar] = parseCellKey(capitals[first][0]);
      const [bq, br] = parseCellKey(capitals[second][0]);
      assert.ok(hexDistance(aq, ar, bq, br) >= 3);
    }
  }
  assert.deepEqual(countTiles(grid), { green: 3, blue: 3 });

  const largestGrid = createGrid(32, 32, 4, () => 0.5);
  assert.equal(Object.values(largestGrid).filter(cell => cell.capital).length, 8);
});
