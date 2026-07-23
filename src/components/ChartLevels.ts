import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApiBase, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { ManualChartLevel } from '../lib/trend'

export type ChartLevelSelection = {
  start: { price: number, time: number }
  end: { price: number, time: number }
  color?: string
  showGuide?: boolean
}

type RenderedLevel = ManualChartLevel & {
  x: number
  endX: number
  y: number
  endY: number
  lineWidth: number
  color: string
  dashed: boolean
}

export function getLevelStartX(sourceCoordinate: number | null) {
  return sourceCoordinate ?? 0
}

export function getLevelEndX(level: Pick<ManualChartLevel, 'endTime' | 'extendRight'> & { endX: number }, paneWidth: number) {
  return level.extendRight ? paneWidth : level.endX
}

export function timeToChartCoordinate(chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>, time: number) {
  const directCoordinate = chart.timeScale().timeToCoordinate(time as Time)
  if (directCoordinate !== null) return directCoordinate
  const candles = series.data()
  const latest = candles.at(-1)
  const previous = candles.at(-2)
  if (!latest || !previous || typeof latest.time !== 'number' || typeof previous.time !== 'number') return null
  const latestX = chart.timeScale().timeToCoordinate(latest.time)
  const previousX = chart.timeScale().timeToCoordinate(previous.time)
  if (latestX === null || previousX === null || latestX === previousX) return null
  return latestX + (time - latest.time) * (latestX - previousX) / (latest.time - previous.time)
}

class ChartLevelsRenderer implements ISeriesPrimitivePaneRenderer {
  private levels: RenderedLevel[] = []
  private selection: (ChartLevelSelection & { x: number, y: number, endX: number, endY: number }) | null = null

  update(levels: RenderedLevel[], selection: (ChartLevelSelection & { x: number, y: number, endX: number, endY: number }) | null) {
    this.levels = levels
    this.selection = selection
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save()
      this.levels.forEach((level) => {
        const endX = getLevelEndX(level, bitmapSize.width / horizontalPixelRatio)
        context.beginPath()
        context.strokeStyle = level.color
        context.lineWidth = level.lineWidth * verticalPixelRatio
        context.setLineDash(level.dashed ? [6 * horizontalPixelRatio, 4 * horizontalPixelRatio] : [])
        context.moveTo(level.x * horizontalPixelRatio, level.y * verticalPixelRatio)
        context.lineTo(endX * horizontalPixelRatio, level.endY * verticalPixelRatio)
        context.stroke()
        if (level.label) {
          const labelX = level.extendRight ? level.x + 6 : endX + 6
          context.fillStyle = level.color
          context.font = `${10 * verticalPixelRatio}px "DM Mono", monospace`
          context.fillText(level.label, labelX * horizontalPixelRatio, (level.endY - 5) * verticalPixelRatio)
        }
      })
      if (this.selection) {
        const selection = this.selection
        const color = selection.color ?? '#b8ff6c'
        if (selection.showGuide) {
          context.beginPath()
          context.strokeStyle = color
          context.lineWidth = 1 * verticalPixelRatio
          context.setLineDash([4 * horizontalPixelRatio, 3 * horizontalPixelRatio])
          context.moveTo(selection.x * horizontalPixelRatio, selection.y * verticalPixelRatio)
          context.lineTo(selection.endX * horizontalPixelRatio, selection.endY * verticalPixelRatio)
          context.stroke()
        }
        context.setLineDash([])
        ;[[selection.x, selection.y], [selection.endX, selection.endY]].forEach(([x, y]) => {
          context.beginPath()
          context.fillStyle = '#0c1019'
          context.strokeStyle = color
          context.lineWidth = 2 * verticalPixelRatio
          context.arc(x * horizontalPixelRatio, y * verticalPixelRatio, 5 * horizontalPixelRatio, 0, Math.PI * 2)
          context.fill()
          context.stroke()
        })
      }
      context.restore()
    })
  }
}

class ChartLevelsPaneView implements ISeriesPrimitivePaneView {
  private readonly levelRenderer = new ChartLevelsRenderer()

  update(manualLevels: ManualChartLevel[], chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>, selection: ChartLevelSelection | null) {
    this.levelRenderer.update(manualLevels.flatMap((level) => {
      const x = timeToChartCoordinate(chart, series, level.time)
      const y = series.priceToCoordinate(level.price)
      const endX = timeToChartCoordinate(chart, series, level.endTime)
      const endY = series.priceToCoordinate(level.endPrice)
      if (x === null || y === null || endX === null || endY === null) return []

      return [{
        ...level,
        x: getLevelStartX(x),
        endX: getLevelStartX(endX),
        y,
        endY,
        lineWidth: level.lineWidth ?? 2,
        color: level.color ?? '#f5bc5b',
        dashed: level.dashed ?? true,
      }]
    }), selection ? (() => {
      const x = timeToChartCoordinate(chart, series, selection.start.time)
      const y = series.priceToCoordinate(selection.start.price)
      const endX = timeToChartCoordinate(chart, series, selection.end.time)
      const endY = series.priceToCoordinate(selection.end.price)
      return x === null || y === null || endX === null || endY === null ? null : { ...selection, x, y, endX, endY }
    })() : null)
  }

  zOrder() {
    return 'top' as const
  }

  renderer() {
    return this.levelRenderer
  }
}

export class ChartLevelsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private series: ISeriesApi<'Candlestick', Time> | null = null
  private requestUpdate: (() => void) | null = null
  private readonly view = new ChartLevelsPaneView()

  constructor(private manualLevels: ManualChartLevel[]) {}
  private selection: ChartLevelSelection | null = null

  setLevels(levels: ManualChartLevel[]) {
    this.manualLevels = levels
    this.requestUpdate?.()
  }

  setSelection(selection: ChartLevelSelection | null) {
    this.selection = selection
    this.requestUpdate?.()
  }

  attached(parameters: SeriesAttachedParameter<Time>) {
    this.chart = parameters.chart
    this.series = parameters.series as ISeriesApi<'Candlestick', Time>
    this.requestUpdate = parameters.requestUpdate
    this.requestUpdate()
  }

  detached() {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  updateAllViews() {
    if (this.chart && this.series) this.view.update(this.manualLevels, this.chart, this.series, this.selection)
  }

  paneViews() {
    return [this.view]
  }

}
