import { useEffect, useRef, useState } from 'react'
import { ColorType, CrosshairMode, createChart, LineStyle, type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type Time } from 'lightweight-charts'
import { chartWebSocketUrl, getCandles, klineEventToCandle, timeframeToBybitInterval, type Candle, type Timeframe } from '../lib/bybit'
import { calculateRsi, calculateRsiSma, type RsiPoint } from '../lib/rsi'
import type { DivergenceInfo } from '../lib/marketInfo'
import { SETUP_META, type FibonacciDrawing, type ManualChartLevel, type RiskRewardBox, type TradePlan } from '../lib/trend'
import { ChartLevelsPrimitive, timeToChartCoordinate, type ChartLevelSelection } from './ChartLevels'
import { distanceToSegment, extrapolateChartTime, isDrawingMenuTarget, isNearPoint } from './DrawingEditor'
import { fibonacciLevels } from './Fibonacci'
import { MeasurementPrimitive, type ChartMeasurement } from './Measurement'
import { createRiskRewardBox, RiskRewardPrimitive } from './RiskReward'
import RsiPanel from './RsiPanel'
import { aggregateLiquidationZones, aggregateOrderBookZones, applyOrderBookUpdate, LIQUIDATION_WINDOW_MS, liquidityWebSocketTopics, mergeLiquidityConfluences, type LiquidationEvent, type LiquidityZone, type OrderBook } from '../lib/liquidity'

type PriceChartProps = {
  symbol: string
  timeframe: Timeframe
  priceTickSize?: number
  pricePrecision?: number
  tradePlans: TradePlan[]
  manualLevels: ManualChartLevel[]
  fibonacciDrawings: FibonacciDrawing[]
  rsiDivergences: Array<DivergenceInfo & { id: string }>
  riskRewards: RiskRewardBox[]
  showLiquidations: boolean
  showOrderBook: boolean
  focusTime: number | null
  drawingMode: 'level' | 'risk' | 'fibonacci' | null
  drawingAnchor: { price: number, time: number } | null
  onDrawingPoint: (point: { price: number, time: number }) => void
  onUpdateRiskReward: (id: string, target: 'takeProfit' | 'stopLoss', price: number) => void
  onUpdateRiskRewardEndpoint: (id: string, endpoint: 'start' | 'end', point: { price: number, time: number }) => void
  onUpdateManualLevel: (id: string, endpoint: 'start' | 'end', point: { price: number, time: number }) => void
  onUpdateFibonacci: (id: string, endpoint: 'start' | 'end', point: { price: number, time: number }) => void
  onMoveManualLevel: (id: string, delta: { price: number, time: number }) => void
  onMoveFibonacci: (id: string, delta: { price: number, time: number }) => void
  onMoveRiskReward: (id: string, delta: { price: number, time: number }) => void
  onDeleteDrawing: (drawing: DrawingSelection) => void
  onStatusChange: (status: 'loading' | 'live' | 'offline') => void
  onPriceChange: (price: number) => void
}

type DrawingSelection = { kind: 'level' | 'fibonacci' | 'risk', id: string }
type DraggingDrawing = DrawingSelection & { endpoint: 'start' | 'end' | 'takeProfit' | 'stopLoss' | 'move', lastPoint?: { price: number, time: number } }

export const freeCrosshairOptions = { mode: CrosshairMode.Normal }

const chartOptions = {
  layout: {
    background: { type: ColorType.Solid, color: '#0c1019' },
    textColor: '#8d99ab',
  },
  grid: {
    vertLines: { color: 'rgba(255, 255, 255, 0.045)' },
    horzLines: { color: 'rgba(255, 255, 255, 0.045)' },
  },
  rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.08)' },
  crosshair: freeCrosshairOptions,
  timeScale: {
    borderColor: 'rgba(255, 255, 255, 0.08)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 60,
    barSpacing: 2,
    minBarSpacing: 1,
  },
}

