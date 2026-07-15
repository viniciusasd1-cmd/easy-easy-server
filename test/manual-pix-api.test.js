'use strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.PAYMENT_PROVIDER = 'manual_pix';
process.env.PIX_KEY = 'pagamentos@example.com';
process.env.PIX_MERCHANT_NAME = 'EASY EASY';
process.env.PIX_MERCHANT_CITY = 'SAO PAULO';
process.env.MANUAL_APPROVAL_SECRET = 'uma-chave-administrativa-de-teste';
process.env.ALLOW_ANY_EXTENSION_ORIGIN = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

test('aprovação manual rejeita requisição sem segredo antes de acessar o banco', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(
    `http://127.0.0.1:${port}/api/admin/payments/b40423b2-932f-4d18-9b08-c3cbd4874e3d/approve`,
    { method: 'POST' },
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(body.error, 'Credencial administrativa inválida');
});

test('listagem administrativa rejeita requisição sem segredo', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/payments?status=pending`);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(body.error, 'Credencial administrativa inválida');
});

test('painel administrativo é servido sem expor a chave', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/admin/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Painel de pagamentos/);
  assert.doesNotMatch(body, /uma-chave-administrativa-de-teste/);
});
