'use client';
/**
 * ใบเบิกเลนส์ทุกเคส (Bewell) — คิวงานของคนเบิก / สั่ง / รับเลนส์
 * แท็บสถานะอยู่ใน URL (?status=) ลิงก์ที่ส่งต่อกันจึงเปิดมาเจอกลุ่มเดียวกัน
 * กดแถวไปแท็บ "ใบเบิกเลนส์" ของเคสนั้น ซึ่งเป็นที่กดเปลี่ยนสถานะ
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/apiClient.js';
import { useAsync, useDebounced } from '../../../lib/hooks.js';
import { Badge, Card, Field, LinkTabs, Loading, PageHead, Toolbar } from '../../../components/ui.jsx';
import { QueryParamPage } from '../../../components/QueryParamPage.jsx';
import { fmtDateTime, money } from '../../../lib/format.js';
import { STATUS_LABEL, STATUS_TONE } from '../../../lib/lens/requisition.js';

const TABS = [
  ['/lens-requisitions?status=all', 'ทั้งหมด'],
  ...Object.entries(STATUS_LABEL).map(([k, label]) => [`/lens-requisitions?status=${k}`, label]),
];

function LensRequisitionListInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('status') || 'all';
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, error } = useAsync(
    () => api.get('/api/lens-requisitions', { status: status === 'all' ? '' : status, q: q.trim() }),
    [status, q]
  );

  return (
    <>
      <PageHead icon="clipboard" title="ใบเบิกเลนส์" subtitle="เลนส์ที่ต้องเบิก / สั่ง / รับ ตามแต่ละเคส" />
      <LinkTabs items={TABS} isActive={(to) => to.endsWith(`status=${status}`)} />
      <Card>
        <Toolbar>
          <Field label="ค้นหา">
            <input
              type="search"
              placeholder="เลขใบเบิก / รหัสเคส / ชื่อลูกค้า / เบอร์โทร"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </Field>
        </Toolbar>
        {loading && !rows ? <Loading /> : null}
        {error ? <p className="muted">{error.message}</p> : null}
        {rows && !rows.length ? <p className="muted">ไม่มีใบเบิกเลนส์ในกลุ่มนี้</p> : null}
        {rows?.length ? (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>เลขใบ</th>
                  <th>เคส</th>
                  <th>ลูกค้า</th>
                  <th>เลนส์</th>
                  <th className="num">ยอด</th>
                  <th>สถานะ</th>
                  <th>ออกใบ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => router.push(`/cases/detail?id=${r.case_id}&step=lens`)}
                  >
                    <td><b>{r.req_no}</b></td>
                    <td>
                      <Link href={`/cases/detail?id=${r.case_id}&step=lens`} onClick={(e) => e.stopPropagation()}>
                        {r.case_code}
                      </Link>
                    </td>
                    <td>{r.customer_name}</td>
                    <td>
                      {r.summary || '—'}
                      {!r.has_rx ? <span className="badge warn" style={{ marginLeft: 6 }}>ยังไม่มีค่าสายตา</span> : null}
                    </td>
                    <td className="num">{money(r.total)}</td>
                    <td><Badge kind={STATUS_TONE[r.status]}>{r.status_label}</Badge></td>
                    <td>{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}

export default function LensRequisitionListPage() {
  return (
    <QueryParamPage>
      <LensRequisitionListInner />
    </QueryParamPage>
  );
}
