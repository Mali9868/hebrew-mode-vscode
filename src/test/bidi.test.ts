import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtlIsolate } from '../core/bidi';

const RLI = String.fromCharCode(0x2067);
const PDI = String.fromCharCode(0x2069);

test('Hebrew lines are wrapped in a right-to-left isolate', () => {
  assert.equal(rtlIsolate('לא הוגדר מפתח Gemini.'), `${RLI}לא הוגדר מפתח Gemini.${PDI}`);
  assert.equal(rtlIsolate('"הסתר ותרגם" עכשיו'), `${RLI}"הסתר ותרגם" עכשיו${PDI}`);
});

test('lines that start with English, and empty lines, are unchanged; each line is isolated on its own', () => {
  assert.equal(rtlIsolate('Hebrew Mode: הגדרת מפתח'), 'Hebrew Mode: הגדרת מפתח');
  assert.equal(rtlIsolate('שורה 2: Google API key\n\nבלחיצה'), `${RLI}שורה 2: Google API key${PDI}\n\n${RLI}בלחיצה${PDI}`);
});
