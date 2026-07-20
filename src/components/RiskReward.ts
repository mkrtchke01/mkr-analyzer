import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApiBase, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { RiskRewardBox } from '../lib/trend'

type RenderedRiskReward = RiskRewardBox & { startX: number, endX: number, entryY: number, takeProfitY: number, stopLossY: number }
export type RiskRewardHandle = { id: string, target: 'takeProfit' | 'stopLoss', y: number }

export function createRiskRewardBox(
  id: string,
  entry: { price: number, time: number },
  target: { price: number, time: number },
): RiskRewardBox | null {
  const distance = Math.abs(target.price - entry.price)
  if (!distance) return null

  const isLong = target.price > entry.price
  return {
    id,
    time: entry.time,
    endTime: target.time,
    entry: entry.price,
    takeProfit: target.price,
    stopLoss: isLong ? entry.price - distance / 3 : entry.price + distance / 3,
  }
}

export function getRiskRewardHandle(cursorY: number, handles: RiskRewardHandle[]) {
  return handles
    .map((handle) => ({ handle, distance: Math.abs(cursorY - handle.y) }))
    .filter(({ distance }) => distance <= 10)
    .sort((left, right) => left.distance - right.distance)[0]?.handle
}

class RiskRewardRenderer implements ISeriesPrimitivePaneRenderer {
  private boxes: RenderedRiskReward[] = []

  update(boxes: RenderedRiskReward[]) {
    this.boxes = boxes
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save()
      this.boxes.forEach((box) => {
        const left = Math.min(box.startX, box.endX) * horizontalPixelRatio
        const width = Math.abs(box.endX - box.startX) * horizontalPixelRatio
        const entryY = box.entryY * verticalPixelRatio
        const takeProfitY = box.takeProfitY * verticalPixelRatio
        const stopLossY = box.stopLossY * verticalPixelRatio
        context.fillStyle = 'rgba(49, 210, 140, .18)'
        context.fillRect(left, Math.min(entryY, takeProfitY), width, Math.abs(entryY - takeProfitY))
        context.fillStyle = 'rgba(255, 102, 122, .18)'
        context.fillRect(left, Math.min(entryY, stopLossY), width, Math.abs(entryY - stopLossY))
        context.lineWidth = 1.5 * verticalPixelRatio
        ;[[takeProfitY, '#31d28c'], [stopLossY, '#ff667a'], [entryY, '#e8edf5']].forEach(([y, color]) => {
          context.beginPath()
          context.strokeStyle = color as string
          context.moveTo(left, y as number)
          context.lineTo(left + width, y as number)
          context.stroke()
        })
      })
      context.restore()
    })
  }
}

class RiskRewardPaneView implements ISeriesPrimitivePaneView {
  private readonly rendererInstance = new RiskRewardRenderer()

  update(boxes: RiskRewardBox[], chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>) {
    this.rendererInstance.update(boxes.flatMap((box) => {
      const startX = chart.timeScale().timeToCoordinate(box.time as Time)
      const endX = chart.timeScale().timeToCoordinate(box.endTime as Time)
      const entryY = series.priceToCoordinate(box.entry)
      const takeProfitY = series.priceToCoordinate(box.takeProfit)
      const stopLossY = series.priceToCoordinate(box.stopLoss)
      if (startX === null || endX === null || entryY === null || takeProfitY === null || stopLossY === null) return []
      return [{ ...box, startX, endX, entryY, takeProfitY, stopLossY }]
    }))
  }

  zOrder() {
    return 'top' as const
  }

  renderer() {
    return this.rendererInstance
  }
}

export class RiskRewardPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private series: ISeriesApi<'Candlestick', Time> | null = null
  private requestUpdate: (() => void) | null = null
  private readonly view = new RiskRewardPaneView()

  constructor(private boxes: RiskRewardBox[]) {}

  setBoxes(boxes: RiskRewardBox[]) {
    this.boxes = boxes
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
    if (this.chart && this.series) this.view.update(this.boxes, this.chart, this.series)
  }

  paneViews() {
    return [this.view]
  }
}
