/**
 * เลนส์จำลองของ Bewell — ไม่ใช่สต็อก ไม่มีจำนวนคงเหลือ และไม่อยู่ในฐานข้อมูล
 *
 * มีไว้เดโมและทดสอบ flow ขายจนกว่า Bewell จะมีฐานเลนส์จริง เลนส์ของร้านนี้สั่งตามค่าสายตา
 * ของแต่ละเคส ค่าสายตาจึงไม่ได้อยู่ในรายการ (ทำได้ทุกค่า) · ราคาเป็นราคาต่อคู่
 * ตัวเลือกแหล่งข้อมูลอยู่ที่ lensSource.js
 */

/** ยี่ห้อ, ชนิด, รุ่น, Index, เคลือบ, ออปชัน, ปรับแสง, สี, ราคาต่อคู่ */
const L = (brand, lensType, design, lensIndex, coating, option, photochromic, color, pricePair) => ({
  mock_code: ['MOCK', brand, lensType, design, lensIndex, coating, option, photochromic, color]
    .filter(Boolean)
    .join('-')
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, '-'),
  brand,
  lens_type: lensType,
  design,
  lens_index: lensIndex,
  coating,
  option,
  photochromic,
  color,
  price_pair: pricePair,
});

export const MOCK_LENSES = [
  L('HOYA', 'Single Vision', 'Nulux', '1.56', 'VG', 'Blue Control', '', '', 3000),
  L('HOYA', 'Single Vision', 'Nulux', '1.60', 'VG', 'Blue Control', '', '', 4200),
  L('HOYA', 'Single Vision', 'Nulux', '1.67', 'Hi-Vision Meiryo', '', '', '', 6500),
  L('HOYA', 'Single Vision', 'Nulux', '1.56', 'VG', '', 'Sensity 2', 'Grey', 5200),
  L('HOYA', 'Single Vision', 'Nulux', '1.60', 'Hi-Vision Meiryo', 'Blue Control', 'Sensity 2', 'Brown', 7800),
  L('HOYA', 'Progressive', 'Hoyalux iD MyStyle V+', '1.60', 'Hi-Vision Meiryo', '', '', '', 28000),
  L('HOYA', 'Progressive', 'Hoyalux Summit Pro', '1.56', 'VG', 'Blue Control', '', '', 14500),
  L('HOYA', 'Office', 'Hoyalux iD WorkStyle V+', '1.60', 'Hi-Vision Meiryo', 'Blue Control', '', '', 16500),
  L('Essilor', 'Single Vision', 'Eyezen Start', '1.56', 'Crizal Easy Pro', '', '', '', 3500),
  L('Essilor', 'Single Vision', 'Eyezen Start', '1.60', 'Crizal Sapphire HR', 'Blue UV Capture', '', '', 6200),
  L('Essilor', 'Single Vision', 'Eyezen Start', '1.67', 'Crizal Sapphire HR', 'Blue UV Capture', '', '', 8900),
  L('Essilor', 'Single Vision', 'Eyezen Start', '1.60', 'Crizal Easy Pro', '', 'Transitions Gen S', 'Grey', 8500),
  L('Essilor', 'Single Vision', 'Eyezen Start', '1.60', 'Crizal Easy Pro', '', 'Transitions Gen S', 'Sapphire', 8900),
  L('Essilor', 'Progressive', 'Varilux Comfort Max', '1.56', 'Crizal Easy Pro', '', '', '', 15900),
  L('Essilor', 'Progressive', 'Varilux XR Series', '1.60', 'Crizal Sapphire HR', 'Blue UV Capture', '', '', 32000),
  L('Essilor', 'Progressive', 'Varilux Physio 3.0', '1.67', 'Crizal Sapphire HR', '', 'Transitions Gen S', 'Brown', 36500),
  L('Zeiss', 'Single Vision', 'SmartLife Individual', '1.60', 'DuraVision Platinum', 'BlueGuard', '', '', 9500),
  L('Zeiss', 'Single Vision', 'ClearView', '1.50', 'DuraVision Silver', '', '', '', 3200),
  L('Zeiss', 'Single Vision', 'ClearView', '1.67', 'DuraVision Platinum', 'BlueGuard', '', '', 7900),
  L('Zeiss', 'Single Vision', 'ClearView', '1.60', 'DuraVision Platinum', '', 'PhotoFusion X', 'Grey', 8800),
  L('Zeiss', 'Progressive', 'SmartLife Progressive Plus', '1.60', 'DuraVision Platinum', 'BlueGuard', '', '', 29500),
  L('Zeiss', 'Progressive', 'Progressive Light 3D', '1.50', 'DuraVision Silver', '', '', '', 12900),
  L('Nikon', 'Single Vision', 'Lite AS', '1.60', 'SeeCoat Blue', 'Blue Cut', '', '', 4800),
  L('Nikon', 'Single Vision', 'Lite AS', '1.74', 'SeeCoat Next', '', '', '', 11500),
  L('Nikon', 'Progressive', 'Presio Power', '1.60', 'SeeCoat Next', '', '', '', 19800),
  L('Tokai', 'Single Vision', 'Lutina', '1.60', 'ACX', 'Blue Cut', '', '', 3900),
  L('Tokai', 'Single Vision', 'Lutina', '1.67', 'ACX', 'Blue Cut', '', '', 5600),
  L('Rodenstock', 'Single Vision', 'Impression Mono', '1.60', 'Solitaire Protect Plus 2', '', '', '', 8200),
  L('Rodenstock', 'Progressive', 'Impression FreeSign 3', '1.60', 'Solitaire Protect Plus 2', '', '', '', 31000),
  L('Tantawan', 'Single Vision', 'Standard', '1.50', 'Hard', '', '', '', 800),
  L('Tantawan', 'Single Vision', 'Standard', '1.56', 'MC', '', '', '', 1200),
  L('Tantawan', 'Single Vision', 'Standard', '1.56', 'MC', 'Blue Cut', '', '', 1800),
  L('Tantawan', 'Single Vision', 'Standard', '1.56', 'MC', '', 'Auto', 'Grey', 2400),
  L('Tantawan', 'Single Vision', 'Standard', '1.56', 'MC', 'Blue Cut', 'Auto', 'Grey', 2900),
  L('Tantawan', 'Single Vision', 'Standard', '1.60', 'MC', 'Blue Cut', '', '', 2600),
  L('Tantawan', 'Progressive', 'Standard Progressive', '1.56', 'MC', 'Blue Cut', '', '', 5500),
  L('Tantawan', 'Bifocal', 'Flat Top 28', '1.56', 'MC', '', '', '', 2200),
];
