# Shree BookStall — Print Desk

Web app for a stationery shop print counter. Customers scan a QR, enter name + phone, and upload files. The owner sees every job on a live dashboard and can clean up phone photos like a document scanner.

## Features

- **Customer QR submit** — name, phone, optional notes, multi-file upload (PDF, images, Word, PPT, text)
- **Owner dashboard** — live queue, status updates, open/print/download files, delete finished jobs
- **Auto crop + brighten** — one tap turns a phone photo of a page into a scan
- **Manual editor** — drag the crop box, adjust brightness/contrast, black & white toggle
- **Undo** — the customer's original upload is always kept and can be restored
- **Printable QR** — generated on the home page for the shop counter

## Quick start

```bash
npm install
cp .env.example .env   # then fill it in — see Environment below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The owner login is at `/login`.

There is no default password. `OWNER_USERNAME`, `OWNER_PASSWORD` and `JWT_SECRET` must be set or login returns 503.

## Environment

| Variable                    | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `OWNER_USERNAME`            | Dashboard login                                                   |
| `OWNER_PASSWORD`            | Dashboard login — no default, choose a strong one                 |
| `JWT_SECRET`                | Signs the session cookie and upload tickets                       |
| `NEXT_PUBLIC_APP_URL`       | Public URL baked into the counter QR                              |
| `NEXT_PUBLIC_SUPABASE_URL`  | Supabase project URL                                              |
| `SUPABASE_BUCKET`           | Storage bucket for uploads (`print-files`)                        |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key — never exposed to the browser           |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor. It creates the tables, indexes, the private `print-files` bucket, and enables RLS with no policies so a leaked anon key cannot read customer data.
3. Copy the project URL and the **service role** key into `.env`.

## How uploads work

Vercel Functions reject request bodies over ~4.5 MB, which a single phone photo often exceeds. Files therefore never pass through the app server:

1. The browser asks `POST /api/uploads` for one signed Supabase URL per file. The server validates the name, type, size and file count, and returns a signed **upload ticket** (a short-lived JWT listing the object names it issued).
2. The browser PUTs each file straight to Supabase Storage.
3. The browser calls `POST /api/submit` with just the customer details and the ticket. The server verifies the ticket, confirms every object actually landed in the bucket, reads the real sizes from storage, and creates the job.

Limits live in `src/lib/upload-limits.ts` and are enforced on both sides. `/api/uploads` and `/api/submit` are rate limited per IP.

## How the scanner works

`src/lib/document-detect.ts` holds the page detector: it thresholds a downscaled copy of the photo at several levels, builds candidate rectangles from connected components and projections, and scores each on how much brighter its interior is than the strip around it. **If no candidate has enough evidence it returns `null` and the image is not cropped** — a wrong crop destroys the document, so refusing to guess is the correct behaviour.

`src/lib/document-enhance-server.ts` applies the crop, flattens transparency onto white (otherwise a transparent PNG turns grey as a JPEG), maps the paper level toward white while keeping the ink dark, then applies brightness/contrast/grayscale.

Every edit is recomputed **from the original upload**, never from the previous output, so repeated adjustments cannot compound. The original object stays in storage (`sourceStoredName` on `PrintFile`), and **Undo edits** puts it back. Deleting a job removes its storage objects too.

## Tests

```bash
npm run lint
npm run build          # also runs the TypeScript check
npm run test:enhance   # 37 image-pipeline checks, no server needed
npm run test:e2e       # needs `npm run dev` running + a real Supabase project
```

`test:enhance` covers auto-crop accuracy on noisy synthetic photos (dark/light desks, lighting gradients, off-centre and landscape pages, 12MP), content safety (a crop may never cut into the page), brightening and slider monotonicity, alpha flattening, determinism, manual/clamped crops, odd formats and performance.

`test:e2e` drives the real HTTP API: auth gating, upload validation, a >4.5 MB direct upload, auto and manual enhancement, undo, and storage cleanup on delete.

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Set all seven environment variables from the table above. `NEXT_PUBLIC_APP_URL` must be the real deployed URL or the QR will point at localhost.
3. Deploy, then check: owner login, a customer submission with a large photo, thumbnails, auto crop + brighten, undo, download, and delete.

Image routes declare `maxDuration = 60` (enhance) and `30` (file serving) because a 12MP photo takes a few seconds to decode, analyse and re-encode.

## How to use in the shop

1. Open the home page and **Download QR**.
2. Print it and place it at the counter.
3. Customers scan → fill name & phone → upload files.
4. Owner opens **/login** → dashboard to see jobs.
5. For messy photos use **Auto crop + brighten**, or the editor for a manual crop. **Undo edits** restores the original.
