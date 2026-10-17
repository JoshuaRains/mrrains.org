export const TEAM_COLORS = {
  green: "#51cf66",
  blue: "#4dabf7"
};

export const DEFAULT_PRICES = {
  regular: 1,
  armored: 5,
  explosive1: 6,
  explosive2: 12,
  repair: 2
};

export const TILE_TYPES = {
  regular: {
    name: "Regular",
    cost: DEFAULT_PRICES.regular,
    description: "Claim an adjacent hex"
  },
  armored: {
    name: "Armored",
    cost: DEFAULT_PRICES.armored,
    description: "5 health; place on empty or friendly land"
  },
  explosive1: {
    name: "Patata",
    cost: DEFAULT_PRICES.explosive1,
    radius: 1,
    description: "Deal 2 damage within 1 hex"
  },
  explosive2: {
    name: "Patata grande",
    cost: DEFAULT_PRICES.explosive2,
    radius: 2,
    description: "Deal 2 damage within 2 hexes"
  },
  repair: {
    name: "Repair",
    cost: DEFAULT_PRICES.repair,
    description: "Restore 1 health to friendly armor"
  }
};

Object.values(TILE_TYPES).forEach(definition => Object.freeze(definition));
Object.freeze(TILE_TYPES);
Object.freeze(DEFAULT_PRICES);
Object.freeze(TEAM_COLORS);

export const HEX_DIRECTIONS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]
];

export function cellKey(q, r) {
  return `${q}_${r}`;
}

export function parseCellKey(key) {
  return key.split("_").map(Number);
}

export function inBounds(q, r, cols, rows) {
  return q >= 0 && q < cols && r >= 0 && r < rows;
}

// The stored coordinates are odd-row offset coordinates. This keeps the map's
// outside edge roughly rectangular while retaining true six-neighbor geometry.
export function offsetToAxial(column, row) {
  return [column - (row - (row & 1)) / 2, row];
}

export function axialToOffset(q, r) {
  return [q + (r - (r & 1)) / 2, r];
}

export function hexDistance(aColumn, aRow, bColumn, bRow) {
  const [aq, ar] = offsetToAxial(aColumn, aRow);
  const [bq, br] = offsetToAxial(bColumn, bRow);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbors(column, row, cols, rows) {
  const [q, r] = offsetToAxial(column, row);
  return HEX_DIRECTIONS
    .map(([dq, dr]) => axialToOffset(q + dq, r + dr))
    .filter(([nq, nr]) => inBounds(nq, nr, cols, rows));
}

export function createGrid(cols, rows, basesPerTeam = 1, random = Math.random) {
  const grid = {};
  for (let r = 0; r < rows; r += 1) {
    for (let q = 0; q < cols; q += 1) {
      grid[cellKey(q, r)] = emptyCell();
    }
  }

  const interior = [];
  for (let r = 1; r < rows - 1; r += 1) {
    for (let q = 1; q < cols - 1; q += 1) interior.push([q, r]);
  }

  const baseCount = Math.max(1, Math.min(4, Math.round(Number(basesPerTeam) || 1)));
  const totalBases = baseCount * 2;
  const minimumDistance = totalBases === 2
    ? Math.max(3, Math.floor(Math.min(cols, rows) * 0.65))
    : Math.max(2, Math.floor(Math.min(cols, rows) / (baseCount + 1)));
  let bases = [];
  const attempts = Math.min(interior.length, 40);
  for (let attempt = 0; attempt < attempts && bases.length < totalBases; attempt += 1) {
    const firstIndex = (Math.floor(random() * interior.length) + attempt) % interior.length;
    const trial = [interior[firstIndex]];
    while (trial.length < totalBases) {
      const candidates = interior
        .filter(([q, r]) => trial.every(([bq, br]) => hexDistance(q, r, bq, br) >= minimumDistance))
        .map(position => ({
          position,
          distance: Math.min(...trial.map(([bq, br]) => hexDistance(position[0], position[1], bq, br)))
        }));
      if (!candidates.length) break;
      const bestDistance = Math.max(...candidates.map(candidate => candidate.distance));
      const best = candidates.filter(candidate => candidate.distance === bestDistance);
      trial.push(best[Math.floor(random() * best.length)]?.position || best[0].position);
    }
    if (trial.length === totalBases) bases = trial;
  }

  if (bases.length < totalBases) {
    throw new Error(`The ${cols} by ${rows} map is too small for ${baseCount} well-spaced bases per team.`);
  }

  bases.forEach(([q, r], index) => {
    const team = index % 2 === 0 ? "green" : "blue";
    grid[cellKey(q, r)] = { team, type: "capital", capital: true };
  });
  return grid;
}

export function emptyCell() {
  return { team: null, type: null };
}

export function normalizePrices(prices = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_PRICES).map(type => {
    const raw = prices[type];
    const candidate = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
    const value = Number.isFinite(candidate) ? Math.round(candidate) : DEFAULT_PRICES[type];
    return [type, Math.max(1, Math.min(99, value))];
  }));
}

