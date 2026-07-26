#!/usr/bin/env node
/**
 * build-ttt.mjs
 * ----------------------------------------------------------------------------
 * Pre-renders an UNBEATABLE tic-tac-toe game as a single markdown fragment made
 * of nested <details>/<summary> disclosure elements.
 *
 * The whole game is playable inside a GitHub README with ZERO JavaScript, ZERO
 * backend and ZERO navigation: every reachable position is already in the file,
 * and "playing a move" is just unfolding the <details> for that cell. The URL
 * never changes.
 *
 * The engine moves FIRST and plays perfect minimax. That is a deliberate design
 * choice: engine-first collapses the branching factor of the first ply from 9 to
 * 1, shrinking the emitted tree by roughly an order of magnitude, which is what
 * makes the fragment fit in a README at all.
 *
 * Because the engine is perfect, the visitor can never win. The generator proves
 * this rather than asserting it: it walks EVERY leaf of the emitted tree and
 * throws if any of them is a visitor win.
 *
 * Node 20+ ESM. No dependencies (node: built-ins only).
 *
 *   node scripts/build-ttt.mjs
 *
 * Owns: this file, assets/t/*.svg, build/ttt-section.md. Touches nothing else.
 * ----------------------------------------------------------------------------
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 1. Paths and budget
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'build');
const OUT_FILE = join(OUT_DIR, 'ttt-section.md');

/** GitHub degrades / stops rendering very large READMEs. Hard ceiling. */
const BYTE_BUDGET = 350 * 1024;

/** Tile srcs are resolved relative to README.md at the repo root. */
const TILE_PREFIX = 'assets/t/';

// ---------------------------------------------------------------------------
// 2. Game primitives
// ---------------------------------------------------------------------------
const AI = 'o'; // the engine, copper, moves first
const HU = 'x'; // the visitor, neutral, moves second

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

/** @param {(string|null)[]} b */
function winner(b) {
  for (const [a, c, d] of LINES) {
    if (b[a] !== null && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return null;
}

/** @param {(string|null)[]} b */
function plyCount(b) {
  let n = 0;
  for (const c of b) if (c !== null) n++;
  return n;
}

/** @param {(string|null)[]} b */
function emptyCells(b) {
  const out = [];
  for (let i = 0; i < 9; i++) if (b[i] === null) out.push(i);
  return out;
}

/** Human-readable cell name: columns A..C, rows 1..3. */
function cellName(i) {
  return 'ABC'[i % 3] + String(Math.floor(i / 3) + 1);
}

// ---------------------------------------------------------------------------
// 3. Minimax (real search, no opening book)
// ---------------------------------------------------------------------------
//
// Score is from the ENGINE's point of view:
//   engine win  -> +10 - ply   (prefer winning sooner)
//   visitor win -> ply - 10    (prefer losing later)
//   draw        ->  0
//
// The depth term uses `ply` = number of marks already on the board, which is a
// pure function of the position. That matters: if the depth term were a counter
// threaded through the recursion it would depend on WHERE the search started,
// and the transposition table below would be unsound (the same position could
// legitimately memoize two different scores). Keying the penalty to the
// position itself keeps minimax(board, turn) a pure function, so memoizing on
// (board, turn) is safe.
const memo = new Map();

/**
 * @param {(string|null)[]} b board, mutated in place then restored
 * @param {string} turn whose move it is
 * @returns {number} score for the engine
 */
function minimax(b, turn) {
  const w = winner(b);
  const ply = plyCount(b);
  if (w === AI) return 10 - ply;
  if (w === HU) return ply - 10;
  if (ply === 9) return 0;

  const key = b.map((c) => c ?? '.').join('') + turn;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const maximizing = turn === AI;
  let best = maximizing ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i] !== null) continue;
    b[i] = turn;
    const score = minimax(b, maximizing ? HU : AI);
    b[i] = null;
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }

  memo.set(key, best);
  return best;
}

