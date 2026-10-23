const test = require('node:test');
const assert = require('node:assert');
const Rich = require('../js/rich.js');

test('cloze numbering, questions and answers', () => {
  const t = 'The {{nucleus}} holds {{c3::DNA::genetic material}} and {{RNA}}';
  assert.deepEqual(Rich.clozeIndices(t), [3, 4, 5]);
  const q = Rich.render(Rich.clozeQuestion(t, 3));
  assert.match(q, /cloze-blank">\[genetic material\]/);
  assert.match(q, /nucleus/);
  // Un-numbered blanks are numbered after the highest explicit one.
  assert.deepEqual(Rich.clozeAnswers(t, 4), ['nucleus']);
  assert.deepEqual(Rich.clozeAnswers(t, 5), ['RNA']);
  const card = { type: 'cloze', front: Rich.renumber(t).text, back: '', clozeIndex: 4 };
  assert.equal(Rich.cardSides(card).answerRaw, 'nucleus');
  assert.ok(Rich.hasCloze(t));
  assert.ok(!Rich.hasCloze('no blanks'));
});

test('same number shares a card', () => {
  const t = '{{c1::a}} and {{c1::b}} then {{c2::c}}';
  assert.deepEqual(Rich.clozeIndices(t), [1, 2]);
  assert.deepEqual(Rich.clozeAnswers(t, 1), ['a', 'b']);
});

test('rendering escapes HTML and applies formatting', () => {
  const html = Rich.render('<script>x</script> **bold** *it* ==hi== `c`\n- one\n- two');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<mark>hi<\/mark>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test('maths falls back to raw when KaTeX is absent, and prices are left alone', () => {
  assert.match(Rich.render('$x^2$'), /math-raw/);
  assert.ok(!/math-raw/.test(Rich.render('costs $5 and $10')));
});

test('images', () => {
  assert.match(Rich.render('![cell](img:abc123)'), /data-img="abc123"/);
  assert.deepEqual(Rich.imageIds('x ![](img:a1) y ![](img:b2)'), ['a1', 'b2']);
  assert.equal(Rich.plainText('see ![](img:a1)'), 'see [image]');
});

test('mark-scheme points and keyword brackets', () => {
  const pts = Rich.markPoints('- substrate binds [[active site]]\n- forms complex [[enzyme-substrate complex/ES complex]]\n- lowers activation energy');
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[1].keywords, [['enzyme-substrate complex', 'ES complex']]);
  assert.equal(pts[2].keywords.length, 0);
  assert.equal(Rich.markPoints('just one line'), null);
  assert.ok(!Rich.render('- a [[k]]\n- b').includes('[['));
});

test('plain text strips markup', () => {
  assert.equal(Rich.plainText('**Mito** {{c1::ATP}} $x$'), 'Mito ATP x');
});
