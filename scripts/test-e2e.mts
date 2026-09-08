/**
 * End-to-end tests against a running server (npm run dev) and a real Supabase
 * project. Exercises the direct-to-storage upload flow, owner auth, the scan
 * editor endpoints and cleanup.
 *
 * Run: npm run dev, then npm run test:e2e
 */
import sharp from "sharp";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let cookie = "";
const results: string[] = [];

type Status = boolean | "warn";

function log(ok: Status, name: string, detail = "") {
  const line = `${ok === true ? "PASS" : ok === "warn" ? "WARN" : "FAIL"}  ${name.padEnd(48)} ${detail}`;
  results.push(line);
  console.log(line);
}

async function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return res;
}

function postJson(path: string, body: unknown) {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonOf(r: Response): Promise<Record<string, unknown>> {
  const t = await r.text();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return { __raw: t.slice(0, 300) };
  }
}

type ApiFile = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  enhanced: boolean;
};
type ApiJob = { id: string; phone: string; files: ApiFile[] };

/** A phone-photo-like page: dark desk, off-white paper, lines of text. */
async function docPhoto(w = 1200, h = 1600) {
  const raw = Buffer.alloc(w * h * 3, 50);
  const px = 180, py = 200, pw = 840, ph = 1180;
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) {
      const i = (y * w + x) * 3;
      const relX = (x - px) / pw;
      const rel = (y - py) / ph;
      const isText =
        relX > 0.1 && relX < 0.9 && rel > 0.12 && rel < 0.88 &&
        Math.floor((y - py) / 14) % 3 === 0;
      const v = isText ? 70 : 225;
      raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

type LocalFile = { name: string; buf: Buffer; type: string };

type SignedUpload = {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
  signedUrl: string;
};

/** Mirror of the browser flow: sign -> PUT to Supabase -> submit metadata. */
async function sign(files: LocalFile[]) {
  const r = await postJson("/api/uploads", {
    files: files.map((f) => ({ name: f.name, size: f.buf.length, type: f.type })),
  });
  return { res: r, data: await jsonOf(r) };
}

async function uploadAndSubmit(
  fields: { name: string; phone: string; notes?: string },
  files: LocalFile[]
) {
  const { res, data } = await sign(files);
  if (!res.ok) return { stage: "sign" as const, status: res.status, data };

  const uploads = data.uploads as SignedUpload[];
  for (const [i, up] of uploads.entries()) {
    const put = await fetch(up.signedUrl, {
      method: "PUT",
      headers: { "content-type": up.mimeType },
      body: new Uint8Array(files[i].buf),
    });
    if (!put.ok) {
      return { stage: "upload" as const, status: put.status, data: await jsonOf(put) };
    }
  }

  const sub = await postJson("/api/submit", { ...fields, ticket: data.ticket });
  return { stage: "submit" as const, status: sub.status, data: await jsonOf(sub) };
}

// ---------------------------------------------------------------- public pages
for (const p of ["/", "/submit", "/login"]) {
  const r = await req(p);
  log(r.status === 200, `GET ${p}`, `status ${r.status}`);
}
for (const p of ["/owner/login", "/owner/dashboard"]) {
  const r = await req(p);
  log(
    r.status === 307 || r.status === 308,
    `GET ${p} redirects`,
    `status ${r.status} -> ${r.headers.get("location")}`
  );
}

// ------------------------------------------------------------------ auth gating
{
  const r = await req("/api/jobs");
  log(r.status === 401, "GET /api/jobs unauthenticated = 401", `status ${r.status}`);
}
{
  const r = await req("/dashboard");
  const loc = r.headers.get("location") ?? "";
  log(
    r.status >= 300 && r.status < 400 && loc.includes("/login"),
    "GET /dashboard unauthenticated redirects",
    `status ${r.status} -> ${loc}`
  );
}
{
  const r = await req("/api/jobs/does-not-exist");
  log(r.status === 401, "GET /api/jobs/:id unauthenticated = 401", `status ${r.status}`);
}
{
  const r = await postJson("/api/auth/login", { username: "owner", password: "wrong-password" });
  log(r.status === 401, "login with wrong password = 401", `status ${r.status}`);
}
{
  const r = await req("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json",
  });
  log(r.status === 400, "login with malformed body = 400", `status ${r.status}`);
}
{
  const r = await postJson("/api/auth/login", {
    username: process.env.OWNER_USERNAME,
    password: process.env.OWNER_PASSWORD,
  });
  log(
    r.status === 200 && cookie.includes("sbs_owner_session"),
    "login with correct password",
    `status ${r.status}`
  );
  if (r.status !== 200) {
    console.log("\n!! cannot authenticate — set OWNER_USERNAME/OWNER_PASSWORD in .env");
    process.exit(1);
  }
}
{
  const r = await req("/api/jobs");
  log(r.status === 200, "GET /api/jobs authenticated", `status ${r.status}`);
}

