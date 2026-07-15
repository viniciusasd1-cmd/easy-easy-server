'use strict';

process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'manual_pix';
process.env.PIX_KEY = 'pagamentos@example.com';
process.env.PIX_MERCHANT_NAME = 'EASY EASY';
process.env.PIX_MERCHANT_CITY = 'SAO PAULO';
process.env.MANUAL_APPROVAL_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PaymentProvider,
  buildPixPayload,
  crc16,
} = require('../src/payment-provider');

test('gera payload PIX EMV válido e QR Code local', async () => {
  const provider = new PaymentProvider();
  const pix = await provider.createPix({
    amount: 29.9,
    description: 'Licença EASY&EASY',
    payerEmail: 'cliente@example.com',
    externalReference: 'b40423b2-932f-4d18-9b08-c3cbd4874e3d',
  });

  assert.match(pix.paymentId, /^manual_/);
  assert.match(pix.qrCode, /^000201/);
  assert.match(pix.qrCode, /BR\.GOV\.BCB\.PIX/i);
  assert.match(pix.qrCode, /540529\.90/);
  assert.match(pix.qrCode, /6304[0-9A-F]{4}$/);
  assert.match(pix.qrCodeBase64, /^data:image\/png;base64,/);
  assert.equal(pix.status, 'pending');
});

test('CRC do payload corresponde ao conteúdo anterior ao campo 63', () => {
  const payload = buildPixPayload({
    pixKey: 'pagamentos@example.com',
    merchantName: 'EASY EASY',
    merchantCity: 'SAO PAULO',
    amount: 69.9,
    txid: 'ABC123',
    description: 'LICENCA EASY EASY',
  });
  const withoutCrc = payload.slice(0, -4);
  assert.equal(payload.slice(-4), crc16(withoutCrc));
});
