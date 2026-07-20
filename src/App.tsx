import { useCallback, useEffect, useMemo, useState } from 'react'
import PriceChart from './components/PriceChart'
import { createRiskRewardBox } from './components/RiskReward'
import SignalHistory from './components/SignalHistory'
import TrendPanel from './components/TrendPanel'
import { filterMarketList, formatPrice, getCandles, getMarkets, getNextMarketSymbol, sortMarketsByTrend, TIMEFRAMES, type Market, type Timeframe } from './lib/bybit'
import { getSavedSignals, tradePlanFromSavedSignal, type SavedSignal } from './lib/signals'
import { getMarketInfo, type DivergenceInfo, type MarketInfoSignal } from './lib/marketInfo'
import { analyzeTrend, getTrendIndicator, SETUP_META, type ManualChartLevel, type RiskRewardBox, type SetupSignal, type TrendAnalysis, type TrendIndicator } from './lib/trend'

const FALLBACK_MARKETS: Market[] = [
  { symbol: 'BTCUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'ETHUSDT', price: 0, change: 0, turnover: 0 },
  { symbol: 'SOLUSDT', price: 0, change: 0, turnover: 0 },
]

const ANALYSIS_TIMEFRAMES: Timeframe[] = ['4h', '1h', '15m', '5m']
const SCAN_INTERVAL = 5 * 60_000
const SCAN_CONCURRENCY = 3
const SAVED_SIGNAL_REFRESH_INTERVAL = 5_000
type DrawingMode = 'level' | 'risk' | null
type ChartPoint = { price: number, time: number }
type TrendSort = 'none' | 'asc' | 'desc'

function baseAsset(symbol: string) {
  return symbol.replace('USDT', '')
}

function formatTurnover(turnover: number) {
  if (turnover >= 1_000_000_000) return `$${(turnover / 1_000_000_000).toFixed(2)}B`
  if (turnover >= 1_000_000) return `$${(turnover / 1_000_000).toFixed(1)}M`
  return `$${(turnover / 1_000).toFixed(0)}K`
}

export default function App() {
  const [markets, setMarkets] = useState<Market[]>(FALLBACK_MARKETS)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [timeframe, setTimeframe] = useState<Timeframe>('5m')
  const [search, setSearch] = useState('')
  const [setupsOnly, setSetupsOnly] = useState(false)
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading')
  const [currentPrice, setCurrentPrice] = useState(0)
  const [marketsError, setMarketsError] = useState(false)
  const [trendAnalyses, setTrendAnalyses] = useState<TrendAnalysis[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendError, setTrendError] = useState(false)
  const [manualLevelsBySymbol, setManualLevelsBySymbol] = useState<Record<string, ManualChartLevel[]>>({})
  const [riskRewardsBySymbol, setRiskRewardsBySymbol] = useState<Record<string, RiskRewardBox[]>>({})
  const [drawingMode, setDrawingMode] = useState<DrawingMode>(null)
  const [drawingAnchor, setDrawingAnchor] = useState<ChartPoint | null>(null)
  const [marketsReady, setMarketsReady] = useState(false)
  const [marketTrends, setMarketTrends] = useState<Record<string, TrendIndicator>>({})
  const [trendSort, setTrendSort] = useState<TrendSort>('none')
  const [setupScanning, setSetupScanning] = useState(false)
  const [savedOpenSignals, setSavedOpenSignals] = useState<SavedSignal[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [marketInfo, setMarketInfo] = useState<MarketInfoSignal[]>([])
  const [rsiDivergencesBySymbol, setRsiDivergencesBySymbol] = useState<Record<string, Array<DivergenceInfo & { id: string }>>>({})
  const [chartFocusTime, setChartFocusTime] = useState<number | null>(null)

  useEffect(() => {
    void getMarkets()
      .then((items) => {
        setMarkets(items)
        setMarketsReady(true)
      })
      .catch(() => setMarketsError(true))
  }, [])

  useEffect(() => {
    if (!marketsReady || !markets.length) return

    let disposed = false
    const symbols = markets.map((market) => market.symbol)
    const scanSetups = async () => {
      setSetupScanning(true)
      const trends: Record<string, TrendIndicator> = {}
      let nextIndex = 0
      const scanOne = async () => {
        while (nextIndex < symbols.length) {
          const currentSymbol = symbols[nextIndex]
          nextIndex += 1
          try {
            const candles = await Promise.all(ANALYSIS_TIMEFRAMES.map((item) => getCandles(currentSymbol, item, 120)))
            const analyses = candles.map((items, index) => analyzeTrend(items, ANALYSIS_TIMEFRAMES[index]))
            const trend = getTrendIndicator(analyses)
            trends[currentSymbol] = trend
            if (!disposed) setMarketTrends((previous) => ({ ...previous, [currentSymbol]: trend }))
          } catch {
            // A single unavailable market must not interrupt the complete scan.
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, symbols.length) }, () => scanOne()))
      if (!disposed) {
        setMarketTrends(trends)
        setSetupScanning(false)
      }
    }

    void scanSetups()
    const scanId = window.setInterval(() => void scanSetups(), SCAN_INTERVAL)
    return () => {
      disposed = true
      window.clearInterval(scanId)
    }
  }, [markets, marketsReady])

  useEffect(() => {
    let disposed = false
    const loadTrendAnalyses = async () => {
      setTrendLoading(true)
      try {
          const candles = await Promise.all(ANALYSIS_TIMEFRAMES.map((item) => getCandles(symbol, item, 1000)))
        if (!disposed) {
          const analyses = candles.map((items, index) => analyzeTrend(items, ANALYSIS_TIMEFRAMES[index]))
          setTrendAnalyses(analyses)
          setMarketInfo(candles.flatMap((items, index) => {
            const infoTimeframe = ANALYSIS_TIMEFRAMES[index]
            return infoTimeframe === '4h' || infoTimeframe === '1h' || infoTimeframe === '15m' ? getMarketInfo(items, infoTimeframe) : []
          }))
          setTrendError(false)
        }
      } catch {
        if (!disposed) {
          setTrendError(true)
          setMarketInfo([])
        }
      } finally {
        if (!disposed) setTrendLoading(false)
      }
    }

    void loadTrendAnalyses()
    const refreshId = window.setInterval(() => void loadTrendAnalyses(), 30_000)
    return () => {
      disposed = true
      window.clearInterval(refreshId)
    }
  }, [symbol])

  useEffect(() => {
    let disposed = false
    const loadSavedSignals = async () => {
      try {
        const items = await getSavedSignals('open')
        if (!disposed) setSavedOpenSignals(items)
      } catch {
        // The feature remains usable before the first database migration is applied.
      }
    }
    void loadSavedSignals()
    const refreshId = window.setInterval(() => void loadSavedSignals(), SAVED_SIGNAL_REFRESH_INTERVAL)
    return () => {
      disposed = true
      window.clearInterval(refreshId)
    }
  }, [])

  const activeMarketSetups = useMemo(() => {
    const next: Record<string, SetupSignal[]> = {}
    savedOpenSignals.filter((signal) => signal.snapshotUrl).forEach((signal) => {
      const savedSetup: SetupSignal = { side: signal.side, type: signal.setupType }
      const current = next[signal.symbol] ?? []
      if (!current.some((setup) => setup.side === savedSetup.side && setup.type === savedSetup.type)) next[signal.symbol] = [...current, savedSetup]
    })
    return next
  }, [savedOpenSignals])

  const setupSymbols = useMemo(() => new Set(Object.keys(activeMarketSetups)), [activeMarketSetups])
  const trendStrengths = useMemo(
    () => Object.fromEntries(Object.entries(marketTrends).map(([marketSymbol, trend]) => [marketSymbol, trend.strength])),
    [marketTrends],
  )
  const visibleMarkets = useMemo(
    () => {
      const filtered = filterMarketList(markets, search, setupSymbols, setupsOnly)
      return (trendSort === 'none' ? filtered : sortMarketsByTrend(filtered, trendStrengths, trendSort)).slice(0, 80)
    },
    [markets, search, setupSymbols, setupsOnly, trendSort, trendStrengths],
  )

  useEffect(() => {
    const selectNextMarket = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return

      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return

      const nextSymbol = getNextMarketSymbol(visibleMarkets, symbol)
      if (!nextSymbol) return

      event.preventDefault()
      setSymbol(nextSymbol)
    }

    window.addEventListener('keydown', selectNextMarket)
    return () => window.removeEventListener('keydown', selectNextMarket)
  }, [symbol, visibleMarkets])

  useEffect(() => {
    if (!historyOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHistoryOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [historyOpen])

  useEffect(() => {
    setDrawingMode(null)
    setDrawingAnchor(null)
    setChartFocusTime(null)
  }, [symbol])

  const selectedMarket = markets.find((market) => market.symbol === symbol)
  const fixedTradePlans = useMemo(
    () => savedOpenSignals.filter((signal) => signal.symbol === symbol && signal.snapshotUrl).map(tradePlanFromSavedSignal),
    [savedOpenSignals, symbol],
  )
  const change = selectedMarket?.change ?? 0
  const handleStatusChange = useCallback((nextStatus: 'loading' | 'live' | 'offline') => setStatus(nextStatus), [])
  const handlePriceChange = useCallback((price: number) => setCurrentPrice(price), [])
  const addDrawingPoint = useCallback((point: ChartPoint) => {
    if (!drawingMode) return
    if (!drawingAnchor) {
      setDrawingAnchor(point)
      return
    }
    if (drawingMode === 'level') {
      setManualLevelsBySymbol((previous) => ({
        ...previous,
        [symbol]: [...(previous[symbol] ?? []), { ...drawingAnchor, endTime: point.time, endPrice: point.price, id: `${Date.now()}-${Math.random()}` }],
      }))
    } else {
      const box = createRiskRewardBox(`${Date.now()}-${Math.random()}`, drawingAnchor, point)
      if (box) {
        setRiskRewardsBySymbol((previous) => ({
          ...previous,
          [symbol]: [...(previous[symbol] ?? []), box],
        }))
      }
    }
    setDrawingAnchor(null)
    setDrawingMode(null)
  }, [drawingAnchor, drawingMode, symbol])
  const updateRiskReward = useCallback((id: string, target: 'takeProfit' | 'stopLoss', price: number) => {
    setRiskRewardsBySymbol((previous) => ({
      ...previous,
      [symbol]: (previous[symbol] ?? []).map((box) => box.id === id ? { ...box, [target]: price } : box),
    }))
  }, [symbol])
  const clearDrawings = useCallback(() => {
    setManualLevelsBySymbol((previous) => {
      const { [symbol]: _, ...rest } = previous
      return rest
    })
    setRiskRewardsBySymbol((previous) => {
      const { [symbol]: _, ...rest } = previous
      return rest
    })
    setRsiDivergencesBySymbol((previous) => {
      const { [symbol]: _, ...rest } = previous
      return rest
    })
  }, [symbol])
  const showDivergence = useCallback((signal: MarketInfoSignal) => {
    if (!signal.divergence) return

    const { divergence } = signal
    const id = `divergence-${signal.timeframe}-${divergence.first.priceTime}-${divergence.second.priceTime}`
    setManualLevelsBySymbol((previous) => {
      const current = previous[symbol] ?? []
      if (current.some((level) => level.id === id)) return previous
      return {
        ...previous,
        [symbol]: [...current, {
          id,
          time: divergence.first.priceTime,
          price: divergence.first.price,
          endTime: divergence.second.priceTime,
          endPrice: divergence.second.price,
        }],
      }
    })
    setRsiDivergencesBySymbol((previous) => {
      const current = previous[symbol] ?? []
      if (current.some((item) => item.id === id)) return previous
      return { ...previous, [symbol]: [...current, { id, ...divergence }] }
    })
    setTimeframe(signal.timeframe)
    setChartFocusTime(divergence.second.priceTime)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [symbol])
  const manualLevels = manualLevelsBySymbol[symbol] ?? []
  const rsiDivergences = rsiDivergencesBySymbol[symbol] ?? []
  const riskRewards = riskRewardsBySymbol[symbol] ?? []
  const drawingCount = manualLevels.length + riskRewards.length + rsiDivergences.length

  return (
    <main className="terminal-shell">
      <section className="workspace" aria-label="Терминал анализа рынков">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">M</span> MKR <span>ANALYZER</span></div>
          <div className="market-mode"><span className="live-dot" /> PERPETUAL · BYBIT</div>
          <button className="history-trigger" onClick={() => setHistoryOpen(true)}>История <b>{savedOpenSignals.length}</b></button>
          <div className="timeframe-selector" aria-label="Таймфрейм графика">
            {Object.keys(TIMEFRAMES).map((item) => {
              const value = item as Timeframe
              return <button className={timeframe === value ? 'active' : ''} key={value} onClick={() => { setTimeframe(value); setChartFocusTime(null) }}>{value}</button>
            })}
          </div>
        </header>

        <section className="chart-panel">
          <div className="chart-heading">
            <div>
              <div className="eyebrow">{baseAsset(symbol)} / USDT · PERPETUAL</div>
              <div className="price-row">
                <strong>{currentPrice ? formatPrice(currentPrice, selectedMarket?.pricePrecision) : '—'}</strong>
                <span className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
              </div>
            </div>
            <div className="chart-actions">
              <button className={`chart-level-toggle ${drawingMode === 'level' ? 'active' : ''}`} onClick={() => { setDrawingMode((mode) => mode === 'level' ? null : 'level'); setDrawingAnchor(null) }} aria-pressed={drawingMode === 'level'}>
                {drawingMode === 'level' ? (drawingAnchor ? 'Конец уровня' : 'Начало уровня') : 'Уровень'}
              </button>
              <button className={`chart-level-toggle ${drawingMode === 'risk' ? 'active' : ''}`} onClick={() => { setDrawingMode((mode) => mode === 'risk' ? null : 'risk'); setDrawingAnchor(null) }} aria-pressed={drawingMode === 'risk'}>
                {drawingMode === 'risk' ? (drawingAnchor ? 'Цель TP' : 'Вход') : 'TP / SL'}
              </button>
              {drawingCount > 0 && <button className="chart-level-clear" onClick={clearDrawings}>Очистить {drawingCount}</button>}
              <div className={`connection ${status}`}>
                <i /> {status === 'live' ? 'Поток данных' : status === 'loading' ? 'Загрузка' : 'Переподключение'}
              </div>
            </div>
          </div>
          <PriceChart key={symbol} symbol={symbol} timeframe={timeframe} priceTickSize={selectedMarket?.tickSize} pricePrecision={selectedMarket?.pricePrecision} tradePlans={fixedTradePlans} manualLevels={manualLevels} rsiDivergences={rsiDivergences} riskRewards={riskRewards} focusTime={chartFocusTime} drawingMode={drawingMode} drawingAnchor={drawingAnchor} onDrawingPoint={addDrawingPoint} onUpdateRiskReward={updateRiskReward} onStatusChange={handleStatusChange} onPriceChange={handlePriceChange} />
          <footer className="chart-footer">
            <span>Свечи · {timeframe}</span>
            <span>Источник: Bybit public market data</span>
          </footer>
        </section>
        <TrendPanel analyses={trendAnalyses} loading={trendLoading} error={trendError} tradePlans={fixedTradePlans} marketInfo={marketInfo} onShowDivergence={showDivergence} />
      </section>

      <aside className="markets-panel">
        <header className="markets-header">
          <div>
            <div className="eyebrow">РЫНКИ</div>
            <h1>USDT perpetual</h1>
          </div>
          <div className="market-heading-meta">
            <span className={`scan-status ${setupScanning ? 'scanning' : ''}`}>{setupScanning ? 'SCAN' : `${Object.values(activeMarketSetups).reduce((count, setups) => count + setups.length, 0)} SETUP`}</span>
            <span className="market-count">{markets.length}</span>
          </div>
        </header>
        <label className="search-box">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти монету" aria-label="Найти монету" />
        </label>
        <label className="setups-only-filter">
          <input type="checkbox" checked={setupsOnly} onChange={(event) => setSetupsOnly(event.target.checked)} />
          <span>Только сетапы</span>
          <b>{Object.keys(activeMarketSetups).length}</b>
        </label>
        <div className="list-label"><span>ПАРА</span><button className={`trend-sort ${trendSort !== 'none' ? 'active' : ''}`} onClick={() => setTrendSort((current) => current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none')} aria-label="Сортировать по силе тренда">ТРЕНД <i>{trendSort === 'desc' ? '↓' : trendSort === 'asc' ? '↑' : '↕'}</i></button><span>ЦЕНА / 24Ч</span></div>
        <div className="market-list">
          {visibleMarkets.map((market) => (
            <button className={`market-row ${market.symbol === symbol ? 'selected' : ''} ${activeMarketSetups[market.symbol]?.[0] ? `setup-${activeMarketSetups[market.symbol]![0].side}` : ''}`} key={market.symbol} onClick={() => setSymbol(market.symbol)}>
              <span className="coin-icon">{baseAsset(market.symbol).slice(0, 1)}</span>
              <span className="coin-name"><span className="market-symbol"><b>{baseAsset(market.symbol)}</b>{activeMarketSetups[market.symbol]?.map((setup) => <em key={`${setup.type}-${setup.side}`}>{`${SETUP_META[setup.type].shortName} ${setup.side.toUpperCase()}`}</em>)}</span><small>USDT · PERP</small></span>
              <span className={`market-trend ${marketTrends[market.symbol]?.direction ?? 'flat'}`} title="Сила тренда"><i style={{ width: `${marketTrends[market.symbol]?.strength ?? 0}%` }} /></span>
              <span className="market-values"><b>{market.price ? formatPrice(market.price, market.pricePrecision) : '—'}</b><small className={market.change >= 0 ? 'positive' : 'negative'}>{market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%</small></span>
            </button>
          ))}
          {!visibleMarkets.length && <div className="empty-state">{setupsOnly ? 'Открытых сетапов пока нет' : 'Монеты не найдены'}</div>}
        </div>
        <footer className="markets-footer">{marketsError ? 'Не удалось обновить список — показаны популярные пары.' : `Объём 24ч · ${formatTurnover(markets.reduce((sum, market) => sum + market.turnover, 0))}`}</footer>
      </aside>
      {historyOpen && <div className="signal-history-dialog" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
        <div className="signal-history-modal" role="dialog" aria-modal="true" aria-label="История всех сигналов" onMouseDown={(event) => event.stopPropagation()}>
          <SignalHistory openSignals={savedOpenSignals} onClose={() => setHistoryOpen(false)} onSelectSymbol={(nextSymbol) => { setSymbol(nextSymbol); setHistoryOpen(false) }} />
        </div>
      </div>}
    </main>
  )
}
