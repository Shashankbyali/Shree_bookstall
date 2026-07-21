# Shree BookStall — Print Desk

Production-ready web app for a stationery shop print counter. Customers scan a QR, enter name + phone, upload files. The owner sees every job on a live dashboard and can one-tap auto-crop & brighten photos like a document scanner.

## Features

- **Customer QR submit** — name, phone, optional notes, multi-file upload (PDF, images, Word, PPT, text)
- **Owner dashboard** — live queue, status updates, open/print files
- **Edit button** — auto crop + brighten for phone photos (doc-scanner style)
- **Printable QR** — generated on the home page for the shop counter

## Quick start

```bash
npm install
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Default owner login

| Field    | Value           |
|----------|-----------------|
| Username | `owner`         |
| Password | `shreebookstall`|

Change these in `.env` before going live.

## Environment

Copy `.env.example` to `.env`:

- `DATABASE_URL` — SQLite path (default `file:./dev.db`)
- `OWNER_USERNAME` / `OWNER_PASSWORD` — dashboard login
- `JWT_SECRET` — long random string for session cookies
- `NEXT_PUBLIC_APP_URL` — public URL used in the QR (e.g. `https://yourdomain.com`)

## How to use in the shop

1. Open the home page and **Download QR**
2. Print and place it at the counter / near the printer
3. Customers scan → fill name & phone → upload files
4. Owner opens **Owner login** → **Dashboard** to see jobs
5. For messy photos, click **Edit (auto crop + brighten)** — it auto-downloads. Use **Download for print** anytime after.

## Deploy (free options)

This app needs **persistent disk** for SQLite + uploaded files. Best free/cheap choices:

### Recommended: Render (free tier)
1. Push code to GitHub
2. [render.com](https://render.com) → **New Web Service** → connect repo
3. Build: `npm install && npx prisma migrate deploy && npm run build`
4. Start: `npm start`
5. Add a **Disk** mount at `/opt/render/project/src/uploads` (and point uploads there) OR switch to Postgres + cloud storage later
6. Set env vars: `DATABASE_URL`, `JWT_SECRET`, `OWNER_USERNAME`, `OWNER_PASSWORD`, `NEXT_PUBLIC_APP_URL`

> Note: Render free tier sleeps after inactivity and disk is limited — fine for a small shop.

### Also good: Railway
- $5/month free credit, easy Node deploy, add volume for uploads
- [railway.app](https://railway.app)

### Budget VPS (most reliable for a shop)
- **Oracle Cloud Always Free** — 1 small VM forever free, full control
- **Hetzner** — ~€4/mo, very stable for a print shop that must stay online

### Not ideal alone
- **Vercel** — great for Next.js but **no persistent file storage** on free tier; you'd need Postgres + S3/R2
- **Netlify** — same limitation

### Before deploy checklist
```bash
# Generate a secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- Change `OWNER_PASSWORD` and `JWT_SECRET`
- Set `NEXT_PUBLIC_APP_URL=https://your-domain.com`
- Run `npx prisma migrate deploy` on the server

## Production notes

- Set a strong `JWT_SECRET` and new owner password
- Point `NEXT_PUBLIC_APP_URL` at your real domain so the QR works off-LAN
- Deploy on a Node host (VPS, Railway, Render, etc.) — file uploads are stored in `/uploads`
- For multi-server / serverless, switch SQLite → Postgres and store files on S3/R2

```bash
npm run build
npm start
```
