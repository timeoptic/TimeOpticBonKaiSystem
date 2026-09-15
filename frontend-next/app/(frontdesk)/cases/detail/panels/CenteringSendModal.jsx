'use client';
/**
 * popup ของปุ่ม "ส่งรูป" ในขั้นวัด Center — สองหน้าในกล่องเดียว
 *
 *   1. ตรวจสอบก่อนส่งรูป — รหัสเคส · รูปทุกใบในกล่อง "รูปภาพการวัด" · หมายเหตุ (อ่านอย่างเดียว)
 *   2. ยืนยันการส่งรูป?   — ถามครั้งสุดท้าย แล้วค่อยยิง POST /api/centering-photos/send
 *
 * ทำไมชั้นที่สองไม่ใช้ useConfirm() — กล่องกลางปิดตัวเองทันทีที่กดยืนยัน ปุ่มจึงบอก
 * "กำลังส่ง..." ระหว่างรอ Telegram ไม่ได้ และปล่อยให้กดซ้ำระหว่างนั้นได้
 *
 * กันส่งซ้ำสองชั้นฝั่งนี้: ref ที่ตั้งก่อน setState (คลิกที่สองของ double click มาถึง
 * ก่อน React วาดปุ่ม disabled) และปุ่มที่ปิดไว้ระหว่างส่ง · ฝั่ง API ล็อกต่อเคสอีกชั้น
 *
 * วางผ่าน portal ที่ body — เนื้อหาหน้าเคสถูกหรี่ลงระหว่างโหลดข้อมูลใหม่ (content-busy)
 * กล่องที่อยู่ข้างในจะหรี่ตามไปด้วย
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../../../../lib/apiClient.js';
import { Icon } from '../../../../../components/Icon.jsx';
import { Lightbox } from '../../../../../components/Lightbox.jsx';
import { isPreviewable } from '../../../../../lib/lightbox.js';
import {
  NO_NOTE, confirmText, photoCountText, sendFailure, sendPayload,
} from '../../../../../lib/centeringSend.js';
import s from './CenteringSendModal.module.css';

/* เครื่องบินกระดาษ — วาดไว้ที่นี่ ไม่ได้เพิ่มเข้า lib/icons.js เพราะไฟล์นั้นอยู่ใน chunk
   ที่ทุกหน้าโหลด เพิ่มรูปเดียวที่นั่น = ต้องขึ้นหน้าเว็บใหม่ทุกหน้า (ดู deploy/README.md)
   ขนาดและสีตาม .ico ของชุดกลางเป๊ะ */
export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="ico">
      <path d="M2.5 3 22 12 2.5 21l2.1-7.8L13.5 12l-8.9-1.2z" />
    </svg>
  );
}

/** toast สำเร็จสองบรรทัด — หัวข้อ แล้วเคส • จำนวนรูป */
export function SentToast({ title, detail }) {
  return (
    <>
      <span className={s.toastTitle}>{title}</span>
      <span className={s.toastDetail}>{detail}</span>
    </>
  );
}

/**
 * @param {{
 *   caseId: number, caseCode: string,
 *   photos: import('../../../../../lib/centeringSend.js').CasePhoto[],
 *   note: string, noteUnsaved: boolean,
 *   onClose: () => void,
 *   onSent: (res: import('../../../../../lib/centeringSend.js').CenteringSendResult) => void,
 *   onFailed: (f: import('../../../../../lib/centeringSend.js').CenteringSendFailure) => void,
 * }} props
 */
