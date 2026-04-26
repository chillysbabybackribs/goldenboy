// Token-efficiency optimizer for image attachments sent to Codex.
//
// Codex vision cost scales with input image dimensions, not raw file size.
// On top of that, base64 data URLs on the WebSocket inflate bytes-on-wire by
// ~33%. This module downscales oversized images and re-encodes them into a
// compact format before they reach the provider, while leaving already-small
// images (and animated GIFs) untouched.
//
// Tuning references:
// - Anthropic image guidelines recommend ≤1568 px on the long edge for best
//   quality/token tradeoff.
// - OpenAI vision "high" detail scales images to fit 2048×2048 then to 768 px
//   short side; 1568 long edge still covers that path without waste.

export const IMAGE_MAX_EDGE = 1568;
export const IMAGE_PASSTHROUGH_MAX_BYTES = 400 * 1024;
export const IMAGE_JPEG_QUALITY = 0.85;

export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

export interface ImageOptimizationDecision {
  /** True when no work is required — caller should send the original bytes. */
  passthrough: boolean;
  /** Target dimensions for the re-encoded bitmap. Equals source when !resize. */
  targetWidth: number;
  targetHeight: number;
  /**
   * Candidate output media type for re-encoding. Final type depends on a
   * runtime alpha check for formats that support transparency.
   */
  outputType: Exclude<ImageMediaType, 'image/gif'>;
  /** If true, encoder must preserve alpha (output will be PNG). */
  mustPreserveAlpha: boolean;
}

/**
 * Pure decision function: given the source image's intrinsic dimensions,
 * byte size, and media type, return how the caller should encode it.
 *
 * Rules:
 * - GIFs are always passthrough (animation would be lost on canvas re-encode).
 * - Images within both the pixel budget and the byte budget are passthrough.
 * - Oversized images are resized to fit IMAGE_MAX_EDGE on the long edge.
 * - PNG/WebP sources may preserve alpha; JPEG sources are always opaque.
 */
export function decideImageOptimization(
  width: number,
  height: number,
  byteSize: number,
  mediaType: string,
): ImageOptimizationDecision {
  const normalizedType = normalizeMediaType(mediaType);

  if (normalizedType === 'image/gif') {
    return {
      passthrough: true,
      targetWidth: width,
      targetHeight: height,
      outputType: 'image/jpeg',
      mustPreserveAlpha: false,
    };
  }

  const longEdge = Math.max(width, height);
  const needsResize = longEdge > IMAGE_MAX_EDGE;
  const needsReencode = byteSize > IMAGE_PASSTHROUGH_MAX_BYTES;

  if (!needsResize && !needsReencode) {
    return {
      passthrough: true,
      targetWidth: width,
      targetHeight: height,
      outputType: 'image/jpeg',
      mustPreserveAlpha: false,
    };
  }

  const scale = needsResize ? IMAGE_MAX_EDGE / longEdge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  // Opaque sources (JPEG) — JPEG is the token/byte-efficient choice.
  // PNG/WebP *may* carry alpha; the runtime encoder inspects pixels and flips
  // to PNG output when transparency is detected.
  const mustPreserveAlpha =
    normalizedType === 'image/png' || normalizedType === 'image/webp';

  return {
    passthrough: false,
    targetWidth,
    targetHeight,
    outputType: mustPreserveAlpha ? 'image/png' : 'image/jpeg',
    mustPreserveAlpha,
  };
}

export function normalizeMediaType(mediaType: string | undefined): ImageMediaType {
  const t = (mediaType ?? '').toLowerCase();
  if (t === 'image/png') return 'image/png';
  if (t === 'image/gif') return 'image/gif';
  if (t === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

export function extensionForMediaType(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'jpg';
  }
}

export function renameForMediaType(name: string, mediaType: ImageMediaType): string {
  const base = (name || '').replace(/\.[^./\\]+$/, '').trim() || 'image';
  return `${base}.${extensionForMediaType(mediaType)}`;
}

// ─── DOM pipeline ─────────────────────────────────────────────────────────
//
// Everything below touches the browser canvas / image APIs and is not used by
// the node-environment unit tests. Keep it thin and let the pure decision
// function above do the reasoning.

export interface OptimizedImage {
  /** Base64-encoded image payload (no data-URL prefix). */
  data: string;
  mediaType: ImageMediaType;
  name: string;
  originalBytes: number;
  optimizedBytes: number;
  /** True when the bytes differ from the source file. */
  reencoded: boolean;
}

export async function optimizeImageForCodex(file: File): Promise<OptimizedImage> {
  const sourceType = normalizeMediaType(file.type);

  // Fast path before we try to decode dimensions: GIFs are always passthrough.
  if (sourceType === 'image/gif') {
    return passthrough(file, sourceType);
  }

  let bitmap: CanvasImageSource & { width?: number; height?: number };
  let width = 0;
  let height = 0;
  try {
    const decoded = await decodeImage(file);
    bitmap = decoded.source;
    width = decoded.width;
    height = decoded.height;
  } catch {
    // Decode failure → send the raw bytes and let Codex handle it.
    return passthrough(file, sourceType);
  }

  const decision = decideImageOptimization(width, height, file.size, sourceType);
  if (decision.passthrough) {
    return passthrough(file, sourceType);
  }

  const canvas = document.createElement('canvas');
  canvas.width = decision.targetWidth;
  canvas.height = decision.targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return passthrough(file, sourceType);
  }
  ctx.drawImage(bitmap, 0, 0, decision.targetWidth, decision.targetHeight);

  const hasAlpha =
    decision.mustPreserveAlpha &&
    canvasHasTransparency(ctx, decision.targetWidth, decision.targetHeight);
  const outputType: ImageMediaType = hasAlpha ? 'image/png' : 'image/jpeg';
  const quality = outputType === 'image/jpeg' ? IMAGE_JPEG_QUALITY : undefined;

  let blob: Blob;
  try {
    blob = await canvasToBlob(canvas, outputType, quality);
  } catch {
    return passthrough(file, sourceType);
  }

  // If re-encoding actually grew the byte size (rare, mostly on tiny images
  // where JPEG headers outweigh savings), keep the original bytes.
  if (blob.size >= file.size && decision.targetWidth === width && decision.targetHeight === height) {
    return passthrough(file, sourceType);
  }

  const data = await blobToBase64(blob);
  return {
    data,
    mediaType: outputType,
    name: renameForMediaType(file.name, outputType),
    originalBytes: file.size,
    optimizedBytes: blob.size,
    reencoded: true,
  };
}

async function passthrough(file: File, mediaType: ImageMediaType): Promise<OptimizedImage> {
  const data = await fileToBase64(file);
  return {
    data,
    mediaType,
    name: file.name || `image.${extensionForMediaType(mediaType)}`,
    originalBytes: file.size,
    optimizedBytes: file.size,
    reencoded: false,
  };
}

interface DecodedImage {
  source: CanvasImageSource & { width?: number; height?: number };
  width: number;
  height: number;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to <img> decode — some exotic formats round-trip more
      // reliably through the DOM decoder.
    }
  }

  return new Promise<DecodedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function canvasHasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    // Stride-sample along the alpha channel. For a 1568×1568 canvas this is
    // still a few hundred thousand reads, but all sequential, so it runs in
    // single-digit ms even on modest hardware.
    const stride = Math.max(4, Math.floor((width * height) / 5000) * 4);
    for (let i = 3; i < data.length; i += stride) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // Fail safe: if we can't read pixels (taint, OOM), preserve alpha so we
    // don't silently drop transparency on UI screenshots.
    return true;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`canvas.toBlob returned null for ${type}`));
      },
      type,
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