/**
 * The engine's move: the empty cell with the highest minimax score.
 * Ties break on the lowest index, which makes the whole tree deterministic.
 * @param {(string|null)[]} b
 * @returns {number} chosen cell index
 */
function engineMove(b) {
  let bestCell = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i] !== null) continue;
    b[i] = AI;
    const score = minimax(b, HU);
    b[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestCell = i;
    }
  }
  if (bestCell === -1) throw new Error('engineMove called on a full board');
  return bestCell;
}

// ---------------------------------------------------------------------------
// 4. Board rendering
// ---------------------------------------------------------------------------
//
// Two modes. `img` is the intended look. `code` renders the same board as
// compact monospace text at about a tenth of the bytes.
//
// In `img` mode every byte of a tile <img> is paid 9 times per board across
// hundreds of nodes, so the tag is stripped to the bone: no width, no height,
// no alt. The SVGs carry their own intrinsic 40x40 dimensions, and each one has
// an internal aria-label, so nothing is lost.
//
// WHY THE COLLAPSED SUMMARY IS TEXT AND NOT TILES
// -----------------------------------------------
// Verified against GitHub's own renderer (POST /markdown/raw), not assumed:
// GitHub AUTO-WRAPS every <img> in an anchor to the asset, injecting
//   <a target="_blank" rel="noopener noreferrer" href="assets/t/o.svg">
// around it. Inside a <summary> that is fatal: the tiles are the biggest click
// target in the control, so clicking the board would navigate to a bare SVG
// file instead of unfolding the move, and the Back button would come home to a
// fully collapsed tree. That breaks both "no navigation" and "the URL never
// changes".
//
// The wrap cannot be suppressed. Both escapes were measured and both fail:
//   <a><img>          -> GitHub injects href + target="_blank" anyway
//   <a href=""><img>  -> survives, but an empty href RELOADS the page on click,
//                        which collapses the whole tree. Worse than navigating.
//
// So the collapsed summary uses a <code> board, which has no clickable child and
// lets the click reach the <summary> toggle where it belongs. The expanded body
// keeps the full tile board: it is a result display, not a control, and an image
// that opens the asset on click is ordinary GitHub behaviour everywhere else.
// The side effect is a large byte win, since the summary board is paid once per
// node.

const IMG = {
  o: `<img src="${TILE_PREFIX}o.svg">`,
  x: `<img src="${TILE_PREFIX}x.svg">`,
  e: `<img src="${TILE_PREFIX}e.svg">`,
};

const TEXT = { o: 'O', x: 'X', e: '.' };

/**
 * @param {(string|null)[]} b
 * @param {'img'|'code'} mode
 */
function renderBoard(b, mode) {
  if (mode === 'code') {
    const rows = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) row.push(TEXT[b[r * 3 + c] ?? 'e']);
      rows.push(row.join(' '));
    }
    return `<code>${rows.join('<br>')}</code>`;
  }

  let out = '<table>';
  for (let r = 0; r < 3; r++) {
    out += '<tr>';
    for (let c = 0; c < 3; c++) out += `<td>${IMG[b[r * 3 + c] ?? 'e']}</td>`;
    out += '</tr>';
  }
  return out + '</table>';
}

// ---------------------------------------------------------------------------
// 5. Tree emission
// ---------------------------------------------------------------------------
//
// Shape per visitor move:
//
//   <details>
//   <summary>{cell label}{board after the visitor played it}</summary>
//                                      <- blank line: closes the raw-HTML block
//   {board after the engine's reply}
//
//   {terminal message, or one nested <details> per remaining legal move}
//
//   </details>
//
// The blank line after <summary> is what lets GitHub parse the rest of the node
// as normal content rather than swallowing it into one opaque HTML block. The
// emitted body is pure HTML from the allow-list (details, summary, table, tr,
// td, img, b, code, br), so it renders correctly either way; the blank line is
// kept because it is the documented-correct GFM form and it is what makes the
// terminal messages render as their own paragraphs.
//
// Terminal branches are PRUNED: once the engine has won or the board is full,
// the node has no children. That pruning is the whole reason this fits.

