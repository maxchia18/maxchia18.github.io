// visualizer.js — draw the solved path over the puzzle screenshot on a canvas.

// Overall opacity of the path layer, so the numbers underneath stay readable.
const PATH_OPACITY = 0.85;

function drawSolution(canvas, puzzle, path) {
  const { crop, rCentersLocal, cCentersLocal, source, cellSize } = puzzle;
  const [cellH, cellW] = cellSize;

  // Supersample so the path stays crisp on high-DPI screens and when scaled.
  // The bitmap is 2× the crop; CSS controls the on-screen display size.
  const S = 2;
  canvas.width = crop.w * S;
  canvas.height = crop.h * S;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // Draw the cropped grid region of the original screenshot as the backdrop.
  ctx.save();
  ctx.scale(S, S);
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  ctx.restore();

  const center = ([r, c]) => [cCentersLocal[c], rCentersLocal[r]];
  const lineW = Math.max(4, Math.min(cellW, cellH) / 5);
  const pts = path.map(center);

  // Gradient stops the path flows through (start → end) — greens only.
  const STOPS = [
    [0.00, [134, 239, 172]],  // light green
    [0.55, [74, 222, 128]],   // green
    [1.00, [22, 163, 74]],    // emerald
  ];
  const colorAt = (t) => {
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
        const k = (t - t0) / (t1 - t0 || 1);
        const ch = (a, b) => Math.round(a + (b - a) * k);
        return `rgb(${ch(c0[0], c1[0])}, ${ch(c0[1], c1[1])}, ${ch(c0[2], c1[2])})`;
      }
    }
    return `rgb(${STOPS[STOPS.length - 1][1].join(',')})`;
  };

  // Render the whole path onto a separate layer first, then composite it at
  // reduced opacity. Doing it in one layer keeps the transparency uniform —
  // the overlapping round caps don't double-darken where segments meet, so
  // the waypoint numbers stay evenly visible through the line.
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const lc = layer.getContext('2d');
  lc.scale(S, S);
  lc.lineJoin = 'round';
  lc.lineCap = 'round';

  // Soft glow underlay so the path pops against the dark board.
  lc.save();
  lc.shadowColor = 'rgba(74, 222, 128, 0.55)';
  lc.shadowBlur = lineW * 1.6;
  lc.strokeStyle = 'rgba(74, 222, 128, 0.9)';
  lc.lineWidth = lineW;
  lc.beginPath();
  pts.forEach(([x, y], i) => (i ? lc.lineTo(x, y) : lc.moveTo(x, y)));
  lc.stroke();
  lc.restore();

  // Gradient body: draw each segment with a color interpolated by its
  // progress along the path.
  lc.lineWidth = lineW;
  const segs = pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const g = lc.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, colorAt(i / (segs - 1 || 1)));
    g.addColorStop(1, colorAt((i + 1) / (segs - 1 || 1)));
    lc.strokeStyle = g;
    lc.beginPath();
    lc.moveTo(x1, y1);
    lc.lineTo(x2, y2);
    lc.stroke();
  }

  // Start and end markers, matching the gradient ends, with white rings.
  dot(lc, pts[0][0], pts[0][1], lineW * 0.9, colorAt(0));
  dot(lc, pts[segs][0], pts[segs][1], lineW * 0.9, colorAt(1));

  // Composite the path layer over the screenshot at reduced opacity.
  ctx.globalAlpha = PATH_OPACITY;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;

  return canvas;
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // white ring for contrast
  ctx.lineWidth = Math.max(2, r * 0.35);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

if (typeof window !== 'undefined') window.drawSolution = drawSolution;
