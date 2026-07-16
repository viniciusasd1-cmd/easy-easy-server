'use strict';

const express = require('express');
const path = require('node:path');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { timingSafeEqual } = require('node:crypto');
const { config, validateConfig } = require('./src/config');
const { PLANS } = require('./src/plans');
const { PaymentProvider } = require('./src/payment-provider');
const { LicenseService } = require('./src/license-service');

validateConfig();

const paymentProvider = new PaymentProvider();
const licenseService = new LicenseService(paymentProvider);
const app = express();
const appOrigin = new URL(config.baseUrl).origin;

function corsRejection(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function isExtensionPublicApi(pathname) {
  return [
    '/api/plans',
    '/api/create-payment',
    '/api/activate',
    '/api/validate',
    '/api/login',
    '/api/my-license',
  ].includes(pathname) || pathname.startsWith('/api/check-payment/');
}

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin === appOrigin) return callback(null, true);
      if (/^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      if (origin.startsWith('chrome-extension://')) {
        const validExtensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
        const allowed = validExtensionOrigin && isExtensionPublicApi(req.path);
        return callback(
          allowed ? null : corsRejection('Extensão não autorizada para esta rota'),
          allowed,
        );
      }
      return callback(corsRejection('Origem não autorizada'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-License-Key',
      'X-Device-Id',
      'X-Request-Id',
      'X-Signature',
      'X-Admin-Key',
      'Authorization',
    ],
  })(req, res, next);
});
app.use(express.json({ limit: '100kb' }));

if (!config.isProduction) {
  app.use((req, _res, next) => {
    console.log(`➡️  ${req.method} ${req.originalUrl}`);
    next();
  });
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function requireManualApprovalSecret(req, res, next) {
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = req.get('x-admin-key') || bearer || '';
  const expected = config.manualApprovalSecret;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const valid =
    providedBuffer.length === expectedBuffer.length &&
    providedBuffer.length > 0 &&
    timingSafeEqual(providedBuffer, expectedBuffer);

  if (!valid) {
    return res.status(401).json({
      success: false,
      error: 'Credencial administrativa inválida',
    });
  }
  return next();
}

function normalizeBrazilianPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(digits)) return `+${digits}`;
  if (/^\d{10,11}$/.test(digits)) return `+55${digits}`;
  return String(value || '').trim();
}

const paymentSchema = z.object({
  planId: z.enum(['daily', 'weekly', 'fortnightly', 'monthly', 'annual', 'lifetime']),
  userPhone: z
    .string()
    .trim()
    .max(24)
    .transform(normalizeBrazilianPhone)
    .refine((value) => /^\+55\d{10,11}$/.test(value), 'Informe um WhatsApp válido com DDD'),
  userName: z.string().trim().max(80).optional().default(''),
});
const licenseSchema = z.object({
  licenseKey: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^EASY-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/, 'Formato de chave inválido'),
  deviceId: z.string().trim().min(8).max(128),
  userAgent: z.string().max(500).optional().default(''),
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'easy-easy-license-server',
    paymentProvider: config.paymentProvider,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/plans', (_req, res) => {
  res.json({ plans: PLANS });
});

app.use(
  '/admin',
  express.static(path.join(__dirname, 'public', 'admin'), {
    dotfiles: 'deny',
    index: 'index.html',
    redirect: true,
  }),
);

console.log('📋 Registrando rota: POST /api/create-payment');
app.post(
  '/api/create-payment',
  paymentLimiter,
  (_req, _res, next) => {
    console.log('🔍 PaymentLimiter passou');
    next();
  },
  async (req, res, next) => {
    console.log('📥 POST /api/create-payment recebido');
    console.log('📦 Body:', req.body);

    try {
      const input = paymentSchema.parse(req.body);
      console.log('✅ Schema validado:', {
        planId: input.planId,
        userPhone: input.userPhone,
        userName: input.userName,
      });

      const data = await licenseService.createPayment(input);
      console.log('✅ Pagamento criado:', {
        paymentId: data.paymentId,
        plan: data.plan,
        status: data.status,
      });

      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error('❌ Erro em /api/create-payment:', error.message);
      console.error('❌ Stack:', error.stack);
      return next(error);
    }
  },
);

app.get(
  '/api/check-payment/:paymentId',
  asyncRoute(async (req, res) => {
    const paymentId = z.uuid().parse(req.params.paymentId);
    const data = await licenseService.getPaymentStatus(paymentId);
    res.json(data);
  }),
);

app.post(
  '/api/activate',
  asyncRoute(async (req, res) => {
    const input = licenseSchema.parse(req.body);
    const data = await licenseService.activate(input);
    res.json(data);
  }),
);

