# Wordle-It

An **offline, portable, interactive Wordle solver** with a Wordle-like UI.
It suggests guesses using **information theory** (entropy / expected information gain) and fast heuristics when the candidate set is large.

Not affiliated with NYT Wordle.

## Features

- **Wordle-like board UI**: click tiles to cycle **grey → yellow → green**
- **Candidate filtering** using Wordle-accurate duplicate-letter rules
- **Smart opener**: computed from the full corpus using **letter frequency + positional frequency**
- **Next-guess suggestions**:
  - Fast heuristic mode for large candidate sets
  - Exact entropy mode once candidates are smaller
- **Pick the next best word**: click an item in **Top picks** to use that guess for the current row
- Works offline (no server, no build step)

## Run

Open `index.html` in any modern browser (Chrome / Edge / Firefox / Safari).

## How to Use

1. The app shows a **Suggested Guess** and fills the current row.
2. Enter that guess in Wordle.
3. In this app, click each tile to match Wordle’s feedback:
   - **Grey**: letter not present (subject to duplicate-letter rules)
   - **Yellow**: letter present but wrong position
   - **Green**: correct letter in the correct position
4. Click **Submit feedback** to filter candidates and get the next suggestion.
5. Optional: click any word in **Top picks** to select that guess instead.

## Solver Overview (Interview-Friendly)

### 1) Feedback simulation (Wordle rules)
For any `(guess, answer)` pair, Wordle feedback is computed by:
1. Marking **greens first** and decrementing available letter counts.
2. Marking **yellows** only if remaining counts exist.

This correctly handles duplicates (the most error-prone part of Wordle solvers).

### 2) Candidate filtering
After you submit feedback for a guess, the solver keeps only those answers that would produce the **exact same pattern** for that guess.

### 3) Entropy / information gain (when feasible)
For a guess `g` and candidate set `C`, the solver buckets all answers by their feedback pattern and computes:

`H(g) = - Σ P(pattern) log2 P(pattern)`

Higher entropy means the guess is expected to eliminate more candidates on average.

### 4) Performance strategy
Exact entropy over a large set can be slow (roughly quadratic when scoring many guesses against many candidates).
To stay responsive, the app uses a **frequency heuristic** when candidates are large, and switches to **entropy** when the candidate set is smaller.

## Word Corpus

The app ships with a built-in 5-letter corpus in `words.js`.
This is embedded as newline-delimited text for maximum portability (works on `file://`).

## Project Structure

- `index.html` — app shell
- `styles.css` — UI styling
- `ui.js` — UI state + interactions + strategy switching
- `solver.js` — feedback engine, candidate filtering, entropy + frequency scoring
- `words.js` — built-in 5-letter word corpus

## Roadmap Ideas

- Run heavy computations in a **Web Worker** (never block UI)
- Split corpus into **answers vs allowed guesses**
- Add on-screen keyboard (Wordle-style) with per-letter states
- Add strategy toggle: “Always entropy” vs “Fast heuristic” vs “Hybrid”