export function getTileCost(game, tileType) {
  return normalizePrices(game?.settings?.prices)[tileType] ?? DEFAULT_PRICES[tileType] ?? Infinity;
}

function isFriendly(cell, team) {
  return Boolean(cell && cell.team === team);
}

function distanceToFriendly(grid, q, r, team) {
  let closest = Infinity;
  Object.entries(grid || {}).forEach(([key, cell]) => {
    if (!isFriendly(cell, team)) return;
    const [fq, fr] = parseCellKey(key);
    closest = Math.min(closest, hexDistance(q, r, fq, fr));
  });
  return closest;
}

export function validatePlacement(game, playerId, tileType, q, r) {
  const definition = Object.hasOwn(TILE_TYPES, tileType) ? TILE_TYPES[tileType] : null;
  const cols = Number(game?.gridCols || game?.gridSize || 15);
  const rows = Number(game?.gridRows || game?.gridSize || 15);
  const player = game?.players?.[playerId];
  const grid = game?.grid || {};
  const cell = grid[cellKey(q, r)] || emptyCell();

  if (game?.state !== "started") return { ok: false, reason: "The round is not active." };
  if (!player || !["green", "blue"].includes(player.team)) return { ok: false, reason: "Player not found." };
  if (!definition) return { ok: false, reason: "Choose a tile type." };
  if (!Number.isInteger(q) || !Number.isInteger(r)) return { ok: false, reason: "That hex is not valid." };
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 7 || rows < 7 || cols > 32 || rows > 32) {
    return { ok: false, reason: "The map dimensions are invalid." };
  }
  if (!inBounds(q, r, cols, rows)) return { ok: false, reason: "That hex is outside the map." };
  const cost = getTileCost(game, tileType);
  if ((Number(player.balance) || 0) < cost) return { ok: false, reason: "Not enough tiles." };
  if (cell.capital) return { ok: false, reason: "Bases cannot be replaced." };

  const team = player.team;
  const distance = distanceToFriendly(grid, q, r, team);

  if (tileType === "repair") {
    const valid = cell.team === team && cell.type === "armored" && Number(cell.health) < 5;
    return valid
      ? { ok: true }
      : { ok: false, reason: "Repair a damaged friendly armored tile." };
  }

  if (tileType === "armored") {
    const targetAllowed = !cell.team || cell.team === team;
    const connected = cell.team === team || distance === 1;
    return targetAllowed && connected
      ? { ok: true }
      : { ok: false, reason: "Armor must be empty or friendly and connected to your land." };
  }

  const isBlast = tileType === "explosive1" || tileType === "explosive2";
  if (isBlast) {
    return distance === 1
      ? { ok: true }
      : { ok: false, reason: "Place a blast next to friendly land." };
  }

  if (tileType === "regular") {
    return cell.team !== team && distance === 1
      ? { ok: true }
      : { ok: false, reason: "Regular tiles must touch friendly land." };
  }

  return { ok: false, reason: "That placement is not valid." };
}

