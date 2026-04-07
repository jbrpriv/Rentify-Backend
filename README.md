# Rentify Backend

Rentify Backend is the Node.js and Express API that powers the platform’s authentication, listings, agreements, payments, notifications, admin tools, and operational workflows.

## Overview

The API is responsible for:

- User authentication and session refresh flow
- Property listings, uploads, offers, agreements, disputes, and maintenance
- Rent payments, billing subscriptions, and Stripe webhooks
- Real-time notifications with Socket.IO
- Scheduled reminders and background notification jobs
- Branding, support, and data-deletion flows
- Admin operations, audit logging, and platform settings

## Tech Stack

- Node.js 20+ with CommonJS modules
- Express 5
- MongoDB with Mongoose
- Redis with BullMQ
- Socket.IO for live updates
- JWT access and refresh tokens
- Stripe for payments and billing
- Cloudinary for image uploads
- AWS S3 for document storage
- Twilio for SMS and OTP flows
- Firebase Admin SDK for push notifications
- Nodemailer for outbound email
- Sentry for production error monitoring

## Repository Layout

- `controllers/` route handlers and business logic
- `routes/` API route definitions
- `models/` MongoDB schemas
- `middlewares/` auth, rate limiting, and reCAPTCHA
- `config/` service setup for database, Redis, Cloudinary, Passport, and Swagger
- `utils/` shared services and helpers
- `queues/` BullMQ queue definitions
- `workers/` background job processors
- `schedulers/` cron-based jobs
- `scripts/` maintenance and seed scripts
- `__tests__/` unit and integration test suites
- `artillery/` load testing config

## Prerequisites

- Node.js 20 or newer
- MongoDB
- Redis if you want full notification/queue behavior
- Stripe account for payments and subscriptions
- Cloudinary account for property image uploads
- AWS S3 bucket for signed agreement and receipt storage
- Twilio account for SMS/OTP features
- Firebase project for push notifications

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file in `Rentify-Backend/`.

## Environment Variables

The backend validates a small core set on startup and then uses additional variables for optional services and feature modules.

### Core startup variables

These are required or the server exits immediately:

```env
MONGO_URI=mongodb://localhost:27017/rentifypro
JWT_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me
```

