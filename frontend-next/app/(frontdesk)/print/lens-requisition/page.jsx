'use client';
/**
 * ใบเบิกเลนส์สำหรับพิมพ์ (A4) — ?id=<lens_requisitions.id>
 *
 * ค่าสายตาบนใบคือสำเนาที่เก็บไว้ในใบเบิก (rx_snapshot) ไม่ใช่ใบค่าสายตาปัจจุบัน
 * ใบที่พิมพ์ส่งร้านเลนส์แล้วจึงตรงกับสิ่งที่ระบบบันทึกว่าส่งไปเสมอ
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/apiClient.js';
import { useAsync } from '../../../../lib/hooks.js';
import { Card, Loading } from '../../../../components/ui.jsx';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { Icon } from '../../../../components/Icon.jsx';
import { LensItemsTable, RxSnapshotTable } from '../../../../components/LensRequisitionCard.jsx';
import { fmtDateTime, money } from '../../../../lib/format.js';

const CSS = `
.lr-paper{background:#fff;color:#111;max-width:190mm;margin:0 auto;padding:12mm;border:1px solid var(--line);border-radius:8px}
.lr-paper h1{font-size:20px;margin:0}
.lr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}
.lr-meta{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0;font-size:14px}
.lr-meta dt{color:#555}.lr-meta dd{margin:0}
.lr-sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:40px;text-align:center;font-size:14px}
.lr-sign div{border-top:1px solid #999;padding-top:6px}
@page{size:A4 portrait;margin:10mm}
@media print{
  html,body{background:#fff}
  .sidebar,.sidebar-overlay,.topbar,.page-head,.no-print,.toasts,.scrim{display:none!important}
  .app,.main,.content{display:block!important;margin:0!important;padding:0!important;max-width:none!important}
  .lr-paper{border:0;border-radius:0;padding:0;max-width:none}
}
`;

function LensRequisitionPrintInner() {
  const id = useSearchParams().get('id');
  const { data: r, loading, error } = useAsync(async () => {
    if (!id) throw new Error('ไม่ได้ระบุเลขใบเบิก');
    return api.get(`/api/lens-requisitions/${id}`);
  }, [id]);

  if (loading) return <Loading text="กำลังเตรียมใบเบิก…" />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  return (
    <>
      <style>{CSS}</style>
      <div className="row no-print" style={{ gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn" onClick={() => window.print()}>
          <Icon name="printer" /> พิมพ์ (A4)
        </button>
        <Link className="btn btn-light" href={`/cases/detail?id=${r.case_id}&step=lens`}>
          <Icon name="arrowLeft" /> กลับไปที่เคส
        </Link>
      </div>

      <div className="lr-paper">
        <div className="lr-head">
          <div>
            <h1>ใบเบิกเลนส์</h1>
            <div>TIMEOPTIC @ สาขาบ่อนไก่</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b>{r.req_no}</b>
            <div>สถานะ: {r.status_label}</div>
          </div>
        </div>

        <dl className="lr-meta">
          <dt>วันที่ออกใบ</dt><dd>{fmtDateTime(r.created_at)}</dd>
          <dt>เคส</dt><dd>{r.case_code}</dd>
          <dt>ลูกค้า</dt><dd>{r.customer_name}{r.customer_phone ? ` · ${r.customer_phone}` : ''}</dd>
          <dt>ออเดอร์</dt><dd>{r.invoice_code || '—'}</dd>
          <dt>ผู้ออกใบ</dt><dd>{r.created_by_name || '—'}</dd>
        </dl>

        <h3>ค่าสายตา (Final Rx)</h3>
        <RxSnapshotTable rx={r.rx_snapshot} />

        <h3>รายการเลนส์</h3>
        <LensItemsTable items={r.items || []} />
        <p style={{ textAlign: 'right' }}><b>รวม {money(r.total)}</b></p>

        <div className="lr-sign">
          <div>ผู้เบิก / วันที่</div>
          <div>ผู้รับเลนส์ / วันที่</div>
        </div>
      </div>
    </>
  );
}

export default function LensRequisitionPrintPage() {
  return (
    <QueryParamPage>
      <LensRequisitionPrintInner />
    </QueryParamPage>
  );
}