// ------------------------------------------------------------ upload validation
const img = await docPhoto();
const jpg: LocalFile = { name: "page.jpg", buf: img, type: "image/jpeg" };

{
  const { res } = await sign([]);
  log(res.status === 400, "sign rejects zero files", `status ${res.status}`);
}
{
  const { res } = await sign(
    Array.from({ length: 25 }, (_, i) => ({ ...jpg, name: `p${i}.jpg` }))
  );
  log(res.status === 400, "sign rejects too many files", `status ${res.status}`);
}
{
  const { res } = await sign([{ name: "evil.exe", buf: Buffer.from("MZ"), type: "application/x-msdownload" }]);
  log(res.status === 400, "sign rejects disallowed type", `status ${res.status}`);
}
{
  const { res } = await sign([{ name: "huge.jpg", buf: Buffer.alloc(0), type: "image/jpeg" }]);
  log(res.status === 400, "sign rejects empty file", `status ${res.status}`);
}
{
  const r = await postJson("/api/submit", { name: "A", phone: "9876543210", ticket: "x" });
  log(r.status === 400, "submit rejects 1-char name", `status ${r.status}`);
}
{
  const r = await postJson("/api/submit", { name: "Test User", phone: "12345", ticket: "x" });
  log(r.status === 400, "submit rejects short phone", `status ${r.status}`);
}
{
  const r = await postJson("/api/submit", { name: "Test User", phone: "9876543210", ticket: "forged" });
  log(r.status === 400, "submit rejects forged ticket", `status ${r.status}`);
}
{
  // A valid ticket whose objects were never uploaded must not create a job.
  const { data } = await sign([jpg]);
  const r = await postJson("/api/submit", {
    name: "Test User",
    phone: "9876543210",
    ticket: data.ticket,
  });
  log(r.status === 400, "submit rejects ticket with no uploaded bytes", `status ${r.status}`);
}
{
  // Over Vercel's 4.5MB function body cap: must still work, because the bytes
  // go browser -> Supabase and never touch the function.
  const big = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 205, b: 210 } },
  }).jpeg({ quality: 100 }).toBuffer();
  const noise = Buffer.alloc(Math.max(0, 6 * 1024 * 1024 - big.length), 1);
  const payload = Buffer.concat([big, noise]);
  const r = await uploadAndSubmit({ name: "Big Upload", phone: "9876543211" }, [
    { name: "big.jpg", buf: payload, type: "image/jpeg" },
  ]);
  log(
    r.stage === "submit" && r.status === 200,
    `${(payload.length / 1024 / 1024).toFixed(1)}MB upload bypasses the 4.5MB cap`,
    `${r.stage} status ${r.status}`
  );
  const bigJob = r.data.jobId as string | undefined;
  if (bigJob) await req(`/api/jobs/${bigJob}`, { method: "DELETE" });
}

