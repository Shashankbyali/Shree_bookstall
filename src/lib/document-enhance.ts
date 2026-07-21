/**
 * Client-side document scanner: auto-crop + brighten/contrast like mobile doc apps.
 */

type Bounds = { x: number; y: number; w: number; h: number };
type RgbCtx = { gray: Float32Array; rgba: Uint8ClampedArray; width: number; height: number };

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    if (typeof src === "string") {
      img.src = src;
    } else {
      img.src = URL.createObjectURL(src);
    }
  });
}

function readCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): RgbCtx {
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, rgba: data, width, height };
}

/** Otsu threshold — separates paper from floor/background. */
function otsuThreshold(gray: Float32Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  }
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVar) {
      maxVar = variance;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Return an intensity percentile without sorting every pixel.  The paper is
 * normally among the brightest parts of a phone photo; using this alongside
 * Otsu avoids treating a light-coloured desk or floor as part of the page.
 */
function intensityPercentile(gray: Float32Array, percentile: number): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  }

  const target = Math.max(0, Math.min(gray.length - 1, Math.floor(gray.length * percentile)));
  let total = 0;
  for (let value = 0; value < hist.length; value++) {
    total += hist[value];
    if (total > target) return value;
  }
  return 255;
}

function isSkinTone(r: number, g: number, b: number): boolean {
  return r > 60 && g > 40 && b > 20 && r > g && r > b && r - g > 12 && r - b > 12;
}

function inCornerRegion(x: number, y: number, w: number, h: number): boolean {
  const mx = w * 0.22;
  const my = h * 0.22;
  return (
    (x < mx && y < my) ||
    (x > w - mx && y < my) ||
    (x < mx && y > h - my) ||
    (x > w - mx && y > h - my)
  );
}

/** Build paper mask: bright pixels, excluding skin in corners and dark shadows. */
function buildPaperMask({ gray, rgba, width, height }: RgbCtx): Uint8Array {
  // The old `otsu - 8` threshold was too permissive for photos taken on a
  // pale desk: the desk and the page became one component, so no crop was
  // selected. Prefer the brighter half of the image as well as the Otsu split.
  // The cap keeps slightly grey pages detectable in a dark photo.
  const threshold = Math.min(
    235,
    Math.max(otsuThreshold(gray) + 12, intensityPercentile(gray, 0.52), 95)
  );
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const g = gray[i];
      const r = rgba[i * 4];
      const gr = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];

      if (inCornerRegion(x, y, width, height) && isSkinTone(r, gr, b)) continue;
      if (g >= threshold) mask[i] = 1;
    }
  }

  return mask;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy++) {
        for (let dx = -radius; dx <= radius && keep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            keep = false;
          }
        }
      }
      if (keep) out[i] = 1;
    }
  }
  return out;
}

/** Largest contiguous bright region after erosion (disconnects hand from paper). */
function largestComponentBounds(
  mask: Uint8Array,
  width: number,
  height: number
): Bounds | null {
  const visited = new Uint8Array(mask.length);
  let best: Bounds | null = null;
  let bestArea = 0;

  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const start = sy * width + sx;
      if (!mask[start] || visited[start]) continue;

      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      let area = 0;
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const idx = stack.pop()!;
        const x = idx % width;
        const y = (idx / width) | 0;
        area++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        for (const n of [idx - 1, idx + 1, idx - width, idx + width]) {
          if (n < 0 || n >= mask.length) continue;
          if (Math.abs((n % width) - x) > 1) continue;
          if (!mask[n] || visited[n]) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const fill = area / (w * h);
      if (
        area > bestArea &&
        fill > 0.5 &&
        w > width * 0.2 &&
        h > height * 0.2
      ) {
        bestArea = area;
        best = { x: minX, y: minY, w, h };
      }
    }
  }
  return best;
}

