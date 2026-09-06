import sharp from "sharp";

type Bounds = { x: number; y: number; w: number; h: number };

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

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

function detectPaperBounds(gray: Uint8Array, width: number, height: number): Bounds {
  // CONSERVATIVE: Start with Otsu threshold without aggressive adjustment
  const threshold = otsuThreshold(gray);
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= threshold) mask[i] = 1;
  }

  // Light erosion to disconnect obvious noise
  const eroded = new Uint8Array(mask.length);
  const r = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let keep = true;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r && keep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
            keep = false;
          }
        }
      }
      if (keep) eroded[i] = 1;
    }
  }

  const rowCount = new Int32Array(height);
  const colCount = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (eroded[y * width + x]) {
        rowCount[y]++;
        colCount[x]++;
      }
    }
  }

  // DOCUMENT-OPTIMIZED: Prefer tall/portrait aspect ratios typical of documents
  // Documents are usually taller than wide or roughly square
  const rowMin = Math.floor(height * 0.2); // At least 20% vertical coverage
  const colMin = Math.floor(width * 0.15); // At least 15% horizontal coverage

  const findBand = (counts: Int32Array, minVal: number) => {
    let bestStart = 0;
    let bestLen = 0;
    let start = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= minVal) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        const len = i - start;
        // Strong preference for bands that are more central (avoid edge detection)
        const distanceFromCenter = Math.abs(i + len/2 - counts.length/2);
        const normalizedDistance = distanceFromCenter / counts.length;
        // Prefer central bands and longer bands
        const score = len * (1 - normalizedDistance);

        if (score > bestLen * (1 - Math.abs(bestStart + bestLen/2 - counts.length/2) / counts.length) || bestLen === 0) {
          bestLen = len;
          bestStart = start;
        }
        start = -1;
      }
    }
    if (start >= 0) {
      const len = counts.length - start;
      const distanceFromCenter = Math.abs(start + len/2 - counts.length/2);
      const normalizedDistance = distanceFromCenter / counts.length;
      const score = len * (1 - normalizedDistance);

      if (score > bestLen * (1 - Math.abs(bestStart + bestLen/2 - counts.length/2) / counts.length) || bestLen === 0) {
        bestLen = len;
        bestStart = start;
      }
    }
    return bestLen > 0 ? { start: bestStart, end: bestStart + bestLen - 1 } : null;
  };

  const rowBand = findBand(rowCount, rowMin);
  if (!rowBand) return { x: 0, y: 0, w: width, h: height };

  const colSlice = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = rowBand.start; y <= rowBand.end; y++) {
      if (eroded[y * width + x]) c++;
    }
    colSlice[x] = c;
  }

  const colBand = findBand(colSlice, colMin);
  if (!colBand) return { x: 0, y: 0, w: width, h: height };

  // ENSURE DOCUMENT-LIKE ASPECT RATIO: Prefer taller-than-wide for documents
  let detectedX = colBand.start;
  let detectedY = rowBand.start;
  let detectedW = colBand.end - colBand.start + 1;
  let detectedH = rowBand.end - rowBand.start + 1;

  const aspectRatio = detectedW / detectedH;

  // If detected region is too wide, try to make it more document-like
  if (aspectRatio > 2.0) { // Wider than 2:1
    // Try to reduce width by finding narrower central region
    const centerX = detectedX + detectedW / 2;
    const targetWidth = Math.min(detectedW, detectedH * 1.8); // Aim for max 1.8:1
    detectedX = Math.max(0, Math.floor(centerX - targetWidth / 2));
    detectedW = Math.min(width - detectedX, targetWidth);
  } else if (aspectRatio < 0.5) { // Taller than 2:1 (might be over-cropped vertically)
    // Try to increase width slightly
    const centerY = detectedY + detectedH / 2;
    const targetHeight = Math.min(detectedH, detectedW * 2.0); // Don't let height exceed 2x width
    detectedY = Math.max(0, Math.floor(centerY - targetHeight / 2));
    detectedH = Math.min(height - detectedY, targetHeight);
  }

  // ADD PADDING: Include some margin around detected content
  const pad = Math.max(2, Math.round(Math.min(width, height) * 0.01)); // 1% padding
  const finalX = Math.max(0, detectedX - pad);
  const finalY = Math.max(0, detectedY - pad);
  const finalW = Math.min(width, detectedW + pad * 2);
  const finalH = Math.min(height, detectedH + pad * 2);

  // FINAL SANITY CHECK: Ensure we have a reasonable detection
  const finalAspectRatio = finalW / finalH;
  const finalAreaRatio = (finalW * finalH) / (width * height);

  // If detection is too small or too extreme, fall back to a more conservative approach
  if (finalAreaRatio < 0.05 || finalAspectRatio > 3 || finalAspectRatio < 0.3) {
    // Fallback: detect central region with document-like proportions
    const fallbackW = Math.floor(width * 0.8);
    const fallbackH = Math.floor(fallbackW * 1.3); // Aspect ratio ~1.3:1 (taller than wide)
    const fallbackX = Math.floor((width - fallbackW) / 2);
    const fallbackY = Math.floor((height - fallbackH) / 2);

    return {
      x: fallbackX,
      y: fallbackY,
      w: fallbackW,
      h: fallbackH,
    };
  }

  return {
    x: finalX,
    y: finalY,
    w: finalW,
    h: finalH,
  };
}

