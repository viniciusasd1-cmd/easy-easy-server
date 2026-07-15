# EASY&EASY — API de pagamentos e licenças

Backend Node.js/Express para vender a extensão via PIX, registrar pagamentos e controlar licenças e dispositivos no Supabase.

## Configuração local

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Copie `.env.example` para `.env`.
4. Preencha `SUPABASE_URL` e `SUPABASE_SECRET_KEY` com a chave secreta do servidor (`sb_secret_...`) ou a `service_role` legada.
5. Para testes, mantenha `PAYMENT_PROVIDER=mock`.
6. Execute `npm install`, `npm test` e `npm start`.

O servidor inicia em `http://localhost:4000`. Verifique com `GET /health`.

## PIX manual para produção

O modo `manual_pix` gera o payload PIX copia e cola e o QR Code no próprio servidor, sem Mercado Pago ou outro gateway. Depois de conferir o recebimento no aplicativo do banco, o administrador confirma o pagamento usando um segredo privado. A licença só é revelada após essa confirmação.

Antes do primeiro deploy em um banco já existente, execute no SQL Editor do Supabase:

```text
supabase/enable-manual-pix-provider.sql
```

Configure no Render:

```env
NODE_ENV=production
PAYMENT_PROVIDER=manual_pix
PIX_KEY=sua-chave-pix
PIX_MERCHANT_NAME=EASY EASY
PIX_MERCHANT_CITY=SAO PAULO
PIX_DESCRIPTION=LICENCA EASY EASY
MANUAL_APPROVAL_SECRET=um-segredo-aleatorio-com-pelo-menos-32-caracteres
ALLOW_ANY_EXTENSION_ORIGIN=false
ALLOWED_EXTENSION_IDS=id_da_extensao
```

`PIX_MERCHANT_NAME` aceita até 25 caracteres e `PIX_MERCHANT_CITY` até 15. A chave PIX e o segredo administrativo nunca devem ser enviados ao GitHub ou incluídos na extensão.

### Confirmar um pagamento recebido

Use o UUID retornado pela API no campo `paymentId`. No PowerShell:

```powershell
$headers = @{ 'X-Admin-Key' = 'SEU_SEGREDO_ADMINISTRATIVO' }
Invoke-RestMethod `
  -Method Post `
  -Uri 'https://easy-easy-server.onrender.com/api/admin/payments/UUID_DO_PAGAMENTO/approve' `
  -Headers $headers
```

A confirmação é idempotente: repetir a aprovação de um pagamento já confirmado retorna a licença existente, sem criar outra cobrança.

## Teste completo sem cobrar PIX real

Com `PAYMENT_PROVIDER=mock`, crie um pagamento e aprove o UUID retornado:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/api/dev/payments/UUID_DO_PAGAMENTO/approve'
```

Essa rota só existe fora de produção quando `ALLOW_MOCK_PAYMENT_APPROVAL=true`.

## Mercado Pago opcional

O provedor anterior continua disponível. Para utilizá-lo, configure `PAYMENT_PROVIDER=mercado_pago`, `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET`. O webhook é `POST /api/webhook/pix`.

## Deploy no Render

- O repositório inclui `render.yaml`; crie um Blueprint no Render apontando para o repositório.
- Runtime: Node; build: `npm ci`; start: `npm start`; health check: `/health`.
- Preencha no painel os valores marcados com `sync: false`; nunca envie `.env` ao Git.
- Use `.env.production.example` como checklist.

O `background.js` da extensão usa `https://easy-easy-server.onrender.com` por padrão. Para desenvolvimento local, grave `http://localhost:4000` em `apiBaseUrl` no `chrome.storage.local`.

## Segurança aplicada

- Chave secreta do Supabase apenas no backend.
- RLS ativado e acesso de `anon` e `authenticated` revogado nas tabelas.
- Confirmação do pagamento e validade da licença atualizadas atomicamente no banco.
- Aprovação manual protegida por segredo de no mínimo 32 caracteres e comparação resistente a timing attacks.
- Rate limiting no endpoint administrativo.
- Chave de licença revelada somente após pagamento confirmado.
- Limite de dispositivos verificado no banco.
- CORS restrito aos IDs configurados da extensão em produção.

## Endpoints

- `GET /api/plans`
- `POST /api/create-payment`
- `GET /api/check-payment/:paymentId`
- `POST /api/admin/payments/:paymentId/approve` — somente `manual_pix`
- `POST /api/activate`
- `POST /api/validate`
- `GET /api/my-license`
- `POST /api/webhook/pix` — somente necessário para Mercado Pago
- `POST /api/login` — compatibilidade
