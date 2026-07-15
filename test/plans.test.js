'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, getPlan, generateLicenseKey } = require('../src/plans');

test('expõe os quatro planos com valores esperados', () => {
  assert.equal(PLANS.length, 4);
  assert.equal(getPlan('monthly').price, 29.9);
  assert.equal(getPlan('quarterly').price, 69.9);
  assert.equal(getPlan('annual').price, 199.9);
  assert.equal(getPlan('lifetime').price, 499.9);
});

test('gera chaves EASY no formato seguro', () => {
  const keys = new Set(Array.from({ length: 100 }, generateLicenseKey));
  assert.equal(keys.size, 100);
  for (const key of keys) {
    assert.match(key, /^EASY-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
  }
});
