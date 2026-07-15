# EASY&EASY — API de pagamentos e licenças

Backend Node.js/Express para vender a extensão via PIX, confirmar pagamentos pelo Mercado Pago e controlar licenças/dispositivos no Supabase.

## Configuração local

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Copie `.env.example` para `.env`.
4. Preencha `SUPABASE_URL` e `SUPABASE_SECRET_KEY` com a chave secreta do servidor (`sb_secret_...`) ou a `service_role` legada.
5. Para testes, mantenha `PAYMENT_PROVIDER=mock`.
6. Execute `npm install`, `npm test` e `npm start`.

O servidor inicia em `http://localhost:4000`. Verifique com `GET /health`.

## Teste completo sem cobrar PIX real

Crie um pagamento pela extensão. Com o UUID retornado no campo `paymentId`, aprove-o manualmente:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/dev/payments/UUID_DO_CHECKOUT/approve"
```

Essa rota só existe quando:

- `NODE_ENV` não é `production`;
- `PAYMENT_PROVIDER=mock`;
- `ALLOW_MOCK_PAYMENT_APPROVAL=true`.

## Mercado Pago real

Configure:

```env
NODE_ENV=production
PAYMENT_PROVIDER=mercado_pago
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
MERCADO_PAGO_WEBHOOK_SECRET=...
BASE_URL=https://seu-servico.onrender.com
ALLOW_ANY_EXTENSION_ORIGIN=false
ALLOWED_EXTENSION_IDS=id_da_extensao
```

No painel do Mercado Pago, cadastre o webhook de pagamentos em:

```text
https://seu-servico.onrender.com/api/webhook/pix
```

Use credenciais de teste antes de ativar produção. O servidor valida a assinatura do webhook e consulta o pagamento diretamente no Mercado Pago antes de liberar a licença.

## Deploy no Render

- O repositório inclui `render.yaml`; crie um Blueprint no Render apontando para o repositório.
- Runtime: Node; build: `npm ci`; start: `npm start`; health check: `/health`.
- Preencha no painel os valores marcados com `sync: false`; nunca envie `.env` ao Git.
- Use `.env.production.example` como checklist das variáveis de produção.

O `background.js` da extensão já usa `https://easy-easy-server.onrender.com` por padrão. Para desenvolvimento local, grave `http://localhost:4000` em `apiBaseUrl` no `chrome.storage.local`. O manifesto autoriza ambas as origens.

A Public Key do Mercado Pago é normalmente destinada ao frontend. O fluxo PIX atual é criado integralmente pelo backend e exige o Access Token e a assinatura secreta do webhook.

## Segurança aplicada

- Chave secreta do Supabase apenas no backend.
- RLS ativado e acesso de `anon`/`authenticated` revogado nas tabelas.
- Operações críticas atômicas em funções SQL com bloqueio de linha.
- Webhook assinado e reconciliado com a API do Mercado Pago.
- Chave de licença revelada somente após pagamento confirmado.
- Limite de dispositivos verificado no banco.
- CORS restrito aos IDs configurados da extensão em produção.
- Rate limiting e validação de entrada em todos os endpoints sensíveis.

## Endpoints

- `GET /api/plans`
- `POST /api/create-payment`
- `GET /api/check-payment/:paymentId`
- `POST /api/activate`
- `POST /api/validate`
- `GET /api/my-license`
- `POST /api/webhook/pix`
- `POST /api/login` (compatibilidade)
