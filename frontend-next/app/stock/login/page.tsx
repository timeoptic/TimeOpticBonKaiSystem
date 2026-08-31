"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Actor } from "@/stockmod/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!username || !password) {
      setError("กรอกทั้งชื่อผู้ใช้และรหัสผ่านก่อนเข้าสู่ระบบ");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post<{ actor: Actor }>("/auth/login", { username, password });
      router.replace("/stock");
    } catch (err) {
      // An unreachable API and a wrong password are different problems and lead
      // to different fixes, so they must never share a message.
      setError(
        ApiError.is(err)
          ? err.message
          : "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
      );
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={onSubmit} noValidate>
        <div className="signin__brand">
          <span className="rail-brand__dot" aria-hidden="true" />
          <span className="rail-brand__text">
            คลังและต้นทุน
            <span className="rail-brand__sub">optical</span>
          </span>
        </div>

        <div>
          <h1 className="signin__title">เข้าสู่ระบบ</h1>
          <p className="signin__lede">ใช้บัญชีที่เจ้าของร้านออกให้</p>
        </div>

        {error ? (
          <p className="notice notice--error" role="alert" style={{ marginBlockEnd: 0 }}>
            {error}
          </p>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="username">
            ชื่อผู้ใช้
          </label>
          <input
            id="username"
            name="username"
            className="input"
            autoComplete="username"
            autoFocus
            disabled={busy}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password">
            รหัสผ่าน
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            disabled={busy}
          />
        </div>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </main>
  );
}
