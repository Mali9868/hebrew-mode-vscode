import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtlIsolate } from '../core/bidi';

const RLI = String.fromCharCode(0x2067);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

test('Hebrew lines are wrapped in a right-to-left isolate', () => {
  assert.equal(rtlIsolate('לא הוגדר מפתח Gemini.'), `${RLI}לא הוגדר מפתח Gemini.${PDI}`);
  assert.equal(rtlIsolate('"הסתר ותרגם" עכשיו'), `${RLI}"הסתר ותרגם" עכשיו${PDI}`);
});

test('lines that start with English, and empty lines, are unchanged; each line is isolated on its own', () => {
  assert.equal(rtlIsolate('Hebrew Mode: הגדרת מפתח'), 'Hebrew Mode: הגדרת מפתח');
  assert.equal(rtlIsolate('שורה 2: Google API key\n\nבלחיצה'), `${RLI}שורה 2: Google API key${PDI}\n\n${RLI}בלחיצה${PDI}`);
});

test('URLs inside a Hebrew line keep left-to-right order', () => {
  assert.equal(
    rtlIsolate('יוצרים מפתח ב-https://aistudio.google.com/api-keys'),
    `${RLI}יוצרים מפתח ב-${LRI}https://aistudio.google.com/api-keys${PDI}${PDI}`,
  );
  assert.equal(rtlIsolate('ראו https://x.io/a.'), `${RLI}ראו ${LRI}https://x.io/a${PDI}.${PDI}`);
});
