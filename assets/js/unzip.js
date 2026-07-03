/* unzip.js — UI glue for the Unzip (LinkedIn Zip) solver section.
   Scoped to #unzip; relies on unzip-solver/extractor/visualizer globals. */
(function () {
  const STAGES = [
    'Loading image',
    'Detecting grid & numbers',
    'Detecting walls',
    'Solving puzzle',
    'Rendering solution',
  ];

  const $ = (id) => document.getElementById(id);
  const dropZone  = $('unzip-drop');
  const fileInput = $('unzip-file');
  const results   = $('unzip-results');
  const stageList = $('unzip-stages');
  const timeLabel = $('unzip-time');
  const canvas    = $('unzip-canvas');
  const saveBtn   = $('unzip-save');
  const resetBtn  = $('unzip-reset');
  const errorBox    = $('unzip-error');
  const dropTitle   = $('unzip-drop-title');
  const placeholder = $('unzip-placeholder');

  if (!dropZone) return; // section not present

  let stageEls = [];

  function buildStages() {
    stageList.innerHTML = '';
    stageEls = STAGES.map((label) => {
      const row = document.createElement('div');
      row.className = 'unzip__stage';
      row.innerHTML =
        `<span class="unzip__stage-icon">○</span><span>${label}</span>`;
      stageList.appendChild(row);
      return row;
    });
  }

  function setStage(i, state) {
    const row = stageEls[i];
    if (!row) return;
    row.className = `unzip__stage ${state}`;
    row.querySelector('.unzip__stage-icon').textContent =
      state === 'active' ? '⟳' : state === 'done' ? '✓' : state === 'error' ? '✗' : '○';
  }

  const nextFrame = () =>
    new Promise((r) => requestAnimationFrame(() => setTimeout(r, 90)));

  async function runPipeline(bitmap) {
    errorBox.hidden = true;
    buildStages();                 // reset checklist to unmarked
    placeholder.hidden = false;    // keep placeholder until solved
    canvas.hidden = true;
    saveBtn.hidden = true;
    resetBtn.hidden = true;
    timeLabel.textContent = '';
    const t0 = performance.now();

    try {
      setStage(0, 'active'); await nextFrame(); setStage(0, 'done');

      setStage(1, 'active'); await nextFrame();
      const puzzle = extractPuzzle(bitmap);
      const conf = extractionConfidence(puzzle);
      setStage(1, 'done');

      setStage(2, 'active'); await nextFrame(); setStage(2, 'done');
      if (!conf.ok) console.warn('Unzip: low confidence —', conf.reason);

      setStage(3, 'active'); await nextFrame();
      const path = solveZip(puzzle.rows, puzzle.cols, puzzle.numbers, puzzle.walls);
      if (!path) {
        const nums = [...puzzle.numbers.keys()].sort((a, b) => a - b).join(', ');
        const hint = !conf.ok
          ? ` It looks like some numbers weren't read correctly (${conf.reason}).`
          : '';
        throw new Error(
          `No solution found — read as a ${puzzle.rows}×${puzzle.cols} grid with ` +
          `numbers ${nums || '(none)'}.${hint} Try a sharper, straight-on screenshot.`
        );
      }
      setStage(3, 'done');

      setStage(4, 'active'); await nextFrame();
      drawSolution(canvas, puzzle, path);
      placeholder.hidden = true;
      canvas.hidden = false;
      setStage(4, 'done');

      const secs = ((performance.now() - t0) / 1000).toFixed(2);
      timeLabel.textContent = `Solved in ${secs}s · ${path.length} cells`;
      saveBtn.hidden = false;
      resetBtn.hidden = false;
    } catch (err) {
      stageEls.forEach((row, i) => {
        if (row.classList.contains('active')) setStage(i, 'error');
      });
      errorBox.textContent = err.message || String(err);
      errorBox.hidden = false;
      resetBtn.hidden = false;
    }
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      errorBox.textContent = 'Please choose an image file (PNG or JPG).';
      errorBox.hidden = false;
      return;
    }
    const bitmap = await createImageBitmap(file);
    dropTitle.textContent = file.name;
    runPipeline(bitmap);
  }

  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }));
  dropZone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  // Paste from clipboard only while the Unzip section is in view.
  window.addEventListener('paste', (e) => {
    const rect = document.getElementById('unzip').getBoundingClientRect();
    const visible = rect.top < window.innerHeight && rect.bottom > 0;
    if (!visible) return;
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  });

  saveBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'unzip-solution.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  resetBtn.addEventListener('click', () => {
    buildStages();                 // checklist stays visible, unmarked
    placeholder.hidden = false;
    canvas.hidden = true;
    saveBtn.hidden = true;
    resetBtn.hidden = true;
    errorBox.hidden = true;
    timeLabel.textContent = '';
    fileInput.value = '';
    dropTitle.textContent = 'Drop screenshot, tap to browse, or paste';
  });

  // Populate the checklist on load so Progress is always visible (unmarked).
  buildStages();

  document.getElementById('unzip-sample')?.addEventListener('click', (e) => {
    e.preventDefault();
    fetch('assets/img/unzip-sample.png')
      .then((r) => r.blob())
      .then((b) => handleFile(new File([b], 'sample.png', { type: 'image/png' })));
  });
})();
