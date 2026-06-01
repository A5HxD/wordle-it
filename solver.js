// Entropy-based Wordle solver core.
// Exposes a small API on window.WordleItSolver.

(function () {
  const ALPHABET_A = "a".charCodeAt(0);

  function isLowerAlphaWord(word) {
    if (typeof word !== "string" || word.length !== 5) return false;
    for (let i = 0; i < 5; i++) {
      const c = word.charCodeAt(i) - ALPHABET_A;
      if (c < 0 || c > 25) return false;
    }
    return true;
  }

  function normalizeWord(word) {
    return String(word || "").trim().toLowerCase();
  }

  // Wordle feedback for duplicates:
  // - First mark greens and remove them from counts
  // - Then mark yellows if count remains
  // Returns array of 5 ints: 0=absent, 1=present, 2=correct
  function feedbackPattern(guess, answer) {
    const g = guess;
    const a = answer;
    const pattern = [0, 0, 0, 0, 0];

    const counts = new Array(26).fill(0);
    for (let i = 0; i < 5; i++) {
      counts[a.charCodeAt(i) - ALPHABET_A]++;
    }

    // Greens first
    for (let i = 0; i < 5; i++) {
      if (g[i] === a[i]) {
        pattern[i] = 2;
        counts[g.charCodeAt(i) - ALPHABET_A]--;
      }
    }
    // Yellows
    for (let i = 0; i < 5; i++) {
      if (pattern[i] === 2) continue;
      const idx = g.charCodeAt(i) - ALPHABET_A;
      if (counts[idx] > 0) {
        pattern[i] = 1;
        counts[idx]--;
      }
    }
    return pattern;
  }

  function encodePatternBase3(pattern) {
    // 5 trits -> 0..242
    let code = 0;
    for (let i = 0; i < 5; i++) code = code * 3 + pattern[i];
    return code;
  }

  function decodePatternBase3(code) {
    const pattern = [0, 0, 0, 0, 0];
    for (let i = 4; i >= 0; i--) {
      pattern[i] = code % 3;
      code = Math.floor(code / 3);
    }
    return pattern;
  }

  function patternsEqual(a, b) {
    for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Memoize feedback codes for speed, but keep it bounded so large corpora can't
  // blow up memory (Map maximum size exceeded).
  const FEEDBACK_MEMO_MAX = 50000;
  const feedbackMemo = new Map(); // key: guess|answer -> code
  function feedbackCode(guess, answer) {
    const key = guess + "|" + answer;
    const hit = feedbackMemo.get(key);
    if (hit !== undefined) return hit;
    const code = encodePatternBase3(feedbackPattern(guess, answer));
    if (feedbackMemo.size >= FEEDBACK_MEMO_MAX) feedbackMemo.clear();
    feedbackMemo.set(key, code);
    return code;
  }

  function entropyFromCounts(counts, total) {
    if (total <= 1) return 0;
    let h = 0;
    for (const c of counts.values()) {
      if (!c) continue;
      const p = c / total;
      h -= p * Math.log2(p);
    }
    return h;
  }

  function buildFrequencyStats(words) {
    // Returns frequencies normalized to [0,1].
    const letter = new Array(26).fill(0);
    const position = Array.from({ length: 5 }, () => new Array(26).fill(0));
    let totalLetters = 0;
    for (const w of words) {
      if (!isLowerAlphaWord(w)) continue;
      for (let i = 0; i < 5; i++) {
        const idx = w.charCodeAt(i) - ALPHABET_A;
        letter[idx]++;
        position[i][idx]++;
        totalLetters++;
      }
    }
    if (totalLetters === 0) {
      return { letter: letter.map(() => 0), position };
    }
    for (let i = 0; i < 26; i++) letter[i] /= totalLetters;
    for (let p = 0; p < 5; p++) {
      let rowTotal = 0;
      for (let i = 0; i < 26; i++) rowTotal += position[p][i];
      if (rowTotal === 0) continue;
      for (let i = 0; i < 26; i++) position[p][i] /= rowTotal;
    }
    return { letter, position };
  }

  function frequencyScore(word, stats, opts) {
    const options = opts || {};
    const letterWeight = typeof options.letterWeight === "number" ? options.letterWeight : 0.45;
    const positionWeight = typeof options.positionWeight === "number" ? options.positionWeight : 0.55;
    const repeatPenalty = typeof options.repeatPenalty === "number" ? options.repeatPenalty : 0.85;

    let score = 0;
    const seen = new Array(26).fill(false);
    for (let p = 0; p < 5; p++) {
      const idx = word.charCodeAt(p) - ALPHABET_A;
      const base = positionWeight * stats.position[p][idx] + letterWeight * stats.letter[idx];
      if (seen[idx]) score += base * repeatPenalty;
      else score += base;
      seen[idx] = true;
    }
    return score;
  }

  function bestOpeningByFrequency(words) {
    const stats = buildFrequencyStats(words);
    let best = null;
    for (const w of words) {
      if (!isLowerAlphaWord(w)) continue;
      const s = frequencyScore(w, stats);
      if (best === null || s > best.score + 1e-15 || (Math.abs(s - best.score) <= 1e-15 && w < best.word)) {
        best = { word: w, score: s };
      }
    }
    return best || { word: "—", score: 0 };
  }

  function scoreGuessEntropy(guess, candidates) {
    const dist = new Map(); // patternCode -> count
    for (const ans of candidates) {
      const code = feedbackCode(guess, ans);
      dist.set(code, (dist.get(code) || 0) + 1);
    }
    const h = entropyFromCounts(dist, candidates.length);
    return { entropy: h, dist };
  }

  function filterCandidates(candidates, guess, pattern) {
    const targetCode = encodePatternBase3(pattern);
    const out = [];
    for (const ans of candidates) {
      if (feedbackCode(guess, ans) === targetCode) out.push(ans);
    }
    return out;
  }

  function topSuggestions(candidates, allowedGuesses, limit = 10) {
    const scored = [];
    for (const g of allowedGuesses) {
      const { entropy } = scoreGuessEntropy(g, candidates);
      scored.push({ word: g, entropy });
    }
    scored.sort((a, b) => b.entropy - a.entropy || a.word.localeCompare(b.word));
    return scored.slice(0, limit);
  }

  function bestSuggestion(candidates, allowedGuesses) {
    // Prefer maximum entropy. Tie-break: prefer a word that is also a candidate solution.
    let best = null;
    const candidateSet = new Set(candidates);
    for (const g of allowedGuesses) {
      const { entropy } = scoreGuessEntropy(g, candidates);
      if (
        best === null ||
        entropy > best.entropy + 1e-12 ||
        (Math.abs(entropy - best.entropy) <= 1e-12 &&
          candidateSet.has(g) &&
          !candidateSet.has(best.word))
      ) {
        best = { word: g, entropy };
      }
    }
    return best || { word: "—", entropy: 0 };
  }

  function parseWordList(text) {
    const lines = String(text || "")
      .split(/\r?\n/g)
      .map((l) => normalizeWord(l))
      .filter(Boolean);
    const uniq = new Set();
    for (const w of lines) if (isLowerAlphaWord(w)) uniq.add(w);
    return Array.from(uniq).sort();
  }

  window.WordleItSolver = {
    isLowerAlphaWord,
    normalizeWord,
    feedbackPattern,
    encodePatternBase3,
    decodePatternBase3,
    filterCandidates,
    bestSuggestion,
    topSuggestions,
    parseWordList,
    buildFrequencyStats,
    frequencyScore,
    bestOpeningByFrequency,
  };
})();
