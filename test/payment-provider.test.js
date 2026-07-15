'use strict';

process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentProvider } = require('../src/payment-provider');

test('provedor mock gera PIX e QR Code local', async () => {
  const provider = new PaymentProvider();
  const pix = await provider.createPix({
    amount: 29.9,
    description: 'Teste',
    payerEmail: 'teste@example.com',
    externalReference: 'license-id',
  });

  assert.match(pix.paymentId, /^mock_/);
  assert.match(pix.qrCode, /^EASY&EASY\|PIX-TESTE\|/);
  assert.match(pix.qrCodeBase64, /^data:image\/png;base64,/);
  assert.equal(pix.status, 'pending');
});