// -------------------------------------------------------------------- happy path
let jobId = "";
let fileId = "";
{
  const r = await uploadAndSubmit(
    { name: "Test User", phone: "98765 43210", notes: "B&W 2 copies" },
    [jpg, { name: "doc.pdf", buf: Buffer.from("%PDF-1.4\n%%EOF\n"), type: "application/pdf" }]
  );
  jobId = (r.data.jobId as string) ?? "";
  log(
    r.status === 200 && !!jobId && r.data.fileCount === 2,
    "submit happy path (2 files)",
    `${r.stage} status ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`
  );
}
if (!jobId) {
  console.log("\n!! submit happy path failed, cannot continue");
  process.exit(1);
}

let job: ApiJob;
{
  const r = await req(`/api/jobs/${jobId}`);
  const d = await jsonOf(r);
  job = d.job as ApiJob;
  fileId = job?.files?.find((f) => f.mimeType.startsWith("image/"))?.id ?? "";
  log(r.status === 200 && !!fileId, "GET job detail", `status ${r.status}, phone ${job?.phone}`);
}
{
  const r = await req(`/api/jobs/${jobId}/files/${fileId}?thumb=1`);
  log(
    r.status === 200 && r.headers.get("content-type") === "image/jpeg",
    "GET file thumbnail",
    `status ${r.status}`
  );
}
{
  const r = await req(`/api/jobs/${jobId}/files/${fileId}?preview=1&source=1`);
  log(r.status === 200, "GET editor preview of the original", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/${jobId}/files/${fileId}`);
  log(r.status === 307 || r.status === 308, "GET file redirects to Supabase CDN", `status ${r.status}`);
  const loc = r.headers.get("location") ?? "";
  if (loc) {
    const rr = await fetch(loc);
    log(rr.status === 200, "signed CDN url is fetchable", `status ${rr.status}`);
  }
}

// ----------------------------------------------------------------- scan editor
{
  const pdf = job.files.find((f) => f.mimeType === "application/pdf")!;
  const r = await req(`/api/jobs/${jobId}/files/${pdf.id}/enhance`, { method: "POST" });
  log(r.status === 400, "enhance rejects non-image", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/${jobId}/files/${fileId}/enhance`);
  const d = await jsonOf(r);
  log(
    r.status === 200 && "suggestedCrop" in d,
    "GET enhance returns settings + suggested crop",
    `status ${r.status} crop ${JSON.stringify(d.suggestedCrop)}`
  );
}

