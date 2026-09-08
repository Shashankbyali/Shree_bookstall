/**
 * Image pipeline tests: auto-crop detection + brighten.
 *
 * Synthetic photos deliberately include sensor noise and a lighting gradient so
 * that `sharp.trim()` cannot rescue a failing detector — a uniform background
 * makes almost any implementation look correct.
 *
 * Run: npm run test:enhance
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import {
  enhanceDocumentBuffer,
  detectCrop,
  createThumbnailBuffer,
  createPreviewBuffer,
  DEFAULT_ENHANCE_SETTINGS,
  normalizeSettings,
  isDecodableImage,
} from "@/lib/document-enhance-server";

const OUT = path.join(process.cwd(), ".test-output");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(ok: boolean, name: string, detail = "") {
  if (ok) pass++;
  else {
    fail++;
    failures.push(name);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
}

// Deterministic pseudo-random so runs are reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

type Photo = {
  imgW: number; imgH: number;
  pageX: number; pageY: number; pageW: number; pageH: number;
  bg: number; paper: number;
  noise?: number; gradient?: number; text?: boolean;
};

/** A phone photo of a printed page: noisy background, uneven lighting, words. */
async function photo(o: Photo): Promise<Buffer> {
  const { imgW, imgH, bg, paper, noise = 10, gradient = 0.28, text = true } = o;
  const raw = Buffer.alloc(imgW * imgH * 3);

  // word boxes: rows of variable-length dark runs, like real text
  const words: [number, number, number, number][] = [];
  if (text) {
    const lineH = Math.max(6, Math.round(o.pageH / 40));
    for (let ly = 0; ly < 30; ly++) {
      const y0 = o.pageY + Math.round(o.pageH * 0.1) + ly * Math.round(lineH * 2.2);
      if (y0 + lineH > o.pageY + o.pageH * 0.92) break;
      let x = o.pageX + Math.round(o.pageW * 0.1);
      const xEnd = o.pageX + Math.round(o.pageW * 0.9);
      while (x < xEnd) {
        const wlen = Math.round(o.pageW * (0.04 + rnd() * 0.09));
        if (x + wlen > xEnd) break;
        words.push([x, y0, wlen, lineH]);
        x += wlen + Math.round(o.pageW * 0.02);
      }
    }
  }
  const inWord = new Uint8Array(imgW * imgH);
  for (const [wx, wy, ww, wh] of words)
    for (let y = wy; y < wy + wh; y++)
      for (let x = wx; x < wx + ww; x++)
        if (x >= 0 && x < imgW && y >= 0 && y < imgH) inWord[y * imgW + x] = 1;

  for (let y = 0; y < imgH; y++) {
    // diagonal lighting falloff, like a window or overhead lamp
    const shade = 1 - gradient * ((y / imgH) * 0.6 + 0.4);
    for (let x = 0; x < imgW; x++) {
      const i = (y * imgW + x) * 3;
      const onPage =
        x >= o.pageX && x < o.pageX + o.pageW && y >= o.pageY && y < o.pageY + o.pageH;
      let v = onPage ? paper : bg;
      if (onPage && inWord[y * imgW + x]) v = Math.max(0, Math.round(v * 0.22));
      v = v * shade * (1 - gradient * 0.3 * (x / imgW));
      v += (rnd() - 0.5) * 2 * noise;
      const c = Math.max(0, Math.min(255, Math.round(v)));
      raw[i] = c; raw[i + 1] = c; raw[i + 2] = c;
    }
  }
  return sharp(raw, { raw: { width: imgW, height: imgH, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function meanOf(buf: Buffer) {
  const st = await sharp(buf).stats();
  return st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
}

// ---------------------------------------------------------------- crop accuracy
console.log("\n--- auto-crop detection (realistic noisy photos) ---");

type CropCase = { name: string; photo: Photo; expectCrop: boolean; tol?: number };
const cropCases: CropCase[] = [
  { name: "portrait page, dark desk", photo: { imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 45, paper: 232 }, expectCrop: true },
  { name: "portrait page, light desk", photo: { imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 168, paper: 240 }, expectCrop: true },
  { name: "off-centre page", photo: { imgW: 1200, imgH: 1600, pageX: 60, pageY: 90, pageW: 700, pageH: 1000, bg: 40, paper: 235 }, expectCrop: true },
  { name: "landscape page", photo: { imgW: 1600, imgH: 1200, pageX: 200, pageY: 260, pageW: 1200, pageH: 700, bg: 42, paper: 233 }, expectCrop: true },
  { name: "dim underexposed page", photo: { imgW: 1200, imgH: 1600, pageX: 180, pageY: 200, pageW: 840, pageH: 1180, bg: 18, paper: 110, gradient: 0.15 }, expectCrop: true },
  { name: "heavy lighting gradient", photo: { imgW: 1200, imgH: 1600, pageX: 190, pageY: 210, pageW: 820, pageH: 1160, bg: 50, paper: 240, gradient: 0.5 }, expectCrop: true },
  { name: "noisy sensor (noise=26)", photo: { imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 48, paper: 230, noise: 26 }, expectCrop: true },
  { name: "12MP phone photo 3024x4032", photo: { imgW: 3024, imgH: 4032, pageX: 500, pageY: 620, pageW: 2000, pageH: 2800, bg: 46, paper: 234 }, expectCrop: true },
  { name: "blank page, no text", photo: { imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 45, paper: 232, text: false }, expectCrop: true },
  // page already fills the frame: correct behaviour is to NOT crop
  { name: "page fills frame (must not crop)", photo: { imgW: 1200, imgH: 1600, pageX: 10, pageY: 10, pageW: 1180, pageH: 1580, bg: 40, paper: 232 }, expectCrop: false },
];

for (const c of cropCases) {
  const buf = await c.photo ? await photo(c.photo) : Buffer.alloc(0);
  const t0 = Date.now();
  const crop = await detectCrop(buf);
  const ms = Date.now() - t0;
  const p = c.photo;

  if (!c.expectCrop) {
    check(crop === null, `no-crop: ${c.name}`, crop ? `got crop ${JSON.stringify(crop)}` : `null (${ms}ms)`);
    continue;
  }
  if (!crop) {
    check(false, `crop: ${c.name}`, `detector returned null (${ms}ms)`);
    continue;
  }
  // Compare against ground truth in pixels
  const gx = crop.x * p.imgW, gy = crop.y * p.imgH;
  const gw = crop.w * p.imgW, gh = crop.h * p.imgH;
  const tol = c.tol ?? 0.06;
  const tolX = p.imgW * tol, tolY = p.imgH * tol;
  const ok =
    Math.abs(gx - p.pageX) < tolX && Math.abs(gy - p.pageY) < tolY &&
    Math.abs(gw - p.pageW) < tolX * 2 && Math.abs(gh - p.pageH) < tolY * 2;
  check(
    ok,
    `crop: ${c.name}`,
    `got ${Math.round(gx)},${Math.round(gy)} ${Math.round(gw)}x${Math.round(gh)} | want ${p.pageX},${p.pageY} ${p.pageW}x${p.pageH} (${ms}ms)`
  );
  const out = await enhanceDocumentBuffer(buf);
  fs.writeFileSync(path.join(OUT, `${c.name.replace(/[^a-z0-9]+/gi, "-")}.jpg`), out.buffer);
}

// -------------------------------------------------------------- content safety
console.log("\n--- content safety (a wrong crop destroys the document) ---");
{
  // Text runs to the very edge of the page; nothing may be cut off.
  const p: Photo = { imgW: 1200, imgH: 1600, pageX: 150, pageY: 150, pageW: 900, pageH: 1300, bg: 44, paper: 234 };
  const buf = await photo(p);
  const crop = await detectCrop(buf);
  const ok = !crop || (crop.x * p.imgW <= p.pageX + 12 && crop.y * p.imgH <= p.pageY + 12 &&
    (crop.x + crop.w) * p.imgW >= p.pageX + p.pageW - 12 &&
    (crop.y + crop.h) * p.imgH >= p.pageY + p.pageH - 12);
  check(ok, "crop never cuts inside the page", crop ? JSON.stringify(Object.fromEntries(Object.entries(crop).map(([k, v]) => [k, +v.toFixed(3)]))) : "null");
}

// ---------------------------------------------------------------- brightening
console.log("\n--- brighten / contrast ---");
{
  const dim = await photo({ imgW: 1200, imgH: 1600, pageX: 180, pageY: 200, pageW: 840, pageH: 1180, bg: 18, paper: 105, gradient: 0.15 });
  const before = await meanOf(dim);
  const after = await meanOf((await enhanceDocumentBuffer(dim)).buffer);
  check(after > before + 30, "dim page gets brighter", `mean ${before.toFixed(1)} -> ${after.toFixed(1)}`);
}
{
  const p = await photo({ imgW: 900, imgH: 1200, pageX: 100, pageY: 120, pageW: 700, pageH: 950, bg: 45, paper: 225 });
  const lo = await meanOf((await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, brightness: 0.7 })).buffer);
  const mid = await meanOf((await enhanceDocumentBuffer(p, DEFAULT_ENHANCE_SETTINGS)).buffer);
  const hi = await meanOf((await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, brightness: 1.6 })).buffer);
  check(lo < mid && mid < hi, "brightness slider is monotonic", `${lo.toFixed(1)} < ${mid.toFixed(1)} < ${hi.toFixed(1)}`);

  const flat = await sharp((await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, contrast: 0.6 })).buffer).stats();
  const punchy = await sharp((await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, contrast: 1.8 })).buffer).stats();
  check(punchy.channels[0].stdev > flat.channels[0].stdev, "contrast slider is monotonic", `stdev ${flat.channels[0].stdev.toFixed(1)} -> ${punchy.channels[0].stdev.toFixed(1)}`);
}
{
  const p = await photo({ imgW: 900, imgH: 1200, pageX: 100, pageY: 120, pageW: 700, pageH: 950, bg: 45, paper: 225 });
  const g = await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, grayscale: true });
  const meta = await sharp(g.buffer).metadata();
  check(meta.channels === 1 || meta.space === "b-w", "grayscale mode produces mono jpeg", `space ${meta.space} channels ${meta.channels}`);
}
{
  // Transparent PNG must land on white paper, not black or grey.
  const png = await sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer();
  const m = await meanOf((await enhanceDocumentBuffer(png)).buffer);
  check(m > 240, "alpha is flattened onto white", `mean ${m.toFixed(1)}`);
}
{
  // Re-running must be idempotent: same input, same settings, same output.
  const p = await photo({ imgW: 900, imgH: 1200, pageX: 100, pageY: 120, pageW: 700, pageH: 950, bg: 45, paper: 225 });
  const a = await enhanceDocumentBuffer(p);
  const b = await enhanceDocumentBuffer(p);
  check(a.buffer.equals(b.buffer), "enhance is deterministic / non-compounding", `${a.buffer.length} vs ${b.buffer.length} bytes`);
}

