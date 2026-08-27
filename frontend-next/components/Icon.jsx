'use client';
/**
 * One icon from lib/icons.js.
 *
 * `name` takes either an icon name ("printer") or the emoji it replaced ("🖨"),
 * so the config objects that still carry an emoji — CASE_PROCESSES, the menu
 * tiles, PageHead's icon prop — keep working while reading as icons on screen.
 *
 * An unknown name renders as the given text rather than disappearing: a missing
 * shape should look wrong, not silently leave a gap.
 */
import { EMOJI, SHAPES } from '../lib/icons.js';

export function Icon({ name, className = '', title = null }) {
  if (!name) return null;
  const key = SHAPES[name] ? name : EMOJI[name];
  const shape = SHAPES[key];
  if (!shape) return <span className={className}>{name}</span>;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
      className={`ico ${className}`.trim()}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: title ? `<title>${title}</title>${shape}` : shape }}
    />
  );
}
