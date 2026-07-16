'use strict';

const elements = {
  login: document.getElementById('login'),
  dashboard: document.getElementById('dashboard'),
  adminKey: document.getElementById('admin-key'),
  enter: document.getElementById('enter'),
  logout: document.getElementById('logout'),
  loginMessage: document.getElementById('login-message'),
  statusFilter: document.getElementById('status-filter'),
  refresh: document.getElementById('refresh'),
  loading: document.getElementById('loading'),
  empty: document.getElementById('empty'),
  payments: document.getElementById('payments'),
  updatedAt: document.getElementById('updated-at'),
  approvalDialog: document.getElementById('approval-dialog'),
  approvalStatus: document.getElementById('approval-status'),
  approvedKey: document.getElementById('approved-key'),
  copyApprovedKey: document.getElementById('copy-approved-key'),
  closeApprovalDialog: document.getElementById('close-approval-dialog'),
};

let adminKey = '';
let refreshTimer = null;
let countdownTimer = null;

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status) {
  return {
    pending: 'Pendente',
    paid: 'Pago',
    expired: 'Expirado',
    failed: 'Falhou',
    refunded: 'Reembolsado',
  }[status] || status;
}

function durationLabel(payment) {
  if (payment.plan === 'lifetime') return 'Vitalício';
  if (!Number.isFinite(payment.durationDays)) return 'Não informada';
  if (payment.durationDays === 1) return '24 horas';
  return `${payment.durationDays} dias`;
}

function countdownLabel(expiresAt) {
  if (!expiresAt) return 'Sem expiração';
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Expirada';

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return days > 0 ? `${days}d ${clock}` : clock;
}

function updateCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach((element) => {
    element.textContent = countdownLabel(element.dataset.countdown);
  });
}

function whatsAppDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function writeLicenseKey(licenseKey) {
  try {
    await navigator.clipboard.writeText(licenseKey);
    return true;
  } catch (error) {
    console.warn('Não foi possível copiar automaticamente:', error);
    return false;
  }
}

async function copyLicenseKey(licenseKey, button) {
  const copied = await writeLicenseKey(licenseKey);
  if (!copied) {
    alert('O navegador bloqueou a cópia. Selecione a chave e copie manualmente.');
    return false;
  }
  const original = button.textContent;
  button.textContent = 'Chave copiada!';
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
  return true;
}

function showApprovalDialog(licenseKey, copied) {
  elements.approvedKey.textContent = licenseKey;
  elements.approvalStatus.textContent = copied
    ? 'A chave foi copiada automaticamente.'
    : 'O navegador não permitiu a cópia automática. Use o botão abaixo.';
  if (!elements.approvalDialog.open) elements.approvalDialog.showModal();
}

function sendLicenseByWhatsApp(payment) {
  const phone = whatsAppDigits(payment.userPhone);
  if (!phone || !payment.licenseKey) return;
  const message = [
    `Olá${payment.userName ? `, ${payment.userName}` : ''}! Seu pagamento EASY&EASY foi confirmado.`,
    `Chave da licença: ${payment.licenseKey}`,
    `Plano: ${payment.planName || payment.plan}`,
    payment.plan === 'lifetime'
      ? 'Validade: vitalícia'
      : payment.expiresAt
        ? `Validade: ${formatDate(payment.expiresAt)}`
        : 'O prazo começa na primeira ativação.',
  ].join('\n');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-Admin-Key': adminKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a operação');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = '') {
  adminKey = '';
  clearInterval(refreshTimer);
  refreshTimer = null;
  clearInterval(countdownTimer);
  countdownTimer = null;
  elements.login.hidden = false;
  elements.dashboard.hidden = true;
  elements.logout.hidden = true;
  elements.loginMessage.textContent = message;
  elements.adminKey.value = '';
  elements.adminKey.focus();
}

