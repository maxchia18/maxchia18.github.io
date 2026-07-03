// extractor.js — parse a Zip screenshot into {rows, cols, numbers, walls}.
//
// Pure client-side computer vision on canvas pixels — no external libraries:
//   1. Grid lines via median row/column projection (robust to circles & walls)
//   2. Numbered circles via bright-blob connected components + circularity
//   3. Digit reading via runtime template matching (no OCR engine needed)
//   4. Walls via edge-brightness sampling between adjacent cells
//
// Exposes `extractPuzzle(imageBitmapOrCanvas)` -> puzzle object.

// ── tunables ────────────────────────────────────────────────────────────────
const GRIDLINE_THRESH_FRAC = 0.25;
const CIRCLE_MIN_AREA_FRAC  = 0.02;  // min blob area as fraction of a cell
const CIRCLE_CIRCULARITY    = 0.70;
const CIRCLE_BRIGHT         = 190;
const INK_DARK              = 130;   // digit ink threshold inside a circle
const WALL_BRIGHT           = 170;
const WALL_RATIO_THRESH     = 0.45;
const MAX_WAYPOINT          = 30;    // render digit templates for 1..this

// ── grayscale helpers ────────────────────────────────────────────────────────

function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return { gray, width, height };
}

function median(arr) {
  const a = Array.prototype.slice.call(arr).sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ── grid-line detection ──────────────────────────────────────────────────────

function findGridlines(profile, minGap, threshFrac = GRIDLINE_THRESH_FRAC) {
  const mean = profile.reduce((s, v) => s + v, 0) / profile.length;
  const max = Math.max(...profile);
  const thr = mean + (max - mean) * threshFrac;
  const peaks = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] > thr) {
      let j = i;
      while (j < profile.length && profile[j] > thr) j++;
      peaks.push((i + j) >> 1);
      i = j;
    } else i++;
  }
  const merged = [];
  for (const p of peaks) {
    if (merged.length && p - merged[merged.length - 1] < minGap) continue;
    merged.push(p);
  }
  return merged;
}

function detectGrid(gray, W, H) {
  const rowMed = new Float64Array(H);
  const colMed = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    rowMed[y] = median(gray.subarray(y * W, y * W + W));
  }
  const col = new Uint8ClampedArray(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = gray[y * W + x];
    colMed[x] = median(col);
  }
  return {
    rowLines: findGridlines(rowMed, (H / 20) | 0),
    colLines: findGridlines(colMed, (W / 20) | 0),
  };
}

// ── locating the grid within a larger screenshot ─────────────────────────────
// Lets the user drop a full phone screenshot (status bar, header, buttons and
// all) instead of a pre-cropped image of just the grid. The puzzle board is
// the only part of the screen with many evenly-spaced lines, so we look for
// the longest run of peaks with uniform spacing rather than assuming the
// whole image is the grid.

const REGION_THRESH_FRAC   = 0.12;  // looser than the in-grid pass; over-detect, then filter
const REGION_MIN_LINES     = 5;     // at least 5 lines (4+ cells) to call it a grid
const REGION_GAP_TOLERANCE = 0.22;  // max deviation from a run's own average spacing

// Longest run of consecutive peaks whose gaps stay within tolerance of the
// run's own running-average spacing. Returns {start, end} indices into
// `peaks`, or null if no run of at least REGION_MIN_LINES peaks qualifies.
function findUniformRun(peaks) {
  if (peaks.length < REGION_MIN_LINES) return null;
  let bestI = -1, bestJ = -1, bestLen = 0;

  for (let i = 0; i < peaks.length - 1; i++) {
    let gapSum = peaks[i + 1] - peaks[i];
    let gapCount = 1;
    let j = i + 1;
    while (j + 1 < peaks.length) {
      const avgGap = gapSum / gapCount;
      const gap = peaks[j + 1] - peaks[j];
      if (Math.abs(gap - avgGap) > avgGap * REGION_GAP_TOLERANCE) break;
      gapSum += gap;
      gapCount++;
      j++;
    }
    const len = j - i + 1;
    if (len > bestLen) { bestLen = len; bestI = i; bestJ = j; }
  }

  return bestLen >= REGION_MIN_LINES ? { start: bestI, end: bestJ } : null;
}

