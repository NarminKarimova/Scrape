# Scraping Dashboards

Next.js dashboard for the scraped Bina.az, market, and Turbo data. The app reads processed JSON from local `processed/` files in development, or from the Cloudflare R2 bucket in production.

## Requirements

- Node.js and npm
- Cloudflare Wrangler login for R2 upload and Worker deploy
- Raw source files under `data/`

Install dependencies:

```bash
npm install
```

## Local Development

Build the processed dashboard data first:

```bash
npm run build-data
```cd

Start the Next.js dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Data Flow

Raw scraper outputs live under `data/`. The dashboard does not upload those raw files directly. Instead:

1. `npm run build-data` reads `data/`
2. It writes optimized JSON into `processed/`
3. `npm run upload-data` uploads every `processed/**/*.json` file to R2

The R2 bucket configured for this repo is:

```text
scraping-dashboard-data
```

The deployed Worker uses the `DASHBOARD_DATA` R2 binding from `wrangler.jsonc`.

## Upload Fresh Data to R2

Use this when scraper data has changed and the live dashboard needs the new numbers:

```bash
npm run upload-data
```

This command runs both steps:

```bash
npm run build-data
node scripts/upload-dashboard-data.mjs
```

The upload script sends each generated JSON file to remote Cloudflare R2 with:

```bash
npx wrangler r2 object put scraping-dashboard-data/<key> --file="<local-file>" --remote
```

You do not need to redeploy the app just to refresh dashboard data. Redeploy only when application code changes.

## Cloudflare Login

If Wrangler is not authenticated:

```bash
npx wrangler login
```

Check the current account:

```bash
npx wrangler whoami
```

On this Windows corporate network, if Wrangler fails with `SELF_SIGNED_CERT_IN_CHAIN`, run the upload with the system CA option:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run upload-data
```

## Deploy App Code

Deploy the Next.js app to Cloudflare Workers when code changes:

```bash
npm run deploy
```

This is separate from `npm run upload-data`. Data refreshes go to R2; app changes go through OpenNext and Wrangler deploy.

## Environment Variables

For local or non-Worker environments that read R2 through the S3-compatible API, copy `.env.example` and fill:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=scraping-dashboard-data
```

The Worker deployment normally uses the R2 binding in `wrangler.jsonc` instead of these S3 variables.

Optional Gemini settings:

```text
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
```

## Useful Commands

```bash
npm run build-data   # regenerate processed/ from data/
npm run upload-data  # rebuild processed/ and upload it to R2
npm run dev          # run local development server
npm run build        # build the Next.js app
npm run deploy       # build and deploy app code to Cloudflare Workers
```
If future scraped data introduces new category IDs, refresh the mappin first:
npm run build-birmarket-categories


$env:NODE_USE_SYSTEM_CA = "1"
npm run upload-data
npm run deploy