export function enableInitialVerticalPanning(chart: Pick<IChartApi, 'priceScale'>) {
  chart.priceScale('right').applyOptions({ autoScale: false })
}

export function resetPriceScaleForNewCandles(chart: Pick<IChartApi, 'priceScale'>) {
  chart.priceScale('right').applyOptions({ autoScale: true })
}

export function fitChartHistory(chart: Pick<IChartApi, 'timeScale'>) {
  chart.timeScale().fitContent()
}

export function focusChartOnTime(chart: Pick<IChartApi, 'timeScale'>, timeframe: Timeframe, time: number) {
  const secondsByTimeframe: Record<Timeframe, number> = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }
  const radius = secondsByTimeframe[timeframe] * 60
  chart.timeScale().setVisibleRange({ from: (time - radius) as Time, to: (time + radius) as Time })
}

export function manualLevelFromChartPoint(price: number, time: Time): Omit<ManualChartLevel, 'id'> {
  return { price, time: Number(time), endPrice: price, endTime: Number(time) }
}

const timeframeSeconds: Record<Timeframe, number> = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 }

function resolveChartTime(chart: IChartApi, series: ISeriesApi<'Candlestick'>, coordinate: number) {
  const directTime = chart.timeScale().coordinateToTime(coordinate)
  const candles = series.data()
  const latest = candles.at(-1)
  const previous = candles.at(-2)
  return extrapolateChartTime(
    directTime === null ? null : Number(directTime),
    coordinate,
    latest && typeof latest.time === 'number' ? { time: latest.time, x: timeToChartCoordinate(chart, series, latest.time) ?? 0 } : null,
    previous && typeof previous.time === 'number' ? { time: previous.time, x: timeToChartCoordinate(chart, series, previous.time) ?? 0 } : null,
  )
}

export function entryLevelFromTradePlan(tradePlan: TradePlan, timeframe: Timeframe): ManualChartLevel | undefined {
  if (tradePlan.entryTime === undefined) return undefined
  const startTime = Math.floor(tradePlan.entryTime / timeframeSeconds[timeframe]) * timeframeSeconds[timeframe]
  return {
    id: `entry-${tradePlan.setupType}-${tradePlan.stop.side}-${tradePlan.entryTime}`,
    price: tradePlan.stop.entry,
    time: startTime,
    endPrice: tradePlan.stop.entry,
    endTime: startTime,
    color: '#6bd5ff',
    lineWidth: 1,
    dashed: true,
    extendRight: true,
  }
}