/** Row/column projection — finds paper band even with uneven edges. */
function projectionBounds(
  mask: Uint8Array,
  width: number,
  height: number
): Bounds | null {
  const rowCount = new Float32Array(height);
  const colCount = new Float32Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        rowCount[y]++;
        colCount[x]++;
      }
    }
  }

  const rowMin = width * 0.28;

  const findBand = (counts: Float32Array, minVal: number) => {
    let bestStart = 0;
    let bestLen = 0;
    let start = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= minVal) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        const len = i - start;
        if (len > bestLen) {
          bestLen = len;
          bestStart = start;
        }
        start = -1;
      }
    }
    if (start >= 0) {
      const len = counts.length - start;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    }
    return bestLen > 0 ? { start: bestStart, end: bestStart + bestLen - 1 } : null;
  };

  const rowBand = findBand(rowCount, rowMin);
  if (!rowBand) return null;

  const colSlice = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = rowBand.start; y <= rowBand.end; y++) {
      if (mask[y * width + x]) c++;
    }
    colSlice[x] = c;
  }

  const colBand = findBand(colSlice, (rowBand.end - rowBand.start + 1) * 0.28);
  if (!colBand) return null;

  return {
    x: colBand.start,
    y: rowBand.start,
    w: colBand.end - colBand.start + 1,
    h: rowBand.end - rowBand.start + 1,
  };
}

/** Trim shadow halos by scanning inward until row/col is mostly paper-bright. */
function trimShadowMargins(
  gray: Float32Array,
  bounds: Bounds,
  width: number,
  height: number
): Bounds {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.w - 1;
  let bottom = bounds.y + bounds.h - 1;

  const rowBrightRatio = (ry: number, x0: number, x2: number) => {
    let bright = 0;
    const n = x2 - x0 + 1;
    for (let cx = x0; cx <= x2; cx++) {
      if (gray[ry * width + cx] > 140) bright++;
    }
    return bright / n;
  };

  const colBrightRatio = (cx: number, y0: number, y2: number) => {
    let bright = 0;
    const n = y2 - y0 + 1;
    for (let cy = y0; cy <= y2; cy++) {
      if (gray[cy * width + cx] > 140) bright++;
    }
    return bright / n;
  };

  const maxTrim = Math.floor(Math.min(bounds.w, bounds.h) * 0.06);
  for (let t = 0; t < maxTrim; t++) {
    if (top >= bottom) break;
    if (rowBrightRatio(top, left, right) < 0.55) top++;
    else break;
  }
  for (let t = 0; t < maxTrim; t++) {
    if (top >= bottom) break;
    if (rowBrightRatio(bottom, left, right) < 0.55) bottom--;
    else break;
  }
  for (let t = 0; t < maxTrim; t++) {
    if (left >= right) break;
    if (colBrightRatio(left, top, bottom) < 0.55) left++;
    else break;
  }
  for (let t = 0; t < maxTrim; t++) {
    if (left >= right) break;
    if (colBrightRatio(right, top, bottom) < 0.55) right--;
    else break;
  }

  return clampBounds(
    {
      x: left,
      y: top,
      w: right - left + 1,
      h: bottom - top + 1,
    },
    width,
    height
  );
}

function clampBounds(b: Bounds, width: number, height: number): Bounds {
  const x = Math.max(0, Math.min(b.x, width - 1));
  const y = Math.max(0, Math.min(b.y, height - 1));
  const w = Math.max(1, Math.min(b.w, width - x));
  const h = Math.max(1, Math.min(b.h, height - y));
  return { x, y, w, h };
}

function area(b: Bounds) {
  return b.w * b.h;
}

function scoreBounds(b: Bounds, imgW: number, imgH: number): number {
  const a = area(b);
  const imgArea = imgW * imgH;
  const ratio = a / imgArea;
  if (ratio < 0.15 || ratio > 0.97) return -1;

  const aspect = b.w / b.h;
  if (aspect < 0.2 || aspect > 5) return -1;

  const tightness = 1 - ratio;
  const portraitBonus = aspect > 0.45 && aspect < 0.85 ? 0.12 : 0;
  const landscapeBonus = aspect > 1.1 && aspect < 2.2 ? 0.08 : 0;
  return tightness + portraitBonus + landscapeBonus;
}

