'use client';
/**
 * คู่มือการใช้งานระบบหน้าร้าน — สำหรับพนักงานที่ยืนหน้าเคาน์เตอร์
 *
 * เนื้อหาอยู่ที่ `lib/manual.js` เป็นข้อมูลล้วน หน้านี้แค่วาด · แก้คำในคู่มือจึงไม่ต้อง
 * แตะ JSX และ `lib/__tests__/manual.test.js` จับลิงก์ที่ชี้ไปหน้าที่ไม่มีแล้วได้
 *
 * ไม่ยิง API สักเส้น — คู่มือต้องเปิดอ่านได้แม้ข้อมูลของร้านโหลดไม่ขึ้น
 */
import { Fragment } from 'react';
import Link from 'next/link';
import { MANUAL, MANUAL_GROUPS } from '../../../lib/manual.js';
import { CASE_PROCESSES } from '../../../lib/caseProcesses.js';
import { Card, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icon.jsx';

/** "กด [[บันทึก]]" → ป้ายที่หน้าตาเหมือนปุ่มจริง ให้คนอ่านรู้ว่าต้องหาอะไรบนจอ */
function Text({ children }) {
  return String(children).split(/(\[\[[^\]]+\]\])/g).map((part, i) => (
    part.startsWith('[[') && part.endsWith(']]')
      ? <span key={i} className="manual-ui">{part.slice(2, -2)}</span>
      : <Fragment key={i}>{part}</Fragment>
  ));
}

/** หกขั้นของเคส — ชื่อ สี และไอคอนมาจาก CASE_PROCESSES ชุดเดียวกับกระดานงาน */
function Flow() {
  return (
    <ol className="manual-flow">
      {CASE_PROCESSES.map((p, i) => (
        <li key={p.id} style={{ '--stage': p.color }}>
          <a href={`#${p.id}`}>
            <span className="manual-flow-dot"><Icon name={p.icon} /></span>
            <span className="manual-flow-no">ขั้นที่ {i + 1}</span>
            <b>{p.label}</b>
          </a>
        </li>
      ))}
    </ol>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'flow':
      return <Flow />;
    case 'text':
      return <p><Text>{block.text}</Text></p>;
    case 'steps':
    case 'list': {
      const List = block.type === 'steps' ? 'ol' : 'ul';
      return (
        <div className="manual-block">
          {block.title ? <h3>{block.title}</h3> : null}
          <List className={block.type === 'steps' ? 'manual-steps' : 'manual-list'}>
            {block.items.map((item, i) => <li key={i}><Text>{item}</Text></li>)}
          </List>
        </div>
      );
    }
    case 'note':
      return (
        <div className={`manual-note ${block.tone === 'warn' ? 'warn' : ''}`}>
          <Icon name={block.tone === 'warn' ? 'warning' : 'sparkle'} />
          <div>
            {block.title ? <b>{block.title}</b> : null}
            <p><Text>{block.text}</Text></p>
          </div>
        </div>
      );
    case 'table':
      return (
        <div className="manual-block">
          {block.title ? <h3>{block.title}</h3> : null}
          <div className="manual-table-wrap">
            <table className="manual-table">
              <thead><tr>{block.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j}><Text>{cell}</Text></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case 'faq':
      return (
        <div className="manual-faq">
          {block.items.map((f, i) => (
            <details key={i}>
              <summary><Text>{f.q}</Text></summary>
              <p><Text>{f.a}</Text></p>
            </details>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export default function ManualPage() {
  return (
    <div className="manual">
      <PageHead icon="book" title="คู่มือการใช้งาน" subtitle="ระบบหน้าร้าน · สำหรับพนักงาน" />

      <section id="toc" className="manual-section">
        <Card title="สารบัญ" className="manual-toc">
          <nav aria-label="สารบัญคู่มือ">
            {MANUAL_GROUPS.map((group) => (
              <div key={group}>
                <div className="manual-toc-head">{group}</div>
                <ul>
                  {MANUAL.filter((s) => s.group === group).map((s) => (
                    <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>
      </section>

      {MANUAL.map((s) => (
        <section key={s.id} id={s.id} className="manual-section">
          <Card title={<><Icon name={s.icon} /> {s.title}</>}>
            {s.lead ? <p className="manual-lead"><Text>{s.lead}</Text></p> : null}
            {s.blocks.map((b, i) => <Block key={i} block={b} />)}
            {s.open?.length ? (
              <div className="manual-open">
                {s.open.map((o) => (
                  <Link key={o.href} href={o.href} className="btn">
                    เปิดหน้า{o.label} <Icon name="arrowRight" />
                  </Link>
                ))}
              </div>
            ) : null}
          </Card>
        </section>
      ))}

      <p className="manual-top"><a href="#toc">กลับไปสารบัญ</a></p>
    </div>
  );
}
