# Wordle-It (Interactive Wordle Solver)

An offline, portable Wordle helper that uses **information gain (entropy)** to suggest the next best guess based on your feedback (grey/yellow/green), with a UI inspired by the Wordle web app.

## Run

Just open `index.html` in any modern browser (Chrome/Edge/Firefox/Safari).

## How to use

1. The app suggests a guess.
2. Enter that guess in Wordle.
3. Click the tiles in the app to match Wordle’s colors:
   - Grey = absent
   - Yellow = present, wrong spot
   - Green = correct spot
4. Press **Submit feedback** to get the next best guess.

## Word lists

This repo ships with a small built-in list in `words.js` so it works out of the box.
For best results, expand `DEFAULT_WORDS` (same file) with a larger 5-letter word list (allowed guesses and/or answers).

