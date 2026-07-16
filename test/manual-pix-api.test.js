'use strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.PAYMENT_PROVIDER = 'manual_pix';
process.env.PIX_KEY = 'pagamentos@example.com';
process.env.PIX_MERCHANT_NAME = 'EASY EASY';
process.env.PIX_MERCHANT_CITY = 'SAO PAULO';
process.env.MANUAL_APPROVAL_SECRET = 'uma-chave-administrativa-de-teste';
process.env.ALLOW_ANY_EXTENSION_ORIGIN = 'false';
process.env.BASE_URL = 'https://easy-easy-server.onrender.com';

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

test('painel administrativo possui relógio regressivo de validade', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/admin/admin.js`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Duração contratada/);
  assert.match(body, /Começa na primeira ativação/);
  assert.match(body, /setInterval\(updateCountdowns, 1000\)/);
  assert.match(body, /Enviar pelo WhatsApp/);
});

test('CORS permite extensão Chrome somente nas rotas públicas', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const response = await fetch(`http://127.0.0.1:${port}/api/plans`, {
    headers: { Origin: origin },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('CORS bloqueia extensão Chrome na rota administrativa', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/payments`, {
    headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
  });

  assert.equal(response.status, 403);
});

test('CORS permite requisições do próprio painel administrativo', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/payments`, {
    headers: { Origin: 'https://easy-easy-server.onrender.com' },
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://easy-easy-server.onrender.com',
  );
});

test('CORS rejeita outra origem com erro 403', async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/payments`, {
    headers: { Origin: 'https://site-nao-autorizado.example' },
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error, 'Origem não autorizada');
});
