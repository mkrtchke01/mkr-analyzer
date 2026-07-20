import { marketInfoText, type MarketInfoSignal } from '../lib/marketInfo'
import { getOverallTrend, type OverallTrend, type TradePlan, type TrendAnalysis, type TrendDirection } from '../lib/trend'
import { formatPrice } from '../lib/bybit'

type TrendPanelProps = {
  analyses: TrendAnalysis[]
  loading: boolean
  error: boolean
  tradePlans: TradePlan[]
  marketInfo: MarketInfoSignal[]
}

const timeframeRole: Record<TrendAnalysis['timeframe'], string> = {
  '4h': 'Глобальный',
  '1h': 'Подтверждение',
  '15m': 'Локальный',
  '5m': 'Вход',
  '1d': 'Долгосрочный',
}

const directionText: Record<TrendDirection, string> = {
  bullish: 'LONG',
  bearish: 'SHORT',
  flat: 'ФЛЕТ',
}

const overallText: Record<OverallTrend, string> = {
  'strong-long': 'СИЛЬНЫЙ LONG',
  'strong-short': 'СИЛЬНЫЙ SHORT',
  flat: 'ФЛЕТ / НЕТ СЕТАПА',
}

export default function TrendPanel({ analyses, loading, error, tradePlans, marketInfo }: TrendPanelProps) {
  const overall = getOverallTrend(analyses)

  return (
    <section className="trend-panel" aria-label="Анализ тренда">
      <header className="trend-heading">
        <div>
          <div className="eyebrow">MULTI-TIMEFRAME</div>
          <h2>Анализ тренда</h2>
        </div>
        <span className={`trend-status ${loading ? 'loading' : ''}`}>{loading ? 'Обновление…' : 'EMA · ADX · ATR · Объём'}</span>
      </header>

      {error ? <div className="trend-error">Не удалось обновить анализ тренда</div> : <>
        <div className="trend-cards">
          {analyses.map((analysis) => (
            <article className={`trend-card ${analysis.direction}`} key={analysis.timeframe}>
              <div className="trend-card-title"><b>{analysis.timeframe}</b><span>{timeframeRole[analysis.timeframe]}</span></div>
              <strong>{directionText[analysis.direction]}</strong>
              <div className="strength-line"><span style={{ width: `${analysis.strength}%` }} /></div>
              <small>Сила {analysis.strength}/100 · ADX {analysis.adx.toFixed(0)}</small>
            </article>
          ))}
          {loading && !analyses.length && <div className="trend-loading">Загружаем 4h, 1h, 15m и 5m…</div>}
        </div>
        <footer className={`overall-trend ${overall}`}>
          <span>ИТОГ</span>
          <strong>{overallText[overall]}</strong>
          <small>{overall === 'flat' ? 'Временные интервалы не подтверждают единый сильный тренд' : 'Все таймфреймы подтверждают направление'}</small>
        </footer>
        <section className="market-info" aria-label="Info">
          <div className="eyebrow">INFO</div>
          {marketInfo.length
            ? <ul>{marketInfo.map((signal) => <li className={signal.side} key={`${signal.type}-${signal.timeframe}`}>{marketInfoText(signal)}</li>)}</ul>
            : <p>Особых рыночных событий на 15m, 1h и 4h не обнаружено</p>}
        </section>
        {tradePlans.map((tradePlan) => <div className={`trade-plan ${tradePlan.stop.side}`} key={tradePlan.setupType}>
          {tradePlan.stop.price ? <>
            <b className="setup-plan-name">{tradePlan.setupName} · {tradePlan.stop.side.toUpperCase()}</b>
            <span>ENTRY {formatPrice(tradePlan.stop.entry)}</span>
            <strong>STOP {formatPrice(tradePlan.stop.price)} · {tradePlan.stop.distancePercent!.toFixed(2)}%</strong>
            {tradePlan.takeProfits.map((target) => <span key={target.id}>{target.id} {formatPrice(target.price)} · {target.riskMultiple}R · {target.share}%</span>)}
            <span className="pullback">{tradePlan.setupNote}</span>
          </> : <span>{tradePlan.stop.reason}</span>}
        </div>)}
      </>}
    </section>
  )
}
