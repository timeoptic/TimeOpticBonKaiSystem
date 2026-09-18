'use client';
/**
 * เส้นทางฝั่ง POS — ห่อ apiClient กลางไว้ชั้นเดียว
 *
 * มีไว้เพื่อให้ path ของ POS อยู่ที่เดียว ไม่กระจายเป็นสตริงตามคอมโพเนนต์
 * (วันที่ย้าย prefix ทีเดียวจบ) และเพื่อให้คอมโพเนนต์ไม่ต้องรู้จัก apiClient ตรง ๆ
 */
import { api } from '../apiClient.js';

/** ช่องทางชำระที่ API รับ — ค่าต้องตรงกับ POS_METHODS ใน api/routes/pos.php */
export const PAY_METHODS = [
  ['cash', 'เงินสด'],
  ['transfer', 'BBL'], // ร้านรับโอนเข้าบัญชีกรุงเทพบัญชีเดียว — ค่าที่เก็บยังเป็น transfer
  ['credit', 'บัตรเครดิต'],
  ['thungngern', 'ถุงเงิน'],
];

export const payMethodLabel = (m) =>
  (PAY_METHODS.find(([k]) => k === m) || [null, m])[1];

export const PAYMENT_STATUS = {
  unpaid: ['ยังไม่ชำระ', 'danger'],
  partial: ['ชำระบางส่วน', 'warn'],
  paid: ['ชำระครบแล้ว', 'ok'],
};

export const FULFILLMENT_STATUS = {
  waiting: ['ยังไม่ส่งมอบ / รอลูกค้ามารับ', 'warn'],
  delivered: ['ส่งมอบสินค้าแล้ว', 'ok'],
};

export const posApi = {
  products: (q, signal) => api.get('/api/pos/products', q ? { q } : {}, signal),
  sales: (query, signal) => api.get('/api/pos/sales', query, signal),
  sale: (id, signal) => api.get(`/api/pos/sales/${id}`, {}, signal),
  create: (body) => api.post('/api/pos/sales', body),
  addPayment: (id, body) => api.post(`/api/pos/sales/${id}/payments`, body),
  deliver: (id, delivered) => api.post(`/api/pos/sales/${id}/deliver`, { delivered }),
  void: (id, reason) => api.post(`/api/pos/sales/${id}/void`, { reason }),
};