/** @typedef {{outcome:'ai'|'draw', depth:number}} Leaf */

function buildTree(mode) {
  const out = [];
  const stats = {
    nodes: 0,        // <details> elements emitted (one per visitor move)
    maxDepth: 0,     // deepest <details> nesting level
    leaves: [],      // every terminal position reached
    aiWins: 0,
    draws: 0,
    visitorWins: 0,  // must stay 0 - checked per move AND per leaf below
  };

  // ---- opening: the engine moves first on an empty board -------------------
  const root = new Array(9).fill(null);
  const opening = engineMove(root);
  root[opening] = AI;

  out.push('### Unbeatable tic-tac-toe');
  out.push('');
  out.push(
    'The engine moves first and plays perfect minimax, so **you cannot win**. ' +
    'A draw is the best result on offer. Every reply is precomputed into this ' +
    'file: no JavaScript, no server, no page loads, and the URL never changes. ' +
    'Unfold a cell to play it.',
  );
  out.push('');
  out.push(
    `Engine opens at **${cellName(opening)}**. Each folded row previews the board ` +
    'your move would make, as `O` for the engine and `X` for you. Open it to see the reply.',
  );
  out.push('');
  out.push('Your move:');
  out.push('');
  out.push(renderBoard(root, mode));
  out.push('');

  // ---- one <details> per legal visitor reply -------------------------------
  for (const cell of emptyCells(root)) {
    emitNode(root, cell, 1, mode, out, stats);
  }

  out.push('');
  out.push(
    `<b>${stats.leaves.length}</b> endings are folded above. ` +
    `<b>${stats.aiWins}</b> are engine wins, <b>${stats.draws}</b> are draws, ` +
    'and none of them is a win for you.',
  );
  out.push('');

  return { text: out.join('\n'), stats, opening };
}

/**
 * Emit the <details> for one visitor move, and recurse.
 * @param {(string|null)[]} parent position the visitor is moving from
 * @param {number} cell the cell the visitor plays
 * @param {number} depth 1-based <details> nesting level
 * @param {'img'|'code'} mode
 * @param {string[]} out
 */
function emitNode(parent, cell, depth, mode, out, stats) {
  stats.nodes++;
  if (depth > stats.maxDepth) stats.maxDepth = depth;

  // --- the visitor's move ---------------------------------------------------
  const afterHuman = parent.slice();
  afterHuman[cell] = HU;

  // The proof, checked at every single visitor move in the entire tree.
  if (winner(afterHuman) === HU) {
    stats.visitorWins++;
    throw new Error(
      `PERFECT-PLAY VIOLATION: visitor wins by playing ${cellName(cell)} ` +
      `into position ${parent.map((c) => c ?? '.').join('')}`,
    );
  }

  // The summary board is ALWAYS 'code': see the note above renderBoard. An <img>
  // here would become a link and steal the click from the disclosure toggle.
  out.push('<details>');
  out.push(`<summary>${cellName(cell)} ${renderBoard(afterHuman, 'code')}</summary>`);
  out.push('');

  // A visitor move can never fill the board: the engine holds moves 1,3,5,7,9,
  // so cell 9 is always the engine's. Guarded anyway rather than assumed.
  if (plyCount(afterHuman) === 9) {
    out.push(renderBoard(afterHuman, mode));
    out.push('');
    out.push('<b>Draw.</b>');
    stats.leaves.push({ outcome: 'draw', depth });
    stats.draws++;
    out.push('');
    out.push('</details>');
    return;
  }

  // --- the engine's reply ---------------------------------------------------
  const afterAi = afterHuman.slice();
  afterAi[engineMove(afterHuman)] = AI;

  out.push(renderBoard(afterAi, mode));
  out.push('');

  if (winner(afterAi) === AI) {
    out.push('<b>Engine wins.</b>');
    stats.leaves.push({ outcome: 'ai', depth });
    stats.aiWins++;
  } else if (plyCount(afterAi) === 9) {
    out.push('<b>Draw.</b> Best available.');
    stats.leaves.push({ outcome: 'draw', depth });
    stats.draws++;
  } else {
    // Not terminal: branch on every legal visitor reply.
    for (const next of emptyCells(afterAi)) {
      emitNode(afterAi, next, depth + 1, mode, out, stats);
    }
  }

  out.push('');
  out.push('</details>');
}

