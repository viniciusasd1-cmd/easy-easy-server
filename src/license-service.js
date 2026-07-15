'use strict';

const { getPlan, generateLicenseKey } = require('./plans');
const { getSupabase, unwrap } = require('./supabase');

class LicenseService {
  constructor(paymentProvider) {
    this.paymentProvider = paymentProvider;
  }

  async createPayment({ planId, userEmail, userName }) {
    console.log('🧾 Iniciando criação de pagamento:', {
      planId,
      provider: this.paymentProvider.kind,
    });

    const plan = getPlan(planId);
    if (!plan) {
      const error = new Error('Plano inválido');
      error.statusCode = 400;
      throw error;
    }

    const supabase = getSupabase();
    let license;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await supabase
        .from('licenses')
        .insert({
          license_key: generateLicenseKey(),
          plan: plan.id,
          user_email: userEmail.toLowerCase(),
          user_name: userName || null,
          payment_status: 'pending',
        })
        .select('*')
        .single();

      if (!result.error) {
        license = result.data;
        console.log('✅ Licença pendente registrada:', { licenseId: license.id });
        break;
      }

      if (result.error.code !== '23505' || attempt === 4) {
        unwrap(result, 'Não foi possível criar a licença');
      }
    }

    try {
      const pix = await this.paymentProvider.createPix({
        amount: plan.price,
        description: `Licença EASY&EASY - ${plan.name}`,
        payerEmail: userEmail,
        externalReference: license.id,
      });
      console.log('✅ PIX criado pelo provedor:', {
        provider: this.paymentProvider.kind,
        providerPaymentId: pix.paymentId,
        status: pix.status,
      });

      const payment = unwrap(
        await supabase
          .from('payments')
          .insert({
            license_id: license.id,
            amount: plan.price,
            method: 'PIX',
            provider: this.paymentProvider.kind,
            payment_id: pix.paymentId,
            qr_code: pix.qrCode,
            qr_code_base64: pix.qrCodeBase64,
            status: pix.status,
            expires_at: pix.expiresAt,
            raw_response: pix.raw,
          })
          .select('*')
          .single(),
        'Não foi possível registrar o pagamento',
      );

      unwrap(
        await supabase
          .from('licenses')
          .update({ payment_id: pix.paymentId })
          .eq('id', license.id),
        'Não foi possível vincular o pagamento',
      );

      return {
        paymentId: payment.id,
        qrCode: pix.qrCode,
        qrCodeBase64: pix.qrCodeBase64,
        amount: plan.price,
        plan: plan.id,
        planName: plan.name,
        status: 'pending',
        expiresAt: pix.expiresAt,
      };
    } catch (error) {
      console.error('❌ Falha após criar a licença; removendo registro pendente:', {
        licenseId: license.id,
        message: error.message,
      });
      await supabase.from('licenses').delete().eq('id', license.id);
      throw error;
    }
  }

  async confirmProviderPayment(providerPaymentId, rawResponse, paidAt = null) {
    const result = await getSupabase().rpc('confirm_payment', {
      p_provider_payment_id: String(providerPaymentId),
      p_paid_at: paidAt || new Date().toISOString(),
      p_raw_response: rawResponse || {},
    });
    return unwrap(result, 'Não foi possível confirmar o pagamento');
  }

  async syncProviderPayment(providerPaymentId) {
    const providerPayment = await this.paymentProvider.getPayment(providerPaymentId);

    if (providerPayment.status === 'paid') {
      await this.confirmProviderPayment(
        providerPayment.paymentId,
        providerPayment.raw,
        providerPayment.paidAt,
      );
    } else if (['expired', 'failed'].includes(providerPayment.status)) {
      const supabase = getSupabase();
      unwrap(
        await supabase
          .from('payments')
          .update({
            status: providerPayment.status,
            raw_response: providerPayment.raw,
          })
          .eq('payment_id', String(providerPaymentId)),
        'Não foi possível atualizar o pagamento',
      );
      unwrap(
        await supabase
          .from('licenses')
          .update({ payment_status: providerPayment.status })
          .eq('payment_id', String(providerPaymentId)),
        'Não foi possível atualizar a licença',
      );
    }

    return providerPayment;
  }

  async getPaymentStatus(checkoutId) {
    const supabase = getSupabase();
    let payment = unwrap(
      await supabase
        .from('payments')
        .select(
          'id, payment_id, status, expires_at, amount, qr_code, qr_code_base64, license:licenses(license_key, plan, user_name, expires_at)',
        )
        .eq('id', checkoutId)
        .single(),
      'Pagamento não encontrado',
    );

    if (payment.status === 'pending' && this.paymentProvider.kind !== 'mock') {
      await this.syncProviderPayment(payment.payment_id);
      payment = unwrap(
        await supabase
          .from('payments')
          .select(
            'id, payment_id, status, expires_at, amount, qr_code, qr_code_base64, license:licenses(license_key, plan, user_name, expires_at)',
          )
          .eq('id', checkoutId)
          .single(),
        'Pagamento não encontrado',
      );
    }

    const expired =
      payment.status === 'pending' &&
      payment.expires_at &&
      new Date(payment.expires_at).getTime() <= Date.now();

    return {
      paymentId: payment.id,
      status: expired ? 'expired' : payment.status,
      amount: Number(payment.amount),
      qrCode: payment.status === 'pending' ? payment.qr_code : null,
      qrCodeBase64: payment.status === 'pending' ? payment.qr_code_base64 : null,
      licenseKey: payment.status === 'paid' ? payment.license.license_key : null,
      plan: payment.license.plan,
      user: payment.license.user_name || 'Usuário',
      validade:
        payment.status === 'paid' && payment.license.expires_at
          ? new Date(payment.license.expires_at).getTime()
          : null,
    };
  }

  async activate({ licenseKey, deviceId, userAgent }) {
    const result = unwrap(
      await getSupabase()
        .rpc('activate_license', {
          p_license_key: licenseKey.trim().toUpperCase(),
          p_device_id: deviceId,
          p_user_agent: userAgent || null,
        })
        .single(),
      'Não foi possível validar a licença',
    );

    if (!result.success) {
      const error = new Error(result.message || 'Licença inválida');
      error.code = result.error_code;
      error.statusCode = 401;
      throw error;
    }

    return {
      success: true,
      authStatus: 'success',
      keyValid: true,
      user: result.user_name || 'Usuário',
      validade: result.expires_at
        ? new Date(result.expires_at).getTime()
        : null,
      plan: result.plan,
      msg: result.message,
    };
  }

  async getMyLicense({ licenseKey, deviceId, userAgent }) {
    return this.activate({ licenseKey, deviceId, userAgent });
  }

  async approveMockPayment(checkoutId) {
    const payment = unwrap(
      await getSupabase()
        .from('payments')
        .select('payment_id')
        .eq('id', checkoutId)
        .eq('provider', 'mock')
        .single(),
      'Pagamento de teste não encontrado',
    );

    await this.confirmProviderPayment(payment.payment_id, {
      mock: true,
      approvedManually: true,
    });
    return this.getPaymentStatus(checkoutId);
  }
}

module.exports = { LicenseService };