async function meanOfCurrent() {
  const dl = await req(`/api/jobs/${jobId}/files/${fileId}?proxy=1`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const st = await sharp(buf).stats();
  const meta = await sharp(buf).metadata();
  return {
    mean: st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: buf.length,
  };
}

const before = await meanOfCurrent();
let firstEnhanced = { mean: 0, width: 0, height: 0, bytes: 0 };
{
  const t0 = Date.now();
  const r = await req(`/api/jobs/${jobId}/files/${fileId}/enhance`, { method: "POST" });
  const d = await jsonOf(r);
  const file = d.file as ApiFile | undefined;
  log(
    r.status === 200 && file?.enhanced === true,
    "POST enhance (auto crop + brighten)",
    `status ${r.status} in ${Date.now() - t0}ms -> ${file?.originalName}`
  );
  firstEnhanced = await meanOfCurrent();
  log(
    firstEnhanced.mean > before.mean,
    "enhanced page is brighter than the upload",
    `mean ${before.mean.toFixed(1)} -> ${firstEnhanced.mean.toFixed(1)}`
  );
  log(
    firstEnhanced.width < before.width && firstEnhanced.height < before.height,
    "auto crop removed the desk around the page",
    `${before.width}x${before.height} -> ${firstEnhanced.width}x${firstEnhanced.height}`
  );
}
{
  // Re-running must recompute from the original, not from the previous output.
  const r = await req(`/api/jobs/${jobId}/files/${fileId}/enhance`, { method: "POST" });
  log(r.status === 200, "enhance twice succeeds", `status ${r.status}`);
  const again = await meanOfCurrent();
  log(
    again.width === firstEnhanced.width && again.height === firstEnhanced.height,
    "re-enhance does not compound the crop",
    `${firstEnhanced.width}x${firstEnhanced.height} -> ${again.width}x${again.height}`
  );
}
{
  const r = await postJson(`/api/jobs/${jobId}/files/${fileId}/enhance`, {
    crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    brightness: 1.3,
    contrast: 1.2,
    grayscale: true,
  });
  log(r.status === 200, "POST manual crop + brightness", `status ${r.status}`);
  const manual = await meanOfCurrent();
  const wantW = Math.round(before.width * 0.5);
  log(
    Math.abs(manual.width - wantW) <= 2,
    "manual crop is applied to the original, exactly",
    `${manual.width}x${manual.height} (want ~${wantW}px wide)`
  );
}
{
  const r = await postJson(`/api/jobs/${jobId}/files/${fileId}/enhance`, {
    crop: { x: 2, y: 2, w: 5, h: 5 },
  });
  log(r.status === 400, "invalid crop rejected", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/${jobId}/files/${fileId}/enhance`, { method: "DELETE" });
  const d = await jsonOf(r);
  const file = d.file as ApiFile | undefined;
  log(r.status === 200 && file?.enhanced === false, "DELETE enhance reverts", `status ${r.status}`);
  const reverted = await meanOfCurrent();
  log(
    reverted.width === before.width && reverted.height === before.height,
    "revert restores the customer's original upload",
    `${reverted.width}x${reverted.height} vs original ${before.width}x${before.height}`
  );
  const again = await req(`/api/jobs/${jobId}/files/${fileId}/enhance`, { method: "DELETE" });
  log(again.status === 400, "revert with nothing to undo = 400", `status ${again.status}`);
}

// --------------------------------------------------------------- job lifecycle
{
  const r = await req(`/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  log(r.status === 200, "PATCH job status = ready", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "bogus" }),
  });
  log(r.status === 400, "PATCH rejects invalid status", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/${jobId}/files/00000000-0000-0000-0000-000000000000`);
  log(r.status === 404, "GET unknown fileId = 404", `status ${r.status}`);
}
{
  const r = await req(`/api/jobs/11111111-1111-1111-1111-111111111111/files/${fileId}`);
  log(r.status === 404, "file scoped to its job (no cross-job read)", `status ${r.status}`);
}

// ------------------------------------------------------- delete + orphan check
{
  const detail = await jsonOf(await req(`/api/jobs/${jobId}`));
  const stored = (detail.job as ApiJob).files.map((f) => f.storedName).filter(Boolean);
  const urls = await Promise.all(
    (detail.job as ApiJob).files.map(async (f) => {
      const r = await req(`/api/jobs/${jobId}/files/${f.id}`);
      return r.headers.get("location") ?? "";
    })
  );

  const r = await req(`/api/jobs/${jobId}`, { method: "DELETE" });
  log(r.status === 200, "DELETE job", `status ${r.status}`);
  const gone = await req(`/api/jobs/${jobId}`);
  log(gone.status === 404, "deleted job is gone", `status ${gone.status}`);

  // The signed URLs are still valid; the objects behind them should not be.
  const stillThere: string[] = [];
  for (const [i, url] of urls.entries()) {
    if (!url) continue;
    const rr = await fetch(url);
    if (rr.ok) stillThere.push(stored[i]);
  }
  log(
    stillThere.length === 0,
    "DELETE also removes the storage objects",
    stillThere.length ? `orphans: ${stillThere.join(", ")}` : "no orphans"
  );
}
{
  const r = await req("/api/auth/logout", { method: "POST" });
  log(r.status === 200, "POST logout", `status ${r.status}`);
}
{
  const r = await req("/api/jobs");
  log(r.status === 401, "session invalid after logout", `status ${r.status}`);
}

console.log("\n=== end-to-end results ===");
const fails = results.filter((r) => r.startsWith("FAIL")).length;
const warns = results.filter((r) => r.startsWith("WARN")).length;
console.log(`${results.length} checks: ${results.length - fails - warns} pass, ${fails} fail, ${warns} warn`);
if (fails) {
  console.log("\nfailed:");
  results.filter((r) => r.startsWith("FAIL")).forEach((r) => console.log("  " + r));
  process.exit(1);
}
