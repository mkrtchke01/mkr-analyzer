import { useEffect, useRef } from 'react'
import { ColorType, createChart, LineStyle, type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type Time } from 'lightweight-charts'
import { chartWebSocketUrl, getCandles, klineEventToCandle, timeframeToBybitInterval, type Candle, type Timeframe } from '../lib/bybit'
import { SETUP_META, type TradePlan } from '../lib/trend'

type PriceChartProps = {
  symbol: string
  timeframe: Timeframe
  tradePlans: TradePlan[]
  onStatusChange: (status: 'loading' | 'live' | 'offline') => void
  onPriceChange: (price: number) => void
}

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
  timeScale: {
    borderColor: 'rgba(255, 255, 255, 0.08)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 10,
  },
}

export function enableInitialVerticalPanning(chart: Pick<IChartApi, 'priceScale'>) {
  chart.priceScale('right').applyOptions({ autoScale: false })
}

export default function PriceChart({ symbol, timeframe, tradePlans, onStatusChange, onPriceChange }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const tradeLinesRef = useRef<IPriceLine[]>([])

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
    let socket: WebSocket | undefined
    let disposed = false
    let retryId: number | undefined
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    const displayCandle = (candle: Candle) => {
      series.update(candle as unknown as CandlestickData<Time>)
      onPriceChange(candle.close)
    }

    const connect = async () => {
      onStatusChange('loading')
      try {
        const candles = await getCandles(symbol, timeframe)
        if (disposed) return
        series.setData(candles as unknown as CandlestickData<Time>[])
        enableInitialVerticalPanning(chart)
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
      socket?.close()
    }
  }, [symbol, timeframe, onPriceChange, onStatusChange])

  return <div className="chart-canvas" ref={containerRef} aria-label={`График ${symbol}`} />
}
