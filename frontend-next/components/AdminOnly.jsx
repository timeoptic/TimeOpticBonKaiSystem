'use client';
/**
 * ครอบหน้าที่เป็นงานของแอดมิน
 *
 * เมนูของสองกลุ่มนี้ถูกซ่อนจากพนักงานขายอยู่แล้ว แต่ URL ยังพิมพ์เข้ามาตรง ๆ ได้
 * (หรือมาจากลิงก์ที่ใครส่งต่อ) จึงต้องมีคำตอบที่หน้าจอด้วย
 *
 * **บอกไปตรง ๆ ว่าไม่มีสิทธิ์ ไม่เด้งกลับเงียบ ๆ** — การถูกดีดออกจากหน้าโดยไม่มี
 * คำอธิบายอ่านได้ว่า "ระบบพัง" ซึ่งจบลงที่พนักงานโทรมาถาม ทั้งที่ระบบทำงานถูก
 *
 * นี่ไม่ใช่ด่านความปลอดภัย — API ปฏิเสธด้วย 403 อยู่แล้วไม่ว่าหน้าเว็บจะวาดอะไร
 * (ดูประตูที่สองใน `api/index.php`) ตรงนี้มีไว้ให้คนอ่านออก ไม่ใช่ให้ระบบปลอดภัย
 */
import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext.jsx';
import { inMoneyZone, inSystemZone, roleTextOf } from '../lib/roles.js';
import { Card, Loading, PageHead } from './ui.jsx';
import { Icon } from './Icon.jsx';

/**
 * @param {{zone: 'money' | 'system', children: React.ReactNode}} props
 *   `zone` บอกว่าหน้านี้อยู่ครึ่งไหนของโซนแอดมิน — การเงิน หรือ ข้อมูลระบบ ·
 *   ไม่มีค่าปริยาย เพราะค่าปริยายที่เดาผิดคือหน้าที่เปิดให้คนที่ไม่ควรเปิด
 */
export function AdminOnly({ zone, children }) {
  const { actor, ready } = useAuth();

  if (!ready) return <Loading />;
  if (zone === 'money' ? inMoneyZone(actor) : inSystemZone(actor)) return children;

  const what = zone === 'money' ? 'การเงิน' : 'ข้อมูลระบบ';

  return (
    <>
      <PageHead icon="lock" title={`เมนูนี้สำหรับผู้ที่มีสิทธิ์ส่วน${what}`} subtitle="Admin only" />
      <Card>
        <p>
          บัญชีของคุณ ({roleTextOf(actor)}) ไม่มีสิทธิ์เข้าถึงส่วน <b>{what}</b>
        </p>
        <p className="muted">
          ถ้าต้องใช้งานส่วนนี้ ให้ผู้ดูแลระบบเพิ่มบทบาทที่มีสิทธิ์ส่วนนี้ให้บัญชีคุณ
        </p>
        <p style={{ marginTop: 14 }}>
          <Link className="btn" href="/"><Icon name="arrowLeft" /> กลับไปเมนูหลัก</Link>
        </p>
      </Card>
    </>
  );
}
