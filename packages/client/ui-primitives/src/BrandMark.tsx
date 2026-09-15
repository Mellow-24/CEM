import type { IconProps } from './icons/props.ts'

/**
 * Render the 深绎未来 character mark.
 * @param props.size - width in px (default 24; height keeps the 1:1 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the decorative brand mark svg.
 */
export function BrandMark({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="currentColor" />
      <text
        x="12"
        y="16.35"
        fill="var(--dsw-alias-label-primary-inverted)"
        fontFamily="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
        fontSize="13.5"
        fontWeight="700"
        textAnchor="middle"
      >深</text>
    </svg>
  )
}