app.post(
  '/api/validate',
  asyncRoute(async (req, res) => {
    const input = licenseSchema.parse(req.body);
    const data = await licenseService.activate(input);
    res.json(data);
  }),
);

// Compatibilidade com versões anteriores da extensão.
app.post(
  '/api/login',
  asyncRoute(async (req, res) => {
    const input = licenseSchema.parse({
      licenseKey: req.body.licenseKey || req.body.key,
      deviceId: req.body.deviceId || req.body.deviceid,
      userAgent: req.body.userAgent || req.get('user-agent') || '',
    });
    const data = await licenseService.activate(input);
    res.json(data);
  }),
);

app.get(
  '/api/my-license',
  asyncRoute(async (req, res) => {
    const input = licenseSchema.parse({
      licenseKey: req.get('x-license-key'),
      deviceId: req.get('x-device-id'),
      userAgent: req.get('user-agent') || '',
    });
    const data = await licenseService.getMyLicense(input);
    res.json(data);
  }),
);

app.post(
  '/api/webhook/pix',
  asyncRoute(async (req, res) => {
    const dataId = req.query['data.id'] || req.body?.data?.id;
    if (!dataId) return res.status(200).json({ received: true });

    paymentProvider.validateWebhook({
      xSignature: req.get('x-signature'),
      xRequestId: req.get('x-request-id'),
      dataId,
    });

    await licenseService.syncProviderPayment(String(dataId));
    return res.status(200).json({ received: true });
  }),
);

if (config.paymentProvider === 'manual_pix') {
  app.get(
    '/api/admin/payments',
    adminLimiter,
    requireManualApprovalSecret,
    asyncRoute(async (req, res) => {
      const status = z
        .enum(['pending', 'paid', 'expired', 'failed', 'refunded'])
        .optional()
        .parse(req.query.status || undefined);
      const data = await licenseService.listAdminPayments(status);
      res.json({ success: true, data });
    }),
  );

  app.post(
    '/api/admin/payments/:paymentId/approve',
    adminLimiter,
    requireManualApprovalSecret,
    asyncRoute(async (req, res) => {
      const paymentId = z.uuid().parse(req.params.paymentId);
      const data = await licenseService.approveManualPayment(paymentId);
      res.json({
        success: true,
        message: 'Pagamento confirmado e licença liberada',
        data,
      });
    }),
  );

  app.post(
    '/api/admin/payments/:paymentId/expire',
    adminLimiter,
    requireManualApprovalSecret,
    asyncRoute(async (req, res) => {
      const paymentId = z.uuid().parse(req.params.paymentId);
      const data = await licenseService.expireManualPayment(paymentId);
      res.json({
        success: true,
        message: 'Solicitação encerrada',
        data,
      });
    }),
  );
}

if (
  config.paymentProvider === 'mock' &&
  config.allowMockPaymentApproval &&
  !config.isProduction
) {
  app.post(
    '/api/dev/payments/:paymentId/approve',
    asyncRoute(async (req, res) => {
      const paymentId = z.uuid().parse(req.params.paymentId);
      const data = await licenseService.approveMockPayment(paymentId);
      res.json({ success: true, data });
    }),
  );
}

if (!config.isProduction) {
  app.get('/api/routes', (_req, res) => {
    const router = app.router || app._router;
    const routes = (router?.stack || [])
      .filter((layer) => layer.route)
      .flatMap((layer) =>
        Object.keys(layer.route.methods).map((method) => ({
          path: layer.route.path,
          methods: [method.toUpperCase()],
        })),
      );

    res.json({ routes });
  });
}

app.use((req, res) => {
  console.warn(`⚠️ Endpoint não encontrado: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado',
    ...(config.isProduction
      ? {}
      : {
          method: req.method,
          path: req.originalUrl,
          routesUrl: '/api/routes',
        }),
  });
});

app.use((error, req, res, _next) => {
  if (error instanceof z.ZodError) {
    console.error(`❌ Validação rejeitada em ${req.method} ${req.originalUrl}:`, error.issues);
    return res.status(400).json({
      success: false,
      error: error.issues[0]?.message || 'Dados inválidos',
      details: error.issues,
    });
  }

  console.error(`❌ Erro da API em ${req.method} ${req.originalUrl}:`, error);
  const statusCode = error.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    error: statusCode >= 500 ? 'Erro interno do servidor' : error.message,
    code: error.code || undefined,
    ...(!config.isProduction && error.message
      ? { details: error.message }
      : {}),
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`🚀 EASY&EASY API em ${config.baseUrl}`);
    console.log(`💳 Provedor de pagamento: ${config.paymentProvider}`);
  });
}

module.exports = { app };
