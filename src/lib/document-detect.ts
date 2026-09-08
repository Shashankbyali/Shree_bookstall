/**
 * Paper-edge detection shared by the browser scanner and the server pipeline.
 *
 * Pure arithmetic only — no canvas, no sharp — so both sides run the exact same
 * algorithm. Callers supply a downscaled greyscale + colour view of the photo;
 * see `analysisFromInterleaved` for building one from raw pixel bytes.
 */

export type Bounds = { x: number; y: number; w: number; h: number };

/** Normalised crop rect (0..1), independent of the analysis resolution. */
export type NormalizedCrop = { x: number; y: number; w: number; h: number };

export type Analysis = {
  gray: Float32Array;
  /** Interleaved colour samples, `channels` bytes per pixel. */
  rgb: Uint8Array | Uint8ClampedArray;
  channels: number;
  width: number;
  height: number;
};

/** Longest edge used for detection. Small enough to stay fast on a phone photo. */
export const ANALYSIS_MAX_SIDE = 1000;

export function analysisFromInterleaved(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number
): Analysis {
  const gray = new Float32Array(width * height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * channels;
    gray[p] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
  }
  return { gray, rgb, channels, width, height };
}

function histogram(gray: Float32Array): Int32Array {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
  }
  return hist;
}

/** Otsu threshold — separates paper from floor/background. */
function otsuThreshold(hist: Int32Array, total: number): number {
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
 * Intensity percentile from the histogram. Paper is normally among the
 * brightest parts of a phone photo; combining this with Otsu stops a
 * light-coloured desk or floor from being treated as part of the page.
 */
function intensityPercentile(hist: Int32Array, count: number, percentile: number): number {
  const target = Math.max(0, Math.min(count - 1, Math.floor(count * percentile)));
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

/** Bright-pixel mask, excluding fingers in the corners. */
function buildPaperMask(a: Analysis, threshold: number): Uint8Array {
  const { gray, rgb, channels, width, height } = a;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (gray[i] < threshold) continue;
      if (inCornerRegion(x, y, width, height)) {
        const o = i * channels;
        if (isSkinTone(rgb[o], rgb[o + 1], rgb[o + 2])) continue;
      }
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Close small holes, then erode. Closing matters for real documents: text and
 * figures punch dark holes through the paper mask, and without filling them the
 * page fragments into dozens of little components.
 */
function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(morph(mask, width, height, radius, "dilate"), width, height, radius, "erode");
}

/**
 * Separable morphology in O(pixels), independent of radius.
 *
 * Each pass keeps a running count of set pixels in the sliding window, so a
 * radius-22 close costs the same as radius-2. The naive nested-loop version is
 * O(pixels x radius) and dominated the whole detector's runtime.
 */
function morph(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  op: "dilate" | "erode"
): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) count += mask[row + x];
    for (let x = 0; x < width; x++) {
      const lo = x - radius;
      const hi = x + radius;
      const window = Math.min(hi, width - 1) - Math.max(lo, 0) + 1;
      tmp[row + x] = op === "dilate" ? (count > 0 ? 1 : 0) : count === window ? 1 : 0;
      // slide: drop the leaving column, add the entering one
      if (lo >= 0) count -= mask[row + lo];
      if (hi + 1 < width) count += mask[row + hi + 1];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) count += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const lo = y - radius;
      const hi = y + radius;
      const window = Math.min(hi, height - 1) - Math.max(lo, 0) + 1;
      out[y * width + x] = op === "dilate" ? (count > 0 ? 1 : 0) : count === window ? 1 : 0;
      if (lo >= 0) count -= tmp[lo * width + x];
      if (hi + 1 < height) count += tmp[(hi + 1) * width + x];
    }
  }

  return out;
}

