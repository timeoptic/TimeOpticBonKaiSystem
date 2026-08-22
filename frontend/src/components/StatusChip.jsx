/** The coloured stage chip used on the board, lists and case header. */
import { stageInfo } from '../lib/constants.js';

export function StatusChip({ row }) {
  const s = stageInfo(row.stage_group);
  return (
    <span
      className="badge"
      style={{ background: `${s.color}1a`, color: s.color }}
    >
      {`${row.stage_no || ''} ${row.status_label_th || row.status}`.trim()}
    </span>
  );
}