function clampExtract(
  bounds: Bounds,
  imgW: number,
  imgH: number
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(bounds.x, imgW - 1));
  const top = Math.max(0, Math.min(bounds.y, imgH - 1));
  const width = Math.max(1, Math.min(bounds.w, imgW - left));
  const height = Math.max(1, Math.min(bounds.h, imgH - top));
  return { left, top, width, height };
}

/** Server-side document scan: auto-crop + brighten using sharp. */
export async function enhanceDocumentBuffer(input: Buffer): Promise<Buffer> {
  try {
    console.log(`[EnhanceBuffer] Starting enhancement, input size: ${input.length} bytes`);

    const rotated = sharp(input).rotate();
    const meta = await rotated.metadata();
    const imgW = meta.width ?? 1;
    const imgH = meta.height ?? 1;

    console.log(`[EnhanceBuffer] Image dimensions: ${imgW}x${imgH}`);

    const analysisW = 1400;
    const { data, info } = await rotated
      .clone()
      .resize(analysisW, undefined, { withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    console.log(`[EnhanceBuffer] Analysis dimensions: ${info.width}x${info.height}`);

    const bounds = detectPaperBounds(data, info.width, info.height);
    console.log(`[EnhanceBuffer] Detected bounds:`, bounds);

    const scaleX = imgW / info.width;
    const scaleY = imgH / info.height;

    const extract = clampExtract(
      {
        x: Math.floor(bounds.x * scaleX),
        y: Math.floor(bounds.y * scaleY),
        w: Math.ceil(bounds.w * scaleX),
        h: Math.ceil(bounds.h * scaleY),
      },
      imgW,
      imgH
    );

    console.log(`[EnhanceBuffer] Extract area:`, extract);

    // If crop would barely change anything, fall back to sharp trim
    const cropArea = extract.width * extract.height;
    const fullArea = imgW * imgH;
    // IMPROVED: Allow more aggressive cropping
    const useExtract = cropArea < fullArea * 0.98 && cropArea > fullArea * 0.05;

    console.log(`[EnhanceBuffer] Crop area ratio: ${(cropArea/fullArea*100).toFixed(1)}%, useExtract: ${useExtract}`);

    let pipeline = rotated.clone();
    if (useExtract) {
      pipeline = pipeline.extract(extract);
      console.log(`[EnhanceBuffer] Using extract: {left: ${extract.left}, top: ${extract.top}, width: ${extract.width}, height: ${extract.height}}`);
    } else {
      pipeline = pipeline.trim({ threshold: 18 });
      console.log(`[EnhanceBuffer] Using trim fallback`);
    }

    const result = await pipeline
      .normalize()
      .modulate({ brightness: 1.1, saturation: 0.35 })
      .linear(1.3, -25)
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    console.log(`[EnhanceBuffer] Enhancement completed, output size: ${result.length} bytes`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[EnhanceBuffer] Enhancement failed:`, {
      error: message,
      stack,
      inputSize: input.length
    });
    throw error;
  }
}

/** Fast thumbnail for dashboard previews. */
export async function createThumbnailBuffer(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(480, 480, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}
