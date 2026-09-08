import sharp, { type Sharp } from "sharp";
import {
  ANALYSIS_MAX_SIDE,
  analysisFromInterleaved,
  detectDocumentBounds,
  fromNormalizedCrop,
  toNormalizedCrop,
  type NormalizedCrop,
} from "./document-detect";

/** Tunables the owner can nudge from the dashboard. */
export type EnhanceSettings = {
  /** Normalised crop rect. Omit to auto-detect. */
  crop?: NormalizedCrop;
  /** 0.5 (darker) .. 2 (brighter), 1 = leave alone. */
  brightness: number;
  /** 0.5 (flatter) .. 2 (punchier), 1 = leave alone. */
  contrast: number;
  /** Print as pure greyscale — smaller files and crisper text on a mono laser. */
  grayscale: boolean;
};

export const DEFAULT_ENHANCE_SETTINGS: EnhanceSettings = {
  brightness: 1,
  contrast: 1,
  grayscale: false,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalizeSettings(input: unknown): EnhanceSettings {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    brightness: clamp(Number(raw.brightness ?? 1) || 1, 0.5, 2),
    contrast: clamp(Number(raw.contrast ?? 1) || 1, 0.5, 2),
    grayscale: raw.grayscale === true,
  };
}

/** Decode + upright the image once, so every step sees the same orientation. */
function decode(input: Buffer) {
  // `flatten` is essential: without it sharp composites alpha onto black, so a
  // transparent PNG or screenshot prints as a grey/black rectangle.
  return sharp(input, { failOn: "error" })
    .rotate()
    .flatten({ background: "#ffffff" });
}

async function analyse(input: Buffer) {
  const { data, info } = await decode(input)
    .resize(ANALYSIS_MAX_SIDE, ANALYSIS_MAX_SIDE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  return analysisFromInterleaved(data, info.width, info.height, info.channels);
}

/**
 * Auto-detect the page rectangle, as a normalised crop.
 * Returns `null` when no convincing page is found — the caller should then not
 * crop at all rather than guess and cut off content.
 */
export async function detectCrop(input: Buffer): Promise<NormalizedCrop | null> {
  const analysis = await analyse(input);
  const bounds = detectDocumentBounds(analysis);
  return bounds ? toNormalizedCrop(bounds, analysis.width, analysis.height) : null;
}

/** Paper white / ink black targets. Not pure 255/0, to keep some tonal detail. */
const PAPER_TARGET = 246;
const INK_TARGET = 12;

/**
 * Work out the linear transform that puts this image's paper at white and its
 * ink at black. Returns null when the image is too flat to stretch safely (a
 * blank or solid-colour scan), where a huge gain would just amplify noise.
 */
async function measureLevels(
  pipeline: Sharp
): Promise<{ gain: number; offset: number } | null> {
  const { data } = await pipeline
    .clone()
    .resize(600, 600, { fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const hist = new Int32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const pct = (p: number) => {
    const target = Math.floor(data.length * p);
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen > target) return v;
    }
    return 255;
  };

  // 6th percentile tracks the ink, 88th the paper. Using the extremes instead
  // would let a single dust speck or blown highlight set the whole mapping.
  const ink = pct(0.06);
  const paper = pct(0.88);
  if (paper - ink < 12) return null;

  const gain = (PAPER_TARGET - INK_TARGET) / (paper - ink);
  // Cap the gain so a very flat original does not turn into pure noise.
  const capped = Math.min(gain, 4);
  return { gain: capped, offset: INK_TARGET - capped * ink };
}

export type EnhanceResult = {
  buffer: Buffer;
  /** The crop actually applied, or null when the image was left full-frame. */
  crop: NormalizedCrop | null;
  width: number;
  height: number;
};

/**
 * Document scan: crop to the page, then lift the paper to white and deepen the
 * ink. Always call this with the *original* upload so repeated adjustments never
 * compound on top of an already-processed image.
 */
export async function enhanceDocumentBuffer(
  input: Buffer,
  settings: EnhanceSettings = DEFAULT_ENHANCE_SETTINGS
): Promise<EnhanceResult> {
  const meta = await decode(input).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (!imgW || !imgH) throw new Error("Image has no usable dimensions.");

  const crop = settings.crop ?? (await detectCrop(input));

  const cropped = () => {
    let p = decode(input);
    if (crop) {
      const extract = fromNormalizedCrop(crop, imgW, imgH);
      // A crop that keeps essentially the whole frame is not worth the re-encode.
      if (extract.width * extract.height < imgW * imgH * 0.995) p = p.extract(extract);
    }
    return p;
  };

  let pipeline = cropped();

  // Document levels: find where the paper and the ink actually sit, then stretch
  // so paper becomes near-white and ink near-black. This is what makes a dim
  // photo look scanned; sharp's normalize() only stretches to the extremes,
  // which on a noisy photo is already 0..255 and therefore does nothing.
  const levels = await measureLevels(cropped());
  if (levels) pipeline = pipeline.linear(levels.gain, levels.offset);

  if (settings.grayscale) {
    // toColourspace is needed as well as greyscale(): later ops re-expand to
    // sRGB, which would emit a 3-channel JPEG that only looks grey.
    pipeline = pipeline.greyscale().toColourspace("b-w");
  } else {
    // Documents photograph with a colour cast from room lighting. Pulling
    // saturation down neutralises it while keeping highlighter and stamps
    // visible.
    pipeline = pipeline.modulate({ saturation: 0.6 });
  }

  // Contrast pivots around mid-grey; brightness is a plain offset afterwards, so
  // the two controls stay independent instead of fighting each other.
  const a = settings.contrast;
  const b = 128 * (1 - settings.contrast) + (settings.brightness - 1) * 96;
  if (a !== 1 || b !== 0) pipeline = pipeline.linear(a, b);

  if (settings.grayscale) pipeline = pipeline.toColourspace("b-w");

  const { data, info } = await pipeline
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, crop: crop ?? null, width: info.width, height: info.height };
}

/** Fast thumbnail for dashboard previews. */
export async function createThumbnailBuffer(input: Buffer): Promise<Buffer> {
  return decode(input)
    .resize(480, 480, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}

/** Larger preview for the crop editor — enough detail to place the handles. */
export async function createPreviewBuffer(input: Buffer): Promise<Buffer> {
  return decode(input)
    .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

/** True when sharp can actually decode the bytes (guards against spoofed types). */
export async function isDecodableImage(input: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(input).metadata();
    return Boolean(meta.width && meta.height);
  } catch {
    return false;
  }
}
