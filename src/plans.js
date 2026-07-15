'use strict';

const { randomInt } = require('node:crypto');

const PLANS = Object.freeze([
  Object.freeze({
    id: 'monthly',
    name: 'Mensal',
    price: 29.9,
    days: 30,
    description: 'Acesso completo por 30 dias',
    badge: '',
  }),
  Object.freeze({
    id: 'quarterly',
    name: 'Trimestral',
    price: 69.9,
    days: 90,
    description: 'Economize 22% no trimestre',
    badge: 'Popular',
  }),
  Object.freeze({
    id: 'annual',
    name: 'Anual',
    price: 199.9,
    days: 365,
    description: 'Economize 44% no ano',
    badge: 'Melhor valor',
  }),
  Object.freeze({
    id: 'lifetime',
    name: 'Vitalício',
    price: 499.9,
    days: null,
    description: 'Pagamento único, acesso permanente',
    badge: 'Para sempre',
  }),
]);

function getPlan(planId) {
  return PLANS.find((plan) => plan.id === planId) || null;
}

function generateLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = [];

  for (let group = 0; group < 4; group += 1) {
    let part = '';
    for (let index = 0; index < 4; index += 1) {
      part += alphabet[randomInt(0, alphabet.length)];
    }
    parts.push(part);
  }

  return `EASY-${parts.join('-')}`;
}

module.exports = { PLANS, getPlan, generateLicenseKey };
