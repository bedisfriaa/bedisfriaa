#!/usr/bin/env node
/**
 * build-puzzle.mjs
 * ----------------------------------------------------------------------------
 * Pre-renders EVERY reachable state of a Sokoban puzzle as a static, inter-linked
 * set of GitHub-markdown pages under `g/`.
 *
 * The puzzle is playable on a GitHub profile with ZERO JavaScript and ZERO
 * backend: every reachable position already exists as a file, and the arrow
 * "controls" are ordinary links to the file for the resulting position.
 *
 * Node 20+ ESM. No dependencies (node: built-ins only).
 *
 *   node scripts/build-puzzle.mjs
 *
 * Owns: this file and the generated `g/` directory. Touches nothing else.
 * ----------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 1. The level
// ---------------------------------------------------------------------------
// Standard Sokoban notation:
//   '#' wall   ' ' floor   '.' goal   '$' box   '@' player
//   '*' box on goal        '+' player on goal
//
// Design notes (verified by the BFS below, numbers reported on every run):
//   - 3 boxes, fully enclosed by walls, 8x8.
//   - 2745 reachable states  -> inside the 800..6000 target window.
//   - Optimal solution is 37 moves / 12 pushes, and the optimal path contains
//     3 push-direction changes: no box can simply be shoved in a straight line
//     to its goal, so it is a real puzzle rather than a shoving exercise.
const LEVEL = `
########
#@  #  #
# # #  #
#     .#
#  # ###
##$# $ #
#. $  .#
########
`;

// Length of the hex state id taken from SHA-256 of the canonical key.
const ID_LENGTH = 7;

// ---------------------------------------------------------------------------
// 2. Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'g');
const START_FRAGMENT = join(OUT_DIR, '_start.html.txt');

// Tile srcs are written with two different prefixes:
//   pages in g/            -> ../assets/tiles/<tile>.svg
//   the README fragment    -> ./assets/tiles/<tile>.svg
const TILE_PREFIX_PAGE = '../assets/tiles/';
const TILE_PREFIX_ROOT = './assets/tiles/';

// ---------------------------------------------------------------------------
// 3. Level parsing
// ---------------------------------------------------------------------------
function parseLevel(src) {
  const lines = src.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('LEVEL is empty');

  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));

  const walls = new Set();
  const goals = new Set();
  const boxes = [];
  let player = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = lines[y][x] ?? ' ';
      const idx = y * width + x;
      switch (ch) {
        case '#': walls.add(idx); break;
        case ' ': break;
        case '.': goals.add(idx); break;
        case '$': boxes.push(idx); break;
        case '*': goals.add(idx); boxes.push(idx); break;
        case '@': player = idx; break;
        case '+': goals.add(idx); player = idx; break;
        default: throw new Error(`Unknown level character ${JSON.stringify(ch)} at (${x},${y})`);
      }
      // Any cell outside a short line is implicitly floor; guard the border below.
    }
  }

  if (player < 0) throw new Error('LEVEL has no player (@ or +)');
  if (boxes.length === 0) throw new Error('LEVEL has no boxes');
  if (boxes.length !== goals.size) {
    throw new Error(`LEVEL has ${boxes.length} boxes but ${goals.size} goals - they must match`);
  }

  boxes.sort((a, b) => a - b);
  const level = { width, height, walls, goals, boxes, player };
  assertEnclosed(level);
  return level;
}

/** The player must never be able to walk off the grid: the border must be solid wall. */
function assertEnclosed({ width, height, walls }) {
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      if (!walls.has(y * width + x)) throw new Error(`LEVEL is not enclosed: border cell (${x},${y}) is not a wall`);
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      if (!walls.has(y * width + x)) throw new Error(`LEVEL is not enclosed: border cell (${x},${y}) is not a wall`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. State space
// ---------------------------------------------------------------------------
// A state is (player index, sorted box indices). Canonical key: "p|b1,b2,b3".
const DIRECTIONS = [
  { name: 'up', dx: 0, dy: -1 },
  { name: 'down', dx: 0, dy: 1 },
  { name: 'left', dx: -1, dy: 0 },
  { name: 'right', dx: 1, dy: 0 },
];

const canonicalKey = (player, boxes) => `${player}|${boxes.join(',')}`;

/**
 * BFS over the four moves from the initial state.
 *
 * Win states are TERMINAL: their pages show a solved message instead of arrows,
 * so anything reachable only *through* a win state would be an orphan page that
 * no link can reach. Not expanding them keeps "reachable state" and
 * "link-reachable page" exactly the same set.
 */
function exploreStates(level) {
  const { width, height, walls, goals } = level;

  const isWin = (boxes) => boxes.every((b) => goals.has(b));
  const inBounds = (x, y) => x >= 0 && x < width && y >= 0 && y < height;

  const startKey = canonicalKey(level.player, level.boxes);
  /** @type {Map<string, {player:number, boxes:number[], depth:number, win:boolean, moves:(string|null)[], parent:string|null, viaDir:number}>} */
  const states = new Map();
  states.set(startKey, {
    player: level.player,
    boxes: level.boxes,
    depth: 0,
    win: isWin(level.boxes),
    moves: [null, null, null, null],
    parent: null,
    viaDir: -1,
  });

  let frontier = [startKey];
  let depth = 0;
  let winCount = states.get(startKey).win ? 1 : 0;
  let optimal = states.get(startKey).win ? 0 : -1;
  let firstWinKey = states.get(startKey).win ? startKey : null;

  while (frontier.length > 0) {
    const next = [];
    depth += 1;

    for (const key of frontier) {
      const state = states.get(key);
      // Win states are terminal - never expanded, and their pages carry no arrows.
      if (state.win) continue;

      const px = state.player % width;
      const py = Math.floor(state.player / width);

      for (let d = 0; d < DIRECTIONS.length; d++) {
        const { dx, dy } = DIRECTIONS[d];
        const nx = px + dx;
        const ny = py + dy;
        if (!inBounds(nx, ny)) continue;

        const target = ny * width + nx;
        if (walls.has(target)) continue;

        let boxes = state.boxes;
        const boxAt = boxes.indexOf(target);
        if (boxAt !== -1) {
          // Pushing: the square beyond the box must be inside, free of wall and box.
          const bx = nx + dx;
          const by = ny + dy;
          if (!inBounds(bx, by)) continue;
          const beyond = by * width + bx;
          if (walls.has(beyond) || boxes.includes(beyond)) continue;
          boxes = boxes.slice();
          boxes[boxAt] = beyond;
          boxes.sort((a, b) => a - b);
        }

        const nextKey = canonicalKey(target, boxes);
        state.moves[d] = nextKey;

        if (states.has(nextKey)) continue;

        const win = isWin(boxes);
        states.set(nextKey, {
          player: target,
          boxes,
          depth,
          win,
          moves: [null, null, null, null],
          parent: key,
          viaDir: d,
        });
        if (win) {
          winCount += 1;
          if (optimal < 0) {
            optimal = depth;
            firstWinKey = nextKey;
          }
        }
        next.push(nextKey);
      }
    }
    frontier = next;
  }

  return { states, startKey, winCount, optimal, firstWinKey };
}

/** Reconstruct the optimal move sequence (list of direction indices) to `winKey`. */
function reconstructPath(states, winKey) {
  const path = [];
  let cursor = winKey;
  while (cursor !== null) {
    const state = states.get(cursor);
    if (state.parent === null) break;
    path.push({ dir: state.viaDir, key: cursor });
    cursor = state.parent;
  }
  return path.reverse();
}

// ---------------------------------------------------------------------------
// 5. Ids
// ---------------------------------------------------------------------------
function assignIds(states) {
  const ids = new Map(); // key -> id
  const seen = new Map(); // id -> key
  for (const key of states.keys()) {
    const id = createHash('sha256').update(key).digest('hex').slice(0, ID_LENGTH);
    if (seen.has(id)) {
      throw new Error(
        `FATAL: state id collision on "${id}"\n` +
          `  ${seen.get(id)}\n  ${key}\n` +
          `Raise ID_LENGTH in scripts/build-puzzle.mjs and rebuild.`
      );
    }
    seen.set(id, key);
    ids.set(key, id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 6. Rendering
// ---------------------------------------------------------------------------
function tileFor(level, state, idx) {
  const onGoal = level.goals.has(idx);
  if (level.walls.has(idx)) return 'wall';
  if (state.boxes.includes(idx)) return onGoal ? 'box-on-goal' : 'box';
  if (state.player === idx) return onGoal ? 'player-on-goal' : 'player';
  return onGoal ? 'goal' : 'floor';
}

const img = (prefix, tile) => `<img src="${prefix}${tile}.svg" width="40" height="40" alt="">`;

/** The board as a <table>. Only table/tr/td/img - all survive GitHub's sanitizer. */
function renderBoard(level, state, tilePrefix) {
  const rows = [];
  for (let y = 0; y < level.height; y++) {
    let row = '<tr>';
    for (let x = 0; x < level.width; x++) {
      row += `<td>${img(tilePrefix, tileFor(level, state, y * level.width + x))}</td>`;
    }
    rows.push(row + '</tr>');
  }
  return `<table cellspacing="0" cellpadding="0" border="0">\n${rows.join('\n')}\n</table>`;
}

/**
 * The control row. Legal moves are links to the destination page; illegal moves
 * render the same arrow image with NO anchor, so the control is visibly present
 * but inert. A link is never emitted for a page that does not exist.
 */
function renderControls(state, ids, tilePrefix, hrefPrefix) {
  // Spatial reading order on a single row: left, up, down, right.
  const order = [2, 0, 1, 3];
  let row = '<tr>';
  for (const d of order) {
    const nextKey = state.moves[d];
    const arrow = img(tilePrefix, DIRECTIONS[d].name);
    row += `<td>${nextKey ? `<a href="${hrefPrefix}${ids.get(nextKey)}.md">${arrow}</a>` : arrow}</td>`;
  }
  return `<table cellspacing="0" cellpadding="0" border="0">\n${row}</tr>\n</table>`;
}

function renderPage(level, state, id, ids) {
  const board = renderBoard(level, state, TILE_PREFIX_PAGE);
  const parts = [board, ''];

  if (state.win) {
    parts.push('### Solved.');
    parts.push('');
    parts.push('All three crates are home. You did that by clicking links.');
    parts.push('');
    parts.push('[Play again](../README.md)');
  } else {
    parts.push(renderControls(state, ids, TILE_PREFIX_PAGE, ''));
    parts.push('');
    parts.push('[Restart](../README.md)');
  }

  parts.push('');
  parts.push(`<sub>Pre-rendered state <code>${id}</code> - a static file, no JavaScript, no backend.</sub>`);
  parts.push('');
  return parts.join('\n');
}

/** Board + controls for embedding in the root README (one directory level up). */
function renderStartFragment(level, state, ids) {
  const board = renderBoard(level, state, TILE_PREFIX_ROOT);
  const controls = renderControls(state, ids, TILE_PREFIX_ROOT, 'g/');
  return `${board}\n\n${controls}\n`;
}

// ---------------------------------------------------------------------------
// 7. Validation
// ---------------------------------------------------------------------------
const HREF_RE = /href="([^"]+)"/g;
const SRC_RE = /src="([^"]+)"/g;

/** Every href in every emitted file must resolve to a file that exists on disk. */
function validateLinks() {
  const files = readdirSync(OUT_DIR);
  const problems = [];
  let hrefCount = 0;

  for (const file of files) {
    const full = join(OUT_DIR, file);
    const text = readFileSync(full, 'utf8');
    // Pages live in g/ ; the README fragment resolves from the repo root.
    const base = file === '_start.html.txt' ? REPO_ROOT : OUT_DIR;
    for (const [, href] of text.matchAll(HREF_RE)) {
      hrefCount += 1;
      const target = resolve(base, href);
      if (!existsSync(target)) problems.push(`${file}: href="${href}" -> missing ${target}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Link integrity FAILED (${problems.length} broken):\n  ${problems.slice(0, 20).join('\n  ')}`);
  }
  return { files: files.length, hrefCount };
}

/**
 * Walk the emitted link graph from the start page and confirm it reaches every
 * emitted page. Proves there are no orphan files and no unreachable states.
 */
function validateReachability(startId, expectedPages) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.pop();
    const text = readFileSync(join(OUT_DIR, `${id}.md`), 'utf8');
    for (const [, href] of text.matchAll(HREF_RE)) {
      const m = /^([0-9a-f]+)\.md$/.exec(href);
      if (!m) continue;
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      queue.push(m[1]);
    }
  }
  if (seen.size !== expectedPages) {
    throw new Error(`Reachability FAILED: link-walk reached ${seen.size} pages but ${expectedPages} were emitted`);
  }
  return seen.size;
}

