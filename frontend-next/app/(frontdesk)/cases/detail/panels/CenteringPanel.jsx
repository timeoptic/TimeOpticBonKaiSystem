'use client';
/**
 * Process 4 — วัด Center.
 *
 * Measurements on the left, the frame they were taken on and who took them on
 * the right. The frame is not asked for: it is the one the sale already chose,
 * and the numbers stamped on it (A / DBL / temple, read out of its size) are
 * offered as a starting point — a suggestion, never the saved value, because
 * what matters is what was measured on the lens in front of you.
 *
 * Two tables carry this: `centerings` holds the optical values (PD, FH, Cor.,
 * CVD, panto, wrap) and `frame_fittings` holds the frame's own box measurements
 * (A, B, DBL, ED) — both written by one press of the shell's บันทึก Draft.
 *
 * "ส่งรูป" sends every photo in รูปภาพการวัด plus the หมายเหตุ box, as shown on
 * screen, to the Telegram group รูปวัด Center — see CenteringSendModal.jsx. It
 * never saves the draft and never reloads the case, so nothing typed is lost.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../lib/apiClient.js';
import { useToast } from '../../../../../components/Toast.jsx';
import {
  Badge, Card, Field, Kv, Stack,
} from '../../../../../components/ui.jsx';
import { EmployeeSelect } from '../../../../../components/Selects.jsx';
import { PhotoUpload } from '../../../../../components/PhotoUpload.jsx';
import { CENTERING_PHOTO_MAX } from '../../../../../lib/photos.js';
import { Icon } from '../../../../../components/Icon.jsx';
import { EditLockBar, LockFieldset, useEditLock } from '../../../../../components/EditLock.jsx';
import { useProcessActions } from '../../../../../components/ProcessShell.jsx';
import { dtLocal, nowLocal, toStamp, todayISO } from '../../../../../lib/format.js';
import { DateTimeField } from '../../../../../components/DateTimeField.jsx';
import { noteUnsaved, sendButtonState, sentHistory, sentToast } from '../../../../../lib/centeringSend.js';
import { CenteringSendModal, SendIcon, SentToast } from './CenteringSendModal.jsx';

const NOTE_MAX = 500;

/** "53-19-145" / "53 □ 18 - 145" — the three numbers stamped on every frame */
function frameSizeParts(size) {
  const nums = String(size || '').match(/\d+(\.\d+)?/g) || [];
  if (nums.length < 2) return null;
  return { a: nums[0], dbl: nums[1], temple: nums[2] || '' };
}

/** one measurement box, with its unit sitting inside the field */
/* `text` = ช่องที่ร้านกรอกได้ทั้งตัวเลขและข้อความ (เช่น Cor. ที่บางทีจดเป็นชื่อรุ่นหรือ "สั้น")
   คอลัมน์เป็น varchar(20) อยู่แล้ว ฝั่ง API ไม่ได้บังคับว่าต้องเป็นตัวเลข */
function Measure({ label, unit, value, onChange, placeholder, hint, readOnly = false, text = false }) {
  return (
    <div className={`measure ${readOnly ? 'readonly' : ''}`}>
      <label>{label}</label>
      <div className="measure-input">
        <input
          type={readOnly || text ? 'text' : 'number'}
          step={text ? undefined : '0.1'}
          inputMode={text ? undefined : 'decimal'}
          maxLength={text ? 20 : undefined}
          value={value ?? ''}
          placeholder={placeholder}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
        />
        {unit ? <span className="measure-unit">{unit}</span> : null}
      </div>
      {hint ? <span className="measure-hint">{hint}</span> : null}
    </div>
  );
}

/* `optional` ไม่ได้เปลี่ยนพฤติกรรมอะไร แค่บอกให้เห็นบนจอว่ากลุ่มนี้ว่างไว้ได้
   เกณฑ์จริงอยู่ที่ processMissing() ฝั่ง API — PD อย่างเดียวที่บังคับ */
const Group = ({ icon, title, cols = 0, optional = false, children }) => (
  <section className="measure-panel">
    <h4>
      <Icon name={icon} /> {title}
      {optional ? <span className="opt-tag">ไม่บังคับ</span> : null}
    </h4>
    <div className={`measure-grid${cols ? ` cols-${cols}` : ''}`}>{children}</div>
  </section>
);

