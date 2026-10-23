# Recall — flashcards with spaced repetition

A Quizlet / RevisionDojo-style flashcard tool that runs entirely in your browser. No accounts, no server, and no build step.

## Features

- **Spaced repetition review.** An Anki-style SM-2 scheduler with learning steps (1 min → 10 min → 1 day, and so on). Each answer button shows when you'll see the card next: **Again / Hard / Good / Easy**. Forgotten cards go back through relearning, and each card's ease adapts to how well you know it. Daily new-card and review limits are configurable.
- **Active recall.**
  - Recall the answer before you reveal it, or turn on **Type answers** to write it from memory. Typed answers are checked with typo tolerance and keyword matching, and the app suggests a rating.
  - Progressive **hints** show first letters, then half of each word.
  - **Definition first** swaps the sides of the card.
  - **Undo** reverses the last rating.
- **Flashcards mode.** Quizlet-style flip cards with *Know* / *Still learning* sorting. You can then restudy just the cards you missed, shuffle the deck, or study only starred cards.
- **Quiz mode.** Mixes multiple choice, written and true/false questions, and can put your weakest cards first. Missed cards can be sent straight back into your spaced-repetition queue.
- **Import:**
  - Paste text from a **Quizlet export** (tab / new line). You can also use comma, dash, colon or custom separators, with a live preview.
  - Drop a **CSV / TSV** file. Quoted fields and multi-line cards are supported.
  - Drop an **Anki "Notes in Plain Text"** export.
  - Restore a **JSON** backup from this app, or a JSON array of `{term, definition}` / `{front, back}` / `{question, answer}`.
  - Import into a new deck or an existing one. Duplicates are skipped.
- **Export** a deck as JSON (including your progress) or as tab-separated text for Quizlet or Anki. You can also back up all decks at once.
- Day streak, due counts, mastery bars (new / learning / reviewing / mastered), starred cards, search, dark mode, keyboard shortcuts and a mobile layout.

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
npm start        # python3 -m http.server 8080 → http://localhost:8080
```

To host it for free, enable **GitHub Pages** for this repo (Settings → Pages → deploy from branch, root folder).

Your data is stored in your browser's `localStorage`. Use **Settings → Export all decks** to back it up or move it to another device.

## Keyboard shortcuts

| Mode | Keys |
| --- | --- |
| Review | `Space` reveal · `1`–`4` Again/Hard/Good/Easy · `H` hint · `U` undo · `Esc` exit |
| Flashcards | `Space` flip · `1` still learning · `2` know · `←` / `→` |
| Quiz | `1`–`4` choose option · `T` / `F` · `Enter` continue |

## Tests

```sh
npm test
```

## Project layout

```
index.html         app shell
css/styles.css     styles (light/dark)
js/srs.js          spaced-repetition scheduler
js/importer.js     Quizlet / CSV / Anki / JSON parsers
js/store.js        localStorage persistence and stats
js/app.js          views and routing
tests/             node:test unit tests
```
