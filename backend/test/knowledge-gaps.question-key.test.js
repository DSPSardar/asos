const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanQuestion, isSameQuestion } = require('../src/modules/knowledge-gaps/question-key');

// Every string below is a real knowledge-gap row from the production Settings
// list. They are all the Closer describing the same handful of missing facts
// in different words, which exact-string dedup happily stored as separate rows.

test('strips the "not provided in the knowledge base" boilerplate', () => {
  assert.equal(cleanQuestion('Fee amount is not provided in the DSP knowledge base.'), 'Fee amount');
  assert.equal(cleanQuestion('Fee amount is not provided in the product context.'), 'Fee amount');
  assert.equal(cleanQuestion('fee amount not provided in the product context'), 'fee amount');
  assert.equal(cleanQuestion('Student reviews/testimonials are not provided in the DSP knowledge base.'), 'Student reviews/testimonials');
  assert.equal(cleanQuestion('Prompt Engineering document after completion is not in the DSP knowledge base.'), 'Prompt Engineering document after completion');
  assert.equal(cleanQuestion('Alternative payment methods like Easypaisa or JazzCash are not available in the provided information.'), 'Alternative payment methods like Easypaisa or JazzCash');
  assert.equal(cleanQuestion('The full syllabus PDF is not provided in the available DSP knowledge base.'), 'The full syllabus PDF');
});

test('strips narration and trailing gap clauses', () => {
  assert.equal(
    cleanQuestion('The user asked whether an LMS is included and how they can review after class, which is not provided in the DSP knowledge base.'),
    'whether an LMS is included and how they can review after class',
  );
});

test('strips Roman Urdu boilerplate without eating the question', () => {
  assert.equal(
    cleanQuestion('Videos free platform par available hain ya nahi, ye information product context mein maujood nahi.'),
    'Videos free platform par available hain ya nahi',
  );
});

test('leaves an already-clean question untouched', () => {
  assert.equal(cleanQuestion('class size'), 'class size');
  assert.equal(cleanQuestion('fee amount'), 'fee amount');
});

test('treats every phrasing of the fee question as one question', () => {
  const feeVariants = [
    'fee amount',
    'Fee amount is not provided in the DSP knowledge base.',
    'Fee amount is not provided in the product context.',
    'fee amount not provided in the product context',
    'Fee details are not provided in the DSP knowledge base.',
    'Fee structure is not provided in the DSP knowledge base.',
    'fee kitni hai',
  ];

  for (const variant of feeVariants) {
    assert.ok(
      isSameQuestion(feeVariants[0], variant),
      `expected "${variant}" to match "${feeVariants[0]}"`,
    );
  }
});

test('treats every phrasing of the syllabus question as one question', () => {
  const syllabusVariants = [
    'full syllabus PDF',
    'full syllabus PDF not provided in product context',
    'The full syllabus PDF is not provided in the DSP knowledge base.',
    'The full syllabus PDF is not provided in the available DSP knowledge base.',
  ];

  for (const variant of syllabusVariants) {
    assert.ok(
      isSameQuestion(syllabusVariants[0], variant),
      `expected "${variant}" to match "${syllabusVariants[0]}"`,
    );
  }
});

test('keeps genuinely different questions apart', () => {
  const distinct = [
    'Fee amount is not provided in the DSP knowledge base.',
    'class size',
    'Admission team contact number is not provided in the DSP knowledge base.',
    'Student reviews/testimonials are not provided in the DSP knowledge base.',
    'UK time conversion is not provided in the DSP knowledge base.',
    'Later class access / missed-class policy is not provided in the DSP knowledge base.',
    'Location details are not provided in the DSP knowledge base.',
    'The full syllabus PDF is not provided in the DSP knowledge base.',
    'One-on-one training availability is not provided in the DSP knowledge base.',
    'specific USA companies or job locations are not provided in the DSP knowledge base',
    'Discount for multiple seats is not provided in the product context.',
  ];

  for (let i = 0; i < distinct.length; i += 1) {
    for (let j = i + 1; j < distinct.length; j += 1) {
      assert.ok(
        !isSameQuestion(distinct[i], distinct[j]),
        `expected "${distinct[i]}" and "${distinct[j]}" to stay separate`,
      );
    }
  }
});