function damageCell(grid, key, damage = 1) {
  const cell = grid[key];
  if (!cell || !cell.team || cell.capital) return;
  if (cell.type === "armored") {
    const nextHealth = (Number(cell.health) || 5) - damage;
    grid[key] = nextHealth > 0 ? { ...cell, health: nextHealth } : emptyCell();
  } else {
    grid[key] = emptyCell();
  }
}

export function captureSurroundedBases(grid, cols, rows) {
  const captures = [];
  Object.entries(grid || {}).forEach(([key, cell]) => {
    if (!cell.capital || !["green", "blue"].includes(cell.team)) return;
    const [q, r] = parseCellKey(key);
    const enemy = cell.team === "green" ? "blue" : "green";
    const ring = neighbors(q, r, cols, rows);
    if (ring.length === 6 && ring.every(([nq, nr]) => grid[cellKey(nq, nr)]?.team === enemy)) {
      captures.push([key, enemy]);
    }
  });
  captures.forEach(([key, team]) => {
    grid[key] = { ...grid[key], team };
  });
  return captures;
}

function applyCapture(grid, key, team, placedType) {
  const target = grid[key] || emptyCell();
  if (target.team && target.team !== team && target.type === "armored") {
    const nextHealth = (Number(target.health) || 5) - 1;
    grid[key] = nextHealth > 0
      ? { ...target, health: nextHealth }
      : { team, type: placedType };
    return;
  }
  grid[key] = { team, type: placedType };
}

export function applyPlacement(game, playerId, tileType, q, r) {
  const validation = validatePlacement(game, playerId, tileType, q, r);
  if (!validation.ok) return validation;

  const definition = TILE_TYPES[tileType];
  const player = game.players[playerId];
  const team = player.team;
  const key = cellKey(q, r);
  const grid = { ...(game.grid || {}) };

  if (tileType === "repair") {
    grid[key] = { ...grid[key], health: Math.min(5, (Number(grid[key].health) || 0) + 1) };
  } else if (tileType === "armored") {
    grid[key] = { team, type: "armored", health: 5 };
  } else if (tileType === "explosive1" || tileType === "explosive2") {
    const radius = definition.radius;
    Object.keys(grid).forEach(candidateKey => {
      const [cq, cr] = parseCellKey(candidateKey);
      if (hexDistance(q, r, cq, cr) <= radius) damageCell(grid, candidateKey, 2);
    });
  } else {
    applyCapture(grid, key, team, tileType);
  }

  captureSurroundedBases(grid, Number(game.gridCols || game.gridSize), Number(game.gridRows || game.gridSize));

  // Cost comes from the Firebase game settings, never from editable DOM text.
  const balance = (Number(player.balance) || 0) - getTileCost(game, tileType);
  const nextGame = {
    ...game,
    grid,
    players: {
      ...game.players,
      [playerId]: { ...player, balance }
    },
    lastAction: {
      playerId,
      team,
      tileType,
      q,
      r,
      at: Date.now()
    }
  };

  return { ok: true, game: nextGame };
}

export function findWinner(grid, cols, rows) {
  const baseTeams = new Set(
    Object.values(grid || {}).filter(cell => cell.capital).map(cell => cell.team)
  );
  if (baseTeams.size === 1 && baseTeams.has("green")) return "green";
  if (baseTeams.size === 1 && baseTeams.has("blue")) return "blue";
  return null;
}

export function countTiles(grid) {
  return Object.values(grid || {}).reduce((counts, cell) => {
    if (cell.team === "green") counts.green += 1;
    if (cell.team === "blue") counts.blue += 1;
    return counts;
  }, { green: 0, blue: 0 });
}

export function parseQuestions(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split("|").map(part => part.trim());
      if (parts.length >= 6) {
        return { question: parts[0], options: parts.slice(1, 5), answer: parts[5] };
      }
      if (parts.length >= 2) {
        return { question: parts[0], options: [], answer: parts[parts.length - 1] };
      }
      return null;
    })
    .filter(Boolean);
}

export function normalizeAnswer(value) {
  return String(value || "").trim().toLocaleLowerCase();
}