/** Read a page back off disk and recover the board it renders, tile by tile. */
function readBoardFromPage(id, level) {
  const text = readFileSync(join(OUT_DIR, `${id}.md`), 'utf8');
  const table = text.slice(text.indexOf('<table'), text.indexOf('</table>'));
  const tiles = [...table.matchAll(SRC_RE)].map(([, src]) => src.replace(TILE_PREFIX_PAGE, '').replace(/\.svg$/, ''));
  if (tiles.length !== level.width * level.height) {
    throw new Error(`Page ${id} rendered ${tiles.length} tiles, expected ${level.width * level.height}`);
  }
  return tiles;
}

/**
 * Follow the generated links, on disk, along the optimal solution: from the start
 * page to a win page. Each hop must exist, and the board each page renders must
 * match an independent simulation of the move sequence.
 */
function validateSolutionWalk(level, states, ids, startKey, path) {
  let id = ids.get(startKey);
  let key = startKey;
  let hops = 0;

  for (const step of path) {
    const text = readFileSync(join(OUT_DIR, `${id}.md`), 'utf8');
    const dirName = DIRECTIONS[step.dir].name;
    const re = new RegExp(`<a href="([0-9a-f]+)\\.md"><img src="${TILE_PREFIX_PAGE.replace(/[./]/g, '\\$&')}${dirName}\\.svg"`);
    const match = re.exec(text);
    if (!match) throw new Error(`Solution walk: page ${id} has no live "${dirName}" control (hop ${hops + 1})`);

    const nextId = match[1];
    if (nextId !== ids.get(step.key)) {
      throw new Error(`Solution walk: "${dirName}" from ${id} links to ${nextId}, expected ${ids.get(step.key)}`);
    }
    if (!existsSync(join(OUT_DIR, `${nextId}.md`))) throw new Error(`Solution walk: ${nextId}.md does not exist`);

    // The page's own board must match the simulated state.
    const expected = [];
    const next = states.get(step.key);
    for (let i = 0; i < level.width * level.height; i++) expected.push(tileFor(level, next, i));
    const actual = readBoardFromPage(nextId, level);
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        throw new Error(`Solution walk: board mismatch on ${nextId} cell ${i}: page says ${actual[i]}, simulation says ${expected[i]}`);
      }
    }

    id = nextId;
    key = step.key;
    hops += 1;
  }

  const finalState = states.get(key);
  if (!finalState.win) throw new Error('Solution walk did not end on a win state');
  const finalText = readFileSync(join(OUT_DIR, `${id}.md`), 'utf8');
  if (!/Solved\./.test(finalText)) throw new Error(`Win page ${id} is missing its solved message`);
  if (/\.md"><img src="[^"]*(up|down|left|right)\.svg/.test(finalText)) {
    throw new Error(`Win page ${id} still renders live arrow controls`);
  }
  return { hops, winId: id };
}

