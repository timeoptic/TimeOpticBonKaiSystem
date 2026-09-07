"use client";

import RecordCard, { CardList } from "./RecordCard";
import { useApi } from "@/stockmod/lib/useApi";
import type { Policy } from "@/stockmod/lib/api";

/**
 * Who can see and do what, read straight from the API.
 *
 * Nothing here is written down twice: the API builds this table by calling the
 * same permission checks it enforces every request with, so the screen cannot
 * disagree with the code. A permissions page that has quietly gone stale is
 * worse than none at all, because someone will believe it.
 *
 * Read-only on purpose. Changing what a role means is a code change with a
 * review, not a toggle on a busy afternoon — one accidental tick would hand the
 * shop's buying prices to everyone who can sign in.
 */
export default function PolicyTable() {
  const policy = useApi<Policy>("/policy");

  if (policy.status === "loading") return <div className="skeleton" />;

  if (policy.status === "error") {
    return (
      <div className="notice notice--error" role="alert">
        {policy.error}
      </div>
    );
  }

  const roles = policy.data.roles;

  return (
    <>
      <p className="field__help">
        ตารางนี้สร้างจากกฎที่ API ใช้บังคับจริงทุกครั้งที่มีคำขอ — ไม่ได้พิมพ์ไว้ซ้ำ
        แก้กฎในโค้ดเมื่อไหร่ ตารางเปลี่ยนตามทันที · เปลี่ยนสิทธิ์ของแต่ละบทบาทต้องแก้ที่โค้ด
        ส่วนการกำหนดว่าใครอยู่บทบาทไหน ทำได้ในตารางผู้ใช้ด้านบน
      </p>

      {policy.data.groups.map((group) => (
        <div key={group.title}>
        {/* บนมือถือ ตารางกากบาทหกบทบาทกลายเป็นการ์ดละหนึ่งความสามารถ · ตารางแบบ
            เมทริกซ์คือของที่บีบไม่ได้เลย — คอลัมน์หายไปหนึ่งคอลัมน์คือบทบาทหนึ่ง
            บทบาทที่ไม่มีใครรู้ว่าทำได้หรือไม่ได้ */}
        <CardList label={group.title}>
          {group.rows.map((row) => (
            <RecordCard
              key={row.label}
              title={row.label}
              sub={row.note ?? undefined}
              fields={roles.map((r) => ({
                label: r.label,
                value: row.allow[r.key] ? (
                  <span className="status status--stock">
                    ✓<span className="sr-only"> ทำได้</span>
                  </span>
                ) : (
                  <span className="status status--out">
                    ✗<span className="sr-only"> ทำไม่ได้</span>
                  </span>
                ),
              }))}
            />
          ))}
        </CardList>

        <div className="tablewrap wide-only">
          <table className="grid">
            <caption className="sr-only">{group.title}</caption>
            <thead>
              <tr>
                <th scope="col">{group.title}</th>
                {roles.map((r) => (
                  <th scope="col" key={r.key} className="grid__num">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr className="grid__row" key={row.label}>
                  <th scope="row">
                    <span className="grid__name">{row.label}</span>
                    {row.note ? <span className="grid__sub">{row.note}</span> : null}
                  </th>
                  {roles.map((r) => (
                    <td className="grid__num" key={r.key}>
                      {/* Never colour alone: the mark is a word to a screen
                          reader and a shape to everyone else. */}
                      {row.allow[r.key] ? (
                        <span className="status status--stock" title="ทำได้">
                          ✓<span className="sr-only"> ทำได้</span>
                        </span>
                      ) : (
                        <span className="status status--out" title="ทำไม่ได้">
                          ✗<span className="sr-only"> ทำไม่ได้</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      ))}
    </>
  );
}
