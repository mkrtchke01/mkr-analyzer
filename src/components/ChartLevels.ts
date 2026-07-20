import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApiBase, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { ManualChartLevel } from '../lib/trend'

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

class ChartLevelsRenderer implements ISeriesPrimitivePaneRenderer {
  private levels: RenderedLevel[] = []

  update(levels: RenderedLevel[]) {
    this.levels = levels
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save()
      this.levels.forEach((level) => {
        context.beginPath()
        context.strokeStyle = level.color
        context.lineWidth = level.lineWidth * verticalPixelRatio
        context.setLineDash(level.dashed ? [6 * horizontalPixelRatio, 4 * horizontalPixelRatio] : [])
        context.moveTo(level.x * horizontalPixelRatio, level.y * verticalPixelRatio)
        context.lineTo(level.endX * horizontalPixelRatio, level.endY * verticalPixelRatio)
        context.stroke()
      })
      context.restore()
    })
  }
}

class ChartLevelsPaneView implements ISeriesPrimitivePaneView {
  private readonly levelRenderer = new ChartLevelsRenderer()

  update(manualLevels: ManualChartLevel[], chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>) {
    this.levelRenderer.update(manualLevels.flatMap((level) => {
      const x = chart.timeScale().timeToCoordinate(level.time as Time)
      const y = series.priceToCoordinate(level.price)
      const endX = chart.timeScale().timeToCoordinate(level.endTime as Time)
      const endY = series.priceToCoordinate(level.endPrice)
      if (x === null || y === null || endX === null || endY === null) return []

      return [{
        ...level,
        x: getLevelStartX(x),
        endX: getLevelStartX(endX),
        y,
        endY,
        lineWidth: 2,
        color: '#f5bc5b',
        dashed: true,
      }]
    }))
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

  setLevels(levels: ManualChartLevel[]) {
    this.manualLevels = levels
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
    if (this.chart && this.series) this.view.update(this.manualLevels, this.chart, this.series)
  }

  paneViews() {
    return [this.view]
  }

}
