import { useEffect, useRef, useState } from 'react'
import { ColorType, CrosshairMode, createChart, LineStyle, type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type Time } from 'lightweight-charts'
import { chartWebSocketUrl, getCandles, klineEventToCandle, timeframeToBybitInterval, type Candle, type Timeframe } from '../lib/bybit'
import { calculateRsi, calculateRsiSma, type RsiPoint } from '../lib/rsi'
import type { DivergenceInfo } from '../lib/marketInfo'
import { SETUP_META, type FibonacciDrawing, type ManualChartLevel, type RiskRewardBox, type TradePlan } from '../lib/trend'
import { ChartLevelsPrimitive } from './ChartLevels'
import { fibonacciLevels } from './Fibonacci'
import { MeasurementPrimitive, type ChartMeasurement } from './Measurement'
import { createRiskRewardBox, getRiskRewardHandle, RiskRewardPrimitive } from './RiskReward'
import RsiPanel from './RsiPanel'

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
  focusTime: number | null
  drawingMode: 'level' | 'risk' | 'fibonacci' | null
  drawingAnchor: { price: number, time: number } | null
  onDrawingPoint: (point: { price: number, time: number }) => void
  onUpdateRiskReward: (id: string, target: 'takeProfit' | 'stopLoss', price: number) => void
  onStatusChange: (status: 'loading' | 'live' | 'offline') => void
  onPriceChange: (price: number) => void
}

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
    rightOffset: 5,
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

export default function PriceChart({ symbol, timeframe, priceTickSize, pricePrecision, tradePlans, manualLevels, fibonacciDrawings, rsiDivergences, riskRewards, focusTime, drawingMode, drawingAnchor, onDrawingPoint, onUpdateRiskReward, onStatusChange, onPriceChange }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const candlesRef = useRef<Candle[]>([])
  const tradeLinesRef = useRef<IPriceLine[]>([])
  const levelPrimitiveRef = useRef<ChartLevelsPrimitive | null>(null)
  const riskRewardPrimitiveRef = useRef<RiskRewardPrimitive | null>(null)
  const measurementPrimitiveRef = useRef<MeasurementPrimitive | null>(null)
  const measurementGestureRef = useRef(false)
  const [drawingPreview, setDrawingPreview] = useState<{ price: number, time: number } | null>(null)
  const [measurement, setMeasurement] = useState<ChartMeasurement | null>(null)
  const [rsiData, setRsiData] = useState<RsiPoint[]>([])
  const [rsiAverage, setRsiAverage] = useState<RsiPoint[]>([])
  const [candleCount, setCandleCount] = useState(0)
  const [rsiVisibleRange, setRsiVisibleRange] = useState<{ from: number, to: number } | null>(null)

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
  }, [drawingAnchor, drawingMode, drawingPreview, fibonacciDrawings, manualLevels, timeframe, tradePlans])

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
      const time = chart.timeScale().coordinateToTime(event.point.x)
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
      const time = chart.timeScale().coordinateToTime(event.clientX - bounds.left)
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
  }, [drawingAnchor, drawingMode, drawingPreview, riskRewards])

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
      const time = chart.timeScale().coordinateToTime(event.point.x)
      if (rawPrice === null || time === null) return
      onDrawingPoint({ price: rawPrice, time: Number(time) })
    }

    chart.subscribeClick(addDrawingPoint)
    return () => chart.unsubscribeClick(addDrawingPoint)
  }, [drawingMode, onDrawingPoint])

  useEffect(() => {
    const container = containerRef.current
    const series = seriesRef.current
    if (!container || !series || !riskRewards.length) return
    let dragging: { id: string, target: 'takeProfit' | 'stopLoss' } | null = null
    const getChartY = (event: PointerEvent) => event.clientY - container.getBoundingClientRect().top
    const onPointerDown = (event: PointerEvent) => {
      const handles = riskRewards.flatMap((box) => {
        const takeProfitY = series.priceToCoordinate(box.takeProfit)
        const stopLossY = series.priceToCoordinate(box.stopLoss)
        return [takeProfitY === null ? null : { id: box.id, target: 'takeProfit' as const, y: takeProfitY }, stopLossY === null ? null : { id: box.id, target: 'stopLoss' as const, y: stopLossY }].filter(Boolean)
      }) as Array<{ id: string, target: 'takeProfit' | 'stopLoss', y: number }>
      const handle = getRiskRewardHandle(getChartY(event), handles)
      if (!handle) return
      event.preventDefault()
      dragging = handle
      container.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const price = series.coordinateToPrice(getChartY(event))
      if (price !== null) onUpdateRiskReward(dragging.id, dragging.target, price)
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return
      dragging = null
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
    }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
    }
  }, [riskRewards, onUpdateRiskReward])

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

  return <>
    <div className="chart-canvas" ref={containerRef} aria-label={`График ${symbol}`} />
    <RsiPanel points={rsiData} averagePoints={rsiAverage} candleCount={candleCount} visibleRange={rsiVisibleRange} divergences={rsiDivergences} />
  </>
}
