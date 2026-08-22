import { api } from '../../api/client.js';
import { useAsync } from '../../lib/hooks.js';
import { Card, Loading, PageHead, PrintButton } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { money, sumBy } from '../../lib/format.js';

export default function Monthly() {
  const { data: rows, loading, error } = useAsync(() => api.get('/api/reports/income-by-month'), []);

  if (loading) return <Loading />;
  if (error) return <Card><p className="muted">{error.message}</p></Card>;

  const max = Math.max(1, ...rows.map((r) => Number(r.total_income)));
  const bar = (r) => (
    <div
      style={{
        height: 9,
        borderRadius: 5,
        background: 'var(--accent)',
        width: `${Math.round((Number(r.total_income) / max) * 100)}%`,
        minWidth: 2,
      }}
    />
  );

  const sum = {
    pay: sumBy(rows, (r) => r.payment_income),
    sale: sumBy(rows, (r) => r.sale_income),
    other: sumBy(rows, (r) => r.other_income),
    exp: sumBy(rows, (r) => r.expense),
    net: sumBy(rows, (r) => r.net),
  };

  return (
    <>
      <PageHead
        icon="📈"
        title="Sale Income By Month"
        subtitle="สรุปรายรับรายเดือน"
        actions={<PrintButton />}
      />
      <Card tight>
        <DataTable
          rowKey={(r) => r.ym}
          columns={[
            { label: 'เดือน', key: 'ym', cls: 'nowrap' },
            { label: 'รับเงินจากลูกค้า', render: (r) => money(r.payment_income), cls: 'num' },
            { label: '(ในนั้นเป็นขายสินค้า)', render: (r) => money(r.sale_income), cls: 'num' },
            { label: 'รายรับอื่น', render: (r) => money(r.other_income), cls: 'num' },
            { label: 'รวมรับ', render: (r) => money(r.total_income), cls: 'num' },
            { label: 'รายจ่าย', render: (r) => money(r.expense), cls: 'num' },
            { label: 'สุทธิ', render: (r) => <b>{money(r.net)}</b>, cls: 'num' },
            { label: 'สัดส่วน', render: bar },
          ]}
          rows={rows}
          empty="ยังไม่มีข้อมูล"
          footer={rows.length ? (
            <tr>
              <td>รวมทั้งหมด</td>
              <td className="num">{money(sum.pay)}</td>
              <td className="num">{money(sum.sale)}</td>
              <td className="num">{money(sum.other)}</td>
              <td className="num">{money(sum.pay + sum.other)}</td>
              <td className="num">{money(sum.exp)}</td>
              <td className="num">{money(sum.net)}</td>
              <td />
            </tr>
          ) : null}
        />
      </Card>
    </>
  );
}
