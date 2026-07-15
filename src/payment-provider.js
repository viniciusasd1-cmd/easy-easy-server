'use strict';

const { randomUUID } = require('node:crypto');
const QRCode = require('qrcode');
const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
} = require('mercadopago');
const { config } = require('./config');

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

  async createPix({ amount, description, payerEmail, externalReference }) {
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
    if (this.kind === 'mock') {
      return { paymentId, status: 'pending', raw: { mock: true, id: paymentId } };
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
    if (this.kind === 'mock') return true;

    WebhookSignatureValidator.validate({
      xSignature,
      xRequestId,
      dataId: String(dataId),
      secret: config.mercadoPagoWebhookSecret,
    });
    return true;
  }
}

module.exports = { PaymentProvider, normalizeProviderStatus };
