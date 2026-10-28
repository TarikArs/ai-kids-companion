// Image helpers (pure JS, no native deps): decode/encode JPEG, rotate by quarter turns.
import { decode, Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';

export { Image };

export async function decodeJpegB64(b64: string): Promise<Image> {
  return (await decode(decodeBase64(b64))) as Image;
}

export async function encodeJpegB64(img: Image, quality = 85): Promise<string> {
  return encodeBase64(await img.encodeJPEG(quality));
}

/** Rotate clockwise by 90, 180 or 270 degrees (exact pixel copy). */
export function rotateClockwise(img: Image, deg: 90 | 180 | 270): Image {
  const w = img.width, h = img.height;
  const out = new Image(deg === 180 ? w : h, deg === 180 ? h : w);
  const src = img.bitmap, dst = out.bitmap, W = out.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (deg === 90) [nx, ny] = [h - 1 - y, x];
      else if (deg === 180) [nx, ny] = [w - 1 - x, h - 1 - y];
      else [nx, ny] = [y, w - 1 - x];
      const si = (y * w + x) * 4, di = (ny * W + nx) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}
