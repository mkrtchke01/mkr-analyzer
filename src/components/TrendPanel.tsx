import { marketInfoText, type MarketInfoSignal } from '../lib/marketInfo'
import { getOverallTrend, type OverallTrend, type TradePlan, type TrendAnalysis, type TrendDirection } from '../lib/trend'
import { formatPrice } from '../lib/bybit'
import { calculatePositionSizing } from '../lib/positionSizing'

type TrendPanelProps = {
  analyses: TrendAnalysis[]
  loading: boolean
  error: boolean
  marketInfo: MarketInfoSignal[]
  onShowMarketInfo: (signal: MarketInfoSignal) => void
}

type TradePlansProps = {
  tradePlans: TradePlan[]
  availableBalance: number
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
  'strong-long': 'LONG / КОНТЕКСТ',
  'strong-short': 'SHORT / КОНТЕКСТ',
  flat: 'ФЛЕТ / НЕТ СЕТАПА',
}

function formatQuantity(value: number) {
  if (value >= 1) return value.toFixed(3)
  if (value >= 0.01) return value.toFixed(4)
  return value.toFixed(6)
}

export function TradePlans({ tradePlans, availableBalance }: TradePlansProps) {
  if (!tradePlans.length) return null

  return <section className="trade-plans" aria-label="План сделки">
    {tradePlans.map((tradePlan) => {
      const sizing = tradePlan.stop.price ? calculatePositionSizing(tradePlan.stop.entry, tradePlan.stop.price, availableBalance) : undefined
      return <div className={`trade-plan ${tradePlan.stop.side}`} key={tradePlan.setupType}>
        {tradePlan.stop.price ? <>
          <b className="setup-plan-name">{tradePlan.setupName} · {tradePlan.stop.side.toUpperCase()}</b>
          <span>ENTRY {formatPrice(tradePlan.stop.entry)}</span>
          <strong>STOP {formatPrice(tradePlan.stop.price)} · {tradePlan.stop.distancePercent!.toFixed(2)}%</strong>
          {tradePlan.takeProfits.map((target) => <span key={target.id}>{target.id} {formatPrice(target.price)} · {target.riskMultiple}R · {target.share}%</span>)}
          {sizing && <span className="position-sizing">РИСК ${sizing.riskAmount.toFixed(2)} · ОРДЕР ${sizing.notional.toFixed(2)} · {sizing.leverage}× · МАРЖА ${sizing.margin.toFixed(2)} · QTY {formatQuantity(sizing.quantity)}</span>}
          <span className="pullback">{tradePlan.setupNote}</span>
        </> : <span>{tradePlan.stop.reason}</span>}
      </div>
    })}
  </section>
}

export default function TrendPanel({ analyses, loading, error, marketInfo, onShowMarketInfo }: TrendPanelProps) {
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
          <small>{overall === 'flat' ? '1h не подтвердил направление или есть сильный контртренд' : '4h не против, 1h подтверждает; 15m и 5m без сильного контртренда'}</small>
        </footer>
        <section className="market-info" aria-label="Info">
          <div className="eyebrow">INFO</div>
          {marketInfo.length
            ? <ul>{marketInfo.map((signal) => <li className={signal.side} key={`${signal.type}-${signal.timeframe}`}><span>{marketInfoText(signal)}</span>{(signal.divergence || signal.level || signal.correction) && <button onClick={() => onShowMarketInfo(signal)}>Показать</button>}</li>)}</ul>
            : <p>Особых рыночных событий на 15m, 1h и 4h не обнаружено</p>}
        </section>
      </>}
    </section>
  )
}
