# Rentify Backend

Node.js + Express API for Rentify.

## Tech Stack

- Node.js (CommonJS)
- Express 5
- MongoDB (Mongoose)
- Redis
- Socket.IO
- JWT auth + refresh flow
- Stripe integrations (payments + billing webhooks)

## Getting Started

### 1) Prerequisites

- Node.js 20+
- MongoDB
- Redis (recommended for full feature parity)

### 2) Install

```bash
npm install
```

### 3) Environment

Create `.env` in the backend root.

Minimum required variables (server exits if missing):

```env
MONGO_URI=mongodb://localhost:27017/rentifypro
JWT_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me
```

Common local defaults:

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

## Run

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## API Health & Docs

- Health check: `GET /api/health`
- Swagger: `/api-docs` (available when `NODE_ENV !== production`)

## NPM Scripts

```bash
npm run dev
npm start
npm test
npm run test:watch
npm run test:coverage
npm run payments:dedupe
npm run payments:dedupe:apply
npm run seed:sara-properties
```

## Seeder: 25 Properties for Sara

Seeder script creates 25 listed properties for `sara@rentify.com`.

- Script: `scripts/seedSaraProperties.js`
- Command:

```bash
npm run seed:sara-properties
```

Behavior:

- Verifies `sara@rentify.com` exists
- Verifies user role is `landlord`
- Removes previous seeded Sara properties (titles prefixed with `Sara Seed Property`)
- Inserts exactly 25 fresh properties

## Listings Pagination

`GET /api/listings` supports true pagination:

- Query params: `page`, `limit`, and existing filters (`city`, `type`, `minRent`, `maxRent`)
- Paginated response shape:

```json
{
  "listings": [],
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 15,
    "pages": 0,
    "hasMore": false
  }
}
```

Backward compatibility:

- If `page`/`limit` are omitted, endpoint returns legacy array response.

## Docker

Build and run with compose:

```bash
docker compose up -d --build
```

Files:

- `Dockerfile`
- `docker-compose.yml`

## Deployment Notes

GitHub Actions workflow is in:

- `.github/workflows/ci.yml`

Production deploy flow includes:

- image build/restart
- health check
- Sara properties seeding (`npm run seed:sara-properties`)

## Project Structure (high-level)

- `controllers/` API handlers
- `routes/` route definitions
- `models/` Mongoose models
- `middlewares/` auth, rate limiting, etc.
- `utils/` shared services/helpers
- `scripts/` utility/seed scripts
- `__tests__/` test suites

## Notes

- Rate limiting is applied per route group.
- Stripe webhooks are mounted before JSON parser (raw body required).
- Sentry is initialized outside test mode only.
 
## Project Tree

```text
Rentify-Backend
│  ├─ .dockerignore
│  ├─ artillery
│  │  └─ load-test.yml
│  ├─ check-tokens.js
│  ├─ config
│  │  ├─ cloudinary.js
│  │  ├─ db.js
│  │  ├─ passport.js
│  │  ├─ redis.js
│  │  └─ swagger.js
│  ├─ controllers
│  │  ├─ adminController.js
│  │  ├─ agreementController.js
│  │  ├─ agreementTemplateController.js
│  │  ├─ authController.js
│  │  ├─ billingController.js
│  │  ├─ dataDeletionController.js
│  │  ├─ disputeController.js
│  │  ├─ listingController.js
│  │  ├─ maintenanceController.js
│  │  ├─ messageController.js
│  │  ├─ notificationController.js
│  │  ├─ offerController.js
│  │  ├─ paymentController.js
│  │  ├─ pdfThemeController.js
│  │  ├─ propertyController.js
│  │  ├─ supportController.js
│  │  └─ userController.js
│  ├─ docker-compose.yml
│  ├─ Dockerfile
│  ├─ fly.toml
│  ├─ middlewares
│  │  ├─ authMiddleware.js
│  │  ├─ rateLimiter.js
│  │  └─ recaptchaMiddleware.js
│  ├─ models
│  │  ├─ Agreement.js
│  │  ├─ AgreementTemplate.js
│  │  ├─ AuditTrail.js
│  │  ├─ Clause.js
│  │  ├─ Dispute.js
│  │  ├─ MaintenanceRequest.js
│  │  ├─ Message.js
│  │  ├─ NotificationLog.js
│  │  ├─ Offer.js
│  │  ├─ Payment.js
│  │  ├─ PdfTheme.js
│  │  ├─ PlatformSetting.js
│  │  ├─ Property.js
│  │  ├─ Reminder.js
│  │  └─ User.js
│  ├─ package-lock.json
│  ├─ package.json
│  ├─ queues
│  │  └─ notificationQueue.js
│  ├─ README.md
│  ├─ routes
│  │  ├─ adminRoutes.js
│  │  ├─ agreementRoutes.js
│  │  ├─ agreementTemplateRoutes.js
│  │  ├─ authRoutes.js
│  │  ├─ billingRoutes.js
│  │  ├─ dataDeletionRoutes.js
│  │  ├─ disputeRoutes.js
│  │  ├─ listingRoutes.js
│  │  ├─ maintenanceRoutes.js
│  │  ├─ messageRoutes.js
│  │  ├─ notificationRoutes.js
│  │  ├─ offerRoutes.js
│  │  ├─ paymentRoutes.js
│  │  ├─ pdfThemeRoutes.js
│  │  ├─ propertyRoutes.js
│  │  ├─ settingsRoutes.js
│  │  ├─ supportRoutes.js
│  │  ├─ uploadRoutes.js
│  │  └─ userRoutes.js
│  ├─ schedulers
│  │  └─ rentScheduler.js
│  ├─ scripts
│  │  ├─ dedupePayments.js
│  │  ├─ seedPdfThemes.js
│  │  └─ seedSaraProperties.js
│  ├─ server.js
│  ├─ test-push.js
│  ├─ test-results.txt
│  ├─ utils
│  │  ├─ clauseSubstitution.js
│  │  ├─ currencyService.js
│  │  ├─ emailService.js
│  │  ├─ firebaseService.js
│  │  ├─ generateToken.js
│  │  ├─ logger.js
│  │  ├─ pdfGenerator.js
│  │  ├─ platformSettings.js
│  │  ├─ s3Service.js
│  │  └─ smsService.js
│  ├─ workers
│  │  └─ notificationWorker.js
│  └─ __tests__
│     ├─ controllers
│     │  ├─ authController.test.js
│     │  ├─ disputeController.test.js
│     │  ├─ maintenanceController.test.js
│     │  └─ userController.test.js
│     ├─ middlewares
│     │  └─ authMiddleware.test.js
│     ├─ setup.js
│     └─ utils
│        ├─ clauseSubstitution.test.js
│        └─ generateToken.test.js
```