import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addGlossaryTerm } from '../core/glossary';

test('adds a trimmed term to the end of the list', () => {
  assert.deepEqual(addGlossaryTerm(['deploy'], '  Supabase '), { ok: true, list: ['deploy', 'Supabase'], term: 'Supabase' });
  assert.deepEqual(addGlossaryTerm([], 'מסך הבית'), { ok: true, list: ['מסך הבית'], term: 'מסך הבית' });
});

test('rejects empty, multi-line, too long and duplicate (case-insensitive) terms', () => {
  assert.deepEqual(addGlossaryTerm([], '   '), { ok: false, reason: 'empty' });
  assert.deepEqual(addGlossaryTerm([], 'a\nb'), { ok: false, reason: 'invalid' });
  assert.deepEqual(addGlossaryTerm([], 'x'.repeat(61)), { ok: false, reason: 'invalid' });
  assert.deepEqual(addGlossaryTerm(['Supabase'], 'supabase'), { ok: false, reason: 'duplicate' });
});
