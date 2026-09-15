import type { IconProps } from './icons/props.ts'
import { BrandMark } from './BrandMark.tsx'

/**
 * Render the 深绎未来 wordmark.
 * @param props.size - mark height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the decorative product wordmark.
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(6, size / 3), height: size }}
    >
      <BrandMark size={size} />
      <span style={{ color: 'currentColor', fontSize: size * 0.78, fontWeight: 720, letterSpacing: '0.08em', lineHeight: 1, whiteSpace: 'nowrap' }}>
        深绎未来
      </span>
    </span>
  )
}
