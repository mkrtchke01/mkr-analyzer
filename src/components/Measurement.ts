import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApiBase, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts'

export type ChartMeasurement = {
  start: { price: number, time: number }
  end: { price: number, time: number }
}

export type MeasurementSummary = {
  priceChange: number
  percentChange: number
  candles: number
}

export function calculateMeasurement(measurement: ChartMeasurement, timeframeSeconds: number): MeasurementSummary {
  const priceChange = measurement.end.price - measurement.start.price
  return {
    priceChange,
    percentChange: measurement.start.price === 0 ? 0 : priceChange / measurement.start.price * 100,
    candles: Math.max(0, Math.round(Math.abs(measurement.end.time - measurement.start.time) / timeframeSeconds)),
  }
}

type RenderedMeasurement = ChartMeasurement & { startX: number, endX: number, startY: number, endY: number }

class MeasurementRenderer implements ISeriesPrimitivePaneRenderer {
  private measurement: RenderedMeasurement | null = null
  private timeframeSeconds = 300

  update(measurement: RenderedMeasurement | null, timeframeSeconds: number) {
    this.measurement = measurement
    this.timeframeSeconds = timeframeSeconds
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this.measurement) return
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const measurement = this.measurement!
      const startX = measurement.startX * horizontalPixelRatio
      const endX = measurement.endX * horizontalPixelRatio
      const startY = measurement.startY * verticalPixelRatio
      const endY = measurement.endY * verticalPixelRatio
      const isUp = measurement.end.price >= measurement.start.price
      const color = isUp ? '#31d28c' : '#ff667a'
      const summary = calculateMeasurement(measurement, this.timeframeSeconds)
      const direction = summary.priceChange >= 0 ? '+' : ''
      const label = `${direction}${summary.priceChange.toPrecision(6)} · ${direction}${summary.percentChange.toFixed(2)}% · ${summary.candles} св.`

      context.save()
      context.strokeStyle = color
      context.fillStyle = isUp ? 'rgba(49, 210, 140, .12)' : 'rgba(255, 102, 122, .12)'
      context.lineWidth = 1.25 * verticalPixelRatio
      context.setLineDash([5 * horizontalPixelRatio, 4 * horizontalPixelRatio])
      context.beginPath()
      context.moveTo(startX, startY)
      context.lineTo(endX, startY)
      context.lineTo(endX, endY)
      context.stroke()
      context.setLineDash([])
      context.fillRect(Math.min(startX, endX), Math.min(startY, endY), Math.abs(endX - startX), Math.abs(endY - startY))

      context.font = `${10 * verticalPixelRatio}px monospace`
      const labelWidth = context.measureText(label).width + 12 * horizontalPixelRatio
      const labelHeight = 20 * verticalPixelRatio
      const labelX = endX + 7 * horizontalPixelRatio
      const labelY = Math.max(0, endY - labelHeight / 2)
      context.fillStyle = '#10151d'
      context.fillRect(labelX, labelY, labelWidth, labelHeight)
      context.strokeStyle = color
      context.strokeRect(labelX, labelY, labelWidth, labelHeight)
      context.fillStyle = color
      context.fillText(label, labelX + 6 * horizontalPixelRatio, labelY + 13 * verticalPixelRatio)
      context.restore()
    })
  }
}

class MeasurementPaneView implements ISeriesPrimitivePaneView {
  private readonly rendererInstance = new MeasurementRenderer()

  update(measurement: ChartMeasurement | null, chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>, timeframeSeconds: number) {
    if (!measurement) return this.rendererInstance.update(null, timeframeSeconds)
    const startX = chart.timeScale().timeToCoordinate(measurement.start.time as Time)
    const endX = chart.timeScale().timeToCoordinate(measurement.end.time as Time)
    const startY = series.priceToCoordinate(measurement.start.price)
    const endY = series.priceToCoordinate(measurement.end.price)
    if (startX === null || endX === null || startY === null || endY === null) return this.rendererInstance.update(null, timeframeSeconds)
    this.rendererInstance.update({ ...measurement, startX, endX, startY, endY }, timeframeSeconds)
  }

  zOrder() {
    return 'top' as const
  }

  renderer() {
    return this.rendererInstance
  }
}

export class MeasurementPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private series: ISeriesApi<'Candlestick', Time> | null = null
  private requestUpdate: (() => void) | null = null
  private readonly view = new MeasurementPaneView()

  constructor(private measurement: ChartMeasurement | null, private timeframeSeconds: number) {}

  setMeasurement(measurement: ChartMeasurement | null, timeframeSeconds: number) {
    this.measurement = measurement
    this.timeframeSeconds = timeframeSeconds
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
    if (this.chart && this.series) this.view.update(this.measurement, this.chart, this.series, this.timeframeSeconds)
  }

  paneViews() {
    return [this.view]
  }
}
