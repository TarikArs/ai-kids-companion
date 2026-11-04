import type { CameraView } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { base64ToBytes } from './session';

// Watches the page cheaply: a tiny 160 px grey frame every few seconds, compared with the last photo sent.
// A full photo is sent only when something changed AND the page is still (no hand moving, no pen writing).
// Pure JS JPEG decoder (no native code): npm install jpeg-js -w apps/mobile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require('jpeg-js') as {
  decode: (data: Uint8Array, opts: { useTArray: true; formatAsRGBA?: boolean }) => { width: number; height: number; data: Uint8Array };
};

const WIDTH = 160;
/** A pixel changed when its brightness (after removing global light changes) moved by more than this. */
const PIXEL_DELTA = 28;
/** About 0.15 % of the frame: a few written digits. */
export const CHANGED = 40;
/** Between two consecutive frames: more than this = something is moving (hand, pen, phone). */
export const MOVING = 120;

export interface Frame {
  w: number;
  h: number;
  gray: Uint8Array;
  mean: number;
}

/** One tiny frame from the live camera, or null if the camera is not ready. */
export async function grabFrame(camera: CameraView | null): Promise<Frame | null> {
  if (!camera) return null;
  const pic = await camera.takePictureAsync({ quality: 0.2, skipProcessing: true, shutterSound: false });
  const ctx = ImageManipulator.manipulate(pic.uri);
  ctx.resize({ width: WIDTH, height: null });
  const img = await ctx.renderAsync();
  const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) return null;
  const { width, height, data } = jpeg.decode(base64ToBytes(saved.base64), { useTArray: true, formatAsRGBA: true });
  const gray = new Uint8Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    gray[i] = v;
    sum += v;
  }
  return { w: width, h: height, gray, mean: sum / gray.length };
}

/** Number of pixels that changed between two frames (global brightness changes ignored). Infinity if not comparable. */
export function changedPixels(a: Frame | null, b: Frame | null): number {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return Infinity;
  const shift = a.mean - b.mean;
  let n = 0;
  for (let i = 0; i < a.gray.length; i++) if (Math.abs(a.gray[i] - b.gray[i] - shift) > PIXEL_DELTA) n++;
  return n;
}
