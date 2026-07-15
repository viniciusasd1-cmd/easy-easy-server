'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, getPlan, generateLicenseKey } = require('../src/plans');

test('expõe os seis planos com valores e durações esperados', () => {
  assert.equal(PLANS.length, 6);
  assert.deepEqual(
    PLANS.map(({ id, price, days }) => ({ id, price, days })),
    [
      { id: 'daily', price: 4.99, days: 1 },
      { id: 'weekly', price: 24.9, days: 7 },
      { id: 'fortnightly', price: 44.9, days: 15 },
      { id: 'monthly', price: 79.9, days: 30 },
      { id: 'annual', price: 699.9, days: 365 },
      { id: 'lifetime', price: 1499, days: null },
    ],
  );
  assert.equal(getPlan('quarterly'), null);
});

test('gera chaves EASY no formato seguro', () => {
  const keys = new Set(Array.from({ length: 100 }, generateLicenseKey));
  assert.equal(keys.size, 100);
  for (const key of keys) {
    assert.match(key, /^EASY-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
  }
});
