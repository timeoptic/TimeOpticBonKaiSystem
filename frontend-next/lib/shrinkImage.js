/**
 * ย่อรูปก่อนส่งขึ้นเซิร์ฟเวอร์
 *
 * รูปจาก iPad / มือถือไฟล์ละ 2–5 MB แล้ว API เก็บไฟล์ต้นฉบับทั้งไฟล์ เว็บหลักจึงกิน
 * พื้นที่โฮสต์เดือนละราว 4 GB · ย่อด้านยาวเหลือ 1600px แล้วบันทึกเป็น JPEG 80%
 * ไฟล์เหลือราว 200–400 KB ยังเห็นจุด Center บนเลนส์และตัวหนังสือบนสลิปชัด
 *
 * หลักคือ "ย่อไม่ได้ก็ส่งของเดิม" — ถอดรหัสรูปไม่ออก เบราว์เซอร์เก่า หรือย่อแล้ว
 * ไฟล์ใหญ่กว่าเดิม ให้ส่งไฟล์ต้นฉบับไปตามเดิม การอัปโหลดต้องไม่พังเพราะด่านนี้
 * PDF และไฟล์ชนิดอื่นผ่านไปตรง ๆ ไม่แตะ
 */

export const SHRINK_MAX_SIDE = 1600;
export const SHRINK_QUALITY = 0.8;
/* รูปที่เล็กอยู่แล้วทั้งขนาดภาพและขนาดไฟล์ ไม่ต้องบีบซ้ำ — บีบ JPEG ซ้ำมีแต่เสียคุณภาพ */
export const SHRINK_SKIP_BYTES = 400 * 1024;

const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp'];

export function isShrinkable(type) {
  return SHRINKABLE.includes(type);
}

/** ขนาดภาพหลังย่อ โดยคงสัดส่วนเดิม · ภาพที่ไม่เกินเพดานคืนขนาดเดิม */
export function shrinkSize(width, height, maxSide = SHRINK_MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** รูปนี้ปล่อยผ่านไปเลยได้ไหม — ภาพไม่เกินเพดานและไฟล์เล็กอยู่แล้ว */
export function canSkipShrink(width, height, bytes) {
  return Math.max(width, height) <= SHRINK_MAX_SIDE && bytes <= SHRINK_SKIP_BYTES;
}

/** ชื่อไฟล์หลังแปลงเป็น JPEG — เปลี่ยนนามสกุล ส่วนชื่อคงเดิม */
export function jpegName(name) {
  const base = String(name || 'photo').replace(/\.[^./\\]+$/, '');
  return (base || 'photo') + '.jpg';
}

/* createImageBitmap หมุนรูปตาม EXIF ให้เอง (from-image) · Safari บาง
   รุ่นไม่รับออปชัน จึงตกไปใช้ <img> ซึ่งเบราว์เซอร์ปัจจุบันหมุนตาม EXIF ให้เหมือนกัน */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* ตกไปใช้ <img> ข้างล่าง */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * คืน File ที่ย่อแล้ว หรือคืน `file` ตัวเดิมถ้าไม่ต้อง/ไม่ควรย่อ — ไม่ throw
 */
export async function shrinkImage(file) {
  if (!file || !isShrinkable(file.type) || typeof document === 'undefined') return file;
  try {
    const src = await decode(file);
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    if (!w || !h || canSkipShrink(w, h, file.size)) {
      if (typeof src.close === 'function') src.close();
      return file;
    }

    const size = shrinkSize(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    /* PNG ที่มีพื้นโปร่งใส แปลงเป็น JPEG แล้วพื้นจะกลายเป็นสีดำ — ปูขาวไว้ก่อน */
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, size.width, size.height);
    if (typeof src.close === 'function') src.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  }
}