// ---------------------------------------------------------------------------
// 6. Self-validation
// ---------------------------------------------------------------------------
//
// Exhaustive, not sampled. Every leaf of the emitted tree is inspected. Because
// the engine's move is deterministic and EVERY legal visitor move is branched,
// the leaf set is the complete set of possible games against this engine. So
// "no leaf is a visitor win" is a proof of unbeatability over all visitor play,
// not evidence for it.
function validate(stats) {
  const bad = stats.leaves.filter((l) => l.outcome !== 'ai' && l.outcome !== 'draw');
  if (bad.length > 0) {
    throw new Error(`SELF-VALIDATION FAILED: ${bad.length} leaves are not an engine win or a draw`);
  }
  if (stats.visitorWins !== 0) {
    throw new Error(`SELF-VALIDATION FAILED: ${stats.visitorWins} visitor wins found`);
  }
  if (stats.leaves.length === 0) {
    throw new Error('SELF-VALIDATION FAILED: no leaves were produced, the walk is broken');
  }
  if (stats.aiWins + stats.draws !== stats.leaves.length) {
    throw new Error('SELF-VALIDATION FAILED: leaf outcome counts do not reconcile');
  }
  return stats.leaves.length;
}

// ---------------------------------------------------------------------------
// 7. Build
// ---------------------------------------------------------------------------
function main() {
  let mode = /** @type {'img'|'code'} */ ('img');
  let built = buildTree(mode);
  let bytes = Buffer.byteLength(built.text, 'utf8');
  let fellBack = false;

  if (bytes > BYTE_BUDGET) {
    mode = 'code';
    fellBack = true;
    built = buildTree(mode);
    bytes = Buffer.byteLength(built.text, 'utf8');
  }

  const checked = validate(built.stats);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, built.text, 'utf8');

  const { stats } = built;
  const kb = (bytes / 1024).toFixed(1);
  const budgetKb = (BYTE_BUDGET / 1024).toFixed(0);

  console.log('build-ttt');
  console.log('---------');
  console.log(`  board mode        : ${mode}${fellBack ? ' (FELL BACK: img exceeded the byte budget)' : ''}`);
  console.log(`  engine opening    : ${cellName(built.opening)}`);
  console.log(`  total nodes       : ${stats.nodes}  (<details> elements, one per visitor move)`);
  console.log(`  max nesting depth : ${stats.maxDepth}`);
  console.log(`  terminal leaves   : ${stats.leaves.length}`);
  console.log(`    engine wins     : ${stats.aiWins}`);
  console.log(`    draws           : ${stats.draws}`);
  console.log(`    visitor wins    : ${stats.visitorWins}`);
  console.log(`  minimax states    : ${memo.size} memoized`);
  console.log(`  byte size         : ${bytes} bytes (${kb} KB) of ${budgetKb} KB budget`);
  console.log(`  self-validation   : PASSED - ${checked} leaves checked, every one an engine win or a draw, 0 visitor wins`);
  console.log(`  written           : ${OUT_FILE}`);

  if (bytes > BYTE_BUDGET) {
    throw new Error(`OVER BUDGET even in code mode: ${bytes} > ${BYTE_BUDGET}`);
  }
}

main();