/** Largest contiguous bright region (disconnects a hand from the paper). */
function largestComponentBounds(
  mask: Uint8Array,
  width: number,
  height: number
): Bounds | null {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best: Bounds | null = null;
  let bestArea = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let minX = start % width;
    let maxX = minX;
    let minY = (start / width) | 0;
    let maxY = minY;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;

    while (top > 0) {
      const idx = stack[--top];
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack[top++] = idx - 1;
      }
      if (x < width - 1 && mask[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack[top++] = idx + 1;
      }
      if (y > 0 && mask[idx - width] && !visited[idx - width]) {
        visited[idx - width] = 1;
        stack[top++] = idx - width;
      }
      if (y < height - 1 && mask[idx + width] && !visited[idx + width]) {
        visited[idx + width] = 1;
        stack[top++] = idx + width;
      }
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (area > bestArea && area / (w * h) > 0.5 && w > width * 0.2 && h > height * 0.2) {
      bestArea = area;
      best = { x: minX, y: minY, w, h };
    }
  }
  return best;
}

/**
 * Row/column projection. Thresholds are taken against the length of the axis
 * being summed (a row can hold at most `width` bright pixels), which is what
 * makes this usable at all.
 */
function projectionBounds(
  mask: Uint8Array,
  width: number,
  height: number,
  order: "rows" | "cols"
): Bounds | null {
  if (order === "cols") {
    const colCount = new Int32Array(width);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) if (mask[row + x]) colCount[x]++;
    }
    const colBand = widestBand(colCount, height * 0.25);
    if (!colBand) return null;

    const bandWidth = colBand.end - colBand.start + 1;
    const rowSlice = new Int32Array(height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let c = 0;
      for (let x = colBand.start; x <= colBand.end; x++) if (mask[row + x]) c++;
      rowSlice[y] = c;
    }
    const rowBand = widestBand(rowSlice, bandWidth * 0.25);
    if (!rowBand) return null;

    return {
      x: colBand.start,
      y: rowBand.start,
      w: bandWidth,
      h: rowBand.end - rowBand.start + 1,
    };
  }

  const rowCount = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let c = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) if (mask[row + x]) c++;
    rowCount[y] = c;
  }

  const rowBand = widestBand(rowCount, width * 0.25);
  if (!rowBand) return null;

  const bandHeight = rowBand.end - rowBand.start + 1;
  const colSlice = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = rowBand.start; y <= rowBand.end; y++) if (mask[y * width + x]) c++;
    colSlice[x] = c;
  }

  const colBand = widestBand(colSlice, bandHeight * 0.25);
  if (!colBand) return null;

  return {
    x: colBand.start,
    y: rowBand.start,
    w: colBand.end - colBand.start + 1,
    h: bandHeight,
  };
}

/** Longest run of indices whose count clears `minVal`. */
function widestBand(counts: Int32Array, minVal: number) {
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;

  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] >= minVal;
    if (on) {
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
  return bestLen > 0 ? { start: bestStart, end: bestStart + bestLen - 1 } : null;
}

/**
 * Trim shadow halos by scanning inward until a row/col is mostly paper-bright.
 * `bright` is derived from the candidate's own interior, not a fixed constant —
 * an underexposed page may peak around 100, and a hardcoded threshold would
 * shave 6% off every edge of it.
 */
function trimShadowMargins(
  gray: Float32Array,
  bounds: Bounds,
  width: number,
  height: number,
  bright: number
): Bounds {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.w - 1;
  let bottom = bounds.y + bounds.h - 1;

  const rowBrightRatio = (ry: number, x0: number, x2: number) => {
    let n = 0;
    for (let cx = x0; cx <= x2; cx++) if (gray[ry * width + cx] > bright) n++;
    return n / (x2 - x0 + 1);
  };
  const colBrightRatio = (cx: number, y0: number, y2: number) => {
    let n = 0;
    for (let cy = y0; cy <= y2; cy++) if (gray[cy * width + cx] > bright) n++;
    return n / (y2 - y0 + 1);
  };

  const maxTrim = Math.floor(Math.min(bounds.w, bounds.h) * 0.06);
  for (let t = 0; t < maxTrim && top < bottom; t++) {
    if (rowBrightRatio(top, left, right) >= 0.55) break;
    top++;
  }
  for (let t = 0; t < maxTrim && top < bottom; t++) {
    if (rowBrightRatio(bottom, left, right) >= 0.55) break;
    bottom--;
  }
  for (let t = 0; t < maxTrim && left < right; t++) {
    if (colBrightRatio(left, top, bottom) >= 0.55) break;
    left++;
  }
  for (let t = 0; t < maxTrim && left < right; t++) {
    if (colBrightRatio(right, top, bottom) >= 0.55) break;
    right--;
  }

  return clampBounds({ x: left, y: top, w: right - left + 1, h: bottom - top + 1 }, width, height);
}

