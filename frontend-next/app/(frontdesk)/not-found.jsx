import Link from 'next/link';
import { Card } from '../../components/ui.jsx';
import { Icon } from '../../components/Icon.jsx';

export default function NotFound() {
  return (
    <Card>
      <h2>404 — ไม่พบหน้านี้</h2>
      <p><Link href="/"><Icon name="arrowLeft" /> กลับเมนูหลัก</Link></p>
    </Card>
  );
}
