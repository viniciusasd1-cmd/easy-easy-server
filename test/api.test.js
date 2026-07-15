'use strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.ALLOW_ANY_EXTENSION_ORIGIN = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

test('health e catálogo de planos respondem', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.paymentProvider, 'mock');

  const plans = await fetch(`http://127.0.0.1:${port}/api/plans`).then((r) => r.json());
  assert.equal(plans.plans.length, 4);
  assert.equal(plans.plans[0].id, 'monthly');
});

test('create-payment está registrado e valida o body antes de acessar o banco', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.notEqual(body.error, 'Endpoint não encontrado');
  assert.ok(Array.isArray(body.details));
});

test('rota de diagnóstico lista create-payment em ambiente não produtivo', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/routes`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(
    body.routes.some(
      (route) =>
        route.path === '/api/create-payment' && route.methods.includes('POST'),
    ),
  );
});
