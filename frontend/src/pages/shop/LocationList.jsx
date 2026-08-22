import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAsync, useDebounced, onSubmit } from '../../lib/hooks.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, Field, FormActions, FormGrid, Loading, PageHead, Toolbar } from '../../components/ui.jsx';
import { DataTable } from '../../components/DataTable.jsx';

export default function LocationList() {
  const { ok, err } = useToast();
  const [term, setTerm] = useState('');
  const q = useDebounced(term);

  const { data: rows, loading, reload } = useAsync(
    () => api.get('/api/locations', { q: q.trim() }),
    [q]
  );

  const add = async (body, form) => {
    try {
      await api.post('/api/locations', body);
      ok('เพิ่มแล้ว');
      form.reset();
      reload();
    } catch (ex) { err(ex); }
  };

  const remove = async (r) => {
    try {
      await api.del('/api/locations/' + r.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div>
      <PageHead icon="📍" title="Product Location" subtitle="ตำแหน่งจัดเก็บสินค้า" />

      <div className="card">
        <div className="card-head"><h2>เพิ่มตำแหน่งสินค้า</h2></div>
        <form className="card-body" onSubmit={onSubmit(add)}>
          <FormGrid>
            <Field label="ชื่อสินค้า / ProductName *"><input name="product_name" required /></Field>
            <Field label="ตำแหน่ง / Location *">
              <input name="location" required placeholder="เช่น ตู้PRO1, Display, ข้างหลัง" />
            </Field>
            <Field label=" ">
              <button className="btn" type="submit">+ เพิ่มตำแหน่ง</button>
            </Field>
          </FormGrid>
          <FormActions />
        </form>
      </div>

      <Toolbar>
        <Field label="ค้นหา" className="grow">
          <input
            type="search"
            placeholder="ค้นหาชื่อสินค้า / ตำแหน่ง"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </Field>
      </Toolbar>

      {loading ? <Loading /> : (
        <Card tight>
          <DataTable
            columns={[
              { label: 'ID', key: 'id', cls: 'mono' },
              { label: 'ชื่อสินค้า', key: 'product_name' },
              { label: 'ตำแหน่ง', key: 'location' },
              {
                label: '',
                cls: 'nowrap',
                render: (r) => (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => remove(r)}>🗑</button>
                ),
              },
            ]}
            rows={rows}
            empty="ยังไม่มีข้อมูลตำแหน่งสินค้า"
          />
        </Card>
      )}
    </div>
  );
}
