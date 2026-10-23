/*
 * AI flashcard generation with Claude, called directly from the browser with the
 * user's own API key. The Anthropic SDK is vendored (vendor/anthropic-sdk.mjs) and
 * only loaded when this feature is used.
 */
(function (root) {
  const MODEL = 'claude-opus-5-5';
  let sdkPromise = null;
  const loadSdk = () => (sdkPromise = sdkPromise || import(new URL('vendor/anthropic-sdk.mjs', document.baseURI).href).then((m) => m.default));

  const SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short deck title for this material' },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            front: { type: 'string' },
            back: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['front', 'back', 'tags'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'cards'],
    additionalProperties: false,
  };

  const SYSTEM = `You write flashcards for a spaced-repetition app used by students revising for exams. Good cards make the student actively recall one idea at a time.

Principles:
- One fact or idea per card. Split lists and multi-part ideas into several cards.
- The front must make sense on its own, without the notes, and have one clear correct answer.
- Keep answers short: a word, a phrase or one sentence, except mark-scheme cards.
- Cover the most important, examinable material first. Don't invent facts that aren't supported by the material or by well-established knowledge of the subject.
- Never duplicate a card the student already has.

Card syntax the app understands:
- Basic card: front = question or term, back = answer or definition.
- Cloze card: put the whole sentence in front, wrap the hidden part in {{double braces}}, and leave back empty or use it for a short extra note. Each {{blank}} becomes its own card, so use one to three blanks per sentence. Use {{c1::answer::hint}} for a hint.
- Mark-scheme card (for "describe/explain" questions): front = the exam-style question with its mark count, e.g. "Explain why ... (3 marks)"; back = one "- " bullet per marking point, each followed by the essential keywords in double square brackets, e.g. "- the active site has a specific shape [[active site, specific/complementary shape]]".
- Formatting: **bold** for key terms. Maths and chemistry in LaTeX between $...$ (use \\ce{} for chemical formulae and equations).
- tags: one to three short lowercase topic tags per card, no spaces (use hyphens).`;

  const STYLES = {
    mixed: 'Use a mix of basic question → answer cards and cloze cards, whichever suits each fact best. Add mark-scheme cards for any "explain/describe" content.',
    qa: 'Use basic question → answer cards only.',
    terms: 'Use basic term → definition cards: the key term on the front, a concise definition on the back.',
    cloze: 'Use cloze cards only.',
    exam: 'Write exam-style questions. Use mark-scheme cards for anything worth more than one mark and basic cards for one-mark recall questions.',
  };

  function userContent({ text, file, count, style, instructions, existing }) {
    const content = [];
    if (file && file.data && file.type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
    else if (file && file.data && file.type.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: file.data } });
    const parts = [];
    if (file && file.text) parts.push(`<material source="${file.name}">\n${file.text}\n</material>`);
    if (text) parts.push(`<material>\n${text}\n</material>`);
    parts.push(count ? `Write about ${count} flashcards from this material.` : 'Write as many flashcards as the material needs to cover everything examinable, without padding.');
    parts.push(STYLES[style] || STYLES.mixed);
    if (instructions) parts.push(`The student adds: ${instructions}`);
    if (existing && existing.length) parts.push(`The student already has these cards (fronts). Don't repeat them:\n${existing.slice(0, 400).map((f) => '- ' + f.slice(0, 160)).join('\n')}`);
    content.push({ type: 'text', text: parts.join('\n\n') });
    return content;
  }

  function friendlyError(Anthropic, e) {
    if (e instanceof Anthropic.AuthenticationError) return 'That API key was rejected. Check it at console.anthropic.com.';
    if (e instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the model.";
    if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API — wait a minute and try again.';
    if (e instanceof Anthropic.BadRequestError) return 'The request was rejected: ' + (e.error?.error?.message || e.message);
    if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your internet connection.";
    if (e instanceof Anthropic.APIError) return `API error ${e.status || ''}: ${e.message}`;
    return e.message || String(e);
  }

  /** Generate cards. Resolves to { title, cards: [{ front, back, tags }] }. */
  async function generate(opts) {
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
    let message;
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent(opts) }],
      });
      let soFar = '';
      stream.on('text', (delta) => {
        soFar += delta;
        if (opts.onProgress) opts.onProgress((soFar.match(/"front"\s*:/g) || []).length);
      });
      message = await stream.finalMessage();
    } catch (e) {
      throw new Error(friendlyError(Anthropic, e));
    }
    if (message.stop_reason === 'refusal') throw new Error("Claude declined to make cards from this material. Try different or shorter notes.");
    if (message.stop_reason === 'max_tokens') throw new Error('That was too much material for one go. Try fewer cards or a shorter extract.');
    const textBlock = message.content.find((b) => b.type === 'text');
    let data;
    try {
      data = JSON.parse(textBlock ? textBlock.text : '');
    } catch (e) {
      throw new Error('The response could not be read. Please try again.');
    }
    const cards = (data.cards || [])
      .map((c) => ({ front: String(c.front || '').trim(), back: String(c.back || '').trim(), tags: (c.tags || []).map((t) => String(t).toLowerCase().replace(/\s+/g, '-')) }))
      .filter((c) => c.front && (c.back || Rich.hasCloze(c.front)));
    if (!cards.length) throw new Error('No cards came back — try adding more material.');
    return { title: data.title || '', cards };
  }

  root.AI = { generate, MODEL };
})(window);
