# Recall — flashcards with spaced repetition

A Quizlet / RevisionDojo-style flashcard app that runs entirely in your browser. No account or build step is needed, and it works offline once installed.

## Features

### Studying
- **FSRS spaced repetition.** This is the modern algorithm Anki now uses. It models how stable each memory is and schedules the next review just before you'd forget it, aiming for a target recall you choose (90% by default). Classic SM-2 is still available in Settings.
- **Exam date mode.** Give a deck a test date and reviews are capped so every card comes up before it. New cards are also paced so you see all of them in time. A **Cram** mode reviews every card, weakest first.
- **Active recall:**
  - Recall the answer before revealing it, or type it. Typed answers are checked with typo tolerance.
  - Progressive hints, *definition first* mode, and undo.
- **Mark-scheme answers.** Write a card's answer as bullet points, with optional `[[keywords]]` on each. Long typed answers are then marked point by point, IB/GCSE style. You can tap a point to correct the marking.
- **Cloze cards.** Write `The {{nucleus}} contains {{DNA}}` and each blank becomes its own card. `{{c1::answer::hint}}` adds a hint, and blanks with the same number are tested together.
- **Images, formatting and maths:**
  - Paste or drop pictures into any card.
  - `**bold**`, `*italic*`, `==highlight==` and bullet lists.
  - LaTeX maths in `$…$` and chemistry via `$\ce{H2SO4}$`, rendered with KaTeX.

### Modes
- **Review:** spaced repetition.
- **Flashcards:** flip cards with *Know / Still learning* sorting.
- **Quiz:** multiple choice, written, true/false and long-answer questions, with weakest cards first. Missed cards can be sent back to review.
- **Match:** pair terms with definitions against the clock (tap or drag), with a personal best per deck.

### Progress
- **Stats page:**
  - a calendar heatmap of study days
  - how many cards are due over the next 30 days
  - recall rate over time
  - cards by stage, with a table view of the numbers
- **Daily goal** with a progress ring, plus a streak.
- **Reminders:** notifications while the app is open or installed. For a reminder that always arrives, there's a one-click recurring calendar event (`.ics`).

### Organising and getting cards in
- **Folders and tags.** Folders nest (`Biology/Topic 2/2.3`), and you can review a whole folder or one tag across decks.
- **Import:**
  - Quizlet export text, CSV/TSV (an optional third column becomes tags), Anki plain-text exports (cloze notes kept), or a JSON backup (images and progress kept).
  - Custom separators, with a live preview.

### Sharing and offline use
- **Share links.** A whole deck is compressed into the URL, so no server is needed. The person who opens it gets a copy, without your progress.
- **Installable app (PWA)** that works offline.

## Run it

Serve the folder with any static web server. The installable app and offline mode need `http(s)://`, not `file://`.

```sh
npm start        # python3 -m http.server 8080 → http://localhost:8080
```

To host it for free, enable **GitHub Pages** (Settings → Pages → deploy from branch, root folder).

Your data lives in the browser: decks in `localStorage`, images in IndexedDB. Use **Settings → Export all decks** to keep a copy or move your decks to another device.

## Keyboard shortcuts

| Mode | Keys |
| --- | --- |
| Review | `Space` reveal · `1`–`4` Again/Hard/Good/Easy · `H` hint · `U` undo · `Esc` exit · long answers: `Ctrl+Enter` to check |
| Flashcards | `Space` flip · `1` still learning · `2` know · `←` / `→` |
| Quiz | `1`–`4` choose · `T` / `F` · `Enter` continue |
| Match | `Enter` start / play again |

## Tests

```sh
npm test
```

## Project layout

```
index.html, sw.js, manifest.webmanifest   app shell, offline cache, install metadata
css/styles.css                            styles (light/dark)
js/srs.js        FSRS + SM-2 schedulers, exam-date capping
js/rich.js       formatting, maths, images, cloze, mark-scheme parsing
js/importer.js   Quizlet / CSV / Anki / JSON parsers
js/store.js      persistence, cloze expansion, folders/tags
js/images.js     image storage (IndexedDB)
js/ui.js         shared helpers, answer checking
js/share.js      share links
js/views/*.js    one file per screen
vendor/          KaTeX (see vendor/README.md)
tests/           node:test unit tests
```

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.
