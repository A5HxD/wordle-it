/* global WORDLE_IT_DEFAULT_WORDS, WordleItSolver */

(function () {
  // If anything below throws, surface it in the UI instead of silently failing.
  try {
  const MAX_ROWS = 6;
  const WORD_LEN = 5;

  const boardEl = document.getElementById("board");
  const suggestedWordEl = document.getElementById("suggestedWord");
  const suggestedMetaEl = document.getElementById("suggestedMeta");
  const remainingCountEl = document.getElementById("remainingCount");
  const modeLabelEl = document.getElementById("modeLabel");
  const topListEl = document.getElementById("topList");

  const submitBtn = document.getElementById("submitBtn");
  const undoBtn = document.getElementById("undoBtn");
  const resetBtn = document.getElementById("resetBtn");

  const learnModalEl = document.getElementById("learnModal");
  const learnMessageEl = document.getElementById("learnMessage");
  const learnWordInputEl = document.getElementById("learnWordInput");
  const learnSaveBtn = document.getElementById("learnSaveBtn");
  const learnCancelBtn = document.getElementById("learnCancelBtn");
  const learnStatusEl = document.getElementById("learnStatus");

  const STATE_ABSENT = 0;
  const STATE_PRESENT = 1;
  const STATE_CORRECT = 2;

  let allowedGuesses = [];
  let candidates = [];

  let currentRow = 0;
  let history = []; // { guess, pattern }
  let solved = false;
  let openerCache = null; // { topWide: [{word, score}], stats }
  const OPENER_IDX_KEY = "wordle_it_opener_idx_v1";
  let manualGuess = null; // { row:number, word:string, meta:string }
  const USER_WORDS_KEY = "wordle_it_user_words_v1";

  function setCurrentGuess(word, metaText) {
    if (solved || currentRow >= MAX_ROWS) return;
    suggestedWordEl.textContent = word ? word.toUpperCase() : "—";
    if (typeof metaText === "string") suggestedMetaEl.textContent = metaText;
    manualGuess = { row: currentRow, word: String(word || "").toLowerCase(), meta: metaText || "" };
    if (!solved && currentRow < MAX_ROWS && WordleItSolver.isLowerAlphaWord(manualGuess.word)) {
      fillRowWithGuess(currentRow, manualGuess.word);
    }
  }

  function setWordList(words, reasonLabel) {
    allowedGuesses = words.slice();
    candidates = words.slice(); // use same list as possible answers by default
    // UI label removed; keep word list changes internal.
    void reasonLabel;
  }

  function loadUserWords() {
    try {
      const raw = localStorage.getItem(USER_WORDS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((w) => WordleItSolver.normalizeWord(w))
        .filter((w) => WordleItSolver.isLowerAlphaWord(w));
    } catch (_) {
      return [];
    }
  }

  function saveUserWord(word) {
    const normalized = WordleItSolver.normalizeWord(word);
    if (!WordleItSolver.isLowerAlphaWord(normalized)) return { ok: false, reason: "invalid" };
    const existing = new Set(loadUserWords());
    if (existing.has(normalized)) return { ok: false, reason: "exists" };
    existing.add(normalized);
    try {
      localStorage.setItem(USER_WORDS_KEY, JSON.stringify(Array.from(existing).sort()));
      return { ok: true };
    } catch (_) {
      return { ok: false, reason: "storage" };
    }
  }

  function mergedCorpus() {
    const base = Array.isArray(window.WORDLE_IT_DEFAULT_WORDS) ? window.WORDLE_IT_DEFAULT_WORDS : [];
    const merged = new Set(base);
    for (const w of loadUserWords()) merged.add(w);
    return Array.from(merged);
  }

  function openLearnModal(message) {
    learnStatusEl.textContent = "";
    learnMessageEl.textContent = message || "What was the correct word?";
    learnWordInputEl.value = "";
    learnModalEl.classList.add("is-open");
    learnModalEl.setAttribute("aria-hidden", "false");
    setTimeout(() => learnWordInputEl.focus(), 0);
  }

  function closeLearnModal() {
    learnModalEl.classList.remove("is-open");
    learnModalEl.setAttribute("aria-hidden", "true");
  }

  function tileEl(row, col) {
    return document.getElementById(`tile-${row}-${col}`);
  }

  function setTile(row, col, letter, state) {
    const el = tileEl(row, col);
    el.textContent = letter ? letter.toUpperCase() : "";
    el.dataset.state = String(state);
  }

  function lockRow(row, locked) {
    for (let c = 0; c < WORD_LEN; c++) {
      const el = tileEl(row, c);
      el.classList.toggle("tile--locked", locked);
      el.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < MAX_ROWS; r++) {
      const row = document.createElement("div");
      row.className = "rowGrid";
      row.setAttribute("role", "row");
      for (let c = 0; c < WORD_LEN; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.id = `tile-${r}-${c}`;
        tile.dataset.state = "0";
        tile.setAttribute("role", "gridcell");
        tile.setAttribute("tabindex", r === 0 && c === 0 ? "0" : "-1");
        tile.setAttribute("aria-label", `Row ${r + 1} column ${c + 1}`);
        tile.addEventListener("click", () => onTileClick(r, c));
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  function onTileClick(row, col) {
    if (row !== currentRow) return;
    const el = tileEl(row, col);
    if (el.classList.contains("tile--locked")) return;
    const cur = Number(el.dataset.state || "0");
    const next = (cur + 1) % 3;
    el.dataset.state = String(next);
  }

  function setSuggestedWord(word, entropy) {
    suggestedWordEl.textContent = word ? word.toUpperCase() : "—";
    const bits = typeof entropy === "number" ? entropy.toFixed(3) : "—";
    suggestedMetaEl.textContent =
      word && word !== "—"
        ? `Expected information gain: ${bits} bits`
        : "No suggestion available";
  }

  function getRowPattern(row) {
    const pattern = [];
    for (let c = 0; c < WORD_LEN; c++) {
      pattern.push(Number(tileEl(row, c).dataset.state || "0"));
    }
    return pattern;
  }

  function clearRow(row) {
    for (let c = 0; c < WORD_LEN; c++) setTile(row, c, "", STATE_ABSENT);
    lockRow(row, false);
  }

  function fillRowWithGuess(row, guess) {
    for (let c = 0; c < WORD_LEN; c++) setTile(row, c, guess[c], STATE_ABSENT);
    lockRow(row, false);
  }

  function allGreen(pattern) {
    for (let i = 0; i < WORD_LEN; i++) if (pattern[i] !== STATE_CORRECT) return false;
    return true;
  }

  function updateSidePanel(best, top) {
    remainingCountEl.textContent = String(candidates.length);
    modeLabelEl.textContent = history.length === 0 ? "Explore (all guesses)" : "Constrain (candidates)";
    setSuggestedWord(best.word, best.entropy);

    topListEl.innerHTML = "";
    for (const item of top) {
      const el = document.createElement("div");
      el.className = "pick";
      el.dataset.word = item.word;
      el.addEventListener("click", () => {
        if (currentRow >= MAX_ROWS) return;
        setCurrentGuess(item.word, `Selected: ${item.entropy.toFixed(3)} bits`);
      });
      const left = document.createElement("div");
      left.className = "pick__word";
      left.textContent = item.word.toUpperCase();
      const right = document.createElement("div");
      right.className = "pick__score";
      right.textContent = `${item.entropy.toFixed(3)} bits`;
      el.appendChild(left);
      el.appendChild(right);
      topListEl.appendChild(el);
    }
  }

  function computeAndRenderSuggestion() {
    if (candidates.length === 0) {
      setSuggestedWord("—", 0);
      suggestedMetaEl.textContent =
        "No candidates left. Check that your colors match Wordle exactly.";
      remainingCountEl.textContent = "0";
      topListEl.innerHTML = "";
      return;
    }
    if (history.length === 0) {
      // Smart dynamic opener: compute once and reuse (avoid UI freezes).
      if (!openerCache) {
        suggestedWordEl.textContent = "—";
        suggestedMetaEl.textContent = "Computing opener…";
        remainingCountEl.textContent = String(candidates.length);
        modeLabelEl.textContent = "Opener (frequency)";
        topListEl.innerHTML = "";
        setTimeout(() => {
          const stats = WordleItSolver.buildFrequencyStats(allowedGuesses);
          const topWide = topKByFrequency(allowedGuesses, stats, 50);
          openerCache = { topWide, stats };
          computeAndRenderSuggestion();
        }, 0);
        return;
      }

      const opener = pickRotatingOpener(openerCache.topWide);
      setCurrentGuess(
        opener.word,
        `Frequency opener #${opener.rank} — score ${opener.score.toFixed(4)}`
      );
      remainingCountEl.textContent = String(candidates.length);
      modeLabelEl.textContent = "Opener (frequency)";
      renderTopFrequencyList(openerCache.topWide.slice(0, 8), "opener");
      return;
    }

    // After the first clue: exact entropy over large candidate sets is O(n^2) and will freeze.
    // Use a fast frequency-based heuristic until the set is smaller, then switch to entropy.
    // Keep exact entropy work small to avoid blocking the UI thread.
    // Entropy is O(n^2) when guessPool==candidates, so use a conservative threshold.
    if (candidates.length > 900) {
      const stats = WordleItSolver.buildFrequencyStats(candidates);
      const bestFreq = bestByFrequency(candidates, stats);
      setCurrentGuess(bestFreq.word, `Heuristic: frequency (candidates=${candidates.length})`);
      remainingCountEl.textContent = String(candidates.length);
      modeLabelEl.textContent = "Constrain (fast)";
      renderTopFrequencyList(topKByFrequency(candidates, stats, 8), "heuristic");
      return;
    }

    // Exact entropy (safe once candidates are small enough).
    const guessPool = candidates;
    suggestedMetaEl.textContent = "Computing best entropy guess…";
    setTimeout(() => {
      const best = WordleItSolver.bestSuggestion(candidates, guessPool);
      const top = WordleItSolver.topSuggestions(candidates, guessPool, 8);
      updateSidePanel(best, top);
      // Only auto-fill if the user hasn't manually chosen a guess for this row.
      if (!manualGuess || manualGuess.row !== currentRow) {
        manualGuess = null;
        if (!solved && currentRow < MAX_ROWS) fillRowWithGuess(currentRow, best.word);
      }
    }, 0);
  }

  function renderTopFrequencyList(items, kind) {
    topListEl.innerHTML = "";
    for (const item of items) {
      const el = document.createElement("div");
      el.className = "pick";
      el.dataset.word = item.word;
      el.addEventListener("click", () => {
        if (currentRow >= MAX_ROWS) return;
        const label =
          kind === "opener"
            ? `Selected: opener score ${item.score.toFixed(4)}`
            : `Selected: score ${item.score.toFixed(4)}`;
        setCurrentGuess(item.word, label);
      });
      const left = document.createElement("div");
      left.className = "pick__word";
      left.textContent = item.word.toUpperCase();
      const right = document.createElement("div");
      right.className = "pick__score";
      right.textContent = item.score.toFixed(4);
      el.appendChild(left);
      el.appendChild(right);
      topListEl.appendChild(el);
    }
  }

  function bestByFrequency(words, stats) {
    let best = null;
    for (const w of words) {
      const s = WordleItSolver.frequencyScore(w, stats);
      if (best === null || s > best.score || (s === best.score && w < best.word)) best = { word: w, score: s };
    }
    return best || { word: "—", score: 0 };
  }

  function topKByFrequency(words, stats, k) {
    // Keep a small set (k <= ~10) without sorting the whole corpus.
    const top = [];
    let minIdx = -1;
    let minScore = Infinity;
    for (const w of words) {
      const s = WordleItSolver.frequencyScore(w, stats);
      if (top.length < k) {
        top.push({ word: w, score: s });
        if (s < minScore) {
          minScore = s;
          minIdx = top.length - 1;
        }
        continue;
      }
      if (s <= minScore) continue;
      top[minIdx] = { word: w, score: s };
      // recompute min in top
      minScore = top[0].score;
      minIdx = 0;
      for (let i = 1; i < top.length; i++) {
        if (top[i].score < minScore) {
          minScore = top[i].score;
          minIdx = i;
        }
      }
    }
    top.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
    return top;
  }

  function bumpOpenerIndex() {
    // Rotate on each reset so you don't get the exact same opener every time.
    try {
      const cur = Number(sessionStorage.getItem(OPENER_IDX_KEY) || "0");
      const next = Number.isFinite(cur) ? cur + 1 : 1;
      sessionStorage.setItem(OPENER_IDX_KEY, String(next));
    } catch (_) {
      // ignore
    }
  }

  function pickRotatingOpener(topWide) {
    if (!topWide || topWide.length === 0) return { word: "—", score: 0, rank: 0 };
    let idx = 0;
    try {
      idx = Number(sessionStorage.getItem(OPENER_IDX_KEY) || "0");
      if (!Number.isFinite(idx) || idx < 0) idx = 0;
    } catch (_) {
      idx = 0;
    }
    idx = idx % topWide.length;
    const chosen = topWide[idx];
    return { word: chosen.word, score: chosen.score, rank: idx + 1 };
  }

  function submitFeedback() {
    if (solved || currentRow >= MAX_ROWS) return;
    const guess = suggestedWordEl.textContent.trim().toLowerCase();
    if (!WordleItSolver.isLowerAlphaWord(guess)) return;
    const pattern = getRowPattern(currentRow);

    history.push({ guess, pattern });
    lockRow(currentRow, true);
    currentRow = history.length;
    manualGuess = null;

    if (allGreen(pattern)) {
      solved = true;
      setSuggestedWord(guess, 0);
      suggestedMetaEl.textContent = "Solved.";
      submitBtn.disabled = true;
      undoBtn.disabled = false;
      return;
    }

    candidates = WordleItSolver.filterCandidates(candidates, guess, pattern);
    if (candidates.length === 0) {
      // User might be using a real Wordle answer not in our corpus; offer to learn it.
      openLearnModal(
        "No candidates matched your feedback. If you know the correct word, enter it to add it to the corpus for future runs."
      );
    }
    if (currentRow >= MAX_ROWS) {
      computeAndRenderSuggestion();
      submitBtn.disabled = true;
      undoBtn.disabled = false;
      openLearnModal(
        "Out of rows. If you know the correct word, enter it to add it to the corpus for future runs."
      );
      return;
    }

    computeAndRenderSuggestion();
    undoBtn.disabled = history.length === 0;
  }

  function undoRow() {
    if (history.length === 0) return;
    const removed = history.pop();
    if (!removed) return;

    // Recompute candidates from scratch for correctness.
    candidates = allowedGuesses.slice();
    for (const h of history) {
      candidates = WordleItSolver.filterCandidates(candidates, h.guess, h.pattern);
    }

    // Clear current row and re-enable inputs.
    solved = false;
    currentRow = history.length;
    submitBtn.disabled = false;
    undoBtn.disabled = history.length === 0;
    manualGuess = null;

    // Clear this row and refill with new suggestion.
    clearRow(currentRow);
    computeAndRenderSuggestion();
  }

  function resetAll() {
    currentRow = 0;
    history = [];
    solved = false;
    openerCache = null;
    bumpOpenerIndex();
    manualGuess = null;
    submitBtn.disabled = false;
    undoBtn.disabled = true;
    renderBoard();
    candidates = allowedGuesses.slice();
    computeAndRenderSuggestion();
  }

  function restoreDefaults() {
    setWordList(WORDLE_IT_DEFAULT_WORDS, "defaults");
    resetAll();
  }

  function init() {
    renderBoard();
    if (!Array.isArray(window.WORDLE_IT_DEFAULT_WORDS)) {
      suggestedWordEl.textContent = "—";
      suggestedMetaEl.textContent =
        "Error: word list failed to load. Open DevTools Console for details.";
      return;
    }
    if (!window.WordleItSolver) {
      suggestedWordEl.textContent = "—";
      suggestedMetaEl.textContent =
        "Error: solver failed to load. Open DevTools Console for details.";
      return;
    }
    setWordList(mergedCorpus(), "defaults+learned");
    undoBtn.disabled = true;
    computeAndRenderSuggestion();

    submitBtn.addEventListener("click", submitFeedback);
    undoBtn.addEventListener("click", undoRow);
    resetBtn.addEventListener("click", resetAll);

    learnCancelBtn.addEventListener("click", closeLearnModal);
    learnSaveBtn.addEventListener("click", () => {
      const word = learnWordInputEl.value;
      const res = saveUserWord(word);
      if (!res.ok) {
        learnStatusEl.textContent =
          res.reason === "exists"
            ? "That word is already saved."
            : res.reason === "storage"
              ? "Could not save (storage blocked)."
              : "Please enter a valid 5-letter word (a–z).";
        return;
      }
      learnStatusEl.textContent = "Saved. Resetting with updated corpus…";
      // Rebuild corpus and reset.
      setWordList(mergedCorpus(), "defaults+learned");
      closeLearnModal();
      resetAll();
    });

    // Close when clicking backdrop
    learnModalEl.querySelector(".modal__backdrop").addEventListener("click", closeLearnModal);
  }

  init();
  } catch (err) {
    try {
      const el = document.getElementById("suggestedMeta");
      if (el) el.textContent = `Error: ${err && err.message ? err.message : String(err)}`;
    } catch (_) {}
    // Re-throw for devtools visibility.
    throw err;
  }
})();