function clampBounds(b: Bounds, width: number, height: number): Bounds {
  const x = Math.max(0, Math.min(Math.round(b.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(b.y), height - 1));
  const w = Math.max(1, Math.min(Math.round(b.w), width - x));
  const h = Math.max(1, Math.min(Math.round(b.h), height - y));
  return { x, y, w, h };
}

/**
 * Intensity statistics over a rectangle, subsampled to keep the cost bounded.
 *
 * `level` is a high percentile rather than the mean, and it is what comparisons
 * should use: on a page full of text the mean is dragged far below the paper
 * itself (ink is ~20% of the pixels), which makes a white page on a pale desk
 * look like it has no contrast at all. The percentile tracks the paper.
 */
function regionStats(
  gray: Float32Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
  percentile = 0.7
): { mean: number; level: number; count: number } {
  // Histogram rather than sort-an-array: this runs thousands of times per image.
  const hist = new Int32Array(256);
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += step) {
    const row = y * width;
    for (let x = x0; x <= x1; x += step) {
      const v = gray[row + x];
      sum += v;
      hist[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)]++;
      count++;
    }
  }
  if (!count) return { mean: 0, level: 0, count: 0 };

  const target = Math.floor(count * percentile);
  let seen = 0;
  let level = 255;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen > target) {
      level = v;
      break;
    }
  }
  return { mean: sum / count, level, count };
}

/**
 * Score a candidate on the evidence that it really is a sheet of paper: a
 * uniformly bright interior surrounded by a visibly darker border.
 *
 * Deliberately *not* based on tightness. Rewarding smaller rectangles — as the
 * previous implementation did — makes the detector prefer a crop that slices
 * through the middle of the page, which silently destroys the customer's
 * document. Here a candidate only wins if the pixels outside it are darker than
 * the pixels inside it, so cropping is always justified by real contrast.
 *
 * Returns 0 for "no usable evidence"; the caller then leaves the image alone.
 */
function scoreBounds(a: Analysis, b: Bounds): number {
  return scoreBoundsExplain(a, b).score;
}

