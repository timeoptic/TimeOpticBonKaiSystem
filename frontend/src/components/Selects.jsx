/** Dropdowns fed from /api/meta. */
import { useMeta } from '../api/meta.jsx';

/**
 * `options` accepts ['a', 'b'] or [[value, label], …].
 * Uncontrolled by default (defaultValue) so forms can be read with readForm().
 */
export function Select({ name, options, value, defaultValue, onChange, ...rest }) {
  const norm = (options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
  const controlled = value !== undefined;
  return (
    <select
      name={name}
      {...(controlled
        ? { value: value ?? '', onChange }
        : { defaultValue: defaultValue ?? '', onChange })}
      {...rest}
    >
      {norm.map(([v, label]) => (
        <option key={String(v)} value={v}>{label}</option>
      ))}
    </select>
  );
}

export function EmployeeSelect({ name, value, defaultValue, onChange, blank = '— เลือกพนักงาน —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...meta.employees.map((e) => [e.id, e.employee_name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

/** A dropdown backed by one of the meta.lists arrays (sex, pay_type, …). */
export function ListSelect({ name, kind, value, defaultValue, onChange, blank = null, ...rest }) {
  const { meta } = useMeta();
  const options = [...(blank ? [['', blank]] : []), ...(meta.lists[kind] || [])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

export function SupplierSelect({ name, value, defaultValue, onChange, blank = '— ไม่ระบุ —', ...rest }) {
  const { meta } = useMeta();
  const options = [['', blank], ...(meta.suppliers || []).map((s) => [s.id, s.name])];
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}

/** Case statuses, optionally hiding the terminal ones. */
export function StatusSelect({ name, value, defaultValue, onChange, openOnly = false, ...rest }) {
  const { meta } = useMeta();
  const options = (meta.statuses || [])
    .filter((s) => !openOnly || !Number(s.is_terminal))
    .map((s) => [s.code, `${s.stage_no} ${s.label_th}`]);
  return (
    <Select name={name} options={options} value={value} defaultValue={defaultValue} onChange={onChange} {...rest} />
  );
}