### Recommended local defaults

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:3000
SERVER_URL=http://localhost:5000
REDIS_URL=redis://localhost:6379
```

### Full environment reference

| Variable | Purpose | Required when |
| --- | --- | --- |
| `MONGO_URI` | MongoDB connection string | Always |
| `JWT_SECRET` | Access token signing secret | Always |
| `JWT_REFRESH_SECRET` | Refresh token signing secret | Always |
| `NODE_ENV` | Runtime mode | Optional |
| `PORT` | HTTP port | Optional; Fly.io sets this to `8080` |
| `CLIENT_URL` | Frontend origin used in CORS and links | Optional, but strongly recommended |
| `SERVER_URL` | Public backend origin used by OAuth callbacks | Optional, but recommended for OAuth |
| `REDIS_URL` | Redis connection string | Optional for boot, required for queue/worker reliability |
| `SENTRY_DSN` | Sentry DSN | Optional monitoring |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Google login |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Google login |
| `FACEBOOK_APP_ID` | Facebook OAuth app ID | Facebook login |
| `FACEBOOK_APP_SECRET` | Facebook OAuth app secret | Facebook login |
| `COOKIE_SECURE` | Forces secure auth cookies | Production cookie tuning |
| `COOKIE_SAMESITE` | Sets auth cookie SameSite behavior | Production cookie tuning |
| `STRIPE_SECRET_KEY` | Stripe secret key | Stripe payments, billing, Connect |
| `STRIPE_WEBHOOK_SECRET` | Stripe payments webhook secret | Rent payment webhook verification |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Stripe billing webhook secret | Subscription webhook verification |
| `STRIPE_PRICE_PRO` | Stripe price ID for Pro plan | Billing subscriptions |
| `STRIPE_PRICE_ENTERPRISE` | Stripe price ID for Enterprise plan | Billing subscriptions |
| `PLAN_PRICE_PRO_CENTS` | Pro fallback price in cents | Optional plan defaults |
| `PLAN_PRICE_ENTERPRISE_CENTS` | Enterprise fallback price in cents | Optional plan defaults |
| `STRIPE_CURRENCY` | Stripe currency code | Optional billing configuration |
| `RECAPTCHA_DISABLED` | Disables reCAPTCHA verification when `true` | Local dev / CI |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 secret | reCAPTCHA verification |
| `RECAPTCHA_MIN_SCORE` | reCAPTCHA minimum score | reCAPTCHA tuning |
| `EMAIL_SERVICE` | Nodemailer service name | Outbound email |
| `EMAIL_USER` | Email username | Outbound email |
| `EMAIL_PASS` | Email password or app password | Outbound email |
| `EMAIL_FROM` | Sender address | Optional email branding |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | Property image uploads |
| `CLOUDINARY_API_KEY` | Cloudinary API key | Property image uploads |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | Property image uploads |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Push notifications |
| `FIREBASE_PRIVATE_KEY` | Firebase private key | Push notifications |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | Push notifications |
| `AWS_ACCESS_KEY_ID` | AWS access key | Document storage |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | Document storage |
| `AWS_REGION` | AWS region | Document storage |
| `AWS_S3_BUCKET` | S3 bucket name | Document storage |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | SMS and OTP |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | SMS and OTP |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number | SMS delivery |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service SID | OTP delivery |
| `BRAND_NAME` | Custom platform brand name | Branding overrides |
| `SUPPORT_EMAIL` | Support inbox shown in templates | Branding overrides |
| `BRAND_LOGO_URL` | Logo URL for branding settings | Branding overrides |
| `BRAND_FAVICON_URL` | Favicon URL for branding settings | Branding overrides |

### Feature notes

- Google OAuth is active only when the Google client ID and secret are set.
- Facebook OAuth is only registered when the `passport-facebook` package is present and both Facebook credentials are set.
- Stripe billing and rent payments are disabled unless the Stripe secret key and plan price IDs are present.
- Email, Firebase, S3, Twilio, Cloudinary, and reCAPTCHA are feature-gated. The server can boot without them, but the related flows will degrade or skip work.

## Local Development

Run the API:

```bash
npm run dev
```

The server listens on `PORT` and exposes:

- Health check: `GET /api/health`
- Swagger UI: `/api-docs` when `NODE_ENV !== production`

## Scripts

### Package scripts

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

### Utility scripts

- `check-tokens.js` for token verification checks
- `test-push.js` for push notification smoke testing
- `scripts/seedPdfThemes.js` for seeding PDF themes
- `scripts/seedSaraProperties.js` for seeding sample listings
- `scripts/dedupePayments.js` for reporting and removing duplicate payments

## API Highlights

The backend includes route groups for:

- Authentication and OAuth
- Users and profiles
- Properties and uploads
- Listings and offers
- Agreements and templates
- Payments and billing
- Maintenance and messaging
- Notifications and support
- Admin, settings, disputes, and data deletion

## Background Jobs

- Redis-backed BullMQ queue for notification jobs
- Worker for email, SMS, and push notifications
- Rent reminder scheduler for due-date automation

## Payments and Billing

- Stripe handles rent payments, payment webhooks, and subscription billing
- Billing support includes Free, Pro, and Enterprise plans
- Landlord Stripe Connect onboarding is supported for payout flows
- Webhook routes use raw request bodies before JSON parsing

## Storage and Uploads

- Cloudinary stores property images
- AWS S3 stores signed agreements, receipts, and tenant documents
- Signed URLs are generated for private S3 objects

## Docker

Build and run the backend with Docker Compose:

```bash
docker compose up -d --build
```

Relevant files:

- `Dockerfile`
- `docker-compose.yml`

The container image exposes port `5000` locally. On Fly.io, `fly.toml` maps the service to port `8080` and sets `NODE_ENV=production`.

## Deployment

### Fly.io

This repository includes `fly.toml`, so the backend can be deployed directly to Fly.io as a Dockerized service.

Deployment expectations:

- Build from the included `Dockerfile`
- Set production environment variables in Fly secrets or app config
- Use `PORT=8080` on Fly.io
- Point `CLIENT_URL` at the deployed frontend
- Point `SERVER_URL` at the backend public URL
- Configure `REDIS_URL` if you use a managed Redis instance rather than the bundled local container

### Docker / self-hosted containers

The same image can run on any Docker-compatible platform, including VPS hosts and container platforms, as long as the required secrets are provided.

### Local compose

`docker-compose.yml` brings up the API and a local Redis instance for development.

## Testing

The test suite uses Jest with an isolated Node environment.

```bash
npm test
npm run test:watch
npm run test:coverage
```

The backend also includes load-testing artifacts under `artillery/`.

## Operational Notes

- Sentry is initialized only outside test mode.
- Rate limiting is applied per route group.
- Stripe webhooks must receive raw bodies.
- Redis outages should not crash the process, but queue-driven features will be impacted.
- Brand settings are read dynamically so generated emails and SMS can reflect the current platform branding.

## Troubleshooting

- If the app exits on boot, verify `MONGO_URI`, `JWT_SECRET`, and `JWT_REFRESH_SECRET` first.
- If login or OAuth fails, confirm `CLIENT_URL`, `SERVER_URL`, and the provider credentials.
- If notifications do not send, verify Redis, email, Twilio, and Firebase credentials.
- If uploads fail, confirm Cloudinary or AWS S3 variables depending on the upload path.