/** Score plus its inputs, so a surprising detection can be traced. */
export function scoreBoundsExplain(a: Analysis, b: Bounds) {
  const out = {
    score: 0,
    ratio: 0,
    aspect: 0,
    interiorMean: 0,
    sideMeans: [] as number[],
    contrast: 0,
    fill: 0,
    reject: "",
  };
  const { gray, width, height } = a;
  const ratio = (b.w * b.h) / (width * height);
  out.ratio = ratio;
  // Below 12% we are almost certainly locked onto a specular highlight.
  // Above 94% there is nothing worth cropping away.
  if (ratio < 0.12 || ratio > 0.94) return (out.reject = "ratio"), out;

  const aspect = b.w / b.h;
  out.aspect = aspect;
  if (aspect < 0.25 || aspect > 4) return (out.reject = "aspect"), out;

  const step = Math.max(1, Math.round(Math.min(b.w, b.h) / 60));
  const inset = Math.round(Math.min(b.w, b.h) * 0.04);
  const ix0 = b.x + inset;
  const iy0 = b.y + inset;
  const ix1 = b.x + b.w - 1 - inset;
  const iy1 = b.y + b.h - 1 - inset;
  if (ix1 <= ix0 || iy1 <= iy0) return (out.reject = "degenerate"), out;

  const interior = regionStats(gray, width, ix0, iy0, ix1, iy1, step);
  out.interiorMean = interior.level;

  // Sample a ring just outside each edge, skipping edges that sit on the image
  // border (nothing to compare against there). The band is wide enough to span
  // several lines of text, so it averages out rather than landing on one line.
  const band = Math.max(4, Math.round(Math.min(width, height) * 0.03));
  const sideMeans: number[] = [];

  if (b.y - band >= 0) {
    sideMeans.push(regionStats(gray, width, b.x, b.y - band, b.x + b.w - 1, b.y - 1, step).level);
  }
  if (b.y + b.h + band <= height) {
    sideMeans.push(
      regionStats(gray, width, b.x, b.y + b.h, b.x + b.w - 1, b.y + b.h + band - 1, step).level
    );
  }
  if (b.x - band >= 0) {
    sideMeans.push(regionStats(gray, width, b.x - band, b.y, b.x - 1, b.y + b.h - 1, step).level);
  }
  if (b.x + b.w + band <= width) {
    sideMeans.push(
      regionStats(gray, width, b.x + b.w, b.y, b.x + b.w + band - 1, b.y + b.h - 1, step).level
    );
  }

  // With fewer than two free edges the "page" is really just the frame.
  const sides = sideMeans.length;
  out.sideMeans = sideMeans;
  if (sides < 2) return (out.reject = "sides"), out;

  // Weakest link, not the average. A sliver cut out of the middle of a page has
  // page on two of its sides, so averaging can still look high-contrast while
  // every real page has *all* of its free edges surrounded by background.
  const contrast = interior.level - Math.max(...sideMeans);
  out.contrast = contrast;
  if (contrast < 14) return (out.reject = "contrast"), out;

  // Interior must genuinely read as paper rather than a busy scene.
  const paperLevel = Math.max(60, interior.level * 0.72);
  let paperish = 0;
  for (let y = iy0; y <= iy1; y += step) {
    const row = y * width;
    for (let x = ix0; x <= ix1; x += step) if (gray[row + x] > paperLevel) paperish++;
  }
  const fill = interior.count ? paperish / interior.count : 0;
  out.fill = fill;
  if (fill < 0.55) return (out.reject = "fill"), out;

  const contrastScore = Math.min(1, contrast / 60);
  const edgeScore = sides / 4;
  // Mild preference for covering more of the frame, so that between two
  // equally well-evidenced rectangles we keep the more generous one.
  out.score = contrastScore * fill * (0.55 + 0.45 * edgeScore) * (0.6 + 0.4 * ratio);
  return out;
}

/**
 * Locate the page in a photo.
 *
 * Returns `null` when nothing convincing is found — callers must then leave the
 * image uncropped. Never guess a rectangle: a wrong crop silently destroys part
 * of the customer's document.
 */
export function detectDocumentBounds(a: Analysis): Bounds | null {
  const ranked = rankDocumentCandidates(a);
  return ranked.length ? ranked[0].bounds : null;
}

export type ScoredCandidate = { bounds: Bounds; score: number; source: string };

/**
 * Every plausible page rectangle, best first. Exposed so the detector can be
 * inspected from tests instead of guessed at.
 */
