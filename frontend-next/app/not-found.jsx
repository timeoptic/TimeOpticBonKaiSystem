import Link from 'next/link';
import { Card } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <Card>
      <h2>404 — ไม่พบหน้านี้</h2>
      <p><Link href="/">← กลับเมนูหลัก</Link></p>
    </Card>
  );
}
