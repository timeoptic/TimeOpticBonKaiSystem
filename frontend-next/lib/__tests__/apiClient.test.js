// frontend-next/lib/__tests__/apiClient.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return response;
  };
  return calls;
}

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

test('api.get: prefixes the path with NEXT_PUBLIC_API_ORIGIN when set', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = 'http://127.0.0.1:8080';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ ok: 1 }));
  await api.get('/api/meta');
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/api/meta');
});

test('api.get: falls back to a relative path when NEXT_PUBLIC_API_ORIGIN is empty', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ ok: 1 }));
  await api.get('/api/meta');
  assert.equal(calls[0].url, '/api/meta');
});

test('api.get: serializes query params, skipping blank/null/undefined', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson([]));
  await api.get('/api/customers', { q: 'สม', page: '', archived: null });
  assert.equal(calls[0].url, '/api/customers?q=%E0%B8%AA%E0%B8%A1');
});

test('api.post: sends a JSON body and content-type header', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const calls = stubFetch(okJson({ id: 1 }));
  await api.post('/api/employees', { employee_name: 'ทดสอบ' });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['content-type'], 'application/json');
  assert.equal(calls[0].opts.body, JSON.stringify({ employee_name: 'ทดสอบ' }));
});

test('request: throws with the server error message on a non-ok response', async () => {
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'กรุณากรอกชื่อ' }) });
  await assert.rejects(() => api.post('/api/employees', {}), /กรุณากรอกชื่อ/);
});

test('request: the thrown error carries status, reason and the response body', async () => {
  /* หน้ารับเงินต้องแยก "อาจซ้ำ" (ถามยืนยันแล้วส่งใหม่ได้) ออกจากข้อผิดพลาดอื่น —
     ข้อความภาษาไทยเปลี่ยนได้ รหัสเหตุผลคือสิ่งที่โค้ดตัดสินใจด้วย */
  process.env.NEXT_PUBLIC_API_ORIGIN = '';
  const { api } = await import('../apiClient.js');
  const body = { error: 'เพิ่งบันทึกยอดนี้ไป', reason: 'possible_duplicate', duplicate: { amount: 2900, seconds_ago: 4 } };
  global.fetch = async () => ({ ok: false, status: 409, json: async () => body });
  await assert.rejects(() => api.post('/api/payments', {}), (e) => {
    assert.equal(e.message, 'เพิ่งบันทึกยอดนี้ไป');
    assert.equal(e.status, 409);
    assert.equal(e.reason, 'possible_duplicate');
    assert.deepEqual(e.data, body);
    return true;
  });
});