// Find the {x, y, w, h} bounding box of the puzzle grid inside a (possibly
// much larger) screenshot. Two passes:
//   1. Row profile over the FULL width finds the grid's vertical extent —
//      the grid is normally most of the screenshot's width, so its lines
//      dominate the median even with header/footer clutter elsewhere.
//   2. Column profile restricted to that vertical band finds the horizontal
//      extent, so content above/below the grid can't pollute it.
function findGridRegion(gray, W, H) {
  const rowMed = new Float64Array(H);
  for (let y = 0; y < H; y++) rowMed[y] = median(gray.subarray(y * W, y * W + W));
  const minGap = Math.max(8, (Math.min(W, H) / 100) | 0);

  const rowPeaks = findGridlines(rowMed, minGap, REGION_THRESH_FRAC);
  const rowRun = findUniformRun(rowPeaks);
  if (!rowRun) return null;
  const y0 = rowPeaks[rowRun.start];
  const y1 = rowPeaks[rowRun.end];

  const bandH = y1 - y0 + 1;
  const colBuf = new Uint8ClampedArray(bandH);
  const colMed = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < bandH; y++) colBuf[y] = gray[(y0 + y) * W + x];
    colMed[x] = median(colBuf);
  }

  const colPeaks = findGridlines(colMed, minGap, REGION_THRESH_FRAC);
  const colRun = findUniformRun(colPeaks);
  if (!colRun) return null;
  const x0 = colPeaks[colRun.start];
  const x1 = colPeaks[colRun.end];

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── circle (numbered cell) detection ─────────────────────────────────────────

function detectCircles(gray, W, H, minArea) {
  const label = new Int32Array(W * H).fill(0);
  const circles = [];
  const stack = [];
  let cur = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (gray[idx] < CIRCLE_BRIGHT || label[idx] !== 0) continue;
      // Flood fill this bright component.
      cur++;
      let area = 0, minX = x, maxX = x, minY = y, maxY = y;
      stack.length = 0;
      stack.push(idx);
      label[idx] = cur;
      while (stack.length) {
        const p = stack.pop();
        const px = p % W, py = (p / W) | 0;
        area++;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        // 4-neighbour connectivity
        const nb = [p - 1, p + 1, p - W, p + W];
        if (px === 0) nb[0] = -1;
        if (px === W - 1) nb[1] = -1;
        for (const q of nb) {
          if (q < 0 || q >= W * H) continue;
          if (gray[q] >= CIRCLE_BRIGHT && label[q] === 0) {
            label[q] = cur;
            stack.push(q);
          }
        }
      }
      if (area < minArea) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const d = Math.max(bw, bh);
      const circ = area / (Math.PI * (d / 2) * (d / 2));
      // Circles are near-square in bbox and fill it well; walls are long/thin.
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      if (circ >= CIRCLE_CIRCULARITY && aspect > 0.7) {
        circles.push({
          cx: ((minX + maxX) / 2) | 0,
          cy: ((minY + maxY) / 2) | 0,
          r: (d / 2) | 0,
        });
      }
    }
  }
  return circles;
}

// ── digit recognition via template matching ──────────────────────────────────

const NORM_W = 40, NORM_H = 40;

// Reduce an ink mask (with bbox) to a fixed NORM_W×NORM_H bitmap, aspect-preserved.
function normalizeInk(mask, mw, mh, bbox) {
  const { minX, minY, maxX, maxY } = bbox;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  if (bw <= 0 || bh <= 0) return null;
  const scale = Math.min(NORM_W / bw, NORM_H / bh) * 0.9;
  const outW = Math.max(1, Math.round(bw * scale));
  const outH = Math.max(1, Math.round(bh * scale));
  const offX = ((NORM_W - outW) / 2) | 0;
  const offY = ((NORM_H - outH) / 2) | 0;
  const out = new Uint8Array(NORM_W * NORM_H);
  for (let oy = 0; oy < outH; oy++) {
    const sy = minY + Math.min(bh - 1, (oy / scale) | 0);
    for (let ox = 0; ox < outW; ox++) {
      const sx = minX + Math.min(bw - 1, (ox / scale) | 0);
      if (mask[sy * mw + sx]) out[(offY + oy) * NORM_W + (offX + ox)] = 1;
    }
  }
  return out;
}

// Intersection-over-union of two ink bitmaps (robust to font differences).
function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i], bv = b[i];
    if (av | bv) uni++;
    if (av & bv) inter++;
  }
  return uni ? inter / uni : 0;
}

