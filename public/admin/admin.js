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
};

let adminKey = '';
let refreshTimer = null;

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
    const email = document.createElement('span');
    email.textContent = payment.userEmail || 'E-mail não informado';
    identity.append(name, email);
    const badge = document.createElement('span');
    badge.className = `status status-${payment.status}`;
    badge.textContent = statusLabel(payment.status);
    top.append(identity, badge);

    const details = document.createElement('dl');
    const rows = [
      ['Valor', formatMoney(payment.amount)],
      ['Plano', payment.plan],
      ['Criado em', formatDate(payment.createdAt)],
      ['Identificador', payment.referenceCode || '—'],
      ['Pagamento', payment.paymentId],
    ];
    for (const [label, value] of rows) {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      wrapper.append(term, description);
      details.append(wrapper);
    }

    card.append(top, details);
    if (payment.status === 'pending') {
      const approve = document.createElement('button');
      approve.className = 'primary approve';
      approve.type = 'button';
      approve.textContent = 'Confirmar recebimento e liberar licença';
      approve.addEventListener('click', () => void approvePayment(payment, approve));
      card.append(approve);
    }
    elements.payments.append(card);
  }
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
      'A licença será liberada imediatamente e esta ação não deve ser usada antes do recebimento.',
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Liberando...';
  try {
    await adminRequest(`/api/admin/payments/${payment.paymentId}/approve`, {
      method: 'POST',
    });
    await loadPayments();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Confirmar recebimento e liberar licença';
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
window.addEventListener('pagehide', () => clearInterval(refreshTimer));
