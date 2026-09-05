'use client';
/** The R/L prescription grid, shared by the case, order and print views. Port of frontend/src/components/RxTable.jsx. */
import { addPower, cylPower, rxNum, sphPower } from '../lib/format.js';

export function RxTable({ t, withPrism = false, labels = ['R', 'L'] }) {
  const heads = ['', 'SPH', 'CYL', 'AXIS', 'ADD', 'PD', 'VA', ...(withPrism ? ['PRISM'] : [])];

  const row = (label, k) => (
    <tr key={k}>
      <td className="lbl">{label}</td>
      {[
        sphPower(t[`${k}_sphere`]),
        cylPower(t[`${k}_cylinder`]),
        rxNum(t[`${k}_axis`]),
        addPower(t[`${k}_add`]),
        rxNum(t[`${k}_pd`]),
        rxNum(t[`${k}_va`]),
        ...(withPrism ? [t[`${k}_prism`] || '—'] : []),
      ].map((v, i) => <td key={i}>{String(v)}</td>)}
    </tr>
  );

  return (
    <table className="doc" style={{ width: '100%' }}>
      <thead>
        <tr>{heads.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {row(labels[0], 'r')}
        {row(labels[1], 'l')}
      </tbody>
    </table>
  );
}
