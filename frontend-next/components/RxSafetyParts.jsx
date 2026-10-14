'use client';
/**
 * ชิ้นส่วนที่ Banner กับ Dialog ของ Prescription Safety Alert ใช้ร่วมกัน
 * ระดับแสดงด้วย สี + ไอคอน + ข้อความ เสมอ (ไม่พึ่งสีอย่างเดียว)
 */
import { Icon } from './Icon.jsx';
import { EYE_NAME, fmtRxValue } from '../lib/rxSafety.js';

export const LEVEL = {
  info: { label: 'ข้อมูลยังไม่ครบ', short: 'INFO', icon: 'circle' },
  warning: { label: 'ควรตรวจสอบ', short: 'WARNING', icon: 'warning' },
  critical: { label: 'ต้องทบทวน', short: 'CRITICAL', icon: 'flame' },
  error: { label: 'ข้อมูลผิด', short: 'ข้อมูลผิด', icon: 'xCircle' },
};

const ROW_LABEL = { sph: 'SPH', cyl: 'CYL', axis: 'AXIS', se: 'SE', add: 'ADD' };

export function LevelTag({ level, children }) {
  const l = LEVEL[level];
  return (
    <span className={`rxs-tag rxs-${level}`}>
      <Icon name={l.icon} />
      {children ?? l.short}
    </span>
  );
}

export function CountTags({ counts }) {
  const shown = ['error', 'critical', 'warning', 'info'].filter((k) => counts[k] > 0);
  if (!shown.length) return null;
  return (
    <span className="rxs-counts">
      {shown.map((k) => <LevelTag key={k} level={k}>{`${LEVEL[k].short} ${counts[k]}`}</LevelTag>)}
    </span>
  );
}

/**
 * ตารางผลต่าง OLD → FINAL ของตาหนึ่งข้าง
 * @param {{eye:'r'|'l', cmp:object}} props — cmp = result.compare[eye]
 */
export function DeltaTable({ eye, cmp }) {
  return (
    <div className="rxs-eye">
      <div className="rxs-eye-head">{EYE_NAME[eye]}</div>
      {!cmp.comparable ? (
        <p className="rxs-note">{cmp.note}</p>
      ) : (
        <div className="rxs-table-wrap">
          <table className="rxs-table">
            <thead>
              <tr><th /><th>แว่นเดิม</th><th>ค่าใหม่</th><th>ผลต่าง</th><th>สถานะ</th></tr>
            </thead>
            <tbody>
              {cmp.rows.map((row) => (
                <tr key={row.key} className={row.level ? `rxs-row-${row.level}` : undefined}>
                  <th scope="row">{ROW_LABEL[row.key]}</th>
                  <td>{fmtRxValue(row.key, row.old)}</td>
                  <td>{fmtRxValue(row.key, row.final)}</td>
                  <td>
                    {row.delta == null
                      ? (row.note || '—')
                      : row.key === 'axis' ? `${row.delta}°` : fmtRxValue(row.key, row.delta)}
                  </td>
                  <td>{row.level ? <LevelTag level={row.level} /> : <span className="rxs-ok">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(cmp.transposed?.old || cmp.transposed?.final) && (
        <p className="rxs-note">แปลงเป็นรูปแบบ CYL ลบก่อนเปรียบเทียบ (ค่าที่บันทึกไว้ไม่เปลี่ยน)</p>
      )}
    </div>
  );
}

/** รายการแจ้งเตือน — คลิกเพื่อไปที่ช่องนั้น */
export function AlertList({ alerts, onPick }) {
  if (!alerts.length) return null;
  return (
    <ul className="rxs-list">
      {alerts.map((a, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li key={i} className={`rxs-item rxs-${a.level}`}>
          <button type="button" className="rxs-item-btn" onClick={() => onPick?.(a)} title="ไปที่ช่องนี้">
            <LevelTag level={a.level} />
            <span>{a.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
