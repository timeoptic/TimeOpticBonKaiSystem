'use client';
/** Multi-file upload + thumbnail grid for a case's attached photos. */
import { useRef } from 'react';
import { api } from '../lib/apiClient.js';
import { useAsync } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from './Confirm.jsx';

export function PhotoUpload({ caseId, kind = 'other', centeringId = null, paymentId = null, takenBy = null }) {
  const { ok, err } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const { data: photos, loading, reload } = useAsync(
    () => api.get('/api/uploads', { case_id: caseId }),
    [caseId]
  );

  const pick = () => inputRef.current?.click();

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('case_id', caseId);
      form.append('kind', kind);
      if (centeringId) form.append('centering_id', centeringId);
      if (paymentId) form.append('payment_id', paymentId);
      if (takenBy) form.append('taken_by', takenBy);
      try {
        await api.upload('/api/uploads', form);
      } catch (ex) { err(ex); }
    }
    ok('อัปโหลดรูปแล้ว');
    reload();
  };

  const remove = async (p) => {
    if (!await confirm('ลบรูป', p.original_name || '', { confirmText: 'ลบ', danger: true })) return;
    try {
      await api.del('/api/uploads/' + p.id);
      ok('ลบแล้ว');
      reload();
    } catch (ex) { err(ex); }
  };

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={upload}
      />
      <button type="button" className="btn btn-sm btn-light" onClick={pick}>📷 เพิ่มรูป</button>
      {loading ? null : (
        <div className="photo-grid">
          {(photos || []).map((p) => (
            <div className="photo-thumb" key={p.id}>
              {p.mime_type === 'application/pdf'
                ? <a href={api.url('/api/uploads/' + p.id)} target="_blank" rel="noreferrer">📄 {p.original_name}</a>
                : <img src={api.url('/api/uploads/' + p.id)} alt={p.original_name || ''} />}
              <button type="button" className="photo-thumb-del" onClick={() => remove(p)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