// Build normalized templates for numbers 1..MAX_WAYPOINT once.
function buildTemplates() {
  const templates = new Map();
  const cnv = document.createElement('canvas');
  cnv.width = 100; cnv.height = 100;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  for (let n = 1; n <= MAX_WAYPOINT; n++) {
    ctx.clearRect(0, 0, 100, 100);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#000';
    ctx.font = '700 60px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 50, 52);
    const img = ctx.getImageData(0, 0, 100, 100);
    const { mask, bbox } = inkMask(img.data, 100, 100, 0, 0, 100, 100, 0);
    const norm = bbox ? normalizeInk(mask, 100, 100, bbox) : null;
    if (norm) templates.set(n, norm);
  }
  return templates;
}

// Threshold dark ink within a region (optionally inside a circular mask).
function inkMask(data, W, H, x0, y0, w, h, circleR, ccx, ccy) {
  const mask = new Uint8Array(W * H);
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  const r2 = circleR ? circleR * circleR : 0;
  for (let y = y0; y < y0 + h && y < H; y++) {
    for (let x = x0; x < x0 + w && x < W; x++) {
      if (circleR) {
        const dx = x - ccx, dy = y - ccy;
        if (dx * dx + dy * dy > r2) continue; // outside circle
      }
      const p = (y * W + x) * 4;
      const lum = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
      if (lum < INK_DARK) {
        mask[y * W + x] = 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = maxX >= 0 ? { minX, minY, maxX, maxY } : null;
  return { mask, bbox };
}

function readDigit(ctx, W, H, circle, templates) {
  const { cx, cy, r } = circle;
  // Sample the circle interior, masking out the dark ring (use 0.78 r).
  const rr = Math.round(r * 0.78);
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r);
  const side = r * 2;
  const img = ctx.getImageData(x0, y0, Math.min(side, W - x0), Math.min(side, H - y0));
  const { mask, bbox } = inkMask(
    img.data, img.width, img.height,
    0, 0, img.width, img.height,
    rr, cx - x0, cy - y0
  );
  if (!bbox) return null;
  const norm = normalizeInk(mask, img.width, img.height, bbox);
  if (!norm) return null;

  let best = null, bestScore = 0;
  for (const [n, tmpl] of templates) {
    const s = iou(norm, tmpl);
    if (s > bestScore) { bestScore = s; best = n; }
  }
  return bestScore > 0.25 ? best : null;
}

// ── wall detection ───────────────────────────────────────────────────────────

function edgeIsWall(gray, W, rCenters, cCenters, r1, c1, r2, c2) {
  const y1 = rCenters[r1], x1 = cCenters[c1];
  const y2 = rCenters[r2], x2 = cCenters[c2];
  const my = (y1 + y2) >> 1, mx = (x1 + x2) >> 1;
  let bright = 0, total = 0;

  if (r2 === r1 + 1) {                       // horizontal edge
    const halfW = (Math.abs(cCenters[1] - cCenters[0]) / 3) | 0;
    for (let y = my - 3; y <= my + 3; y++)
      for (let x = mx - halfW; x <= mx + halfW; x++, total++)
        if (gray[y * W + x] > WALL_BRIGHT) bright++;
  } else if (c2 === c1 + 1) {                // vertical edge
    const halfH = (Math.abs(rCenters[1] - rCenters[0]) / 3) | 0;
    for (let y = my - halfH; y <= my + halfH; y++)
      for (let x = mx - 3; x <= mx + 3; x++, total++)
        if (gray[y * W + x] > WALL_BRIGHT) bright++;
  } else return false;

  return total > 0 && bright / total > WALL_RATIO_THRESH;
}

// ── public API ───────────────────────────────────────────────────────────────

let _templates = null;

function extractPuzzle(source) {
  // Draw source onto a canvas to access pixels.
  const W = source.width, H = source.height;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const { gray } = toGray(ctx.getImageData(0, 0, W, H));

  // 0. Locate the grid inside the screenshot. Handles both a pre-cropped
  //    puzzle image (the region is ~the whole image) and a full phone
  //    screenshot with a status bar, header, and buttons around the board.
  const region = findGridRegion(gray, W, H);
  if (!region) {
    throw new Error(
      "Couldn't find a Zip puzzle grid in this image. Make sure the whole " +
      'board (all rows and columns) is visible and not cut off, then try again.'
    );
  }

  // Crop to the grid region with a small margin so the outer border isn't clipped.
  const pad = Math.max(4, Math.round(Math.max(region.w, region.h) * 0.03));
  const rx = Math.max(0, region.x - pad);
  const ry = Math.max(0, region.y - pad);
  const rw = Math.min(W - rx, region.w + pad * 2);
  const rh = Math.min(H - ry, region.h + pad * 2);

  const cropCnv = document.createElement('canvas');
  cropCnv.width = rw; cropCnv.height = rh;
  const cropCtx = cropCnv.getContext('2d', { willReadFrequently: true });
  cropCtx.drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh);
  const { gray: cropGray } = toGray(cropCtx.getImageData(0, 0, rw, rh));

  // 1. grid lines (within the cropped region)
  const { rowLines, colLines } = detectGrid(cropGray, rw, rh);
  if (rowLines.length < 2 || colLines.length < 2) {
    throw new Error(
      "Found the puzzle area but couldn't read its grid lines clearly. " +
      'Try a sharper, straight-on screenshot.'
    );
  }
  const rows = rowLines.length - 1;
  const cols = colLines.length - 1;
  const rCenters = [], cCenters = [];
  for (let i = 0; i < rows; i++) rCenters.push((rowLines[i] + rowLines[i + 1]) >> 1);
  for (let i = 0; i < cols; i++) cCenters.push((colLines[i] + colLines[i + 1]) >> 1);
  const cellH = Math.round(median(diffs(rowLines)));
  const cellW = Math.round(median(diffs(colLines)));

  // 2. circles → numbers
  if (!_templates) _templates = buildTemplates();
  const minArea = cellH * cellW * CIRCLE_MIN_AREA_FRAC;
  const circles = detectCircles(cropGray, rw, rh, minArea);
  const nearest = (v, arr) =>
    arr.reduce((best, c, i) => Math.abs(c - v) < Math.abs(arr[best] - v) ? i : best, 0);

  const numbers = new Map();
  for (const circle of circles) {
    const gr = nearest(circle.cy, rCenters);
    const gc = nearest(circle.cx, cCenters);
    const digit = readDigit(cropCtx, rw, rh, circle, _templates);
    if (digit !== null) numbers.set(digit, [gr, gc]);
  }

  // 3. walls
  const walls = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r + 1 < rows && edgeIsWall(cropGray, rw, rCenters, cCenters, r, c, r + 1, c))
        walls.add(edgeKey(r, c, r + 1, c));
      if (c + 1 < cols && edgeIsWall(cropGray, rw, rCenters, cCenters, r, c, r, c + 1))
        walls.add(edgeKey(r, c, r, c + 1));
    }
  }

  // Crop rectangle for the visualizer, expressed in the ORIGINAL screenshot's
  // coordinates (the visualizer draws from `source`, not the sub-crop canvas).
  const crop = {
    x: rx + colLines[0], y: ry + rowLines[0],
    w: colLines[colLines.length - 1] - colLines[0],
    h: rowLines[rowLines.length - 1] - rowLines[0],
  };
  const rCentersLocal = rCenters.map((v) => v - rowLines[0]);
  const cCentersLocal = cCenters.map((v) => v - colLines[0]);

  return {
    rows, cols, numbers, walls,
    cellSize: [cellH, cellW],
    crop, rCentersLocal, cCentersLocal,
    source,
  };
}

function diffs(arr) {
  const d = [];
  for (let i = 1; i < arr.length; i++) d.push(arr[i] - arr[i - 1]);
  return d;
}

// Confidence heuristic — flags a likely mis-read so the UI can warn.
function extractionConfidence(puzzle) {
  const { numbers, rows, cols } = puzzle;
  if (numbers.size === 0) return { ok: false, reason: 'no numbers detected' };
  const maxNum = Math.max(...numbers.keys());
  const missing = [];
  for (let i = 1; i <= maxNum; i++) if (!numbers.has(i)) missing.push(i);
  if (missing.length) return { ok: false, reason: `missing numbers: ${missing.join(', ')}` };
  for (const [n, [r, c]] of numbers)
    if (r < 0 || r >= rows || c < 0 || c >= cols)
      return { ok: false, reason: `number ${n} out of bounds` };
  return { ok: true, reason: 'ok' };
}

if (typeof window !== 'undefined') {
  window.extractPuzzle = extractPuzzle;
  window.extractionConfidence = extractionConfidence;
}
