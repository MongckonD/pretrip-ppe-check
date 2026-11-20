/**
 * Read a driving-licence photo in the browser with Tesseract.js (Thai + English).
 * The library and its language data (~ a few MB, cached by the browser after the first time) load only
 * when someone opens the licence camera, so the normal pages stay small. Nothing is sent to a third party:
 * the photo is read on the phone, then only the photo the user confirms goes to our own server.
 */
import { parseLicense, type ParsedLicense } from './licenseParse';

export interface PreparedPhoto {
  /** compressed JPEG that is uploaded (kept readable for the admin) */
  upload: Blob;
  previewUrl: string;
  /** high-contrast greyscale copy for OCR */
  ocr: HTMLCanvasElement;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น')); };
    img.src = url;
  });
}

function canvasOf(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) =>
  c.toBlob((b) => (b ? res(b) : rej(new Error('บีบอัดรูปไม่สำเร็จ'))), 'image/jpeg', q));

/** Greyscale + stretch contrast (helps OCR on glossy cards and dim photos). */
function enhance(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g | 0]++;
  }
  // ignore the darkest / brightest 1 % so glare does not decide the range
  const total = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const img = await loadImage(file);
  const long = Math.max(img.width, img.height);
  const k = Math.min(1, 1600 / long);
  const up = canvasOf(img, Math.round(img.width * k), Math.round(img.height * k));
  const upload = await toBlob(up, 0.85);
  // OCR works best with text ~30 px high: scale the card to about 2000 px on its long side
  const ko = 2000 / long;
  const ocr = enhance(canvasOf(img, Math.round(img.width * ko), Math.round(img.height * ko)));
  return { upload, previewUrl: URL.createObjectURL(upload), ocr };
}

function rotate(src: HTMLCanvasElement, deg: 90 | 270) {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

const score = (p: ParsedLicense) => Number(!!p.fullName) + Number(!!p.licenseNo) + Number(!!(p.expiry || p.lifetime));

export type OcrStage = 'loading' | 'reading';

/**
 * OCR the photo and pick out the fields. A card photographed upright (portrait) is also tried
 * turned 90° both ways; the reading that finds the most fields wins.
 */
export async function readLicense(
  photo: PreparedPhoto,
  onProgress: (stage: OcrStage, pct: number) => void,
): Promise<{ parsed: ParsedLicense; text: string }> {
  const { createWorker } = await import('tesseract.js');
  let pass = 0, passes = 1;
  const worker = await createWorker(['tha', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress('reading', Math.round(((pass + m.progress) / passes) * 100));
      else if (/load|initializ/i.test(m.status)) onProgress('loading', Math.round(m.progress * 100));
    },
  });
  try {
    const c = photo.ocr;
    const tries = c.height > c.width * 1.1 ? [rotate(c, 90), rotate(c, 270)] : [c];
    passes = tries.length;
    let best: { parsed: ParsedLicense; text: string } = { parsed: {}, text: '' };
    for (; pass < tries.length; pass++) {
      const { data } = await worker.recognize(tries[pass]);
      const parsed = parseLicense(data.text);
      if (score(parsed) > score(best.parsed)) best = { parsed, text: data.text };
      if (score(best.parsed) === 3) break;
    }
    return best;
  } finally {
    await worker.terminate();
  }
}
