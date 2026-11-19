import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, parseModel, ApiModel } from '../core/models';

const gen = ['generateContent', 'countTokens'];
const m = (name: string, methods = gen): ApiModel => ({ name: `models/${name}`, supportedGenerationMethods: methods });

test('picks the newest stable Flash-Lite and ignores previews, aliases and non-generate models', () => {
  const models = [
    m('gemini-2.0-flash-lite'),
    m('gemini-2.0-flash-lite-001'),
    m('gemini-2.5-flash-lite'),
    m('gemini-2.5-flash-lite-preview-09-2025'),
    m('gemini-3.1-flash-lite-preview'),
    m('gemini-flash-lite-latest'),
    m('gemini-2.5-flash'),
    m('gemini-9-flash-lite', ['embedContent']),
    m('text-embedding-004', ['embedContent']),
  ];
  assert.equal(pickModel(models, 'flash-lite'), 'gemini-2.5-flash-lite');
  assert.equal(pickModel(models, 'flash'), 'gemini-2.5-flash');
});

test('prefers unsuffixed alias, then highest revision', () => {
  assert.equal(pickModel([m('gemini-3.0-flash-lite-001'), m('gemini-3.0-flash-lite-002')], 'flash-lite'), 'gemini-3.0-flash-lite-002');
  assert.equal(pickModel([m('gemini-3.0-flash-lite-002'), m('gemini-3.0-flash-lite')], 'flash-lite'), 'gemini-3.0-flash-lite');
  assert.equal(pickModel([m('gemini-3-flash-lite'), m('gemini-2.5-flash-lite')], 'flash-lite'), 'gemini-3-flash-lite');
});

test('returns null when no stable model of the tier exists', () => {
  assert.equal(pickModel([m('gemini-3.1-flash-lite-preview')], 'flash-lite'), null);
});

test('flash-lite is not mistaken for flash', () => {
  assert.equal(parseModel('gemini-2.5-flash-lite')?.tier, 'flash-lite');
  assert.equal(parseModel('gemini-2.5-flash')?.tier, 'flash');
  assert.equal(pickModel([m('gemini-2.5-flash-lite')], 'flash'), null);
});
