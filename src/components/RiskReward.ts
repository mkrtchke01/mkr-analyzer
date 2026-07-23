import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApiBase, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { RiskRewardBox } from '../lib/trend'
import { timeToChartCoordinate } from './ChartLevels'

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

export function moveRiskRewardEndpoint(box: RiskRewardBox, endpoint: 'start' | 'end', point: { price: number, time: number }): RiskRewardBox {
  if (endpoint === 'start') return { ...box, time: point.time, entry: point.price }
  const distance = Math.abs(point.price - box.entry)
  const isLong = point.price > box.entry
  return {
    ...box,
    endTime: point.time,
    takeProfit: point.price,
    stopLoss: isLong ? box.entry - distance / 3 : box.entry + distance / 3,
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
  private selectedId: string | null = null

  update(boxes: RenderedRiskReward[], selectedId: string | null) {
    this.boxes = boxes
    this.selectedId = selectedId
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
        if (box.id === this.selectedId) {
          ;[[box.startX, box.entryY], [box.endX, box.takeProfitY], [box.startX, box.stopLossY]].forEach(([x, y]) => {
            context.beginPath()
            context.fillStyle = '#0c1019'
            context.strokeStyle = '#b8ff6c'
            context.lineWidth = 2 * verticalPixelRatio
            context.arc((x as number) * horizontalPixelRatio, (y as number) * verticalPixelRatio, 5 * horizontalPixelRatio, 0, Math.PI * 2)
            context.fill()
            context.stroke()
          })
        }
      })
      context.restore()
    })
  }
}

class RiskRewardPaneView implements ISeriesPrimitivePaneView {
  private readonly rendererInstance = new RiskRewardRenderer()

  update(boxes: RiskRewardBox[], chart: IChartApiBase<Time>, series: ISeriesApi<'Candlestick', Time>, selectedId: string | null) {
    this.rendererInstance.update(boxes.flatMap((box) => {
      const startX = timeToChartCoordinate(chart, series, box.time)
      const endX = timeToChartCoordinate(chart, series, box.endTime)
      const entryY = series.priceToCoordinate(box.entry)
      const takeProfitY = series.priceToCoordinate(box.takeProfit)
      const stopLossY = series.priceToCoordinate(box.stopLoss)
      if (startX === null || endX === null || entryY === null || takeProfitY === null || stopLossY === null) return []
      return [{ ...box, startX, endX, entryY, takeProfitY, stopLossY }]
    }), selectedId)
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
  private selectedId: string | null = null

  constructor(private boxes: RiskRewardBox[]) {}

  setBoxes(boxes: RiskRewardBox[]) {
    this.boxes = boxes
    this.requestUpdate?.()
  }

  setSelection(id: string | null) {
    this.selectedId = id
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
    if (this.chart && this.series) this.view.update(this.boxes, this.chart, this.series, this.selectedId)
  }

  paneViews() {
    return [this.view]
  }
}