export function CenteringSendModal({ caseId, caseCode, photos, note, noteUnsaved, onClose, onSent, onFailed }) {
  const [stage, setStage] = useState('review');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [target, setTarget] = useState(null);
  const inFlight = useRef(false);
  const reviewTitle = useId();
  const askTitle = useId();

  const count = photos.length;
  const text = (note || '').trim();
  const hasNote = text !== '';

  /* บอกล่วงหน้าถ้ายังไม่ได้ตั้งกลุ่มปลายทาง ดีกว่าให้ผ่านสองชั้นแล้วมาล้มตอนท้าย
     อ่านไม่สำเร็จก็ปล่อยผ่าน — API ตรวจซ้ำอยู่แล้ว */
  useEffect(() => {
    let alive = true;
    api.get('/api/settings')
      .then((st) => {
        if (alive) setTarget((st?.telegram_targets || []).find((t) => t.key === 'centering') || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const notConfigured = !!target && !target.configured;

  const images = useMemo(
    () => photos
      .filter((p) => isPreviewable(p.mime_type))
      .map((p) => ({ key: p.id, src: api.url('/api/uploads/' + p.id), alt: p.original_name || '', name: p.original_name || '' })),
    [photos]
  );

  /* Esc: หน้ายืนยันถอยกลับไปตรวจสอบ หน้าตรวจสอบปิดกล่อง · ระหว่างส่งไม่ทำอะไร
     (ตอนเปิดรูปใหญ่ Lightbox กิน Esc ไว้ที่ window ก่อนแล้ว ไม่ถึงตรงนี้) */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || inFlight.current) return;
      if (stage === 'confirm') setStage('review');
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    try {
      const res = await api.post('/api/centering-photos/send', sendPayload({ caseId, caseCode, photos, note }));
      onSent(res);
    } catch (ex) {
      const f = sendFailure(ex);
      inFlight.current = false;
      setSending(false);
      setFailure(f);
      setStage('review');
      onFailed(f);
    }
  };

  const onBackdrop = (e) => {
    if (e.target !== e.currentTarget || inFlight.current) return;
    if (stage === 'confirm') setStage('review');
    else onClose();
  };

  const review = (
    <div className={`modal ${s.dialog}`} role="dialog" aria-modal="true" aria-labelledby={reviewTitle}>
      <header className={s.head}>
        <div className={s.headText}>
          <h3 id={reviewTitle}>ตรวจสอบก่อนส่งรูป</h3>
          <p>กรุณาตรวจสอบข้อมูลและรูปภาพก่อนยืนยันการส่ง</p>
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="ปิด">
          <Icon name="x" />
        </button>
      </header>

      <div className={`m-body ${s.body}`}>
        {failure ? (
          <p className={s.alert} role="alert">
            <Icon name="warning" />
            <span>
              {failure.title}
              {failure.detail ? <span className={s.alertDetail}>{failure.detail}</span> : null}
            </span>
          </p>
        ) : null}
        {notConfigured ? (
          <p className={s.alert}>
            <Icon name="warning" />
            <span>ยังไม่ได้ตั้งค่ากลุ่ม Telegram &quot;รูปวัด Center&quot; — แจ้งผู้ดูแลระบบให้ตั้งที่หน้า Settings ก่อนส่ง</span>
          </p>
        ) : null}

        <section className={s.section}>
          <h4 className={s.label}>หมายเลขเคส</h4>
          <div className={s.caseNo}>{caseCode}</div>
        </section>

        <section className={s.section}>
          <h4 className={`${s.label} ${s.labelRow}`}>
            <span>รูปภาพที่จะส่ง</span>{' '}
            <span className={s.count}>{`${count} รูป`}</span>
          </h4>
          <ul className={s.thumbs} aria-label={photoCountText(count)}>
            {photos.map((p) => (
              <li key={p.id} className={s.thumb}>
                {isPreviewable(p.mime_type) ? (
                  <button
                    type="button"
                    className={s.thumbOpen}
                    onClick={() => setViewing(images.findIndex((x) => x.key === p.id))}
                    aria-label={`ดูรูปใหญ่ ${p.original_name || ''}`.trim()}
                    title="กดเพื่อดูรูปใหญ่"
                  >
                    <img src={api.url('/api/uploads/' + p.id)} alt={p.original_name || ''} />
                  </button>
                ) : (
                  <a className={s.fileTile} href={api.url('/api/uploads/' + p.id)} target="_blank" rel="noreferrer">
                    <Icon name="file" />
                    <span>{p.original_name || 'ไฟล์'}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section}>
          <h4 className={s.label}>หมายเหตุ</h4>
          <div className={`${s.note} ${hasNote ? '' : s.noteEmpty}`} aria-readonly="true">
            {hasNote ? text : NO_NOTE}
          </div>
          {noteUnsaved ? (
            <p className={s.warn}>
              <Icon name="warning" />
              <span>หมายเหตุนี้ยังไม่ได้บันทึก Draft — จะส่งตามข้อความที่เห็นนี้</span>
            </p>
          ) : null}
          <p className={`hint ${s.flat}`}>แก้หมายเหตุได้ที่ช่อง &quot;หมายเหตุ&quot; ในหน้า Center</p>
        </section>
      </div>

      <div className={`m-foot ${s.foot}`}>
        <button type="button" className="btn btn-light" onClick={onClose}>ยกเลิก</button>
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => setStage('confirm')}
          disabled={notConfigured || count === 0}
        >
          <SendIcon /> ยืนยันการส่ง
        </button>
      </div>
    </div>
  );

  const ask = (
    <div className={`modal ${s.dialog} ${s.ask}`} role="dialog" aria-modal="true" aria-labelledby={askTitle}>
      <h3 id={askTitle}>ยืนยันการส่งรูป?</h3>
      <div className="m-body">
        <dl className={s.summary}>
          <div><dt>เคส</dt><dd>{caseCode}</dd></div>
          <div><dt>รูปภาพ</dt><dd>{`${count} รูป`}</dd></div>
          <div><dt>หมายเหตุ</dt><dd>{hasNote ? 'พร้อมหมายเหตุจากหน้า Center' : NO_NOTE}</dd></div>
        </dl>
        <p className={s.askText}>{confirmText({ caseCode, count, hasNote })}</p>
      </div>
      <div className={`m-foot ${s.foot}`}>
        <button type="button" className="btn btn-light" onClick={() => setStage('review')} disabled={sending}>
          กลับไปตรวจสอบ
        </button>
        <button type="button" className="btn btn-accent" onClick={send} disabled={sending} aria-busy={sending} autoFocus>
          {sending
            ? <><span className="spin" aria-hidden="true" /> กำลังส่ง...</>
            : <><SendIcon /> ยืนยันและส่ง</>}
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div className="modal-back" onClick={onBackdrop}>
      {stage === 'confirm' ? ask : review}
      {viewing !== null && images.length > 0 ? (
        <Lightbox items={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}
    </div>,
    document.body
  );
}
