'use client';
/**
 * ใครกำลังใช้งานอยู่.
 *
 * ไม่มีระบบล็อกอินของตัวเอง — ใช้ของระบบคลัง (`stock/api/src/Auth.php`) ทั้งดุ้น
 * ซึ่งอ่านตาราง `admins` เดิม สองหน้าจึงล็อกอินครั้งเดียวใช้ได้ทั้งคู่ เพราะใช้
 * คุกกี้ `optic_session` ใบเดียวกัน
 *
 * เหตุผลที่ไม่ทำบัญชีสองชุด: ฐานข้อมูลเดียวกัน ถ้ามีสองที่ให้ปิดสิทธิ์คนที่ลาออก
 * วันหนึ่งจะปิดไม่ครบ
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/apiClient.js';

const AuthContext = createContext({
  actor: null, ready: false, login: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }) {
  const [actor, setActor] = useState(null);
  const [ready, setReady] = useState(false);

  /* /api/auth/me ตอบ null เมื่อยังไม่ได้ล็อกอิน ซึ่งเป็นคำตอบ ไม่ใช่ข้อผิดพลาด
     จึงเป็นเส้นเดียวที่เรียกได้ก่อนล็อกอิน */
  const refresh = useCallback(async () => {
    try {
      setActor(await api.get('/api/auth/me'));
    } catch {
      setActor(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (username, password) => {
    setActor(await api.post('/api/auth/login', { username, password }));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout', {});
    setActor(null);
  }, []);

  return (
    <AuthContext.Provider value={{ actor, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