function detectDocumentBounds(ctx: RgbCtx): Bounds {
  const { gray, width, height } = ctx;
  const rawMask = buildPaperMask(ctx);
  const eroded = erodeMask(rawMask, width, height, 3);

  const component = largestComponentBounds(eroded, width, height);
  const projection = projectionBounds(eroded, width, height);

  const candidates: Bounds[] = [];
  if (component) candidates.push(component);
  if (projection) candidates.push(projection);
  if (component && projection) {
    candidates.push({
      x: Math.max(component.x, projection.x),
      y: Math.max(component.y, projection.y),
      w: Math.min(component.x + component.w, projection.x + projection.w) - Math.max(component.x, projection.x),
      h: Math.min(component.y + component.h, projection.y + projection.h) - Math.max(component.y, projection.y),
    });
  }

  let best: Bounds = { x: 0, y: 0, w: width, h: height };
  let bestScore = -1;

  for (const c of candidates) {
    if (c.w <= 0 || c.h <= 0) continue;
    const trimmed = trimShadowMargins(gray, clampBounds(c, width, height), width, height);
    const pad = Math.max(1, Math.round(Math.min(trimmed.w, trimmed.h) * 0.008));
    const padded = clampBounds(
      {
        x: trimmed.x - pad,
        y: trimmed.y - pad,
        w: trimmed.w + pad * 2,
        h: trimmed.h + pad * 2,
      },
      width,
      height
    );
    const s = scoreBounds(padded, width, height);
    if (s > bestScore) {
      bestScore = s;
      best = padded;
    }
  }

  return best;
}

/** Document whitening: boost contrast, lift paper, deepen ink. */
function enhanceDocument(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  const luminances: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    luminances.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  luminances.sort((a, b) => a - b);
  const low = luminances[Math.floor(luminances.length * 0.02)] ?? 0;
  const high = luminances[Math.floor(luminances.length * 0.98)] ?? 255;
  const range = Math.max(high - low, 1);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    r = ((r - low) / range) * 255;
    g = ((g - low) / range) * 255;
    b = ((b - low) / range) * 255;

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = r * 0.35 + gray * 0.65;
    g = g * 0.35 + gray * 0.65;
    b = b * 0.35 + gray * 0.65;

    const contrast = 1.35;
    const brightness = 18;
    r = (r - 128) * contrast + 128 + brightness;
    g = (g - 128) * contrast + 128 + brightness;
    b = (b - 128) * contrast + 128 + brightness;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 200) {
      const t = (lum - 200) / 55;
      const lift = t * 40;
      r = Math.min(255, r + lift);
      g = Math.min(255, g + lift);
      b = Math.min(255, b + lift);
    } else if (lum < 90) {
      const t = (90 - lum) / 90;
      const deepen = t * 25;
      r = Math.max(0, r - deepen);
      g = Math.max(0, g - deepen);
      b = Math.max(0, b - deepen);
    }

    data[i] = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, b));
  }

  ctx.putImageData(imageData, 0, 0);
}

function downscaleForAnalysis(
  img: HTMLImageElement,
  maxSide = 1400
): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, scale };
}

/**
 * Auto-crop and brighten an image like a document scanner.
 * Returns a JPEG Blob of the enhanced result.
 */
export async function enhanceDocumentImage(
  source: string | Blob,
  quality = 0.92
): Promise<Blob> {
  const img = await loadImage(source);
  const { canvas: small, scale } = downscaleForAnalysis(img);
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("Canvas not supported");

  const ctx = readCanvas(sctx, small.width, small.height);
  const bounds = detectDocumentBounds(ctx);

  const sx = Math.floor(bounds.x / scale);
  const sy = Math.floor(bounds.y / scale);
  const sw = Math.min(img.width - sx, Math.ceil(bounds.w / scale));
  const sh = Math.min(img.height - sy, Math.ceil(bounds.h / scale));

  const out = document.createElement("canvas");
  out.width = Math.max(1, sw);
  out.height = Math.max(1, sh);
  const octx = out.getContext("2d", { willReadFrequently: true });
  if (!octx) throw new Error("Canvas not supported");

  octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  enhanceDocument(octx, sw, sh);

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode enhanced image"));
      },
      "image/jpeg",
      quality
    );
  });
}
