"use client";

/**
 * A quantity, with the two buttons that save it being typed.
 *
 * Most of the time the number is one or two, and reaching for a keyboard to
 * change 1 to 2 is more work than the task deserves — especially on the shop's
 * tablet, where a keypad covers half the form. The field stays typeable for the
 * day someone counts out thirty.
 *
 * The value is kept as a string, not a number: while someone is clearing the box
 * to retype it, the field is briefly empty, and a numeric state would turn that
 * into a 0 that fights the cursor.
 */
export default function QtyField({
  id,
  value,
  onChange,
  label = "จำนวน",
  max,
  help,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  label?: string;
  /** Usually what is on hand. The plus button stops here rather than promising stock that is not there. */
  max?: number;
  help?: string;
  disabled?: boolean;
}) {
  const n = Number(value);
  const current = Number.isFinite(n) ? n : 0;

  const step = (by: number) => {
    const next = current + by;
    if (next < 1) return;
    if (max !== undefined && next > max) return;
    onChange(String(next));
  };

  const atMin = current <= 1;
  const atMax = max !== undefined && current >= max;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      <div className="qty">
        <button
          type="button"
          className="qty__step"
          onClick={() => step(-1)}
          disabled={disabled || atMin}
          aria-label={`ลด${label}`}
        >
          −
        </button>
        <input
          id={id}
          className="input qty__input"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          disabled={disabled}
          autoComplete="off"
        />
        <button
          type="button"
          className="qty__step"
          onClick={() => step(1)}
          disabled={disabled || atMax}
          aria-label={`เพิ่ม${label}`}
        >
          +
        </button>

        {/* The jumps people actually make. "ทั้งหมด" is the one worth having on
            a screen where running a product down to zero is a normal day. */}
        <div className="qty__quick">
          {[1, 2, 5, 10].map((q) =>
            max !== undefined && q > max ? null : (
              <button
                key={q}
                type="button"
                className="chip chip--preset"
                aria-pressed={current === q}
                disabled={disabled}
                onClick={() => onChange(String(q))}
              >
                {q}
              </button>
            ),
          )}
          {max !== undefined && max > 0 ? (
            <button
              type="button"
              className="chip chip--preset"
              aria-pressed={current === max}
              disabled={disabled}
              onClick={() => onChange(String(max))}
            >
              ทั้งหมด {max}
            </button>
          ) : null}
        </div>
      </div>

      {help ? <span className="field__help">{help}</span> : null}
    </div>
  );
}
