'use client';
import { useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Loading, PageHead, Tabs,
} from '../../../components/ui.jsx';
import { PagedTable } from '../../../components/Pager.jsx';
import { fmtDate, fmtDateTime } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';
import { EditLockBar, LockFieldset, useEditLock } from '../../../components/EditLock.jsx';
import { AdminOnly } from '../../../components/AdminOnly.jsx';
import { TimeField } from '../../../components/TimeField.jsx';
import { RxAlertRules } from './RxAlertRules.jsx';

function SettingsPageInner() {
  const { ok, err } = useToast();
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, logs] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/notifications', { limit: 50 }),
    ]);
    return { s, logs };
  }, []);

  /* ปลายทางที่กำลังแก้อยู่ + ค่าที่พิมพ์ค้างไว้ (คีย์ตามชื่อ setting จริง)
     เก็บเป็นแมปเพื่อให้สลับแท็บไปมาแล้วสิ่งที่พิมพ์ค้างไว้ยังอยู่ ไม่หายไปเงียบ ๆ */
  const [destKey, setDestKey] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const lock = useEditLock(true);
  const digestLock = useEditLock(true);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const { s, logs } = data;
  const targets = s.telegram_targets || [];
  const dest = targets.find((t) => t.key === destKey) || targets[0] || {};
  const val = (key) => (edits[key] !== undefined ? edits[key] : (s[key] || ''));
  const setVal = (key, v) => setEdits((e) => ({ ...e, [key]: v }));

  const enabled = s.telegram_enabled === '1';
  const digestOn = s.delivery_digest_enabled === '1';

  const save = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.telegram_enabled = body.telegram_enabled ? '1' : '0';
    /* ช่องที่ .env ล็อกไว้ไม่ต้องตัดทิ้งเอง — readForm ข้าม element ที่ disabled อยู่แล้ว
       ส่วนช่อง token ที่ยังโชว์ค่า mask อยู่ ฝั่ง API ปฏิเสธไม่เขียนทับให้ */
    try {
      await api.put('/api/settings', body);
      ok('บันทึกการตั้งค่าแล้ว');
      setEdits({});
      lock.relock();
      reload();
    } catch (ex) { err(ex); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/settings/telegram/test', {
        target: dest.key,
        [dest.token_key]: val(dest.token_key),
        [dest.chat_key]: val(dest.chat_key),
      });
      ok(`ส่งเข้า "${r.label}" สำเร็จ! บอท @${r.bot.username}`);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  const runReminders = async () => {
    try {
      const r = await api.post('/api/reminders/run');
      ok(r.skipped ? r.skipped : `ตรวจ ${r.checked} คิว · ส่ง ${r.sent} ข้อความ`);
      reload();
    } catch (ex) { err(ex); }
  };

  const saveDigest = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.delivery_digest_enabled = body.delivery_digest_enabled ? '1' : '0';
    try {
      await api.put('/api/settings', body);
      ok('บันทึกการตั้งค่าสรุปคิวส่งมอบแล้ว');
      digestLock.relock();
      reload();
    } catch (ex) { err(ex); }
  };

  /* ส่งของจริงเข้ากลุ่มเดี๋ยวนี้ — ไม่กินโควตาของรอบวันนั้น (ดู DeliveryDigest::runOnce) */
  const runDigest = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/delivery-digest/run');
      ok(r.error
        ? `ส่งไม่สำเร็จ: ${r.error}`
        : `ส่งแล้ว · คิวพรุ่งนี้ ${r.queue} ราย · เลยกำหนด ${r.overdue} ราย`);
      reload();
    } catch (ex) {
      err(ex);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead icon="gear" title="Settings" subtitle="ตั้งค่าระบบแจ้งเตือน" />

      <div className="card">
        <div className="card-head">
          <h2>Telegram</h2>
          {dest.configured
            ? <Badge kind="ok">ตั้งค่าแล้ว</Badge>
            : <Badge kind="warn">ยังไม่ได้ตั้งค่า</Badge>}
          {enabled ? <Badge kind="blue">เปิดใช้งาน</Badge> : <Badge kind="gray">ปิดอยู่</Badge>}
        </div>

        <form key={lock.formKey} className="card-body" onSubmit={save}>
          <EditLockBar lock={lock} what="การตั้งค่า Telegram" onCancel={() => setEdits({})} />
          {/* ปลายทางไหน — วาดจาก Telegram::TARGETS ฝั่ง API ไม่ได้พิมพ์ชื่อไว้ที่นี่
              เพิ่มกลุ่มใหม่ที่ฝั่งนั้นแล้วแท็บขึ้นเองโดยไม่ต้องแก้หน้านี้ */}
          <Tabs
            names={targets.map((t) => t.label)}
            active={dest.label}
            onSelect={(label) => {
              setDestKey((targets.find((t) => t.label === label) || dest).key);
            }}
          />

          {dest.fell_back ? (
            <p className="muted" style={{ marginTop: 8 }}>
              ยังไม่ได้ตั้งกลุ่มนี้ — ข้อความที่สั่งให้มาที่นี่จะไปโผล่ที่
              <b> {targets[0]?.label}</b> แทน
            </p>
          ) : null}
          {/* ปลายทางที่ไม่ตกกลับ (กลุ่มรูปวัด Center) — ตั้งไม่ครบคือส่งไม่ออกเลย ต้องบอกให้ชัด */}
          {dest.fallback === false && !dest.configured ? (
            <p className="muted" style={{ marginTop: 8 }}>
              ยังไม่ได้ตั้งกลุ่มนี้ — ปุ่ม “ส่งรูป” ในขั้นวัด Center จะส่งไม่ได้จนกว่าจะตั้งค่า
              (ไม่ส่งไปกลุ่มอื่นแทน)
            </p>
          ) : null}

          <LockFieldset locked={lock.locked}>
          <FormGrid>
            <Field label="เปิดใช้งาน" className="full">
              <label className="check">
                <input type="checkbox" name="telegram_enabled" defaultChecked={enabled} />
                {' '}ส่งแจ้งเตือนเข้า Telegram (สวิตช์รวมของทุกปลายทาง)
              </label>
            </Field>

            <Field
              label={`Bot Token — ${dest.label}`}
              className="full"
              hint={dest.token_from_env
                ? `กำหนดผ่าน environment variable ${dest.token_env} อยู่ — แก้ที่นี่ไม่ได้`
                : 'ได้จาก @BotFather ใน Telegram (คำสั่ง /newbot)'}
            >
              <input
                key={`${dest.key}-token`}
                name={dest.token_key}
                placeholder="123456789:AAF..."
                disabled={!!dest.token_from_env}
                value={val(dest.token_key)}
                onChange={(e) => setVal(dest.token_key, e.target.value)}
              />
            </Field>

            <Field
              label={`Chat ID — ${dest.label}`}
              className="full"
              hint={dest.chat_from_env
                ? `กำหนดผ่าน environment variable ${dest.chat_env} อยู่ — แก้ที่นี่ไม่ได้`
                : 'ชวนบอทเข้ากลุ่มร้าน แล้วดู chat id ได้จาก @userinfobot หรือ @getidsbot'}
            >
              <input
                key={`${dest.key}-chat`}
                name={dest.chat_key}
                placeholder="-1001234567890 หรือ 123456789"
                disabled={!!dest.chat_from_env}
                value={val(dest.chat_key)}
                onChange={(e) => setVal(dest.chat_key, e.target.value)}
              />
            </Field>

            <Field label="แจ้งเตือนล่วงหน้าปริยาย (นาที)">
              <input
                name="reminder_default_minutes"
                type="number" min="0" max="1440"
                defaultValue={s.reminder_default_minutes || 10}
              />
            </Field>
            <Field label="ชื่อร้าน"><input name="shop_name" defaultValue={s.shop_name || ''} /></Field>
            <Field label="เวลาเปิดร้าน">
              <TimeField name="shop_open_time" defaultValue={s.shop_open_time || '10:00'} />
            </Field>
            <Field label="เวลาปิดร้าน">
              <TimeField name="shop_close_time" defaultValue={s.shop_close_time || '20:00'} />
            </Field>
          </FormGrid>
          </LockFieldset>

          <FormActions>
            {lock.locked ? null : <button className="btn btn-lg" type="submit"><Icon name="save" /> บันทึกการตั้งค่า</button>}
            <button type="button" className="btn btn-light" disabled={busy} onClick={test}>
              <Icon name="flask" /> ทดสอบส่งเข้า {dest.label}
            </button>
            <button type="button" className="btn btn-light" onClick={runReminders}>
              <Icon name="timer" /> รันตัวเตือนเดี๋ยวนี้
            </button>
          </FormActions>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>สรุปคิวส่งมอบประจำวัน</h2>
          {digestOn ? <Badge kind="blue">เปิดใช้งาน</Badge> : <Badge kind="gray">ปิดอยู่</Badge>}
          {s.delivery_digest_last_date
            ? <Badge kind="ok">{`ส่งล่าสุด ${fmtDate(s.delivery_digest_last_date)}`}</Badge>
            : null}
        </div>

        <form key={digestLock.formKey} className="card-body" onSubmit={saveDigest}>
          <EditLockBar lock={digestLock} what="การตั้งค่าสรุปคิว" />
          <p className="muted" style={{ marginTop: 0 }}>
            ทุกวันตามเวลาที่ตั้งไว้ ระบบจะส่งสองข้อความเข้ากลุ่มเดียวกับแจ้งเตือนคิว —
            <b> คิวส่งมอบพรุ่งนี้</b> (เลขออเดอร์ · ชื่อลูกค้า · วันนัด) และ
            <b> รายการที่เลยกำหนดส่งมอบ</b> พร้อมเบอร์โทรไว้ตามลูกค้า
          </p>

          <LockFieldset locked={digestLock.locked}>
          <FormGrid>
            <Field label="เปิดใช้งาน" className="full">
              <label className="check">
                <input
                  type="checkbox"
                  name="delivery_digest_enabled"
                  defaultChecked={digestOn}
                />
                {' '}ส่งสรุปคิวส่งมอบทุกวัน
              </label>
            </Field>

            <Field label="เวลาที่ส่ง" hint="ค่าเริ่มต้นหนึ่งทุ่ม — ก่อนปิดร้านพอให้เตรียมของทัน">
              <TimeField
                name="delivery_digest_time"
                defaultValue={s.delivery_digest_time || '19:00'}
              />
            </Field>

            <Field
              label="ส่งเข้ากลุ่ม"
              hint="ปลายทางตั้งค่าที่การ์ด Telegram ด้านบน"
            >
              <select
                name="delivery_digest_target"
                defaultValue={s.delivery_digest_target || 'digest'}
              >
                {/* กลุ่มรูปวัด Center รับรูปลูกค้าอย่างเดียว ไม่ใช่ที่ของสรุปคิวส่งมอบ */}
                {targets.filter((t) => t.digest !== false).map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="รายการเลยกำหนด — นับย้อนหลัง (วัน)"
              hint="เกินกรอบนี้ไม่ต้องแจ้ง ฐานข้อมูลมีคิวค้างจากข้อมูลนำเข้าเก่ากว่าพันใบ"
            >
              <input
                name="delivery_digest_overdue_days"
                type="number" min="1" max="365"
                defaultValue={s.delivery_digest_overdue_days || 30}
              />
            </Field>
          </FormGrid>
          </LockFieldset>

          <FormActions>
            {digestLock.locked ? null : <button className="btn btn-lg" type="submit"><Icon name="save" /> บันทึก</button>}
            <button type="button" className="btn btn-light" disabled={busy} onClick={runDigest}>
              <Icon name="bell" /> ส่งสรุปทดสอบเดี๋ยวนี้
            </button>
          </FormActions>
        </form>
      </div>

      <RxAlertRules />

      <Card title="วิธีตั้งค่า Telegram">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>เปิด Telegram ค้นหา @BotFather แล้วพิมพ์ /newbot ตั้งชื่อบอท</li>
          <li>BotFather จะให้ Bot Token มา — ก็อปมาวางในช่องด้านบน</li>
          <li>สร้างกลุ่มของร้าน (เช่น &quot;TimeOptic คิวลูกค้า&quot;) แล้วเชิญบอทเข้ากลุ่ม</li>
          <li>เชิญ @getidsbot เข้ากลุ่มเพื่อดู Chat ID (ของกลุ่มจะขึ้นต้นด้วย -100) แล้วเตะออกได้</li>
          <li>วาง Chat ID ติ๊กเปิดใช้งาน <Icon name="arrowRight" /> บันทึก <Icon name="arrowRight" /> กดปุ่มทดสอบ</li>
        </ol>
      </Card>

      <Card title="ประวัติการแจ้งเตือนล่าสุด" tight>
        <PagedTable
          columns={[
            { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap', mobile: 'title' },
            { label: 'ประเภท', key: 'kind', mobile: 'subtitle' },
            { label: 'การจอง', key: 'booking_code', cls: 'mono', mobile: 'body' },
            {
              label: 'ผล',
              mobile: 'status',
              render: (n) => (Number(n.ok)
                ? <Badge kind="ok">สำเร็จ</Badge>
                : <Badge kind="danger">ไม่สำเร็จ</Badge>),
            },
            { label: 'ข้อผิดพลาด', key: 'error', mobile: 'body' },
          ]}
          rows={logs}
          empty="ยังไม่มีการแจ้งเตือน"
        />
      </Card>
    </div>
  );
}

/* งานของแอดมิน — พนักงานขายที่พิมพ์ URL เข้ามาตรง ๆ จะเห็นคำอธิบาย
   ไม่ใช่หน้าเปล่าหรือถูกเด้งกลับเงียบ ๆ */
export default function SettingsPage() {
  return <AdminOnly zone="system"><SettingsPageInner /></AdminOnly>;
}
