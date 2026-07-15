'use strict';

const { randomInt } = require('node:crypto');

const PLANS = Object.freeze([
  Object.freeze({
    id: 'daily',
    name: '24 horas',
    price: 4.99,
    days: 1,
    description: 'Acesso completo por 24 horas',
    badge: '',
  }),
  Object.freeze({
    id: 'weekly',
    name: '7 dias',
    price: 24.9,
    days: 7,
    description: 'Acesso completo por 7 dias',
    badge: '',
  }),
  Object.freeze({
    id: 'fortnightly',
    name: '15 dias',
    price: 44.9,
    days: 15,
    description: 'Acesso completo por 15 dias',
    badge: '',
  }),
  Object.freeze({
    id: 'monthly',
    name: 'Mensal',
    price: 79.9,
    days: 30,
    description: 'Acesso completo por 30 dias',
    badge: 'Mais escolhido',
  }),
  Object.freeze({
    id: 'annual',
    name: 'Anual',
    price: 699.9,
    days: 365,
    description: 'Economize 27% no ano',
    badge: 'Melhor valor',
  }),
  Object.freeze({
    id: 'lifetime',
    name: 'Vitalício',
    price: 1499,
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
