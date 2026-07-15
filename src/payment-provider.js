'use strict';

const { randomUUID } = require('node:crypto');
const QRCode = require('qrcode');
const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
} = require('mercadopago');
const { config } = require('./config');

function emv(id, value) {
  const text = String(value);
  if (text.length > 99) {
    throw new Error(`Campo PIX ${id} excede o limite de 99 caracteres.`);
  }
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

function normalizePixText(value, maxLength) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function crc16(payload) {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload({ pixKey, merchantName, merchantCity, amount, txid, description }) {
  const key = String(pixKey || '').trim().slice(0, 77);
  const name = normalizePixText(merchantName, 25) || 'EASY EASY';
  const city = normalizePixText(merchantCity, 15) || 'SAO PAULO';
  const reference = normalizePixText(txid, 25).replace(/[^A-Z0-9]/g, '') || '***';
  const normalizedDescription = normalizePixText(description, 40);

  let merchantAccount = emv('00', 'br.gov.bcb.pix') + emv('01', key);
  const descriptionLimit = Math.max(0, 99 - merchantAccount.length - 4);
  if (normalizedDescription && descriptionLimit > 0) {
    merchantAccount += emv('02', normalizedDescription.slice(0, descriptionLimit));
  }

  const amountValue = Number(amount).toFixed(2);
  const additionalData = emv('05', reference);
  const withoutCrc =
    emv('00', '01') +
    emv('01', '11') +
    emv('26', merchantAccount) +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', amountValue) +
    emv('58', 'BR') +
    emv('59', name) +
    emv('60', city) +
    emv('62', additionalData) +
    '6304';

  return withoutCrc + crc16(withoutCrc);
}

function normalizeProviderStatus(status) {
  if (status === 'approved') return 'paid';
  if (['pending', 'in_process', 'authorized'].includes(status)) return 'pending';
  if (status === 'expired') return 'expired';
  return 'failed';
}

class PaymentProvider {
  constructor() {
    this.kind = config.paymentProvider;

    if (this.kind === 'mercado_pago') {
      const client = new MercadoPagoConfig({
        accessToken: config.mercadoPagoAccessToken,
      });
      this.payment = new Payment(client);
    }
  }

  async createPix({ amount, description, payerEmail, externalReference, pixReference }) {
    if (this.kind === 'mock') {
      const paymentId = `mock_${randomUUID()}`;
      const qrCode = `EASY&EASY|PIX-TESTE|${paymentId}|${amount.toFixed(2)}`;
      const qrCodeBase64 = await QRCode.toDataURL(qrCode, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      });

      return {
        paymentId,
        status: 'pending',
        qrCode,
        qrCodeBase64,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        raw: { mock: true, id: paymentId },
      };
    }

    if (this.kind === 'manual_pix') {
      const paymentId = `manual_${randomUUID()}`;
      const txid = String(pixReference || externalReference)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 25);
      const qrCode = buildPixPayload({
        pixKey: config.pixKey,
        merchantName: config.pixMerchantName,
        merchantCity: config.pixMerchantCity,
        amount,
        txid,
        description: config.pixDescription || description,
      });
      const qrCodeBase64 = await QRCode.toDataURL(qrCode, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      });

      return {
        paymentId,
        status: 'pending',
        qrCode,
        qrCodeBase64,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        raw: { manual: true, id: paymentId, txid },
      };
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const response = await this.payment.create({
      body: {
        transaction_amount: Number(amount.toFixed(2)),
        description,
        payment_method_id: 'pix',
        payer: { email: payerEmail },
        external_reference: externalReference,
        notification_url: `${config.baseUrl}/api/webhook/pix`,
        date_of_expiration: expiresAt,
        metadata: { license_id: externalReference },
      },
      requestOptions: { idempotencyKey: randomUUID() },
    });

    const transaction = response.point_of_interaction?.transaction_data;
    if (!transaction?.qr_code || !transaction?.qr_code_base64) {
      throw new Error('Mercado Pago não retornou os dados do QR Code PIX.');
    }

    return {
      paymentId: String(response.id),
      status: normalizeProviderStatus(response.status),
      qrCode: transaction.qr_code,
      qrCodeBase64: `data:image/png;base64,${transaction.qr_code_base64}`,
      expiresAt: response.date_of_expiration || expiresAt,
      raw: response,
    };
  }

  async getPayment(paymentId) {
    if (this.kind === 'mock' || this.kind === 'manual_pix') {
      return {
        paymentId,
        status: 'pending',
        raw: { manual: this.kind === 'manual_pix', mock: this.kind === 'mock', id: paymentId },
      };
    }

    const response = await this.payment.get({ id: paymentId });
    return {
      paymentId: String(response.id),
      status: normalizeProviderStatus(response.status),
      paidAt: response.date_approved || null,
      externalReference: response.external_reference || null,
      raw: response,
    };
  }

  validateWebhook({ xSignature, xRequestId, dataId }) {
    if (this.kind !== 'mercado_pago') return true;

    WebhookSignatureValidator.validate({
      xSignature,
      xRequestId,
      dataId: String(dataId),
      secret: config.mercadoPagoWebhookSecret,
    });
    return true;
  }
}

module.exports = {
  PaymentProvider,
  buildPixPayload,
  crc16,
  normalizePixText,
  normalizeProviderStatus,
};