export function CenteringPanel({ c, reload }) {
  const { ok, err } = useToast();
  const actions = useProcessActions();
  const ce = useMemo(() => c.centering || {}, [c]);
  const ff = useMemo(() => c.frame_fitting || {}, [c]);
  const order = c.order || {};
  const lock = useEditLock(!!ce.id);

  const [form, setForm] = useState({});
  const [fit, setFit] = useState({});

  /* รายการในกล่องรูปภาพการวัด — null จนกว่ากล่องจะโหลดเสร็จ ข้อความ "กรุณาเพิ่มรูป"
     จะได้ไม่กะพริบขึ้นมาก่อนรูปโหลด · photoRev เปลี่ยน = ให้กล่องโหลดรายการใหม่
     (API บอกว่ารูปในเคสเปลี่ยนไประหว่างเปิด popup) */
  const [photos, setPhotos] = useState(null);
  const [photoRev, setPhotoRev] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  /* การส่งที่เพิ่งสำเร็จในหน้านี้ — ส่งเสร็จไม่ reload เคส (ดู onSent) c.events จึงยังไม่มี
     รอบนี้ เก็บไว้ในรูปเดียวกับเหตุการณ์ของไทม์ไลน์ ให้ sentHistory อ่านรวมกันได้ */
  const [localSends, setLocalSends] = useState([]);
  const sent = useMemo(() => sentHistory([...localSends, ...(c.events || [])]), [localSends, c.events]);

  useEffect(() => {
    setForm({
      r_pd: ce.r_pd || '', l_pd: ce.l_pd || '', pd_total: ce.pd_total || '',
      r_height: ce.r_height || '', l_height: ce.l_height || '',
      /* Cor. — ความยาว corridor ของเลนส์โปรเกรสซีฟ ค่าเดียวใช้ทั้งสองข้าง คู่กับ FH ตอนสั่งเลนส์ */
      corridor: ce.corridor || '',
      vertex_distance: ce.vertex_distance || '', pantoscopic_tilt: ce.pantoscopic_tilt || '',
      /* wrap ไม่ได้อยู่ในชุดที่ร้านวัด แต่ค่าที่เคยบันทึกไว้ต้องไม่หายตอนบันทึกทับ */
      wrap_angle: ce.wrap_angle || '', center_point_note: ce.center_point_note || '',
      performed_by: ce.performed_by || '',
      /* ไม่ได้ถามว่าใครกรอก — ค่าที่เคยบันทึกไว้ยังส่งต่อไปกับการบันทึกครั้งถัดไป */
      recorded_by: ce.recorded_by || '',
      measured_at: dtLocal(ce.measured_at) || nowLocal(),
    });
    setFit({
      frame_box_a: ff.frame_box_a || '', frame_box_b: ff.frame_box_b || '',
      dbl: ff.dbl || '', ed: ff.ed || '',
    });
  }, [ce, ff, lock.formKey]);

  const set = (name) => (v) => setForm((f) => ({ ...f, [name]: v }));
  const setF = (name) => (v) => setFit((f) => ({ ...f, [name]: v }));

  /* PD total is the two halves added up — a third box to type it in is one more
     number that can disagree with the other two */
  const pdSum = (Number(form.r_pd) || 0) + (Number(form.l_pd) || 0);
  const pdTotal = pdSum > 0 ? pdSum.toFixed(1) : (form.pd_total || '');

  const suggest = frameSizeParts(order.frame_size);
  const useSuggested = () => {
    if (!suggest) return;
    setFit((f) => ({ ...f, frame_box_a: f.frame_box_a || suggest.a, dbl: f.dbl || suggest.dbl }));
    ok('เติมค่าจากข้อมูลกรอบแล้ว — แก้ตามที่วัดจริงได้');
  };

  /* quiet = เรียกจาก beforeComplete — ไม่ขึ้น toast ไม่ reload เพราะการยืนยันที่ตามมาทำให้เอง */
  const saveDraft = async ({ quiet = false } = {}) => {
    const centering = await api.post('/api/centerings', {
      ...form,
      pd_total: pdTotal,
      measured_at: toStamp(form.measured_at),
      case_id: c.id,
      order_id: order.id || null,
      frame_product_id: order.frame_product_id || null,
    });
    await api.post('/api/frame-fittings', {
      ...fit,
      case_id: c.id,
      order_id: order.id || null,
      frame_size: order.frame_size || ff.frame_size || '',
      performed_by: form.performed_by || null,
      recorded_by: form.recorded_by || null,
    });
    if (!quiet) {
      ok('บันทึกค่า Center แล้ว');
      lock.relock();
      reload();
    }
    return centering;
  };

  /* ✓ ยืนยันค่า Center บันทึกค่าที่กรอกก่อนเสมอ — เดิมปุ่มนี้แค่ยืนยันขั้นตอน แล้ว reload ล้างฟอร์ม
     กลับเป็นค่าที่เก็บไว้ ค่าที่พิมพ์แต่ยังไม่ได้กด "บันทึก Draft" หายหมด (ร้านเจอ 15 ก.ย. 2026
     เคส CASE-2026-00001) · บันทึกไม่ผ่าน = throw → ProcessShell ไม่ยืนยัน ฟอร์มยังอยู่ครบ */
  const beforeComplete = async () => {
    await saveDraft({ quiet: true });
    return true;
  };

  const fns = useRef({});
  fns.current = { saveDraft, beforeComplete };
  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    /* ล็อกอยู่ = ไม่มีปุ่มบันทึก Draft และ "บันทึกและไปต่อ" เขียนอะไรไม่ได้ · ยืนยันขั้นยังได้
       ค่าที่ส่งคือค่าที่บันทึกไว้เดิม */
    register({
      ...(lock.locked ? {} : { saveDraft: () => fns.current.saveDraft() }),
      beforeComplete: () => fns.current.beforeComplete(),
    });
    return () => register({});
  }, [register, lock.locked]);

  const note = form.center_point_note || '';
  const photoCount = photos ? photos.length : 0;
  const btn = sendButtonState({ photos, sent, today: todayISO() });

  /* ส่งสำเร็จไม่ reload เคส — reload จะรีเซ็ตฟอร์มจากค่าที่บันทึกไว้ หมายเหตุที่พิมพ์ค้าง
     (ซึ่งเพิ่งถูกส่งออกไป) จะหายไปจากช่องทันที */
  const onSent = (res) => {
    setSendOpen(false);
    setLocalSends((l) => [...l, {
      action: 'centering_photos_sent',
      payload: { centerImages: (photos || []).map((p) => p.id), sentAt: res?.sent_at || toStamp(nowLocal()) + ':00', ok: true },
    }]);
    ok(<SentToast {...sentToast({ caseCode: res?.case_code || c.case_code, count: res?.count ?? photoCount })} />);
  };
  const onSendFailed = (f) => {
    err(f.title);
    if (f.refresh) setPhotoRev((n) => n + 1);
  };

  return (
    <>
    <EditLockBar lock={lock} what="ค่า Center" />
    <div className="split center-split">
      <Stack>
        <LockFieldset locked={lock.locked}>
        <Card>
          <div className="ws-hero">
            <span className="ws-hero-icon"><Icon name="target" /></span>
            <div>
              <h2>ค่าการวัด Center Point</h2>
              <p>กรอกค่าการวัดจริง — มิลลิเมตร (Panto เป็นองศา)</p>
            </div>
          </div>

          <Group icon="users" title="PD" cols={3}>
            <Measure label="PD ขวา (R)" unit="mm" value={form.r_pd} onChange={set('r_pd')} placeholder="31.0" />
            <Measure label="PD ซ้าย (L)" unit="mm" value={form.l_pd} onChange={set('l_pd')} placeholder="31.0" />
            <Measure label="PD รวม" unit="mm" value={pdTotal} readOnly hint="ขวา + ซ้าย" />
          </Group>

          <Group icon="eye" title="FH" cols={3} optional>
            <Measure label="FH ขวา (R)" unit="mm" value={form.r_height} onChange={set('r_height')} placeholder="18.5" />
            <Measure label="FH ซ้าย (L)" unit="mm" value={form.l_height} onChange={set('l_height')} placeholder="18.5" />
            <Measure label="Cor." unit="mm" text value={form.corridor} onChange={set('corridor')} placeholder="14" hint="Corridor · เลนส์โปรเกรสซีฟ" />
          </Group>

          <Group icon="glasses" title="FRAME BOX" cols={4} optional>
            <Measure label="A" unit="mm" value={fit.frame_box_a} onChange={setF('frame_box_a')} placeholder="52.0" />
            <Measure label="B" unit="mm" value={fit.frame_box_b} onChange={setF('frame_box_b')} placeholder="18.0" />
            <Measure label="DBL" unit="mm" value={fit.dbl} onChange={setF('dbl')} placeholder="18.0" />
            <Measure label="ED" unit="mm" value={fit.ed} onChange={setF('ed')} placeholder="60.0" />
          </Group>

          <Group icon="tag" title="มุมและระยะสวมใส่" cols={2} optional>
            <Measure label="CVD" unit="mm" value={form.vertex_distance} onChange={set('vertex_distance')} placeholder="12.0" />
            <Measure label="Panto" unit="°" value={form.pantoscopic_tilt} onChange={set('pantoscopic_tilt')} placeholder="8.0" />
          </Group>
        </Card>
        </LockFieldset>

        <Card title="รูปภาพการวัด" right={<span className="muted">{`ไม่เกิน ${CENTERING_PHOTO_MAX} รูป`}</span>}>
          <p className="hint">ถ่ายให้เห็นใบหน้าตรง ด้านข้าง และกรอบที่มาร์คจุดไว้ให้ชัด</p>
          <PhotoUpload
            key={photoRev}
            caseId={c.id}
            kind="centering"
            centeringId={ce.id}
            takenBy={form.performed_by || null}
            max={CENTERING_PHOTO_MAX}
            locked={lock.locked}
            onPhotos={setPhotos}
            actions={(
              <button
                type="button"
                className={btn.tone === 'sent' ? 'btn btn-sm' : 'btn btn-sm btn-accent'}
                style={btn.tone === 'sent'
                  ? { background: 'var(--panel)', color: 'var(--ink-dim)', borderColor: 'var(--line)', boxShadow: 'none' }
                  : undefined}
                onClick={() => setSendOpen(true)}
                disabled={photoCount === 0}
              >
                {btn.tone === 'sent' ? <Icon name="check" /> : <SendIcon />} {btn.label}
              </button>
            )}
            actionsHint={btn.hint}
            sentIds={sent.ids}
          />
        </Card>
      </Stack>

      <Stack>
        <LockFieldset locked={lock.locked}>
        <Card
          title="กรอบแว่นที่ใช้ในการวัด"
          badge={order.frame_name
            ? <Badge kind="ok"><Icon name="check" /> มาจากขั้นการขาย</Badge>
            : <Badge kind="warn">ยังไม่ได้เลือกกรอบ</Badge>}
        >
          {order.frame_name ? (
            <>
              <Kv
                rows={[
                  ['ยี่ห้อ', order.frame_brand || '—'],
                  ['ชื่อ / รุ่น', [order.frame_name, order.frame_model].filter(Boolean).join(' · ') || '—'],
                  ['SKU', order.frame_sku || '—'],
                  ['ไซส์ที่ระบุ', order.frame_size || '—'],
                ]}
              />
              {suggest && (
                <div className="suggest">
                  <div className="suggest-head">
                    <b>ค่าจากข้อมูลกรอบ</b>
                    <button type="button" className="btn btn-sm btn-light" onClick={useSuggested}>
                      <Icon name="download" /> ใช้ค่านี้
                    </button>
                  </div>
                  <div className="suggest-chips">
                    <span className="suggest-chip"><b>A</b>{suggest.a}</span>
                    <span className="suggest-chip"><b>DBL</b>{suggest.dbl}</span>
                    {suggest.temple ? <span className="suggest-chip"><b>ขาแว่น</b>{suggest.temple}</span> : null}
                  </div>
                  <p className="hint">ค่าที่โรงงานพิมพ์ไว้ ไม่ใช่ค่าที่วัดเอง — แก้ตามเลนส์จริงได้เสมอ</p>
                </div>
              )}
            </>
          ) : (
            <p className="muted">เลือกกรอบที่ขั้น “ขาย/เลือกกรอบ” ก่อน ค่ากรอบจะขึ้นมาที่นี่เอง</p>
          )}
        </Card>

        <Card title="ผู้ดำเนินการ">
          <div className="measure-grid">
            <Field label="ผู้วัด / Technician">
              <EmployeeSelect
                name="performed_by"
                value={form.performed_by ?? ''}
                onChange={(e) => set('performed_by')(e.target.value)}
              />
            </Field>
            <Field label="วันที่และเวลาที่วัด">
              <DateTimeField
                value={form.measured_at || ''}
                onChange={set('measured_at')}
              />
            </Field>
          </div>
        </Card>

        <Card title="หมายเหตุ" right={<span className="muted">{`${note.length}/${NOTE_MAX}`}</span>}>
          <textarea
            rows={5}
            maxLength={NOTE_MAX}
            value={note}
            placeholder="เช่น ลูกค้าใช้สายตาขับรถกลางคืนเป็นหลัก · ปรับความโค้งขาแว่นให้แนบขึ้นก่อนวัด"
            onChange={(e) => set('center_point_note')(e.target.value)}
          />
        </Card>
        </LockFieldset>
      </Stack>

      {sendOpen && photoCount > 0 ? (
        <CenteringSendModal
          caseId={c.id}
          caseCode={c.case_code}
          photos={photos}
          note={note}
          noteUnsaved={noteUnsaved(note, ce.center_point_note)}
          onClose={() => setSendOpen(false)}
          onSent={onSent}
          onFailed={onSendFailed}
        />
      ) : null}
    </div>
    </>
  );
}
