'use client';
import { Card } from '../../components/ui.jsx';

export default function GlobalError({ error, reset }) {
  return (
    <Card>
      <h2>เกิดข้อผิดพลาด</h2>
      <p className="muted">{error?.message || 'มีบางอย่างผิดพลาด กรุณาลองใหม่'}</p>
      <button type="button" className="btn" onClick={() => reset()}>ลองใหม่</button>
    </Card>
  );
}
