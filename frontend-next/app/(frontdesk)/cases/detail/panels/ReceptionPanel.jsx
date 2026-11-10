'use client';
/**
 * Process 1 — รับลูกค้า. The intake facts that belong to the case itself
 * (who took it, how the customer found us and the reception note), plus a
 * read-only look at the customer the case is attached to.
 *
 * The rush flag and the free-text source detail used to be edited here. Both
 * columns still exist and still render wherever they were shown before — this
 * form just no longer offers them, and the `...c` spread below carries the
 * stored values through untouched on every save.
 *
 * Saving here is a draft save: it writes the case row and leaves the
 * process status alone — ProcessShell owns "✓ เปิดเคสเรียบร้อย".
 */
import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../../lib/apiClient.js';
import { readForm } from '../../../../../lib/hooks.js';
import { useToast } from '../../../../../components/Toast.jsx';
import {
  Badge, Field, FormActions, FormGrid, Kv, Row,
} from '../../../../../components/ui.jsx';
import { EmployeeSelect, ListSelect } from '../../../../../components/Selects.jsx';
import { custName, fmtDate } from '../../../../../lib/format.js';
import { birthOrAge } from '../../../../../lib/customerAge.js';
import { emptyFields, missingText } from '../../../../../lib/customerFill.js';
import { Icon } from '../../../../../components/Icon.jsx';
import { EditLockBar, LockFieldset, useEditLock } from '../../../../../components/EditLock.jsx';
import { CustomerFillDialog } from './CustomerFillDialog.jsx';

export function ReceptionPanel({ c, reload }) {
  const { ok, err } = useToast();
  /* ข้อมูลลูกค้าไม่ครบ — ขั้นนี้คือตอนที่พนักงานคุยกับลูกค้าอยู่ ถามแล้วเติมได้ทันที
     ป้ายนับแค่วันเกิดกับเบอร์โทร ปุ่มขึ้นเมื่อยังมีช่องไหนว่างก็ตาม (lib/customerFill.js) */
  const [filling, setFilling] = useState(false);
  const missing = missingText(c);
  const canFill = emptyFields(c).length > 0;
  const lock = useEditLock(true);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/cases/' + c.id, { ...c, ...readForm(e.currentTarget) });
      ok('บันทึกข้อมูลการรับเคสแล้ว');
      lock.relock();
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="stack">
      <EditLockBar lock={lock} what="ข้อมูลการรับเคส" />
      <form key={lock.formKey} onSubmit={save}>
        <LockFieldset locked={lock.locked}>
        <FormGrid>
          <Field label="พนักงานผู้รับเรื่อง">
            <EmployeeSelect name="received_by" defaultValue={c.received_by || ''} />
          </Field>
          <Field label="ประเภทงาน / Case Type">
            <ListSelect name="case_type" kind="case_type" defaultValue={c.case_type || ''} blank="— ไม่ระบุ —" />
          </Field>
          {/* เลือกผิดตอนเปิดเคสต้องแก้ได้ที่นี่ — มันคือตัวแบ่งสมุดงานบนกระดาน
              ถ้าแก้ไม่ได้ เคสก็ค้างอยู่ผิดแท็บไปตลอด */}
          <Field label="ประเภทลูกค้า / Customer Category">
            <ListSelect
              name="customer_category"
              kind="customer_category"
              defaultValue={c.customer_category || ''}
              blank="— เลือกประเภทลูกค้า —"
            />
          </Field>
          {/* 'returning' คือค่าที่ POST /api/cases ใส่ให้เองเมื่อเปิดเคสให้ลูกค้าที่มี
              เคสเก่าอยู่แล้ว — จงใจไม่อยู่ใน Lookups::lists() เพื่อไม่ให้ใครติ๊กเองได้
              ถ้าปล่อยให้มันลงมาที่ <ListSelect> ค่าจะไม่ตรงกับตัวเลือกไหนเลย แล้ว
              <Select> จะตกกลับไปที่ตัวเลือกแรกคือ "— ไม่ระบุ —" ตามที่มันทำกับค่าแปลกปลอม
              ทุกตัว · ผลคือแค่เปิดขั้นนี้แล้วกดบันทึก ป้าย "ลูกค้าเก่า" ก็หายเงียบ ๆ
              จึงแสดงเป็นข้อความแทน และส่งค่าเดิมกลับไปทาง hidden input ให้ readForm
              อ่านเจอ — ค่าเดินทางไป-กลับโดยไม่มีใครแก้ได้ */}
          <Field label="รู้จักเราจากช่องทางไหน / Customer Source">
            {c.referral_source === 'returning' ? (
              <>
                <input type="hidden" name="referral_source" value="returning" />
                <p className="muted">ลูกค้าเก่า — ระบบบันทึกให้ตอนเปิดเคส</p>
              </>
            ) : (
              <ListSelect name="referral_source" kind="referral_source" defaultValue={c.referral_source || ''} blank="— ไม่ระบุ —" />
            )}
          </Field>
        </FormGrid>
        <Field label="บันทึกการรับเรื่อง" className="full">
          <textarea name="reception_note" defaultValue={c.reception_note || ''} />
        </Field>
        </LockFieldset>
        {lock.locked ? null : (
          <FormActions>
            <button className="btn btn-light" type="submit"><Icon name="save" /> บันทึกข้อมูลการรับเคส</button>
          </FormActions>
        )}
      </form>

      <Kv
        rows={[
          ['ลูกค้า', <Link key="cust" href={'/customers/detail?id=' + c.customer_id}>{custName(c)}</Link>],
          ['โทร', c.phone || '—'],
          ['LINE / WhatsApp', c.line_id || '—'],
          ['วันเกิด', birthOrAge(c, fmtDate) || '—'],
          ['ตอนเปิดเคส', Number(c.is_new_customer) ? 'ลูกค้าใหม่' : 'ลูกค้าเก่า'],
        ]}
      />

      {missing || canFill ? (
        <Row>
          {/* ป้ายยาวกว่าป้ายทั่วไป — ปล่อยตัดบรรทัดได้ จอ 360px จะได้ไม่ล้นออกข้าง */}
          {missing ? <Badge kind="warn" style={{ whiteSpace: 'normal' }}><Icon name="warning" /> {missing}</Badge> : null}
          {canFill ? (
            <button type="button" className="btn btn-sm btn-light" onClick={() => setFilling(true)}>
              <Icon name="pencil" /> เติมข้อมูลลูกค้า
            </button>
          ) : null}
        </Row>
      ) : null}

      {filling ? (
        <CustomerFillDialog
          c={c}
          onClose={() => setFilling(false)}
          onSaved={() => { setFilling(false); reload(); }}
        />
      ) : null}
    </div>
  );
}
