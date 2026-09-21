// ============================================
// POPUP.JS - EASY&EASY
// ============================================

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const elements = {
    loginView: $('loginView'),
    homeView: $('homeView'),
    plansContainer: $('plans-container'),
    plansLoading: $('plans-loading'),
    plansError: $('plans-error'),
    userPhone: $('userPhone'),
    buyerName: $('buyerName'),
    paymentScreen: $('payment-screen'),
    paymentBack: $('payment-back'),
    qrCode: $('qr-code'),
    pixCode: $('pix-code'),
    copyPix: $('copy-pix'),
    amountDisplay: $('amount-display'),
    paymentReference: $('payment-reference'),
    paymentStatus: $('payment-status'),
    manualCheck: $('manual-check'),
    sendReceipt: $('send-receipt'),
    licenseRelease: $('license-release'),
    licenseKeyFinal: $('license-key-final'),
    copyLicense: $('copy-license'),
    activateButton: $('activate-btn'),
    activationSection: $('activation-section'),
    manualKeyInput: $('manual-key-input'),
    manualActivateButton: $('manual-activate-btn'),
    activationMessage: $('activation-message'),
    userLine: $('userLine'),
    countdown: $('countdown'),
    warningBox: $('warningBox'),
    status: $('status'),
    enabled: $('enabled'),
    mode1: $('mode1'),
    mode2: $('mode2'),
    showValidity: $('showValidity'),
    logoutButton: $('logoutButton'),
    globalLoading: $('global-loading'),
    toast: $('toast'),
    themeButton: $('themeBtn'),
    supportWhatsApp: $('support-whatsapp'),
  };

  const state = {
    licenseKey: '',
    keyValid: false,
    user: '',
    validade: null,
    plan: '',
    enabled: false,
    mode: '1',
    showValidity: true,
    paymentId: '',
    releasedLicenseKey: '',
    paymentReferenceCode: '',
    paymentAmount: null,
    pollingTimer: null,
    pollingAttempts: 0,
    countdownTimer: null,
  };

  function sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('Erro de comunicação com o background'));
          return;
        }
        resolve(response);
      });
    });
  }

  function setLoading(visible, text = 'Processando...') {
    elements.globalLoading.hidden = !visible;
    elements.globalLoading.querySelector('p').textContent = text;
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  function showActivationMessage(message, type = '') {
    elements.activationMessage.textContent = message;
    elements.activationMessage.className = `message ${type}`.trim();
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  function openSupportWhatsApp(includePayment = false) {
    const message = includePayment && state.paymentId
      ? `Olá! Fiz o pagamento da EASY&EASY e quero enviar o comprovante. Valor: ${formatMoney(state.paymentAmount || 0)}. Identificador: ${state.paymentReferenceCode || state.paymentId}.`
      : 'Olá! Preciso de suporte com a extensão EASY&EASY.';
    const url = `https://wa.me/5511977884807?text=${encodeURIComponent(message)}`;
    chrome.tabs.create({ url });
  }

  function updateViews() {
    elements.loginView.hidden = state.keyValid;
    elements.homeView.hidden = !state.keyValid;
    if (!state.keyValid) return;

    elements.userLine.textContent = state.user || 'Minha conta';
    elements.enabled.checked = state.enabled;
    elements.mode1.checked = state.mode === '1';
    elements.mode2.checked = state.mode === '2';
    elements.showValidity.checked = state.showValidity;
    elements.status.textContent = state.enabled ? 'Ativa' : 'Desativada';
    elements.status.className = state.enabled ? 'is-updated' : 'is-disabled';
    updateCountdown();
  }

  function updateCountdown() {
    if (!state.keyValid || !state.showValidity) {
      elements.countdown.hidden = true;
      return;
    }

    elements.countdown.hidden = false;
    if (state.validade === null || state.validade === undefined) {
      elements.countdown.textContent = 'Acesso vitalício';
      elements.countdown.style.color = 'var(--accent)';
      elements.warningBox.hidden = true;
      return;
    }

    const remaining = Number(state.validade) - Date.now();
    if (remaining <= 0) {
      elements.countdown.textContent = 'Licença expirada';
      elements.countdown.style.color = 'var(--danger)';
      elements.warningBox.hidden = false;
      return;
    }

    elements.warningBox.hidden = true;
    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    elements.countdown.textContent = `${days}d ${hours}h ${minutes}m restantes`;
    elements.countdown.style.color = days <= 5 ? 'var(--warning)' : 'var(--accent-2)';
  }

  async function loadConfig() {
    try {
      const data = await sendMessage('getStatus');
      Object.assign(state, {
        licenseKey: data.licenseKey || '',
        keyValid: data.keyValid === true,
        user: data.user || '',
        validade: data.validade ?? null,
        plan: data.plan || '',
        enabled: data.enabled === true,
        mode: data.mode === '2' ? '2' : '1',
        showValidity: data.showValidity !== false,
        paymentId: data.pendingPaymentId || '',
      });
      updateViews();

      if (!state.keyValid) {
        await loadPlans();
        if (state.paymentId) await resumePayment(state.paymentId);
      }
    } catch (error) {
      elements.plansError.textContent = error.message;
      elements.plansError.hidden = false;
      elements.plansLoading.hidden = true;
    }
  }

  async function loadPlans() {
    elements.plansLoading.hidden = false;
    elements.plansError.hidden = true;

    try {
      const response = await sendMessage('getPlans');
      if (!Array.isArray(response.plans)) {
        throw new Error(response.error || 'Planos indisponíveis');
      }
      renderPlans(response.plans);
    } catch (error) {
      elements.plansError.textContent = error.message;
      elements.plansError.hidden = false;
    } finally {
      elements.plansLoading.hidden = true;
    }
  }

  function renderPlans(plans) {
    elements.plansContainer.replaceChildren();

    for (const plan of plans) {
      const card = document.createElement('article');
      card.className = `plan-card ${plan.badge ? 'featured' : ''}`.trim();

      if (plan.badge) {
        const badge = document.createElement('span');
        badge.className = 'plan-badge';
        badge.textContent = plan.badge;
        card.append(badge);
      }

      const title = document.createElement('h3');
      title.textContent = plan.name;
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = formatMoney(plan.price);
      const suffix = document.createElement('small');
      suffix.textContent = plan.id === 'lifetime' ? ' uma vez' : '';
      price.append(suffix);
      const description = document.createElement('p');
      description.className = 'plan-description';
      description.textContent = plan.description;
      const button = document.createElement('button');
      button.className = 'buy-btn';
      button.type = 'button';
      button.textContent = 'Comprar via PIX';
      button.addEventListener('click', () => void startPayment(plan.id));
      card.append(title, price, description, button);
      elements.plansContainer.append(card);
    }
  }

  function validateBuyer() {
    const rawPhone = elements.userPhone.value.trim();
    const digits = rawPhone.replace(/\D/g, '');
    const userPhone = /^55\d{10,11}$/.test(digits)
      ? `+${digits}`
      : /^\d{10,11}$/.test(digits)
        ? `+55${digits}`
        : '';
    const userName = elements.buyerName.value.trim();
    if (!userPhone) {
      throw new Error('Informe um WhatsApp válido com DDD');
    }
    return { userPhone, userName };
  }

  async function startPayment(planId) {
    try {
      const buyer = validateBuyer();
      setLoading(true, 'Gerando seu PIX...');
      const response = await sendMessage('createPayment', { planId, ...buyer });
      if (response.success !== true || !response.data) {
        throw new Error(response.error || response.msg || 'Erro ao gerar pagamento');
      }
      showPaymentScreen(response.data);
      startPaymentPolling(response.data.paymentId);
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  function showPaymentScreen(data) {
    state.paymentId = data.paymentId;
    state.paymentReferenceCode = data.referenceCode || '';
    state.paymentAmount = Number(data.amount) || null;
    elements.plansContainer.hidden = true;
    elements.plansLoading.hidden = true;
    elements.activationSection.hidden = true;
    elements.paymentScreen.hidden = false;
    if (data.qrCodeBase64) elements.qrCode.src = data.qrCodeBase64;
    elements.pixCode.textContent = data.qrCode || '';
    elements.amountDisplay.textContent = data.amount ? formatMoney(data.amount) : '';
    elements.paymentReference.textContent = data.referenceCode || '—';
    elements.paymentStatus.textContent = '⏳ Aguardando pagamento...';
    elements.licenseRelease.hidden = true;
  }

  async function resumePayment(paymentId) {
    try {
      const data = await sendMessage('checkPayment', { paymentId });
      if (data.status === 'paid') {
        showPaymentScreen(data);
        handlePaidPayment(data);
      } else if (data.status === 'pending' && data.qrCodeBase64) {
        showPaymentScreen(data);
        startPaymentPolling(paymentId);
      }
    } catch (_error) {
      // Um checkout antigo não deve impedir a compra de um novo plano.
    }
  }

  function stopPaymentPolling() {
    if (state.pollingTimer) clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }

  function startPaymentPolling(paymentId) {
    stopPaymentPolling();
    state.paymentId = paymentId;
    state.pollingAttempts = 0;
    state.pollingTimer = setInterval(() => void checkPaymentStatus(), 5000);
  }

  async function checkPaymentStatus() {
    if (!state.paymentId) return;
    state.pollingAttempts += 1;

    try {
      const data = await sendMessage('checkPayment', {
        paymentId: state.paymentId,
      });

      if (data.status === 'paid') {
        handlePaidPayment(data);
        return;
      }
      if (['expired', 'failed'].includes(data.status)) {
        stopPaymentPolling();
        elements.paymentStatus.textContent = '❌ Pagamento expirado. Gere um novo PIX.';
        return;
      }
      if (state.pollingAttempts >= 60) {
        stopPaymentPolling();
        elements.paymentStatus.textContent = '⏳ Ainda aguardando. Use “Verificar pagamento”.';
      }
    } catch (error) {
      console.error('Erro ao verificar pagamento:', error);
    }
  }

  function handlePaidPayment(data) {
    stopPaymentPolling();
    state.releasedLicenseKey = data.licenseKey;
    elements.paymentStatus.textContent = '✅ Pagamento confirmado!';
    elements.paymentStatus.style.color = 'var(--accent)';
    elements.licenseKeyFinal.textContent = data.licenseKey;
    elements.licenseRelease.hidden = false;
    showToast('🎉 Pagamento aprovado! Sua licença foi liberada.');
  }

  async function activate(key) {
    const licenseKey = String(key || '').trim().toUpperCase();
    if (!licenseKey) throw new Error('Informe sua chave de licença');

    const response = await sendMessage('activateLicense', { licenseKey });
    if (response.success !== true) {
      throw new Error(response.error || response.msg || 'Não foi possível ativar');
    }

    const data = response.data;
    Object.assign(state, {
      licenseKey,
      keyValid: true,
      user: data.user || 'Usuário',
      validade: data.validade ?? null,
      plan: data.plan || '',
      enabled: true,
    });
    stopPaymentPolling();
    updateViews();
    showToast('✅ Licença ativada com sucesso!');
  }

  async function copyText(text, successMessage) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  }

  async function updateSetting(action, data, key, value) {
    const previous = state[key];
    state[key] = value;
    updateViews();
    try {
      const response = await sendMessage(action, data);
      if (response.success !== true) throw new Error(response.msg || 'Erro ao salvar');
    } catch (error) {
      state[key] = previous;
      updateViews();
      showToast(error.message);
    }
  }

  elements.manualActivateButton.addEventListener('click', async () => {
    showActivationMessage('Validando licença...');
    try {
      await activate(elements.manualKeyInput.value);
      showActivationMessage('✅ Licença ativada!', 'success');
    } catch (error) {
      showActivationMessage(`❌ ${error.message}`, 'error');
    }
  });

  elements.manualKeyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.manualActivateButton.click();
  });
  elements.manualCheck.addEventListener('click', () => void checkPaymentStatus());
  elements.sendReceipt.addEventListener('click', () => openSupportWhatsApp(true));
  elements.supportWhatsApp.addEventListener('click', () => openSupportWhatsApp(false));
  elements.copyPix.addEventListener('click', () =>
    void copyText(elements.pixCode.textContent, 'Código PIX copiado!'),
  );
  elements.copyLicense.addEventListener('click', () =>
    void copyText(state.releasedLicenseKey, 'Licença copiada!'),
  );
  elements.activateButton.addEventListener('click', async () => {
    try {
      setLoading(true, 'Ativando licença...');
      await activate(state.releasedLicenseKey);
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(false);
    }
  });
  elements.paymentBack.addEventListener('click', () => {
    stopPaymentPolling();
    elements.paymentScreen.hidden = true;
    elements.plansContainer.hidden = false;
    elements.activationSection.hidden = false;
  });
  elements.enabled.addEventListener('change', () =>
    void updateSetting('setEnabled', { value: elements.enabled.checked }, 'enabled', elements.enabled.checked),
  );
  elements.mode1.addEventListener('change', () => {
    if (elements.mode1.checked) void updateSetting('setMode', { mode: '1' }, 'mode', '1');
  });
  elements.mode2.addEventListener('change', () => {
    if (elements.mode2.checked) void updateSetting('setMode', { mode: '2' }, 'mode', '2');
  });
  elements.showValidity.addEventListener('change', () =>
    void updateSetting(
      'setShowValidity',
      { value: elements.showValidity.checked },
      'showValidity',
      elements.showValidity.checked,
    ),
  );
  elements.logoutButton.addEventListener('click', async () => {
    if (!confirm('Deseja sair e remover a licença deste navegador?')) return;
    const response = await sendMessage('logout');
    if (response.success) {
      Object.assign(state, {
        licenseKey: '',
        keyValid: false,
        user: '',
        validade: null,
        enabled: false,
      });
      updateViews();
      await loadPlans();
    }
  });

  const savedTheme = localStorage.getItem('easy_easy_theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  elements.themeButton.textContent = savedTheme === 'dark' ? '☾' : '☀';
  elements.themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('easy_easy_theme', next);
    elements.themeButton.textContent = next === 'dark' ? '☾' : '☀';
  });

  state.countdownTimer = setInterval(updateCountdown, 1000);
  window.addEventListener('unload', () => {
    stopPaymentPolling();
    clearInterval(state.countdownTimer);
    clearTimeout(toastTimer);
  });

  void loadConfig();
});
