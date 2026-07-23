import type { FibonacciDrawing, ManualChartLevel } from '../lib/trend'

export const FIBONACCI_RATIOS = [0, 0.382, 0.5, 0.618, 1] as const

export function fibonacciLevels(drawing: FibonacciDrawing): ManualChartLevel[] {
  const priceRange = drawing.end.price - drawing.start.price

  return FIBONACCI_RATIOS.map((ratio) => {
    const price = drawing.start.price + priceRange * ratio
    return {
      id: `${drawing.id}-${ratio}`,
      price,
      time: drawing.start.time,
      endPrice: price,
      endTime: drawing.end.time,
      color: ratio === 0.5 ? '#f2bf67' : '#6bd5ff',
      label: `Фибо ${ratio}`,
      lineWidth: ratio === 0.5 ? 2 : 1,
      dashed: ratio !== 0.5,
    }
  })
}
