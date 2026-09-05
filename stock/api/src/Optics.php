<?php

declare(strict_types=1);

namespace Optic;

/**
 * The runs of numbers a prescription is allowed to hold.
 *
 * The two forms that ask for a power offer exactly these steps — the same
 * ladders are built in `frontend-next/stockmod/lib/optics.ts` — and the shop
 * asked for the boxes to stop accepting anything else. A hand-keyed "-2.3" or
 * "-25.00" is a slip of the finger, never a lens, and once it is in the ledger
 * it sorts apart from every real power and reads as a size the shop stocks.
 *
 * Repeated here rather than trusted to the form for the ordinary reason: the
 * API is reachable without the form, and `rx_orders` is a ledger the till and
 * the shop-floor system both read back. One file so the day the shop fits a
 * wider range there is one number to change on each side, not one per caller.
 */
final class Optics
{
    /** Powers are ground in quarter dioptres. Nothing between the steps exists. */
    public const STEP = 0.25;

    /**
     * Each field's run, both ends included.
     *
     * CYL is negative-only because this shop writes minus-cyl, and 0.00 stays
     * in it because "no astigmatism" is a value someone records, not a blank.
     * It runs as deep as SPH does: heavy astigmatism exists, and the -6.00 it
     * stopped at was a ceiling nobody had meant to set.
     *
     * ADD starts at +0.25 — the shop does prescribe additions that small.
     *
     * Both were widened on the shop's word. The ladders in
     * `frontend-next/stockmod/lib/optics.ts` carry the same two numbers and
     * have to move with these.
     */
    public const RANGE = [
        'sph' => [-12.0, 12.0],
        'cyl' => [-12.0, 0.0],
        'add' => [0.25, 3.5],
    ];

    /** An axis is whole degrees round a half circle — 180 and 0 are the same line. */
    public const AXIS_MIN = 0;
    public const AXIS_MAX = 180;

    /**
     * One power as the ladder spells it, or null when the field was left blank.
     *
     * Blank stays blank: an order is routinely keyed from a phone call and the
     * sheet follows, so "not recorded" has to remain sayable. What is refused
     * is a number that is not on the ladder — off the ends of the run, or
     * between two steps.
     *
     * @param string $key   Which run to measure against — a key of RANGE.
     * @param string $label What the box is called on screen, for the message.
     */
    public static function power(mixed $v, string $key, string $label): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }

        [$min, $max] = self::RANGE[$key];

        // An iPad keyboard writes a real minus sign, and an ADD is written with
        // its plus. Both are how the number is spelled, not part of the number.
        $s = str_replace('−', '-', trim((string) $v));
        if (!preg_match('/^[-+]?\d{1,3}(\.\d{1,2})?$/', $s)) {
            throw ApiError::badRequest("{$label} ต้องเป็นตัวเลข ทศนิยมไม่เกินสองตำแหน่ง", 'bad_rx');
        }

        /* Counted in steps rather than compared as fractions: 0.25 has no exact
           binary form, so `fmod(-2.25, 0.25)` is not reliably zero. Rounding to
           the nearest step and asking how far that landed from what was typed
           answers the same question without trusting the last bit. */
        $typed = (float) $s;
        $on    = round($typed / self::STEP) * self::STEP;

        if (abs($on - $typed) > 0.0001 || $on < $min || $on > $max) {
            throw ApiError::badRequest(
                sprintf(
                    '%s ต้องอยู่ในช่วง %s ถึง %s และเป็นขั้นละ %s',
                    $label,
                    self::write($min),
                    self::write($max),
                    number_format(self::STEP, 2, '.', ''),
                ),
                'out_of_range',
            );
        }

        return self::write($on);
    }

    /**
     * The axis, as a whole degree.
     *
     * Read as a number rather than a spelling because the column is one: an
     * axis has no sign and no decimal, and 007 and 7 are the same meridian.
     */
    public static function axis(mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }

        $s = trim((string) $v);
        if (!preg_match('/^\d{1,3}$/', $s) || (int) $s < self::AXIS_MIN || (int) $s > self::AXIS_MAX) {
            throw ApiError::badRequest(
                sprintf('AXIS ต้องเป็นจำนวนเต็ม %d–%d', self::AXIS_MIN, self::AXIS_MAX),
                'bad_axis',
            );
        }

        return (int) $s;
    }

    /**
     * A power, always signed and always two places.
     *
     * "+1.50" and "-1.50" are different lenses, and a bare "1.50" says which
     * only to someone who already knows. The same rule as the picker's ladder,
     * so a value written here matches the option it came from character for
     * character.
     */
    public static function write(float $n): string
    {
        return ($n > 0 ? '+' : ($n < 0 ? '-' : '')) . number_format(abs($n), 2, '.', '');
    }
}