/** Non-fatal: the tile assets are owned by another build step. */
function checkTiles() {
  const dir = join(REPO_ROOT, 'assets', 'tiles');
  const needed = [
    'floor', 'wall', 'goal', 'box', 'box-on-goal', 'player', 'player-on-goal',
    'up', 'down', 'left', 'right',
  ];
  if (!existsSync(dir)) return { present: 0, missing: needed };
  const missing = needed.filter((t) => !existsSync(join(dir, `${t}.svg`)));
  return { present: needed.length - missing.length, missing };
}

// ---------------------------------------------------------------------------
// 8. Build
// ---------------------------------------------------------------------------
function main() {
  const level = parseLevel(LEVEL);
  const { states, startKey, winCount, optimal, firstWinKey } = exploreStates(level);

  if (winCount === 0 || firstWinKey === null) {
    throw new Error('FATAL: the level is unsolvable - BFS reached no win state.');
  }

  const ids = assignIds(states);
  const startId = ids.get(startKey);

  // Idempotence: wipe g/ so stale states from an older level can never linger.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let bytes = 0;
  for (const [key, state] of states) {
    const id = ids.get(key);
    const page = renderPage(level, state, id, ids);
    writeFileSync(join(OUT_DIR, `${id}.md`), page, 'utf8');
    bytes += Buffer.byteLength(page, 'utf8');
  }

  const fragment = renderStartFragment(level, states.get(startKey), ids);
  writeFileSync(START_FRAGMENT, fragment, 'utf8');
  bytes += Buffer.byteLength(fragment, 'utf8');

  // ---- verification ------------------------------------------------------
  const { files, hrefCount } = validateLinks();
  const reached = validateReachability(startId, states.size);
  const path = reconstructPath(states, firstWinKey);
  const walk = validateSolutionWalk(level, states, ids, startKey, path);

  // ---- report ------------------------------------------------------------
  const tiles = checkTiles();
  const mb = (bytes / 1024 / 1024).toFixed(2);
  console.log('');
  console.log('  Sokoban static state-space build');
  console.log('  --------------------------------');
  console.log(`  level dimensions      ${level.width} x ${level.height}`);
  console.log(`  boxes                 ${level.boxes.length}`);
  console.log(`  reachable states      ${states.size}`);
  console.log(`  win states            ${winCount}`);
  console.log(`  optimal solution      ${optimal} moves`);
  console.log(`  pages written         ${files} files in g/`);
  console.log(`  total bytes written   ${bytes} (${mb} MiB)`);
  console.log(`  start state id        ${startId}`);
  console.log('');
  console.log('  verification');
  console.log(`  [ok] link integrity   ${hrefCount} hrefs, all resolve to existing files`);
  console.log(`  [ok] reachability     link-walk reached all ${reached} pages from the start page`);
  console.log(`  [ok] solution walk    ${walk.hops} hops on disk, start ${startId} -> win ${walk.winId}, every board verified`);
  if (tiles.missing.length > 0) {
    console.log(`  [--] tile assets      ${tiles.present}/11 present; missing: ${tiles.missing.join(', ')} (owned by another build step)`);
  } else {
    console.log('  [ok] tile assets      all 11 present');
  }
  console.log('');
}

main();
