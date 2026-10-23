const test = require('node:test');
const assert = require('node:assert');
const I = require('../js/importer.js');

test('Quizlet tab/newline export', () => {
  const text = 'mitochondria\tpowerhouse of the cell\nribosome\tmakes proteins, from mRNA\n';
  assert.deepEqual(I.detect(text), { format: 'delimited', termSep: '\t', cardSep: '\n' });
  const { decks } = I.parse(text, I.detect(text));
  assert.deepEqual(decks[0].cards, [
    { front: 'mitochondria', back: 'powerhouse of the cell' },
    { front: 'ribosome', back: 'makes proteins, from mRNA' },
  ]);
});

test('CSV with quotes, embedded newlines and header row', () => {
  const text = 'Term,Definition\n"Hello, world","line1\nline2"\nfoo,"say ""hi"""\n';
  const cards = I.parseDelimited(text, ',', '\n');
  assert.deepEqual(cards, [
    { front: 'Hello, world', back: 'line1\nline2' },
    { front: 'foo', back: 'say "hi"' },
  ]);
});

test('custom separators split only on first term separator', () => {
  const cards = I.parseDelimited('a - b - c;d - e', ' - ', ';');
  assert.deepEqual(cards, [{ front: 'a', back: 'b - c' }, { front: 'd', back: 'e' }]);
});

test('dash detection', () => {
  assert.equal(I.detect('cat - gato\ndog - perro').termSep, ' - ');
});

test('Anki plain text export with html', () => {
  const text = '#separator:tab\n#html:true\nfront<br>two\t<b>back</b> &amp; more\n';
  assert.deepEqual(I.parse(text, I.detect(text)).decks[0].cards, [{ front: 'front\ntwo', back: 'back & more' }]);
});

test('JSON backup and plain arrays', () => {
  const backup = JSON.stringify({ app: 'recall', decks: [{ name: 'D', cards: [{ front: 'x', back: 'y', srs: { state: 'review' } }] }] });
  const r = I.parse(backup, I.detect(backup));
  assert.equal(r.decks[0].name, 'D');
  assert.equal(r.decks[0].cards[0].srs.state, 'review');
  const arr = JSON.stringify([{ term: 't', definition: 'd' }, { question: 'q', answer: 'a' }]);
  assert.deepEqual(I.parse(arr, { format: 'json' }).decks[0].cards, [{ front: 't', back: 'd' }, { front: 'q', back: 'a' }]);
});
