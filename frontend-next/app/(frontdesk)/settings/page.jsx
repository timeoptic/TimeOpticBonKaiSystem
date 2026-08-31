'use client';
import { useState } from 'react';
import { api } from '../../../lib/apiClient.js';
import { useAsync, readForm } from '../../../lib/hooks.js';
import { useToast } from '../../../components/Toast.jsx';
import {
  Badge, Card, Field, FormActions, FormGrid, Loading, PageHead,
} from '../../../components/ui.jsx';
import { DataTable } from '../../../components/DataTable.jsx';
import { fmtDateTime } from '../../../lib/format.js';
import { Icon } from '../../../components/Icon.jsx';

export default function SettingsPage() {
  const { ok, err } = useToast();
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, logs] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/notifications', { limit: 50 }),
    ]);
    return { s, logs };
  }, []);

  /* the token and chat id are also read by the two side buttons */
  const [token, setToken] = useState(undefined);
  const [chat, setChat] = useState(undefined);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const { s, logs } = data;
  const tokenValue = token === undefined ? (s.telegram_bot_token || '') : token;
  const chatValue = chat === undefined ? (s.telegram_chat_id || '') : chat;
  const enabled = s.telegram_enabled === '1';

  const save = async (e) => {
    e.preventDefault();
    const body = readForm(e.currentTarget);
    body.telegram_enabled = body.telegram_enabled ? '1' : '0';
    if (s.telegram_token_from_env) delete body.telegram_bot_token;
    try {
      await api.put('/api/settings', body);
      ok('บันทึกการตั้งค่าแล้ว');
      setToken(undefined);
      setChat(undefined);
      reload();
    } catch (ex) { err(ex); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/settings/telegram/test', {
        telegram_bot_token: tokenValue,
        telegram_chat_id: chatValue,
      });
      ok(`ส่งสำเร็จ! บอท @${r.bot.username}`);
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

  return (
    <div>
      <PageHead icon="⚙️" title="Settings" subtitle="ตั้งค่าระบบแจ้งเตือน" />

      <div className="card">
        <div className="card-head">
          <h2>Telegram</h2>
          {s.telegram_configured
            ? <Badge kind="ok">ตั้งค่าแล้ว</Badge>
            : <Badge kind="warn">ยังไม่ได้ตั้งค่า</Badge>}
          {enabled ? <Badge kind="blue">เปิดใช้งาน</Badge> : <Badge kind="gray">ปิดอยู่</Badge>}
        </div>

        <form className="card-body" onSubmit={save}>
          <FormGrid>
            <Field label="เปิดใช้งาน" className="full">
              <label className="check">
                <input type="checkbox" name="telegram_enabled" defaultChecked={enabled} />
                {' '}ส่งแจ้งเตือนคิวเข้า Telegram
              </label>
            </Field>

            <Field
              label="Bot Token"
              className="full"
              hint={s.telegram_token_from_env
                ? 'กำหนดผ่าน environment variable TELEGRAM_BOT_TOKEN อยู่ — แก้ที่นี่ไม่ได้'
                : 'ได้จาก @BotFather ใน Telegram (คำสั่ง /newbot)'}
            >
              <input
                name="telegram_bot_token"
                placeholder="123456789:AAF..."
                disabled={!!s.telegram_token_from_env}
                value={tokenValue}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>

            <Field
              label="Chat ID (กลุ่มหรือคนที่จะรับแจ้งเตือน)"
              className="full"
              hint="ชวนบอทเข้ากลุ่มร้าน แล้วดู chat id ได้จาก @userinfobot หรือ @getidsbot"
            >
              <input
                name="telegram_chat_id"
                placeholder="-1001234567890 หรือ 123456789"
                value={chatValue}
                onChange={(e) => setChat(e.target.value)}
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
              <input name="shop_open_time" type="time" defaultValue={s.shop_open_time || '10:00'} />
            </Field>
            <Field label="เวลาปิดร้าน">
              <input name="shop_close_time" type="time" defaultValue={s.shop_close_time || '20:00'} />
            </Field>
          </FormGrid>

          <FormActions>
            <button className="btn btn-lg" type="submit"><Icon name="save" /> บันทึกการตั้งค่า</button>
            <button type="button" className="btn btn-light" disabled={busy} onClick={test}>
              <Icon name="flask" /> ทดสอบส่งข้อความ
            </button>
            <button type="button" className="btn btn-light" onClick={runReminders}>
              <Icon name="timer" /> รันตัวเตือนเดี๋ยวนี้
            </button>
          </FormActions>
        </form>
      </div>

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
        <DataTable
          columns={[
            { label: 'เมื่อ', render: (n) => fmtDateTime(n.created_at), cls: 'nowrap' },
            { label: 'ประเภท', key: 'kind' },
            { label: 'การจอง', key: 'booking_code', cls: 'mono' },
            {
              label: 'ผล',
              render: (n) => (Number(n.ok)
                ? <Badge kind="ok">สำเร็จ</Badge>
                : <Badge kind="danger">ไม่สำเร็จ</Badge>),
            },
            { label: 'ข้อผิดพลาด', key: 'error' },
          ]}
          rows={logs}
          empty="ยังไม่มีการแจ้งเตือน"
        />
      </Card>
    </div>
  );
}
