'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFirstExpiration } = require('../src/license-service');

test('prazo de 24 horas começa no instante da primeira ativação', () => {
  const activatedAt = Date.parse('2026-07-15T20:00:00.000Z');
  assert.equal(
    calculateFirstExpiration('daily', activatedAt),
    '2026-07-16T20:00:00.000Z',
  );
});

test('plano vitalício continua sem expiração', () => {
  assert.equal(calculateFirstExpiration('lifetime', Date.now()), null);
});