export default function PriceChart({ symbol, timeframe, priceTickSize, pricePrecision, tradePlans, manualLevels, fibonacciDrawings, rsiDivergences, riskRewards, showLiquidations, showOrderBook, focusTime, drawingMode, drawingAnchor, onDrawingPoint, onUpdateRiskReward, onUpdateRiskRewardEndpoint, onUpdateManualLevel, onUpdateFibonacci, onMoveManualLevel, onMoveFibonacci, onMoveRiskReward, onDeleteDrawing, onStatusChange, onPriceChange }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const candlesRef = useRef<Candle[]>([])
  const tradeLinesRef = useRef<IPriceLine[]>([])
  const liquidityLinesRef = useRef<IPriceLine[]>([])
  const currentPriceRef = useRef(0)
  const liquidationsRef = useRef<LiquidationEvent[]>([])
  const orderBookRef = useRef<OrderBook>({ bids: new Map(), asks: new Map() })
  const levelPrimitiveRef = useRef<ChartLevelsPrimitive | null>(null)
  const riskRewardPrimitiveRef = useRef<RiskRewardPrimitive | null>(null)
  const measurementPrimitiveRef = useRef<MeasurementPrimitive | null>(null)
  const measurementGestureRef = useRef(false)
  const draggingDrawingRef = useRef<DraggingDrawing | null>(null)
  const [drawingPreview, setDrawingPreview] = useState<{ price: number, time: number } | null>(null)
  const [selectedDrawing, setSelectedDrawing] = useState<DrawingSelection | null>(null)
  const [drawingMenuPosition, setDrawingMenuPosition] = useState<{ x: number, y: number } | null>(null)
  const [measurement, setMeasurement] = useState<ChartMeasurement | null>(null)
  const [rsiData, setRsiData] = useState<RsiPoint[]>([])
  const [rsiAverage, setRsiAverage] = useState<RsiPoint[]>([])
  const [candleCount, setCandleCount] = useState(0)
  const [rsiVisibleRange, setRsiVisibleRange] = useState<{ from: number, to: number } | null>(null)
  const [liquidityZones, setLiquidityZones] = useState<LiquidityZone[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, { ...chartOptions, width: container.clientWidth, height: container.clientHeight })
    const series = chart.addCandlestickSeries({
      upColor: '#31d28c',
      downColor: '#ff5f74',
      borderVisible: false,
      wickUpColor: '#31d28c',
      wickDownColor: '#ff5f74',
      priceLineVisible: false,
    })
    chartRef.current = chart
    seriesRef.current = series
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    tradeLinesRef.current.forEach((line) => series.removePriceLine(line))
    tradeLinesRef.current = []
    tradePlans.forEach((tradePlan) => {
      const stopPrice = tradePlan.stop.price
      if (stopPrice === undefined) return
      const { stop, takeProfits } = tradePlan
      const setupName = SETUP_META[tradePlan.setupType].shortName
      const referenceLevels = [
        ...(tradePlan.triggerLevel ? [{ ...tradePlan.triggerLevel, color: '#f2c15d' }] : []),
        ...(tradePlan.chartLevels ?? []),
      ].filter((reference, index, references) => references.findIndex((candidate) => candidate.label === reference.label && candidate.price === reference.price) === index)
      referenceLevels.forEach((reference) => {
        tradeLinesRef.current.push(series.createPriceLine({
          price: reference.price,
          color: reference.color ?? '#f2c15d',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: reference.label,
        }))
      })
      if (tradePlan.entryTime !== undefined) {
        tradeLinesRef.current.push(series.createPriceLine({
          price: stop.entry,
          color: '#6bd5ff',
          lineVisible: false,
          axisLabelVisible: true,
          title: `${setupName} ENTRY ${stop.side.toUpperCase()}`,
        }))
      }
      tradeLinesRef.current.push(series.createPriceLine({
        price: stopPrice,
        color: '#ff667a',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${setupName} STOP ${stop.side.toUpperCase()}`,
      }))
      takeProfits.forEach((takeProfit) => {
        tradeLinesRef.current.push(series.createPriceLine({
          price: takeProfit.price,
          color: '#31d28c',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${setupName} ${takeProfit.id} · ${takeProfit.share}% · ${takeProfit.riskMultiple}R`,
        }))
      })
    })
  }, [tradePlans])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    const levelPrimitive = new ChartLevelsPrimitive([])
    levelPrimitiveRef.current = levelPrimitive
    series.attachPrimitive(levelPrimitive)
    return () => {
      series.detachPrimitive(levelPrimitive)
      levelPrimitiveRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    const primitive = new MeasurementPrimitive(null, timeframeSeconds[timeframe])
    measurementPrimitiveRef.current = primitive
    series.attachPrimitive(primitive)
    return () => {
      series.detachPrimitive(primitive)
      measurementPrimitiveRef.current = null
    }
  }, [])

  useEffect(() => {
    measurementPrimitiveRef.current?.setMeasurement(measurement, timeframeSeconds[timeframe])
  }, [measurement, timeframe])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const syncRsiRange = (range: { from: number, to: number } | null) => setRsiVisibleRange(range)
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncRsiRange)
    syncRsiRange(chart.timeScale().getVisibleLogicalRange())
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsiRange)
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series || priceTickSize === undefined || pricePrecision === undefined) return
    series.applyOptions({ priceFormat: { type: 'price', precision: pricePrecision, minMove: priceTickSize } })
  }, [pricePrecision, priceTickSize])

  useEffect(() => {
    const preview = drawingMode === 'level' && drawingAnchor && drawingPreview
      ? [{ id: 'drawing-preview', price: drawingAnchor.price, time: drawingAnchor.time, endPrice: drawingPreview.price, endTime: drawingPreview.time }]
      : []
    const fibonacciPreview = drawingMode === 'fibonacci' && drawingAnchor && drawingPreview
      ? fibonacciLevels({ id: 'fibonacci-preview', start: drawingAnchor, end: drawingPreview })
      : []
    const entries = tradePlans.map((tradePlan) => entryLevelFromTradePlan(tradePlan, timeframe)).filter((level): level is ManualChartLevel => Boolean(level))
    levelPrimitiveRef.current?.setLevels([...manualLevels, ...fibonacciDrawings.flatMap(fibonacciLevels), ...entries, ...preview, ...fibonacciPreview])
    const selectedLevel = selectedDrawing?.kind === 'level' ? manualLevels.find((level) => level.id === selectedDrawing.id) : undefined
    const selectedFibonacci = selectedDrawing?.kind === 'fibonacci' ? fibonacciDrawings.find((drawing) => drawing.id === selectedDrawing.id) : undefined
    const selection: ChartLevelSelection | null = selectedLevel
      ? { start: { price: selectedLevel.price, time: selectedLevel.time }, end: { price: selectedLevel.endPrice, time: selectedLevel.endTime }, color: selectedLevel.color }
      : selectedFibonacci
        ? { ...selectedFibonacci, color: '#b8ff6c', showGuide: true }
        : null
    levelPrimitiveRef.current?.setSelection(selection)
  }, [drawingAnchor, drawingMode, drawingPreview, fibonacciDrawings, manualLevels, selectedDrawing, timeframe, tradePlans])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !drawingMode || !drawingAnchor) {
      setDrawingPreview(null)
      return
    }

    const moveDrawingPreview = (event: { point?: { x: number, y: number } }) => {
      if (!event.point) return
      const price = series.coordinateToPrice(event.point.y)
      const time = resolveChartTime(chart, series, event.point.x)
      if (price !== null && time !== null) setDrawingPreview({ price, time: Number(time) })
    }

    chart.subscribeCrosshairMove(moveDrawingPreview)
    return () => chart.unsubscribeCrosshairMove(moveDrawingPreview)
  }, [drawingAnchor, drawingMode])

  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    const series = seriesRef.current
    if (!container || !chart || !series) return

    const pointFromPointer = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      const price = series.coordinateToPrice(event.clientY - bounds.top)
      const time = resolveChartTime(chart, series, event.clientX - bounds.left)
      return price === null || time === null ? null : { price, time: Number(time) }
    }
    const startMeasurement = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return
      const point = pointFromPointer(event)
      if (!point) return
      measurementGestureRef.current = true
      setMeasurement({ start: point, end: point })
    }
    const moveMeasurement = (event: PointerEvent) => {
      if (!event.shiftKey) return
      const point = pointFromPointer(event)
      if (!point) return
      setMeasurement((current) => current ? { ...current, end: point } : current)
    }
    const clearMeasurement = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return
      measurementGestureRef.current = false
      setMeasurement(null)
    }

    container.addEventListener('pointerdown', startMeasurement)
    container.addEventListener('pointermove', moveMeasurement)
    window.addEventListener('keyup', clearMeasurement)
    return () => {
      container.removeEventListener('pointerdown', startMeasurement)
      container.removeEventListener('pointermove', moveMeasurement)
      window.removeEventListener('keyup', clearMeasurement)
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return

    const primitive = new RiskRewardPrimitive([])
    riskRewardPrimitiveRef.current = primitive
    series.attachPrimitive(primitive)
    return () => {
      series.detachPrimitive(primitive)
      riskRewardPrimitiveRef.current = null
    }
  }, [])

  useEffect(() => {
    const preview = drawingMode === 'risk' && drawingAnchor && drawingPreview
      ? createRiskRewardBox('drawing-preview', drawingAnchor, drawingPreview)
      : null
    riskRewardPrimitiveRef.current?.setBoxes(preview ? [...riskRewards, preview] : riskRewards)
    riskRewardPrimitiveRef.current?.setSelection(selectedDrawing?.kind === 'risk' ? selectedDrawing.id : null)
  }, [drawingAnchor, drawingMode, drawingPreview, riskRewards, selectedDrawing])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !drawingMode) return

    const addDrawingPoint = (event: { point?: { x: number, y: number } }) => {
      if (measurementGestureRef.current) {
        measurementGestureRef.current = false
        return
      }
      if (!event.point) return
      const rawPrice = series.coordinateToPrice(event.point.y)
      const time = resolveChartTime(chart, series, event.point.x)
      if (rawPrice === null || time === null) return
      onDrawingPoint({ price: rawPrice, time: Number(time) })
    }

    chart.subscribeClick(addDrawingPoint)
    return () => chart.unsubscribeClick(addDrawingPoint)
  }, [drawingMode, onDrawingPoint])

  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    const series = seriesRef.current
    if (!container || !chart || !series || drawingMode) return
    const pointFromEvent = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      const price = series.coordinateToPrice(y)
      const time = resolveChartTime(chart, series, x)
      return price === null || time === null ? null : { x, y, price, time }
    }
    const endpointForSelection = (selection: DrawingSelection) => {
      if (selection.kind === 'level') {
        const level = manualLevels.find((item) => item.id === selection.id)
        return level ? { start: { price: level.price, time: level.time }, end: { price: level.endPrice, time: level.endTime } } : null
      }
      if (selection.kind === 'fibonacci') {
        const drawing = fibonacciDrawings.find((item) => item.id === selection.id)
        return drawing ? { start: drawing.start, end: drawing.end } : null
      }
      if (selection.kind === 'risk') {
        const box = riskRewards.find((item) => item.id === selection.id)
        return box ? { start: { price: box.entry, time: box.time }, end: { price: box.takeProfit, time: box.endTime } } : null
      }
      return null
    }
    const onPointerDown = (event: PointerEvent) => {
      if (isDrawingMenuTarget(event.target)) return
      if (event.button !== 0 || event.shiftKey) return
      const point = pointFromEvent(event)
      if (!point) return
      draggingDrawingRef.current = null
      if (selectedDrawing) {
        const endpoints = endpointForSelection(selectedDrawing)
        if (endpoints) {
          const startX = timeToChartCoordinate(chart, series, endpoints.start.time)
          const startY = series.priceToCoordinate(endpoints.start.price)
          const endX = timeToChartCoordinate(chart, series, endpoints.end.time)
          const endY = series.priceToCoordinate(endpoints.end.price)
          if (startX !== null && startY !== null && isNearPoint(point, { x: startX, y: startY })) draggingDrawingRef.current = { ...selectedDrawing, endpoint: 'start' }
          else if (endX !== null && endY !== null && isNearPoint(point, { x: endX, y: endY })) draggingDrawingRef.current = { ...selectedDrawing, endpoint: 'end' }
        }
        if (!draggingDrawingRef.current && selectedDrawing.kind === 'risk') {
          const box = riskRewards.find((item) => item.id === selectedDrawing.id)
          const takeProfitY = box ? series.priceToCoordinate(box.takeProfit) : null
          const stopLossY = box ? series.priceToCoordinate(box.stopLoss) : null
          if (takeProfitY !== null && Math.abs(point.y - takeProfitY) <= 10) draggingDrawingRef.current = { ...selectedDrawing, endpoint: 'takeProfit' }
          else if (stopLossY !== null && Math.abs(point.y - stopLossY) <= 10) draggingDrawingRef.current = { ...selectedDrawing, endpoint: 'stopLoss' }
        }
        if (draggingDrawingRef.current) {
          event.preventDefault()
          container.setPointerCapture(event.pointerId)
          return
        }
      }

      const hitLevel = manualLevels.find((level) => {
        const startX = timeToChartCoordinate(chart, series, level.time)
        const startY = series.priceToCoordinate(level.price)
        const endX = timeToChartCoordinate(chart, series, level.endTime)
        const endY = series.priceToCoordinate(level.endPrice)
        return startX !== null && startY !== null && endX !== null && endY !== null && distanceToSegment(point, { x: startX, y: startY }, { x: endX, y: endY }) <= 8
      })
      const hitFibonacci = !hitLevel && fibonacciDrawings.find((drawing) => fibonacciLevels(drawing).some((level) => {
        const startX = timeToChartCoordinate(chart, series, level.time)
        const endX = timeToChartCoordinate(chart, series, level.endTime)
        const y = series.priceToCoordinate(level.price)
        return startX !== null && endX !== null && y !== null && distanceToSegment(point, { x: startX, y }, { x: endX, y }) <= 8
      }))
      const hitRisk = !hitLevel && !hitFibonacci && riskRewards.find((box) => {
        const startX = timeToChartCoordinate(chart, series, box.time)
        const endX = timeToChartCoordinate(chart, series, box.endTime)
        const entryY = series.priceToCoordinate(box.entry)
        const takeProfitY = series.priceToCoordinate(box.takeProfit)
        const stopLossY = series.priceToCoordinate(box.stopLoss)
        return startX !== null && endX !== null && entryY !== null && takeProfitY !== null && stopLossY !== null
          && point.x >= Math.min(startX, endX) && point.x <= Math.max(startX, endX)
          && point.y >= Math.min(entryY, takeProfitY, stopLossY) && point.y <= Math.max(entryY, takeProfitY, stopLossY)
      })
      const selection = hitLevel ? { kind: 'level' as const, id: hitLevel.id } : hitFibonacci ? { kind: 'fibonacci' as const, id: hitFibonacci.id } : hitRisk ? { kind: 'risk' as const, id: hitRisk.id } : null
      if (selection && selectedDrawing?.kind === selection.kind && selectedDrawing.id === selection.id) {
        draggingDrawingRef.current = { ...selection, endpoint: 'move', lastPoint: point }
        event.preventDefault()
        container.setPointerCapture(event.pointerId)
        return
      }
      setSelectedDrawing(selection)
      setDrawingMenuPosition(selection ? { x: point.x, y: point.y } : null)
    }
    const onPointerMove = (event: PointerEvent) => {
      const dragging = draggingDrawingRef.current
      if (!dragging) return
      const point = pointFromEvent(event)
      if (!point) return
      if (dragging.kind === 'level' && (dragging.endpoint === 'start' || dragging.endpoint === 'end')) onUpdateManualLevel(dragging.id, dragging.endpoint, point)
      if (dragging.kind === 'fibonacci' && (dragging.endpoint === 'start' || dragging.endpoint === 'end')) onUpdateFibonacci(dragging.id, dragging.endpoint, point)
      if (dragging.kind === 'risk' && (dragging.endpoint === 'start' || dragging.endpoint === 'end')) onUpdateRiskRewardEndpoint(dragging.id, dragging.endpoint, point)
      if (dragging.kind === 'risk' && (dragging.endpoint === 'takeProfit' || dragging.endpoint === 'stopLoss')) onUpdateRiskReward(dragging.id, dragging.endpoint, point.price)
      if (dragging.endpoint === 'move' && dragging.lastPoint) {
        const delta = { price: point.price - dragging.lastPoint.price, time: point.time - dragging.lastPoint.time }
        if (dragging.kind === 'level') onMoveManualLevel(dragging.id, delta)
        if (dragging.kind === 'fibonacci') onMoveFibonacci(dragging.id, delta)
        if (dragging.kind === 'risk') onMoveRiskReward(dragging.id, delta)
        dragging.lastPoint = point
      }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!draggingDrawingRef.current) return
      draggingDrawingRef.current = null
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
    }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
    }
  }, [drawingMode, fibonacciDrawings, manualLevels, onMoveFibonacci, onMoveManualLevel, onMoveRiskReward, onUpdateFibonacci, onUpdateManualLevel, onUpdateRiskReward, onUpdateRiskRewardEndpoint, riskRewards, selectedDrawing])

  useEffect(() => {
    let socket: WebSocket | undefined
    let disposed = false
    let retryId: number | undefined
    let scaleFrame: number | undefined
    let lockScaleFrame: number | undefined
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    const displayCandle = (candle: Candle) => {
      series.update(candle as unknown as CandlestickData<Time>)
      const current = candlesRef.current
      candlesRef.current = current.at(-1)?.time === candle.time ? [...current.slice(0, -1), candle] : [...current, candle]
      const nextRsi = calculateRsi(candlesRef.current)
      setRsiData(nextRsi)
      setRsiAverage(calculateRsiSma(nextRsi))
      setCandleCount(candlesRef.current.length)
      onPriceChange(candle.close)
      currentPriceRef.current = candle.close
    }

    const connect = async () => {
      onStatusChange('loading')
      try {
        const candles = await getCandles(symbol, timeframe)
        if (disposed) return
        series.setData(candles as unknown as CandlestickData<Time>[])
        candlesRef.current = candles
        const nextRsi = calculateRsi(candles)
        setRsiData(nextRsi)
        setRsiAverage(calculateRsiSma(nextRsi))
        setCandleCount(candles.length)
        if (focusTime) focusChartOnTime(chart, timeframe, focusTime)
        else fitChartHistory(chart)
        // Let Lightweight Charts recalculate only after the requested time range is visible.
        // Freezing the scale before that calculation included distant candles and compressed the chart.
        scaleFrame = window.requestAnimationFrame(() => {
          if (disposed) return
          resetPriceScaleForNewCandles(chart)
          lockScaleFrame = window.requestAnimationFrame(() => {
            if (!disposed) enableInitialVerticalPanning(chart)
          })
        })
        const latest = candles.at(-1)
        if (latest) onPriceChange(latest.close)
        if (latest) currentPriceRef.current = latest.close
      } catch {
        if (!disposed) onStatusChange('offline')
      }

      if (disposed) return
      socket = new WebSocket(chartWebSocketUrl())
      const interval = timeframeToBybitInterval(timeframe)
      const topic = `kline.${interval}.${symbol}`
      socket.onopen = () => socket?.send(JSON.stringify({ op: 'subscribe', args: [topic] }))
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data) as { topic?: string; data?: Array<Record<string, string | number>> }
        if (payload.topic === topic && payload.data?.[0]) {
          displayCandle(klineEventToCandle(payload.data[0]))
          onStatusChange('live')
        }
      }
      socket.onerror = () => onStatusChange('offline')
      socket.onclose = () => {
        if (!disposed) {
          onStatusChange('offline')
          retryId = window.setTimeout(connect, 3000)
        }
      }
    }

    void connect()
    return () => {
      disposed = true
      if (retryId) window.clearTimeout(retryId)
      if (scaleFrame) window.cancelAnimationFrame(scaleFrame)
      if (lockScaleFrame) window.cancelAnimationFrame(lockScaleFrame)
      socket?.close()
    }
  }, [symbol, timeframe, focusTime, onPriceChange, onStatusChange])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    liquidityLinesRef.current.forEach((line) => series.removePriceLine(line))
    liquidityLinesRef.current = liquidityZones.map((zone) => series.createPriceLine({
      price: zone.price,
      color: zone.source === 'confluence' ? '#b8ff6c' : zone.source === 'orderbook' ? (zone.side === 'bid' ? '#31d28c' : '#ff667a') : (zone.side === 'long' ? '#ff9aab' : '#71cfff'),
      lineWidth: zone.source === 'confluence' ? 3 : 2,
      lineStyle: zone.source === 'orderbook' ? LineStyle.Dotted : LineStyle.Dashed,
      axisLabelVisible: false,
      title: zone.label,
    }))
    return () => {
      liquidityLinesRef.current.forEach((line) => series.removePriceLine(line))
      liquidityLinesRef.current = []
    }
  }, [liquidityZones])

  useEffect(() => {
    if (!showLiquidations && !showOrderBook) {
      setLiquidityZones([])
      return
    }

    let socket: WebSocket | undefined
    let disposed = false
    let retryId: number | undefined
    liquidationsRef.current = []
    orderBookRef.current = { bids: new Map(), asks: new Map() }

    const refreshZones = () => {
      const currentPrice = currentPriceRef.current
      if (currentPrice <= 0) return
      const liquidations = showLiquidations
        ? aggregateLiquidationZones(liquidationsRef.current, currentPrice, priceTickSize)
        : []
      const orderBook = showOrderBook
        ? aggregateOrderBookZones(orderBookRef.current, currentPrice, priceTickSize)
        : []
      setLiquidityZones(mergeLiquidityConfluences(liquidations, orderBook, currentPrice, priceTickSize))
    }

    const connect = () => {
      const topics = liquidityWebSocketTopics(symbol, showLiquidations, showOrderBook)
      if (!topics.length) return
      socket = new WebSocket(chartWebSocketUrl())
      socket.onopen = () => socket?.send(JSON.stringify({ op: 'subscribe', args: topics }))
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data) as {
          topic?: string
          type?: 'snapshot' | 'delta'
          data?: { T?: number, p?: string, v?: string, S?: 'Buy' | 'Sell', b?: string[][], a?: string[][] } | Array<{ T?: number, p?: string, v?: string, S?: 'Buy' | 'Sell' }>
        }
        if (!payload.topic || !payload.data) return
        if (payload.topic.startsWith('allLiquidation.')) {
          const events = (Array.isArray(payload.data) ? payload.data : [payload.data]).flatMap((event) => event.p && event.v && event.S ? [{
            price: Number(event.p),
            size: Number(event.v),
            side: event.S === 'Buy' ? 'long' as const : 'short' as const,
            timestamp: Number(event.T ?? Date.now()),
          }] : [])
          if (events.length) {
            liquidationsRef.current = [...liquidationsRef.current, ...events]
              .filter((item) => item.timestamp >= Date.now() - LIQUIDATION_WINDOW_MS)
            refreshZones()
          }
        }
        if (payload.topic.startsWith('orderbook.') && (payload.type === 'snapshot' || payload.type === 'delta')) {
          if (Array.isArray(payload.data)) return
          orderBookRef.current = applyOrderBookUpdate(orderBookRef.current, payload.type, payload.data)
          refreshZones()
        }
      }
      socket.onclose = () => {
        if (!disposed) retryId = window.setTimeout(connect, 3_000)
      }
    }

    connect()
    return () => {
      disposed = true
      if (retryId) window.clearTimeout(retryId)
      socket?.close()
    }
  }, [priceTickSize, showLiquidations, showOrderBook, symbol])

  return <>
    <div className="chart-canvas" ref={containerRef} aria-label={`График ${symbol}`}>
      {selectedDrawing && drawingMenuPosition && <div className="drawing-menu" style={{ left: drawingMenuPosition.x, top: drawingMenuPosition.y }}>
        <span>{selectedDrawing.kind === 'fibonacci' ? 'Фибо' : selectedDrawing.kind === 'risk' ? 'TP / SL' : 'Линия'}</span>
        <button onClick={() => { onDeleteDrawing(selectedDrawing); setSelectedDrawing(null); setDrawingMenuPosition(null) }}>Удалить</button>
      </div>}
    </div>
    <RsiPanel points={rsiData} averagePoints={rsiAverage} candleCount={candleCount} visibleRange={rsiVisibleRange} divergences={rsiDivergences} />
  </>
}
