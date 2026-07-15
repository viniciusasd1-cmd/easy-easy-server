'use strict';

require('dotenv').config();

function asBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function parseExtensionIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || 'development';

const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT || 4000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseSecretKey:
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  paymentProvider:
    process.env.PAYMENT_PROVIDER ||
    (nodeEnv === 'production' ? 'mercado_pago' : 'mock'),
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
  mercadoPagoWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
  pixKey: String(process.env.PIX_KEY || '').trim(),
  pixMerchantName: String(process.env.PIX_MERCHANT_NAME || 'EASY EASY').trim(),
  pixMerchantCity: String(process.env.PIX_MERCHANT_CITY || 'SAO PAULO').trim(),
  pixDescription: String(
    process.env.PIX_DESCRIPTION || 'LICENCA EASY EASY',
  ).trim(),
  manualApprovalSecret: process.env.MANUAL_APPROVAL_SECRET || '',
  allowedExtensionIds: parseExtensionIds(process.env.ALLOWED_EXTENSION_IDS),
  allowAnyExtensionOrigin: asBoolean(
    process.env.ALLOW_ANY_EXTENSION_ORIGIN,
    nodeEnv !== 'production',
  ),
  allowMockPaymentApproval: asBoolean(
    process.env.ALLOW_MOCK_PAYMENT_APPROVAL,
    nodeEnv !== 'production',
  ),
});

function validateConfig() {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY');

  if (config.paymentProvider === 'mercado_pago') {
    if (!config.mercadoPagoAccessToken) {
      missing.push('MERCADO_PAGO_ACCESS_TOKEN');
    }
    if (!config.mercadoPagoWebhookSecret) {
      missing.push('MERCADO_PAGO_WEBHOOK_SECRET');
    }
  }

  if (config.paymentProvider === 'manual_pix') {
    if (!config.pixKey) missing.push('PIX_KEY');
    if (!config.pixMerchantName) missing.push('PIX_MERCHANT_NAME');
    if (!config.pixMerchantCity) missing.push('PIX_MERCHANT_CITY');
    if (!config.manualApprovalSecret) missing.push('MANUAL_APPROVAL_SECRET');
    if (
      config.isProduction &&
      config.manualApprovalSecret.length < 32
    ) {
      throw new Error(
        'MANUAL_APPROVAL_SECRET deve ter pelo menos 32 caracteres em produção.',
      );
    }
  }

  if (config.isProduction && config.allowAnyExtensionOrigin) {
    throw new Error(
      'ALLOW_ANY_EXTENSION_ORIGIN deve ser false em produção. Configure ALLOWED_EXTENSION_IDS.',
    );
  }

  if (!['mock', 'manual_pix', 'mercado_pago'].includes(config.paymentProvider)) {
    throw new Error(
      'PAYMENT_PROVIDER deve ser mock, manual_pix ou mercado_pago.',
    );
  }

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  }

  if (config.supabaseSecretKey.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SECRET_KEY contém uma chave pública (sb_publishable_). ' +
        'Use uma chave secreta sb_secret_ do backend ou a chave JWT service_role legada.',
    );
  }

  if (config.supabaseSecretKey.startsWith('eyJ')) {
    try {
      const payloadPart = config.supabaseSecretKey.split('.')[1];
      const payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf8'),
      );
      if (payload.role && payload.role !== 'service_role') {
        throw new Error(
          `SUPABASE_SECRET_KEY usa o papel "${payload.role}"; o backend exige service_role.`,
        );
      }
    } catch (error) {
      if (error.message.includes('backend exige service_role')) throw error;
      throw new Error('SUPABASE_SECRET_KEY contém um JWT inválido.');
    }
  }
}

module.exports = { config, validateConfig };
