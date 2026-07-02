// visualizer.js — draw the solved path over the puzzle screenshot on a canvas.

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
  ctx.scale(S, S);

  // Draw the cropped grid region of the original screenshot as the backdrop.
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

  const center = ([r, c]) => [cCentersLocal[c], rCentersLocal[r]];
  const lineW = Math.max(4, Math.min(cellW, cellH) / 5);

  // Continuous rounded polyline through every cell center.
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.95)';
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  path.forEach((cell, i) => {
    const [x, y] = center(cell);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Start (green) and end (red) markers.
  const [sx, sy] = center(path[0]);
  const [ex, ey] = center(path[path.length - 1]);
  dot(ctx, sx, sy, lineW, '#22c55e');
  dot(ctx, ex, ey, lineW, '#ef4444');

  return canvas;
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

if (typeof window !== 'undefined') window.drawSolution = drawSolution;
