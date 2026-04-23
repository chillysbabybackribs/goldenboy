import { describe, it, expect } from 'vitest';
import {
  IMAGE_MAX_EDGE,
  IMAGE_PASSTHROUGH_MAX_BYTES,
  decideImageOptimization,
  extensionForMediaType,
  normalizeMediaType,
  renameForMediaType,
} from './imageOptimization.js';

describe('decideImageOptimization', () => {
  it('passes GIFs through unchanged even when huge (animation preservation)', () => {
    const decision = decideImageOptimization(4000, 4000, 20 * 1024 * 1024, 'image/gif');
    expect(decision.passthrough).toBe(true);
    expect(decision.targetWidth).toBe(4000);
    expect(decision.targetHeight).toBe(4000);
    expect(decision.mustPreserveAlpha).toBe(false);
  });

  it('passes small, compact images through unchanged', () => {
    const decision = decideImageOptimization(1200, 800, 120 * 1024, 'image/jpeg');
    expect(decision.passthrough).toBe(true);
    expect(decision.targetWidth).toBe(1200);
    expect(decision.targetHeight).toBe(800);
  });

  it('triggers re-encode when byte budget is exceeded even if dimensions are fine', () => {
    const decision = decideImageOptimization(
      1200,
      800,
      IMAGE_PASSTHROUGH_MAX_BYTES + 1,
      'image/jpeg',
    );
    expect(decision.passthrough).toBe(false);
    expect(decision.targetWidth).toBe(1200);
    expect(decision.targetHeight).toBe(800);
    expect(decision.outputType).toBe('image/jpeg');
  });

  it('scales oversized landscape images to fit the long edge at MAX_EDGE', () => {
    const decision = decideImageOptimization(3200, 1800, 5 * 1024 * 1024, 'image/jpeg');
    expect(decision.passthrough).toBe(false);
    expect(decision.targetWidth).toBe(IMAGE_MAX_EDGE);
    expect(decision.targetHeight).toBe(Math.round(1800 * (IMAGE_MAX_EDGE / 3200)));
    // Aspect ratio within 1 px of the source.
    expect(Math.abs((decision.targetWidth / decision.targetHeight) - (3200 / 1800)))
      .toBeLessThan(0.01);
  });

  it('scales oversized portrait images to fit the long edge at MAX_EDGE', () => {
    const decision = decideImageOptimization(1200, 4800, 5 * 1024 * 1024, 'image/png');
    expect(decision.passthrough).toBe(false);
    expect(decision.targetHeight).toBe(IMAGE_MAX_EDGE);
    expect(decision.targetWidth).toBe(Math.round(1200 * (IMAGE_MAX_EDGE / 4800)));
  });

  it('flags PNG sources as alpha-preserving (runtime confirms via pixel scan)', () => {
    const decision = decideImageOptimization(2000, 2000, 1 * 1024 * 1024, 'image/png');
    expect(decision.passthrough).toBe(false);
    expect(decision.mustPreserveAlpha).toBe(true);
    expect(decision.outputType).toBe('image/png');
  });

  it('flags WebP sources as alpha-preserving', () => {
    const decision = decideImageOptimization(2000, 2000, 1 * 1024 * 1024, 'image/webp');
    expect(decision.mustPreserveAlpha).toBe(true);
    expect(decision.outputType).toBe('image/png');
  });

  it('defaults JPEG sources to opaque JPEG output (no alpha check needed)', () => {
    const decision = decideImageOptimization(2000, 2000, 1 * 1024 * 1024, 'image/jpeg');
    expect(decision.mustPreserveAlpha).toBe(false);
    expect(decision.outputType).toBe('image/jpeg');
  });

  it('treats unknown media types as JPEG', () => {
    const decision = decideImageOptimization(2000, 2000, 1 * 1024 * 1024, 'image/bmp');
    expect(decision.mustPreserveAlpha).toBe(false);
    expect(decision.outputType).toBe('image/jpeg');
  });

  it('never produces a zero-dimension target', () => {
    // Pathological tiny image that still exceeds byte budget (shouldnt happen
    // in practice, but make sure the math does not collapse to 0).
    const decision = decideImageOptimization(
      1,
      1,
      IMAGE_PASSTHROUGH_MAX_BYTES + 1,
      'image/jpeg',
    );
    expect(decision.targetWidth).toBeGreaterThanOrEqual(1);
    expect(decision.targetHeight).toBeGreaterThanOrEqual(1);
  });
});

describe('normalizeMediaType', () => {
  it('maps known types through unchanged', () => {
    expect(normalizeMediaType('image/png')).toBe('image/png');
    expect(normalizeMediaType('image/gif')).toBe('image/gif');
    expect(normalizeMediaType('image/webp')).toBe('image/webp');
    expect(normalizeMediaType('image/jpeg')).toBe('image/jpeg');
  });

  it('is case-insensitive', () => {
    expect(normalizeMediaType('IMAGE/PNG')).toBe('image/png');
  });

  it('defaults anything unknown or empty to image/jpeg', () => {
    expect(normalizeMediaType('image/bmp')).toBe('image/jpeg');
    expect(normalizeMediaType('')).toBe('image/jpeg');
    expect(normalizeMediaType(undefined)).toBe('image/jpeg');
  });
});

describe('extensionForMediaType', () => {
  it('returns canonical extensions', () => {
    expect(extensionForMediaType('image/png')).toBe('png');
    expect(extensionForMediaType('image/gif')).toBe('gif');
    expect(extensionForMediaType('image/webp')).toBe('webp');
    expect(extensionForMediaType('image/jpeg')).toBe('jpg');
  });
});

describe('renameForMediaType', () => {
  it('swaps the extension of a named file to match the chosen media type', () => {
    expect(renameForMediaType('screenshot.png', 'image/jpeg')).toBe('screenshot.jpg');
    expect(renameForMediaType('pasted-123-1.jpg', 'image/png')).toBe('pasted-123-1.png');
  });

  it('falls back to "image" when the input has no usable base name', () => {
    expect(renameForMediaType('', 'image/jpeg')).toBe('image.jpg');
    expect(renameForMediaType('.png', 'image/jpeg')).toBe('image.jpg');
  });
});
