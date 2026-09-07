'use client';
/** The small presentational pieces the pages are built from. Port of frontend/src/components/ui.jsx. */
import { Fragment, cloneElement, isValidElement, useId, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon.jsx';

export function PageHead({ icon, title, subtitle, actions = null, className = '' }) {
  return (
    <div className={`page-head ${className}`.trim()}>
      <div className="ph-icon"><Icon name={icon} /></div>
      <h1>{title}{subtitle ? <span>{subtitle}</span> : null}</h1>
      {actions ? <div className="ph-actions">{actions}</div> : null}
    </div>
  );
}

/**
 * A card that starts folded. For the long tails of a screen — a timeline, a
 * withdrawal history — that matter when you go looking and are noise when you
 * do not: the header still says how much is in there.
 */
export function CardFold({ title, badge, right, count, defaultOpen = false, tight, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button type="button" className="card-head fold-head" onClick={() => setOpen((v) => !v)}>
        <h2>{title}</h2>
        {badge}
        <span className="fold-right">
          {count !== undefined ? <span className="muted">{count}</span> : null}
          {right}
          <span className={`fold-caret ${open ? 'open' : ''}`} aria-hidden="true" />
        </span>
      </button>
      {open ? <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div> : null}
    </div>
  );
}

export function Card({ title, badge, right, tight, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {title || badge || right ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : null}
          {badge}
          {right ? <div className="right">{right}</div> : null}
        </div>
      ) : null}
      <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
    </div>
  );
}

/**
 * ป้าย + ช่องกรอกหนึ่งคู่
 *
 * ป้ายถูกผูกกับช่องด้วย htmlFor/id ไม่ใช่ด้วยการเอา <label> ไปครอบ — ครอบไม่ได้
 * เพราะ <label> ส่งคลิกทุกครั้งไปที่ช่องที่มันคุมอยู่ แล้วการคลิกวันในปฏิทินของ
 * <DateField> ที่ลอยอยู่ข้างในจะถูกส่งต่อไปหาช่องด้วย ปฏิทินจะกะพริบปิด-เปิด
 * (เหตุผลเดียวกับที่ ReportFilter ใช้ <div> ไม่ใช่ <label>)
 *
 * ผูกเฉพาะตอนที่ลูกเป็นแท็กพื้นฐานจริง ๆ (input/select/textarea) — คอมโพเนนต์
 * ของเราเอง (DateField, Select, MultiSelect …) ไม่ได้ส่ง id ต่อไปให้ช่องข้างใน
 * ยัด id ให้มันจะได้ id ที่ไปเกาะ <div> ครอบแทน แล้วป้ายจะชี้ไปที่กล่องเปล่า
 *
 * ที่ผูกแล้วได้อะไร: แตะที่ป้ายแล้วเคอร์เซอร์ไปอยู่ในช่องเลย — บนมือถือนี่คือ
 * พื้นที่กดที่กว้างขึ้นฟรี ๆ โดยไม่ต้องขยายอะไร และเป็นสิ่งที่โปรแกรมอ่านหน้าจอ
 * ต้องใช้เพื่อบอกว่าช่องนี้ชื่ออะไร
 */
export function Field({ label, hint, children, className = '' }) {
  const auto = useId();
  const native = isValidElement(children)
    && typeof children.type === 'string'
    && ['input', 'select', 'textarea'].includes(children.type)
    && !children.props.id;
  const id = native ? auto : undefined;

  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {native ? cloneElement(children, { id }) : children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export const Split = ({ children, className = '' }) => (
  <div className={`split ${className}`}>{children}</div>
);
export const Stack = ({ children, style }) => <div className="stack" style={style}>{children}</div>;
export const Row = ({ children, style }) => <div className="row" style={style}>{children}</div>;
export const Toolbar = ({ children, className = '' }) => (
  <div className={`toolbar ${className}`}>{children}</div>
);
export const FormGrid = ({ children, two = false, className = '' }) => (
  <div className={`form-grid ${two ? 'two' : ''} ${className}`}>{children}</div>
);
export const FormActions = ({ children, style }) => (
  <div className="form-actions" style={style}>{children}</div>
);

export const Badge = ({ kind = '', children, style, title }) => (
  <span className={`badge ${kind}`} style={style} title={title}>{children}</span>
);

export const Empty = ({ children = 'ไม่มีข้อมูล' }) => <div className="empty">{children}</div>;

export const Loading = ({ text = 'กำลังโหลด…' }) => (
  <div className="loading"><span className="spin" /> {text}</div>
);

export function Kpi({ label, value, sub, kind = '' }) {
  return (
    <div className={`kpi ${kind}`}>
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub ? <div className="k-sub">{sub}</div> : null}
    </div>
  );
}

export const Kpis = ({ children, className = '' }) => (
  <div className={`kpis ${className}`.trim()}>{children}</div>
);

export function Fieldset({ legend, children }) {
  return <fieldset><legend>{legend}</legend>{children}</fieldset>;
}

export function Check({ name, checked, onChange, children, defaultChecked }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={checked} defaultChecked={defaultChecked} onChange={onChange} />
      {' '}{children}
    </label>
  );
}

export function Tabs({ names, active, onSelect }) {
  return (
    <div className="tabs">
      {names.map((n) => (
        <a
          key={n}
          href="#"
          className={n === active ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); onSelect(n); }}
        >
          {n}
        </a>
      ))}
    </div>
  );
}

export function LinkTabs({ items, isActive }) {
  return (
    <div className="tabs">
      {items.map(([to, label]) => (
        <Link key={to} href={to} className={isActive(to) ? 'active' : ''}>{label}</Link>
      ))}
    </div>
  );
}

export function OrderStatusBadge({ order }) {
  if (Number(order.order_closed)) return <Badge kind="ok">ปิดการขายแล้ว</Badge>;
  const unfilled = !order.lens_product_id || !order.right_lens_product_id || !order.frame_product_id;
  return unfilled
    ? <Badge kind="warn">รอของ / ยังไม่เติม</Badge>
    : <Badge kind="blue">รอลูกค้ารับ</Badge>;
}

export const PrintButton = () => (
  <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>
    <Icon name="printer" /> พิมพ์
  </button>
);

/**
 * key/value description list.
 * `dl.kv` is a two-column grid, so the pairs are emitted as fragments — a
 * wrapper element would become a single grid item and break the columns.
 */
export function Kv({ rows, style }) {
  return (
    <dl className="kv" style={style}>
      {rows.filter(Boolean).map(([k, v], i) => (
        <Fragment key={`${k}-${i}`}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
