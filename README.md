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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Default owner login

| Field    | Value            |
| -------- | ---------------- |
| Username | `owner`          |
| Password | `shreebookstall` |

Change these in `.env` before going live.

## Environment

Copy `.env.example` to `.env`:

- `OWNER_USERNAME` / `OWNER_PASSWORD` — dashboard login
- `JWT_SECRET` — long random string for session cookies
- `NEXT_PUBLIC_APP_URL` — public URL used in the QR (e.g. `https://yourdomain.com`)
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `SUPABASE_BUCKET` — storage bucket for uploaded files
- `SUPABASE_SERVICE_ROLE_KEY` — server-side storage/admin key

## How to use in the shop

1. Open the home page and **Download QR**
2. Print and place it at the counter / near the printer
3. Customers scan → fill name & phone → upload files
4. Owner opens **Owner login** → **Dashboard** to see jobs
5. For messy photos, click **Edit (auto crop + brighten)** — it auto-downloads. Use **Download for print** anytime after.

## Deploy Free

This app is set up for **Vercel + Supabase**, which is the cleanest free path because it gives you hosted PostgreSQL and file storage without needing a credit card.

### Recommended: Vercel + Supabase

1. Push code to GitHub.
2. Keep your database and files in Supabase.
3. Deploy the Next.js app to Vercel from the GitHub repo.
4. Set env vars in Vercel:
   - `NEXT_PUBLIC_APP_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_BUCKET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OWNER_USERNAME`
   - `OWNER_PASSWORD`
   - `JWT_SECRET`
5. Deploy.

### Why this stays fast

- Postgres tables are indexed for the queue views.
- Files live in Supabase Storage instead of the app server.
- The app stays on Vercel’s edge network while Supabase handles data.
- The owner dashboard only fetches the queue and file metadata, not huge blobs.

### Before deploy checklist

```bash
# Generate a secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Change `OWNER_PASSWORD` and `JWT_SECRET`
- Set `NEXT_PUBLIC_APP_URL=https://your-domain.com`
- Make sure Supabase Storage bucket `print-files` exists
- Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor before first deploy

## Production notes

- Set a strong `JWT_SECRET` and new owner password
- Point `NEXT_PUBLIC_APP_URL` at your real domain so the QR works off-LAN
- Deploy on Vercel for the frontend and Supabase for database/storage
- For a custom host, keep the same Supabase setup and only move the frontend

```bash
npm run build
npm start
```
