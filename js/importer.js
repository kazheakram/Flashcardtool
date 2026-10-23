/*
 * Flashcard import parsers.
 *
 * Supports:
 *  - Quizlet "Export" text (term<TAB>definition, one card per line, or custom separators)
 *  - CSV / TSV files (quoted fields, embedded newlines, optional header row)
 *  - Anki "Notes in Plain Text" exports (#separator / #html headers)
 *  - JSON (this app's backup format, or an array of {front, back} / {term, definition} / {question, answer})
 */
(function (root) {
  const HEADER_WORDS = ['term', 'definition', 'front', 'back', 'question', 'answer', 'word', 'meaning', 'prompt', 'response'];

  function stripHtml(s) {
    return s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** RFC-4180-ish parser for a single-character field separator and newline row separator. */
  function parseCsv(text, sep) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let fieldStart = true;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"' && fieldStart) {
        inQuotes = true;
        fieldStart = false;
      } else if (c === sep) {
        row.push(field);
        field = '';
        fieldStart = true;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        fieldStart = true;
      } else {
        field += c;
        fieldStart = false;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function looksLikeHeader(front, back) {
    return HEADER_WORDS.includes(front.trim().toLowerCase()) && HEADER_WORDS.includes(back.trim().toLowerCase());
  }

  function rowsToCards(rows) {
    const cards = [];
    rows.forEach((cols, i) => {
      const front = (cols[0] || '').trim();
      const back = (cols[1] || '').trim();
      if (!front && !back) return;
      if (i === 0 && looksLikeHeader(front, back)) return;
      const card = { front, back };
      // Optional third column: tags (space or comma separated), as in Anki exports.
      const tags = (cols[2] || '').trim();
      if (tags && cols.length === 3) card.tags = tags;
      cards.push(card);
    });
    return cards;
  }

  function unescapeSep(sep) {
    return sep.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  }

  /**
   * Parse delimited text.
   * @param {string} text
   * @param {string} termSep  separator between term and definition ('\t', ',', ' - ', or any string)
   * @param {string} cardSep  separator between cards ('\n', ';', '\n\n', or any string)
   */
  function parseDelimited(text, termSep, cardSep) {
    termSep = unescapeSep(termSep);
    cardSep = unescapeSep(cardSep);
    text = text.replace(/\r\n?/g, '\n');
    if (cardSep === '\n' && termSep.length === 1) {
      return rowsToCards(parseCsv(text, termSep));
    }
    const rows = text.split(cardSep).map((chunk) => {
      const idx = chunk.indexOf(termSep);
      if (idx === -1) return [chunk];
      return [chunk.slice(0, idx), chunk.slice(idx + termSep.length)];
    });
    return rowsToCards(rows);
  }

  function parseAnki(text) {
    let sep = '\t';
    let html = false;
    const body = [];
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      const m = line.match(/^#(\w+):(.*)$/);
      if (m) {
        const key = m[1].toLowerCase();
        const val = m[2].trim().toLowerCase();
        if (key === 'separator') sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' }[val] || m[2].trim();
        if (key === 'html') html = val === 'true';
        continue;
      }
      body.push(line);
    }
    let cards = rowsToCards(parseCsv(body.join('\n'), sep));
    if (html) cards = cards.map((c) => ({ front: stripHtml(c.front), back: stripHtml(c.back) }));
    return cards;
  }

  function cardFromObject(o) {
    if (!o || typeof o !== 'object') return null;
    const front = o.front ?? o.term ?? o.question ?? o.word ?? o.prompt;
    const back = o.back ?? o.definition ?? o.answer ?? o.meaning ?? o.response;
    if (front == null && back == null) return null;
    const card = { front: String(front ?? '').trim(), back: String(back ?? '').trim() };
    if (o.tags) card.tags = o.tags;
    return card;
  }

  /** Returns { decks: [{ name, description, cards: [...] }] }. Cards may carry `srs` if from a backup. */
  function parseJson(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return { decks: [{ name: 'Imported deck', cards: data.map(cardFromObject).filter(Boolean) }] };
    }
    if (data && data.share && Array.isArray(data.c)) {
      // Compact share-link payload: { share: 1, n, d, c: [[front, back, tags?]] }
      return { decks: [{ name: data.n || 'Shared deck', description: data.d || '', cards: data.c.map(([front, back, tags]) => ({ front, back, tags })) }] };
    }
    if (data && Array.isArray(data.decks)) {
      return {
        decks: data.decks.map((d) => ({
          name: d.name || 'Imported deck',
          description: d.description || '',
          folder: d.folder || '',
          cards: (d.cards || [])
            .map((c) => {
              const card = cardFromObject(c);
              if (!card) return null;
              for (const k of ['srs', 'starred', 'tags', 'noteId', 'clozeIndex']) if (c[k] != null) card[k] = c[k];
              return card;
            })
            .filter(Boolean),
        })),
        images: data.images || null,
      };
    }
    if (data && Array.isArray(data.cards)) {
      return { decks: [{ name: data.name || 'Imported deck', description: data.description || '', cards: data.cards.map(cardFromObject).filter(Boolean) }] };
    }
    throw new Error('Unrecognised JSON format');
  }

  /** Guess separators for pasted text. */
  function detect(text) {
    const t = text.trim();
    if (/^[[{]/.test(t)) return { format: 'json' };
    if (/^#(separator|html|notetype|deck|columns):/im.test(t)) return { format: 'anki' };
    const lines = t.split(/\r?\n/).filter(Boolean);
    const share = (re) => lines.filter((l) => re.test(l)).length / Math.max(1, lines.length);
    if (share(/\t/) >= 0.5) return { format: 'delimited', termSep: '\t', cardSep: '\n' };
    if (share(/ - /) >= 0.5) return { format: 'delimited', termSep: ' - ', cardSep: '\n' };
    if (share(/:/) >= 0.8 && share(/,/) < 0.5) return { format: 'delimited', termSep: ':', cardSep: '\n' };
    if (share(/,/) >= 0.5) return { format: 'delimited', termSep: ',', cardSep: '\n' };
    if (/;/.test(t) && lines.length <= 2) return { format: 'delimited', termSep: ',', cardSep: ';' };
    return { format: 'delimited', termSep: '\t', cardSep: '\n' };
  }

  /** Detect format from a filename + its contents. */
  function detectFile(name, text) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'json') return { format: 'json' };
    if (ext === 'csv') return { format: 'delimited', termSep: ',', cardSep: '\n' };
    if (ext === 'tsv') return { format: 'delimited', termSep: '\t', cardSep: '\n' };
    return detect(text);
  }

  /** Parse according to a detected/selected format. Always returns { decks: [...] }. */
  function parse(text, fmt) {
    if (fmt.format === 'json') return parseJson(text);
    if (fmt.format === 'anki') return { decks: [{ name: 'Imported deck', cards: parseAnki(text) }] };
    return { decks: [{ name: 'Imported deck', cards: parseDelimited(text, fmt.termSep, fmt.cardSep) }] };
  }

  const Importer = { parse, parseDelimited, parseCsv, parseAnki, parseJson, detect, detectFile, stripHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = Importer;
  else root.Importer = Importer;
})(typeof window !== 'undefined' ? window : globalThis);