// -------------------------------------------------------------------- manual crop
console.log("\n--- manual crop override ---");
{
  const p = await photo({ imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 45, paper: 232 });
  const r = await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
  check(r.width === 600 && r.height === 800, "explicit crop is honoured exactly", `${r.width}x${r.height} (want 600x800)`);
}
{
  const p = await photo({ imgW: 1200, imgH: 1600, pageX: 200, pageY: 220, pageW: 800, pageH: 1150, bg: 45, paper: 232 });
  const r = await enhanceDocumentBuffer(p, { ...DEFAULT_ENHANCE_SETTINGS, crop: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } });
  check(r.width > 0 && r.height > 0, "out-of-range crop is clamped, not crashed", `${r.width}x${r.height}`);
}

// ------------------------------------------------------------------- edge cases
console.log("\n--- edge cases ---");
const edge: [string, () => Promise<Buffer>][] = [
  ["1x1 pixel", async () => sharp({ create: { width: 1, height: 1, channels: 3, background: "#808080" } }).jpeg().toBuffer()],
  ["16x16 tiny", async () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#c8c8c8" } }).jpeg().toBuffer()],
  ["solid white", async () => sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ffffff" } }).jpeg().toBuffer()],
  ["solid black", async () => sharp({ create: { width: 800, height: 1000, channels: 3, background: "#000000" } }).jpeg().toBuffer()],
  ["2000x100 wide strip", async () => sharp({ create: { width: 2000, height: 100, channels: 3, background: "#e6e6e6" } }).jpeg().toBuffer()],
  ["100x2000 tall strip", async () => sharp({ create: { width: 100, height: 2000, channels: 3, background: "#e6e6e6" } }).jpeg().toBuffer()],
  ["16-bit png", async () => sharp({ create: { width: 400, height: 500, channels: 3, background: "#dddddd" } }).png({ compressionLevel: 9 }).toBuffer()],
  ["cmyk-ish tiff", async () => sharp({ create: { width: 400, height: 500, channels: 3, background: "#dddddd" } }).tiff().toBuffer()],
  ["animated-ish gif", async () => sharp({ create: { width: 300, height: 300, channels: 3, background: "#aaaaaa" } }).gif().toBuffer()],
];
for (const [name, make] of edge) {
  try {
    const r = await enhanceDocumentBuffer(await make());
    check(r.buffer.length > 0 && r.width > 0, `handles ${name}`, `-> ${r.width}x${r.height}`);
  } catch (e) {
    check(false, `handles ${name}`, `threw: ${(e as Error).message}`);
  }
}
{
  const bad = Buffer.from("this is definitely not an image");
  check(!(await isDecodableImage(bad)), "isDecodableImage rejects non-image bytes");
  const good = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  check(await isDecodableImage(good), "isDecodableImage accepts a real jpeg");
  let threw = false;
  try { await enhanceDocumentBuffer(bad); } catch { threw = true; }
  check(threw, "enhance throws on undecodable input");
}
{
  const s = normalizeSettings({ brightness: 99, contrast: -5, grayscale: "yes" });
  check(s.brightness === 2 && s.contrast === 0.5 && s.grayscale === false, "settings are clamped and coerced", JSON.stringify(s));
  const d = normalizeSettings(undefined);
  check(d.brightness === 1 && d.contrast === 1, "missing settings fall back to neutral", JSON.stringify(d));
}

// ------------------------------------------------------------------- thumbnails
console.log("\n--- previews ---");
{
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#646464" } }).jpeg().toBuffer();
  const t = await sharp(await createThumbnailBuffer(big)).metadata();
  check(t.width === 480 && t.height === 320, "thumbnail fits in 480px", `${t.width}x${t.height}`);
  const pv = await sharp(await createPreviewBuffer(big)).metadata();
  check(pv.width === 1400, "preview fits in 1400px", `${pv.width}x${pv.height}`);
  const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#646464" } }).jpeg().toBuffer();
  const st = await sharp(await createThumbnailBuffer(small)).metadata();
  check(st.width === 100, "small image is not upscaled", `${st.width}x${st.height}`);
}

// ------------------------------------------------------------------ performance
console.log("\n--- performance (Vercel function budget) ---");
{
  const big = await photo({ imgW: 3024, imgH: 4032, pageX: 500, pageY: 620, pageW: 2000, pageH: 2800, bg: 46, paper: 234 });
  const t0 = Date.now();
  await enhanceDocumentBuffer(big);
  const ms = Date.now() - t0;
  check(ms < 8000, "12MP photo enhances within budget", `${ms}ms`);
}

console.log(`\n${pass + fail} checks: ${pass} pass, ${fail} fail`);
if (fail) {
  console.log("failed:\n  " + failures.join("\n  "));
  process.exit(1);
}
