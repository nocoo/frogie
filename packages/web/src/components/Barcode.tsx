/**
 * Barcode Component
 *
 * Decorative barcode pattern for badge card header
 */

const bars = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1]

export function Barcode() {
  return (
    <div className="flex items-stretch gap-[1.5px] h-full">
      {bars.map((w, i) => (
        <div
          key={`bar-${String(i)}`}
          className="rounded-[0.5px] bg-primary-foreground"
          style={{ width: `${String(w * 1.5)}px`, opacity: i % 3 === 0 ? 0.9 : 0.5 }}
        />
      ))}
    </div>
  )
}