function renderPayments(payments) {
  elements.payments.replaceChildren();
  elements.empty.hidden = payments.length !== 0;

  for (const payment of payments) {
    const card = document.createElement('article');
    card.className = 'payment-card';

    const top = document.createElement('div');
    top.className = 'payment-top';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = payment.userName || 'Cliente sem nome';
    const contact = document.createElement('span');
    contact.textContent = payment.userPhone || payment.userEmail || 'WhatsApp não informado';
    identity.append(name, contact);
    const badge = document.createElement('span');
    badge.className = `status status-${payment.status}`;
    badge.textContent = statusLabel(payment.status);
    top.append(identity, badge);

    const details = document.createElement('dl');
    const countdown = document.createElement('span');
    if (payment.status === 'paid') {
      if (payment.expiresAt) {
        countdown.dataset.countdown = payment.expiresAt;
        countdown.textContent = countdownLabel(payment.expiresAt);
      } else if (payment.plan === 'lifetime') {
        countdown.textContent = 'Vitalícia';
      } else {
        countdown.textContent = 'Começa na primeira ativação';
      }
    } else {
      countdown.textContent = 'Começa na primeira ativação';
    }

    const rows = [
      ['Valor', formatMoney(payment.amount)],
      ['Plano', payment.planName || payment.plan],
      ['Duração contratada', durationLabel(payment)],
      ['Tempo restante', countdown],
      ...(payment.status === 'pending' && payment.paymentExpiresAt
        ? [['Solicitação expira em', (() => {
          const requestCountdown = document.createElement('span');
          requestCountdown.dataset.countdown = payment.paymentExpiresAt;
          requestCountdown.textContent = countdownLabel(payment.paymentExpiresAt);
          return requestCountdown;
        })()]]
        : []),
      ...(payment.paidAt ? [['Aprovado em', formatDate(payment.paidAt)]] : []),
      ...(payment.expiresAt ? [['Válida até', formatDate(payment.expiresAt)]] : []),
      ...(payment.licenseKey ? [['Chave da licença', payment.licenseKey]] : []),
      ['Criado em', formatDate(payment.createdAt)],
      ['Identificador', payment.referenceCode || '—'],
      ['Pagamento', payment.paymentId],
    ];
    for (const [label, value] of rows) {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      if (value instanceof Node) description.append(value);
      else description.textContent = value;
      wrapper.append(term, description);
      details.append(wrapper);
    }

    card.append(top, details);
    if (payment.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'pending-actions';
      const approve = document.createElement('button');
      approve.className = 'primary approve';
      approve.type = 'button';
      approve.textContent = 'Confirmar recebimento e liberar licença';
      approve.addEventListener('click', () => void approvePayment(payment, approve));
      const expire = document.createElement('button');
      expire.className = 'danger';
      expire.type = 'button';
      expire.textContent = 'Encerrar solicitação';
      expire.addEventListener('click', () => void expirePayment(payment, expire));
      actions.append(approve, expire);
      card.append(actions);
    } else if (payment.status === 'expired') {
      const lateApproval = document.createElement('button');
      lateApproval.className = 'secondary approve';
      lateApproval.type = 'button';
      lateApproval.textContent = 'Confirmar pagamento mesmo assim';
      lateApproval.addEventListener('click', () => void approvePayment(payment, lateApproval));
      card.append(lateApproval);
    } else if (payment.status === 'paid' && payment.licenseKey) {
      const actions = document.createElement('div');
      actions.className = 'payment-actions';

      const copy = document.createElement('button');
      copy.className = 'secondary';
      copy.type = 'button';
      copy.textContent = 'Copiar chave';
      copy.addEventListener('click', () => void copyLicenseKey(payment.licenseKey, copy));
      actions.append(copy);

      if (whatsAppDigits(payment.userPhone)) {
        const whatsApp = document.createElement('button');
        whatsApp.className = 'primary';
        whatsApp.type = 'button';
        whatsApp.textContent = 'Enviar pelo WhatsApp';
        whatsApp.addEventListener('click', () => sendLicenseByWhatsApp(payment));
        actions.append(whatsApp);
      }
      card.append(actions);
    }
    elements.payments.append(card);
  }
  updateCountdowns();
}

async function loadPayments() {
  elements.loading.hidden = false;
  elements.refresh.disabled = true;
  try {
    const status = elements.statusFilter.value;
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const response = await adminRequest(`/api/admin/payments${query}`);
    renderPayments(response.data || []);
    elements.updatedAt.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
  } catch (error) {
    if (error.status === 401) {
      showLogin('Chave administrativa inválida.');
      return;
    }
    elements.empty.hidden = false;
    elements.empty.textContent = error.message;
  } finally {
    elements.loading.hidden = true;
    elements.refresh.disabled = false;
  }
}

async function approvePayment(payment, button) {
  const confirmed = confirm(
    `Você conferiu no banco o PIX de ${formatMoney(payment.amount)}?\n\n` +
      'A chave será liberada imediatamente. O prazo começará somente na primeira ativação.',
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Liberando...';
  try {
    const response = await adminRequest(`/api/admin/payments/${payment.paymentId}/approve`, {
      method: 'POST',
    });
    const licenseKey = response.data?.licenseKey;
    const copied = licenseKey ? await writeLicenseKey(licenseKey) : false;
    await loadPayments();
    if (licenseKey) showApprovalDialog(licenseKey, copied);
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Confirmar recebimento e liberar licença';
  }
}

async function expirePayment(payment, button) {
  const confirmed = confirm(
    `Encerrar a solicitação ${payment.referenceCode || payment.paymentId}?\n\n` +
      'Ela sairá dos pendentes e continuará disponível em Expirados.',
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Encerrando...';
  try {
    await adminRequest(`/api/admin/payments/${payment.paymentId}/expire`, {
      method: 'POST',
    });
    await loadPayments();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Encerrar solicitação';
  }
}

async function enterDashboard() {
  adminKey = elements.adminKey.value.trim();
  if (!adminKey) {
    elements.loginMessage.textContent = 'Digite sua chave administrativa.';
    return;
  }

  elements.enter.disabled = true;
  elements.loginMessage.textContent = 'Verificando...';
  try {
    await loadPayments();
    if (!adminKey) return;
    elements.login.hidden = true;
    elements.dashboard.hidden = false;
    elements.logout.hidden = false;
    elements.loginMessage.textContent = '';
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void loadPayments(), 20000);
    clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdowns, 1000);
  } finally {
    elements.enter.disabled = false;
  }
}

elements.enter.addEventListener('click', () => void enterDashboard());
elements.adminKey.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void enterDashboard();
});
elements.logout.addEventListener('click', () => showLogin());
elements.refresh.addEventListener('click', () => void loadPayments());
elements.statusFilter.addEventListener('change', () => void loadPayments());
elements.copyApprovedKey.addEventListener('click', () => {
  void copyLicenseKey(elements.approvedKey.textContent, elements.copyApprovedKey);
});
elements.closeApprovalDialog.addEventListener('click', () => elements.approvalDialog.close());
window.addEventListener('pagehide', () => {
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);
});
