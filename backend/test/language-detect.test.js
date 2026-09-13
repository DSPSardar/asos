// test/language-detect.test.js — Item 8: reply in the lead's language from turn one.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectLanguage, languageInstruction } = require('../src/utils/language');

test('detects Urdu script, Roman Urdu, English, Arabic and Hindi', () => {
  assert.equal(detectLanguage('السلام علیکم فیس کتنی ہے'), 'ur');
  assert.equal(detectLanguage('Assalam o alaikum, fee kitni hai course ki?'), 'roman_ur');
  assert.equal(detectLanguage('Hi, what is the fee for the course?'), 'en');
  assert.equal(detectLanguage('مرحبا كيف الحال'), 'ar');
  assert.equal(detectLanguage('नमस्ते कोर्स की फीस कितनी है'), 'hi');
});

test('defaults to the Urdu + English mix when the signal is weak', () => {
  assert.equal(detectLanguage('salam'), 'mixed');
  assert.equal(detectLanguage(''), 'mixed');
  assert.equal(detectLanguage('I saw your ad, mujhe details chahiye'), 'mixed');
  assert.match(languageInstruction('mixed'), /Urdu \+ English mix/);
  assert.match(languageInstruction('en'), /Reply in English/);
  assert.match(languageInstruction('bogus'), /Urdu \+ English mix/);
});
