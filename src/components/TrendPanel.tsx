import { useState } from 'react'
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

export function clipboardPriceValue(price: number) {
  return formatPrice(price).replaceAll(',', '')
}

async function copyPrice(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()

  if (!copied) throw new Error('Clipboard is unavailable')
}

export function TradePlans({ tradePlans, availableBalance }: TradePlansProps) {
  const [copiedPrice, setCopiedPrice] = useState<string | null>(null)

  if (!tradePlans.length) return null

  const handleCopy = (id: string, price: number) => {
    const value = clipboardPriceValue(price)
    const copiedId = `${id}-${value}`

    void copyPrice(value)
      .then(() => {
        setCopiedPrice(copiedId)
        window.setTimeout(() => setCopiedPrice((current) => current === copiedId ? null : current), 1600)
      })
      .catch(() => setCopiedPrice(null))
  }

  const priceCell = (id: string, label: string, price: number, detail: string, tone: 'entry' | 'stop' | 'target') => {
    const value = formatPrice(price)
    const copiedId = `${id}-${clipboardPriceValue(price)}`
    const isCopied = copiedPrice === copiedId

    return <div className={`trade-price-cell ${tone}`} key={id}>
      <span>{label}</span>
      <button type="button" onClick={() => handleCopy(id, price)} title="Скопировать цену">
        {isCopied ? 'СКОПИРОВАНО' : value}
      </button>
      <small>{detail}</small>
    </div>
  }

  return <section className="trade-plans" aria-label="План сделки">
    {tradePlans.map((tradePlan) => {
      const sizing = tradePlan.stop.price ? calculatePositionSizing(tradePlan.stop.entry, tradePlan.stop.price, availableBalance) : undefined
      return <div className={`trade-plan ${tradePlan.stop.side}`} key={tradePlan.setupType}>
        {tradePlan.stop.price ? <>
          <header className="trade-plan-header">
            <b className="setup-plan-name">{tradePlan.setupName}</b>
            <strong>{tradePlan.stop.side.toUpperCase()}</strong>
            <small>Нажмите на цену, чтобы скопировать</small>
          </header>
          <div className="trade-price-grid">
            {priceCell(`${tradePlan.setupType}-entry`, 'ВХОД', tradePlan.stop.entry, 'Цена входа', 'entry')}
            {priceCell(`${tradePlan.setupType}-stop`, 'СТОП', tradePlan.stop.price, `${tradePlan.stop.distancePercent!.toFixed(2)}% риска`, 'stop')}
            {tradePlan.takeProfits.map((target) => priceCell(`${tradePlan.setupType}-${target.id}`, target.id, target.price, `${target.riskMultiple}R · ${target.share}% позиции`, 'target'))}
          </div>
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