export function rankDocumentCandidates(a: Analysis): ScoredCandidate[] {
  const { gray, width, height } = a;
  const hist = histogram(gray);
  const otsu = otsuThreshold(hist, gray.length);

  // Several thresholds, because one number cannot cover both "white page on a
  // dark desk" and "grey page in a dim room".
  const thresholds = [
    ...new Set([
      Math.min(235, Math.max(otsu + 12, intensityPercentile(hist, gray.length, 0.52), 95)),
      Math.max(60, otsu),
      Math.max(40, otsu - 20),
      intensityPercentile(hist, gray.length, 0.35),
    ]),
  ];

  const raw: { b: Bounds; source: string }[] = [];

  for (const threshold of thresholds) {
    const paper = buildPaperMask(a, threshold);
    // Closing radius has to be large enough to bridge lines of text, otherwise
    // the page fragments into horizontal strips and only slivers get proposed.
    for (const radius of [
      Math.max(2, Math.round(Math.min(width, height) * 0.006)),
      Math.max(6, Math.round(Math.min(width, height) * 0.022)),
    ]) {
      const mask = closeMask(paper, width, height, radius);
      const tag = `t${threshold}r${radius}`;

      const component = largestComponentBounds(mask, width, height);
      if (component) raw.push({ b: component, source: `${tag}:component` });

      // Rows-first breaks on text lines; columns-first survives them, because a
      // column crosses the blank gaps between lines. Both are cheap, so try each.
      const rows = projectionBounds(mask, width, height, "rows");
      if (rows) raw.push({ b: rows, source: `${tag}:rows` });
      const cols = projectionBounds(mask, width, height, "cols");
      if (cols) raw.push({ b: cols, source: `${tag}:cols` });

      for (const [p, q, label] of [
        [component, rows, "component^rows"],
        [component, cols, "component^cols"],
        [rows, cols, "rows^cols"],
      ] as const) {
        if (!p || !q) continue;
        const x = Math.max(p.x, q.x);
        const y = Math.max(p.y, q.y);
        raw.push({
          b: {
            x,
            y,
            w: Math.min(p.x + p.w, q.x + q.w) - x,
            h: Math.min(p.y + p.h, q.y + q.h) - y,
          },
          source: `${tag}:${label}`,
        });
        // Union too: text touching an edge can clip one of the projections.
        const ux = Math.min(p.x, q.x);
        const uy = Math.min(p.y, q.y);
        raw.push({
          b: {
            x: ux,
            y: uy,
            w: Math.max(p.x + p.w, q.x + q.w) - ux,
            h: Math.max(p.y + p.h, q.y + q.h) - uy,
          },
          source: `${tag}:${label}|union`,
        });
      }
    }
  }

  const scored: ScoredCandidate[] = [];
  const seen = new Set<string>();

  for (const { b, source } of raw) {
    if (b.w <= 0 || b.h <= 0) continue;
    const clamped = clampBounds(b, width, height);
    const step = Math.max(1, Math.round(Math.min(clamped.w, clamped.h) / 60));
    const interior = regionStats(
      gray,
      width,
      clamped.x,
      clamped.y,
      clamped.x + clamped.w - 1,
      clamped.y + clamped.h - 1,
      step
    );
    const trimmed = trimShadowMargins(
      gray,
      clamped,
      width,
      height,
      Math.max(50, interior.mean * 0.75)
    );

    // Score with and without the shadow trim: on a page with dark content near
    // the edge the trim can bite into real content, so let the evidence decide.
    for (const [cand, suffix] of [
      [trimmed, "+trim"],
      [clamped, ""],
    ] as const) {
      const pad = Math.max(1, Math.round(Math.min(cand.w, cand.h) * 0.008));
      const padded = clampBounds(
        { x: cand.x - pad, y: cand.y - pad, w: cand.w + pad * 2, h: cand.h + pad * 2 },
        width,
        height
      );
      const key = `${padded.x},${padded.y},${padded.w},${padded.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const score = scoreBounds(a, padded);
      if (score > 0) scored.push({ bounds: padded, score, source: source + suffix });
    }
  }

  return scored.sort((p, q) => q.score - p.score);
}

export function toNormalizedCrop(b: Bounds, width: number, height: number): NormalizedCrop {
  return { x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height };
}

/** Map a normalised crop onto real pixels, clamped to stay inside the image. */
export function fromNormalizedCrop(
  crop: NormalizedCrop,
  imgW: number,
  imgH: number
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(Math.floor(crop.x * imgW), imgW - 1));
  const top = Math.max(0, Math.min(Math.floor(crop.y * imgH), imgH - 1));
  const width = Math.max(1, Math.min(Math.round(crop.w * imgW), imgW - left));
  const height = Math.max(1, Math.min(Math.round(crop.h * imgH), imgH - top));
  return { left, top, width, height };
}

export function isValidNormalizedCrop(c: unknown): c is NormalizedCrop {
  if (!c || typeof c !== "object") return false;
  const { x, y, w, h } = c as Record<string, unknown>;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const cx = x as number, cy = y as number, cw = w as number, ch = h as number;
  return cx >= 0 && cy >= 0 && cw > 0 && ch > 0 && cx + cw <= 1.0001 && cy + ch <= 1.0001;
}
