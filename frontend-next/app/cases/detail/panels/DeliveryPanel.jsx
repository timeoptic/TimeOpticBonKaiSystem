'use client';
/**
 * ขั้น "ส่งมอบ" — หน้าจอตอนลูกค้ายืนอยู่ตรงหน้าเคาน์เตอร์
 *
 * คำถามของหน้านี้มีสี่ข้อ เรียงตามลำดับที่พนักงานถามจริง:
 *   ส่งให้ใคร → ส่งอะไร → ยอดเงินเป็นยังไง → ยืนยันส่งมอบ
 *
 * จึงไม่มีฟอร์มและไม่มี checklist ให้ติ๊กซ้ำ — การชำระเงินถูกตัดสินไปแล้วในขั้น
 * ก่อนหน้า ที่นี่แค่ "อ่าน" ไม่ต้อง "กรอก"
 *
 * ปุ่มหลักคือปุ่มยืนยันของ ProcessShell ปุ่มเดียว (ไม่สร้างปุ่มซ้อน) โดย panel
 * ฝาก beforeComplete ไว้ให้เปิดกล่องยืนยันก่อน แล้วค่อยบันทึกการส่งมอบ
 * — ยอดค้างชำระ "ไม่ใช่" เงื่อนไขของการส่งมอบ เตือนได้แต่ห้ามปิดปุ่ม
 * (ฝั่ง API ก็คิดแบบเดียวกัน: processBlocking ของขั้นนี้ดูแค่ว่ามีออเดอร์หรือยัง)
 *
 * ขั้นนี้เป็นขั้นสุดท้าย — กดยืนยันแล้วเคสปิด
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/apiClient.js';
import { useToast } from '../../../../components/Toast.jsx';
import { Badge, Card, Kv, Split, Stack } from '../../../../components/ui.jsx';
import { useProcessActions } from '../../../../components/ProcessShell.jsx';
import { useMeta } from '../../../../contexts/MetaContext.jsx';
import { paymentStatusOf } from '../../../../lib/caseProcesses.js';
import { custName, fmtDateTime, money, nowLocal, toStamp } from '../../../../lib/format.js';
import { Icon } from '../../../../components/Icon.jsx';

/** กรอบ/เลนส์หนึ่งชิ้น: ป้ายกำกับ ชื่อสินค้า แล้วรายละเอียดรอง */
function Item({ label, name, sub }) {
  return (
    <div className="dlv-item">
      <span className="dlv-item-label">{label}</span>
      <b>{name || '—'}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

/** ชื่อเลนส์ที่จะโชว์ — ออเดอร์เก็บรุ่นเดียวใช้ทั้งสองข้าง จึงแสดงครั้งเดียว */
function lensBlocks(order) {
  const sub = [order.lens_brand, order.lens_index, order.lens_coating, order.lens_design]
    .filter(Boolean).join(' · ');
  return [{ label: 'LENS', name: order.lens_name, sub }];
}

export function DeliveryPanel({ c, reload, actorId }) {
  const { ok, err } = useToast();
  const { meta } = useMeta();
  const actions = useProcessActions();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = useRef(null);

  const d = c.delivery || {};
  const o = c.order || {};
  const pay = paymentStatusOf(c);
  const delivered = !!d.delivered_at;
  const balance = Number(c.balance) || 0;
  const net = (Number(o.total_price) || 0) - (Number(o.discount) || 0);
  const name = custName(c);
  const blocking = actions?.state?.blocking || [];
  const empName = (id) => (meta.employees.find((e) => Number(e.id) === Number(id)) || {}).employee_name || '—';
  const lenses = lensBlocks(o);
  const frameSub = [o.frame_color, o.frame_size, o.frame_sku].filter(Boolean).join(' · ');
  /* ออเดอร์เก่าหลายใบไม่ได้แยก frame_model ไว้ ชื่อเต็มใน frame_name จึงบอกได้มากกว่า
     "Gucci" เฉย ๆ — ใช้ยี่ห้อ+รุ่นเมื่อมีจริงเท่านั้น */
  const frameName = o.frame_model
    ? [o.frame_brand, o.frame_model].filter(Boolean).join(' ')
    : (o.frame_name || o.frame_brand);

  /* บันทึกการส่งมอบ แล้วปล่อยให้ ProcessShell ยิง complete ต่อเอง */
  const saveDelivery = async () => {
    setBusy(true);
    try {
      await api.post('/api/case-deliveries', {
        case_id: c.id,
        order_id: o.id || null,
        delivered_at: toStamp(nowLocal()),
        handed_over_by: actorId() || null,
        employee_id: actorId() || null,
        received_by_customer_name: name,
      });
      ok('บันทึกการส่งมอบแล้ว');
      return true;
    } catch (ex) {
      err(ex);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const close = (value) => {
    setAsk(false);
    decide.current?.(value);
    decide.current = null;
  };

  const confirmDeliver = async () => {
    const saved = await saveDelivery();
    close(saved);
  };

  /* ProcessShell เรียกอันนี้ก่อนกดยืนยันขั้นตอน — คืน false = ไม่ต้องไปต่อ */
  const fns = useRef({});
  fns.current.beforeComplete = () => {
    if (delivered) return true;
    if (blocking.length) {
      err(new Error(`ยังส่งมอบไม่ได้ — ${blocking.join(', ')}`));
      return false;
    }
    return new Promise((resolve) => { decide.current = resolve; setAsk(true); });
  };

  const register = actions?.register;
  useEffect(() => {
    if (!register) return undefined;
    register({ beforeComplete: () => fns.current.beforeComplete() });
    return () => register({});
  }, [register]);

  if (delivered) {
    return (
      <Card title="ส่งมอบแล้ว" badge={<Badge kind="ok"><Icon name="check" /> เรียบร้อย</Badge>}>
        <Kv
          rows={[
            ['ส่งมอบเมื่อ', fmtDateTime(d.delivered_at)],
            ['ผู้รับสินค้า', d.received_by_customer_name || '—'],
            ['ผู้ส่งมอบ', d.handed_over_by_name || empName(d.handed_over_by)],
            ['ยอดคงเหลือ', balance > 0
              ? <b className="dlv-due">{money(balance)}</b>
              : <Badge kind="ok"><Icon name="check" /> ชำระครบแล้ว</Badge>],
          ]}
        />
      </Card>
    );
  }

  return (
    <>
      <Split>
        <Stack>
          <Card title="ข้อมูลลูกค้า">
            <div className="dlv-cust">
              <b>{name}</b>
              <a href={`tel:${c.phone || ''}`} className="dlv-phone">
                <Icon name="phone" /> {c.phone || '—'}
              </a>
              <span className="dlv-case mono">{c.case_code}</span>
            </div>
          </Card>

          <Card title="ข้อมูลออเดอร์">
            {o.id ? (
              <div className="dlv-items">
                <Item label="FRAME" name={frameName} sub={frameSub} />
                {lenses.map((l) => <Item key={l.label} label={l.label} name={l.name} sub={l.sub} />)}
              </div>
            ) : (
              <p className="muted">ยังไม่มีออเดอร์ในเคสนี้</p>
            )}
          </Card>
        </Stack>

        <Card title="สถานะ">
          <Kv
            rows={[
              ['ยอดสุทธิ', <b>{money(net)}</b>],
              ['ชำระแล้ว', money(c.paid)],
              ['ยอดคงเหลือ', balance > 0 ? <b className="dlv-due">{money(balance)}</b> : money(0)],
              ['การชำระเงิน', <Badge kind={pay.kind}>
                {pay.code === 'paid' ? <><Icon name="check" /> {pay.label}</> : pay.label}
              </Badge>],
            ]}
          />
          <p className="hint dlv-hint">
            ยอดค้างชำระไม่ปิดกั้นการส่งมอบ — ลูกค้ารับแว่นได้ แล้วเก็บเงินที่ขั้น “ชำระเงิน” ตามปกติ
          </p>
        </Card>
      </Split>

      {ask && (
        <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="modal">
            <h3>ยืนยันการส่งมอบ</h3>
            <div className="m-body">
              <Kv
                rows={[
                  ['ลูกค้า', <><b>{name}</b>{c.phone ? <div className="muted">{c.phone}</div> : null}</>],
                  ['Case', <span className="mono">{c.case_code}</span>],
                  ['Frame', frameName || '—'],
                  ['Lens', lenses.map((l) => l.name).filter(Boolean).join(' / ') || '—'],
                ]}
              />
              <p className="dlv-confirm-msg">ยืนยันว่าได้ส่งมอบแว่นออเดอร์นี้ให้ลูกค้าเรียบร้อยแล้ว</p>
              {balance > 0 && (
                <div className="dlv-warn">
                  <Icon name="warning" />
                  <div>
                    <b>{`ออเดอร์นี้ยังมียอดคงเหลือ ${money(balance)}`}</b>
                    <span>คุณยังสามารถยืนยันการส่งมอบได้</span>
                  </div>
                </div>
              )}
            </div>
            <div className="m-foot">
              <button type="button" className="btn btn-light" onClick={() => close(false)} disabled={busy}>
                ยกเลิก
              </button>
              <button type="button" className="btn" onClick={confirmDeliver} disabled={busy}>
                <Icon name="box" /> ยืนยันส่งมอบ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
