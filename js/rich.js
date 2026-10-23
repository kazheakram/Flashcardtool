/*
 * Card text: formatting, maths, images, cloze deletions and mark-scheme points.
 *
 * Syntax supported in any card field:
 *   **bold**  *italic*  __underline__  ==highlight==  ~~strike~~  `code`
 *   - bullet / 1. numbered lines
 *   $inline maths$   $$display maths$$   \ce{H2O} inside maths (mhchem)
 *   ![alt](img:ID)   images stored in this browser   ![alt](https://…) web images
 *   {{answer}}  {{c1::answer}}  {{c1::answer::hint}}   cloze deletions
 *   [[ATP/adenosine triphosphate, energy]]   mark-scheme keywords (hidden when shown)
 */
(function (root) {
  const CLOZE_RE = /\{\{(?:c(\d+)::)?([\s\S]+?)(?:::([^}]*?))?\}\}/g;
  const KEYWORDS_RE = /\s*\[\[([^\]]*)\]\]/g;

  // Private-use markers survive HTML escaping and are swapped for spans at the end.
  const BLANK_OPEN = '';
  const BLANK_CLOSE = '';
  const HL_OPEN = '';
  const HL_CLOSE = '';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- cloze ----------

  /** Numbered cloze groups present in text, e.g. [1, 2, 3]. Un-numbered {{x}} get sequential numbers. */
  function clozeIndices(text) {
    return renumber(text).indices;
  }

  /** Gives every {{x}} without a number its own number. Returns { text, indices }. */
  function renumber(text) {
    const explicit = [...String(text).matchAll(CLOZE_RE)].filter((m) => m[1]).map((m) => +m[1]);
    let next = explicit.length ? Math.max(...explicit) : 0;
    const used = new Set();
    const out = String(text).replace(CLOZE_RE, (all, n, ans, hint) => {
      const idx = n ? +n : ++next;
      used.add(idx);
      return `{{c${idx}::${ans}${hint != null ? '::' + hint : ''}}}`;
    });
    return { text: out, indices: [...used].sort((a, b) => a - b) };
  }

  const hasCloze = (text) => new RegExp(CLOZE_RE.source).test(String(text));

  function clozeQuestion(text, idx) {
    return renumber(text).text.replace(CLOZE_RE, (all, n, ans, hint) => (+n === idx ? BLANK_OPEN + (hint || '…') + BLANK_CLOSE : ans));
  }
  function clozeAnswer(text, idx) {
    return renumber(text).text.replace(CLOZE_RE, (all, n, ans) => (+n === idx ? HL_OPEN + ans + HL_CLOSE : ans));
  }
  /** All blanks filled in and highlighted (for card lists). */
  function clozeDisplay(text) {
    return String(text).replace(CLOZE_RE, (all, n, ans) => HL_OPEN + ans + HL_CLOSE);
  }
  function clozeAnswers(text, idx) {
    return [...renumber(text).text.matchAll(CLOZE_RE)].filter((m) => +m[1] === idx).map((m) => m[2]);
  }

  // ---------- mark scheme ----------

  /** Bullet/numbered lines of an answer, each with optional [[keywords]]. Needs 2+ points. */
  function markPoints(text) {
    const lines = String(text)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l));
    if (lines.length < 2) return null;
    return lines.map((l) => {
      const body = l.replace(/^([-*•]|\d+[.)])\s+/, '');
      const groups = [];
      body.replace(KEYWORDS_RE, (all, kw) => {
        kw.split(/[,;]/).forEach((g) => {
          const alts = g.split('/').map((a) => a.trim()).filter(Boolean);
          if (alts.length) groups.push(alts);
        });
      });
      return { text: plainText(body.replace(KEYWORDS_RE, '')), keywords: groups };
    });
  }

  // ---------- plain text ----------

  /** Strip markup for answer checking, match tiles, exports and share links. */
  function plainText(text) {
    return String(text ?? '')
      .replace(CLOZE_RE, (a, n, ans) => ans)
      .replace(KEYWORDS_RE, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (a, alt) => (alt ? `[${alt}]` : '[image]'))
      .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
      .replace(/\$([^$\n]+?)\$/g, '$1')
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
      .replace(/__([\s\S]+?)__/g, '$1')
      .replace(/==([\s\S]+?)==/g, '$1')
      .replace(/~~([\s\S]+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2')
      .trim();
  }

  const IMG_RE = /!\[([^\]]*)\]\(((?:img:[\w-]+)|(?:https?:\/\/[^\s)]+)|(?:data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+))\)/g;

  function imageIds(text) {
    return [...String(text ?? '').matchAll(IMG_RE)].map((m) => m[2]).filter((s) => s.startsWith('img:')).map((s) => s.slice(4));
  }

  // ---------- rendering ----------

  function renderMath(src, display) {
    if (root.katex) {
      try {
        return root.katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
      } catch (e) {
        /* fall through */
      }
    }
    return `<code class="math-raw">${esc(src)}</code>`;
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/==([\s\S]+?)==/g, '<mark>$1</mark>')
      .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  }

  /** Render card text to HTML. Safe: all user text is escaped before markup is applied. */
  function render(text) {
    const slots = [];
    const slot = (html) => '' + (slots.push(html) - 1) + '';
    let s = String(text ?? '').replace(/\r\n?/g, '\n');
    s = s.replace(KEYWORDS_RE, '');
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (a, m) => slot(renderMath(m.trim(), true)));
    s = s.replace(/(^|[^\\$])\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g, (a, pre, m) => pre + slot(renderMath(m, false)));
    s = s.replace(/\\\$/g, '$');
    s = s.replace(IMG_RE, (a, alt, src) =>
      slot(src.startsWith('img:') ? `<img class="card-img" data-img="${esc(src.slice(4))}" alt="${esc(alt)}">` : `<img class="card-img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">`)
    );
    s = esc(s);

    // Block structure: lists and paragraphs.
    const out = [];
    let list = null;
    for (const line of s.split('\n')) {
      const ul = line.match(/^\s*(?:[-*•])\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const kind = ul ? 'ul' : ol ? 'ol' : null;
      if (kind) {
        if (!list || list.kind !== kind) {
          if (list) out.push(`</${list.kind}>`);
          list = { kind };
          out.push(`<${kind}>`);
        }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
      } else {
        if (list) {
          out.push(`</${list.kind}>`);
          list = null;
        }
        out.push(inline(line) + '\n');
      }
    }
    if (list) out.push(`</${list.kind}>`);
    let html = out.join('').replace(/\n+$/, '').replace(/\n/g, '<br>');

    html = html
      .replace(/([\s\S]*?)/g, '<span class="cloze-blank">[$1]</span>')
      .replace(/([\s\S]*?)/g, '<span class="cloze-hl">$1</span>')
      .replace(/(\d+)/g, (a, i) => slots[+i]);
    return html;
  }

  /** Question/answer for a card. `swap` shows the definition first (basic cards only). */
  function cardSides(card, swap) {
    if (card.type === 'cloze') {
      const idx = card.clozeIndex || 1;
      return {
        q: render(clozeQuestion(card.front, idx)),
        a: render(clozeAnswer(card.front, idx)) + (card.back.trim() ? `<div class="extra">${render(card.back)}</div>` : ''),
        answerRaw: clozeAnswers(card.front, idx).join(', '),
        promptPlain: plainText(clozeQuestion(card.front, idx).replace(/[\s\S]*?/g, '___')),
      };
    }
    const q = swap ? card.back : card.front;
    const a = swap ? card.front : card.back;
    return { q: render(q), a: render(a), answerRaw: a, promptPlain: plainText(q) };
  }

  const Rich = { render, plainText, cardSides, hasCloze, clozeIndices, renumber, clozeQuestion, clozeAnswer, clozeAnswers, clozeDisplay, markPoints, imageIds, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = Rich;
  else root.Rich = Rich;
})(typeof window !== 'undefined' ? window : globalThis);
