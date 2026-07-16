'use strict';

const { getPlan, generateLicenseKey } = require('./plans');
const { getSupabase, unwrap } = require('./supabase');

function calculateFirstExpiration(planId, now = Date.now()) {
  const plan = getPlan(planId);
  if (!plan || plan.days === null) return null;
  return new Date(now + plan.days * 24 * 60 * 60 * 1000).toISOString();
}

class LicenseService {
  constructor(paymentProvider) {
    this.paymentProvider = paymentProvider;
  }

  async createPayment({ planId, userPhone, userName }) {
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
          user_phone: userPhone,
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
      const referenceCode = `EE${license.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      const pix = await this.paymentProvider.createPix({
        amount: plan.price,
        description: `Licença EASY&EASY - ${plan.name}`,
        payerEmail: 'cliente@easy-easy.app',
        externalReference: license.id,
        pixReference: referenceCode,
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
        referenceCode,
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
    const supabase = getSupabase();
    const effectivePaidAt = paidAt || new Date().toISOString();
    const result = await supabase.rpc('confirm_payment', {
      p_provider_payment_id: String(providerPaymentId),
      p_paid_at: effectivePaidAt,
      p_raw_response: rawResponse || {},
    });
    const licenseId = unwrap(result, 'Não foi possível confirmar o pagamento');

    // Compatibilidade com bancos que ainda usam a função confirm_payment antiga:
    // uma licença paga e nunca ativada deve continuar sem prazo definido.
    const license = unwrap(
      await supabase
        .from('licenses')
        .select('last_validated_at, activated_devices')
        .eq('id', licenseId)
        .single(),
      'Não foi possível verificar a ativação da licença',
    );
    if (!license.last_validated_at && (license.activated_devices || []).length === 0) {
      unwrap(
        await supabase
          .from('licenses')
          .update({ expires_at: null })
          .eq('id', licenseId),
        'Não foi possível preparar a validade da licença',
      );
    }

    return licenseId;
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
    if (this.paymentProvider.kind === 'manual_pix') {
      await this.expireStaleManualPayments();
    }
    let payment = unwrap(
      await supabase
        .from('payments')
        .select(
          'id, payment_id, status, expires_at, amount, qr_code, qr_code_base64, license:licenses(id, license_key, plan, user_name, expires_at)',
        )
        .eq('id', checkoutId)
        .single(),
      'Pagamento não encontrado',
    );

    if (
      payment.status === 'pending' &&
      this.paymentProvider.kind === 'mercado_pago'
    ) {
      await this.syncProviderPayment(payment.payment_id);
      payment = unwrap(
        await supabase
          .from('payments')
          .select(
            'id, payment_id, status, expires_at, amount, qr_code, qr_code_base64, license:licenses(id, license_key, plan, user_name, expires_at)',
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
      referenceCode: `EE${payment.license.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
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
    const supabase = getSupabase();
    const result = unwrap(
      await supabase
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

    let expiresAt = result.expires_at;
    const firstExpiresAt = calculateFirstExpiration(result.plan);
    if (!expiresAt && firstExpiresAt) {
      const started = unwrap(
        await supabase
          .from('licenses')
          .update({ expires_at: firstExpiresAt })
          .eq('id', result.license_id)
          .is('expires_at', null)
          .select('expires_at')
          .maybeSingle(),
        'Não foi possível iniciar a validade da licença',
      );

      if (started?.expires_at) {
        expiresAt = started.expires_at;
      } else {
        const current = unwrap(
          await supabase
            .from('licenses')
            .select('expires_at')
            .eq('id', result.license_id)
            .single(),
          'Não foi possível carregar a validade da licença',
        );
        expiresAt = current.expires_at;
      }
    }

    return {
      success: true,
      authStatus: 'success',
      keyValid: true,
      user: result.user_name || 'Usuário',
      validade: expiresAt
        ? new Date(expiresAt).getTime()
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

  async approveManualPayment(checkoutId) {
    const payment = unwrap(
      await getSupabase()
        .from('payments')
        .select('payment_id, status')
        .eq('id', checkoutId)
        .eq('provider', 'manual_pix')
        .single(),
      'Pagamento PIX manual não encontrado',
    );

    if (payment.status === 'paid') {
      return this.getPaymentStatus(checkoutId);
    }
    if (!['pending', 'expired'].includes(payment.status)) {
      const error = new Error(`Pagamento não pode ser aprovado no estado ${payment.status}`);
      error.statusCode = 409;
      throw error;
    }

    await this.confirmProviderPayment(payment.payment_id, {
      manual: true,
      approvedManually: true,
      approvedAt: new Date().toISOString(),
    });
    return this.getPaymentStatus(checkoutId);
  }

  async expireStaleManualPayments(now = new Date().toISOString()) {
    const supabase = getSupabase();
    const expiredPayments = unwrap(
      await supabase
        .from('payments')
        .update({ status: 'expired' })
        .eq('provider', 'manual_pix')
        .eq('status', 'pending')
        .lte('expires_at', now)
        .select('license_id'),
      'Não foi possível expirar as solicitações antigas',
    );

    const licenseIds = [...new Set(expiredPayments.map((payment) => payment.license_id))];
    if (licenseIds.length > 0) {
      unwrap(
        await supabase
          .from('licenses')
          .update({ payment_status: 'expired' })
          .in('id', licenseIds)
          .eq('payment_status', 'pending'),
        'Não foi possível expirar as licenças pendentes',
      );
    }

    return expiredPayments.length;
  }

  async expireManualPayment(checkoutId) {
    const supabase = getSupabase();
    const payment = unwrap(
      await supabase
        .from('payments')
        .select('id, license_id, status')
        .eq('id', checkoutId)
        .eq('provider', 'manual_pix')
        .single(),
      'Pagamento PIX manual não encontrado',
    );

    if (payment.status === 'paid') {
      const error = new Error('Um pagamento confirmado não pode ser encerrado');
      error.statusCode = 409;
      throw error;
    }

    if (!['pending', 'expired'].includes(payment.status)) {
      const error = new Error(`Solicitação não pode ser encerrada no estado ${payment.status}`);
      error.statusCode = 409;
      throw error;
    }

    if (payment.status !== 'expired') {
      unwrap(
        await supabase
          .from('payments')
          .update({ status: 'expired' })
          .eq('id', payment.id),
        'Não foi possível encerrar a solicitação',
      );
    }

    unwrap(
      await supabase
        .from('licenses')
        .update({ payment_status: 'expired' })
        .eq('id', payment.license_id)
        .neq('payment_status', 'paid'),
      'Não foi possível encerrar a licença pendente',
    );

    return { paymentId: payment.id, status: 'expired' };
  }

  async listAdminPayments(status = undefined) {
    await this.expireStaleManualPayments();
    let query = getSupabase()
      .from('payments')
      .select(
        'id, status, amount, created_at, expires_at, paid_at, license:licenses(id, license_key, plan, user_phone, user_email, user_name, expires_at, last_validated_at)',
      )
      .eq('provider', 'manual_pix')
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) query = query.eq('status', status);

    const payments = unwrap(
      await query,
      'Não foi possível carregar os pagamentos',
    );

    return payments.map((payment) => {
      const plan = getPlan(payment.license?.plan);
      return {
        paymentId: payment.id,
        status: payment.status,
        amount: Number(payment.amount),
        referenceCode: payment.license?.id
          ? `EE${payment.license.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
          : '',
        createdAt: payment.created_at,
        paymentExpiresAt: payment.expires_at,
        paidAt: payment.paid_at,
        expiresAt: payment.license?.expires_at || null,
        activatedAt: payment.license?.last_validated_at || null,
        plan: payment.license?.plan || '',
        planName: plan?.name || payment.license?.plan || '',
        durationDays: plan?.days ?? null,
        userPhone: payment.license?.user_phone || '',
        userEmail: payment.license?.user_email || '',
        userName: payment.license?.user_name || '',
        licenseKey: payment.status === 'paid'
          ? payment.license?.license_key || ''
          : '',
      };
    });
  }
}

module.exports = { LicenseService, calculateFirstExpiration };
