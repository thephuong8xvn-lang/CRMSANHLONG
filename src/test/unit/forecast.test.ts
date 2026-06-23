import { describe, it, expect } from 'vitest'
import {
  classifyDemand,
  ses,
  crostonSBA,
  confidenceOf,
  forecast,
  DEFAULT_FORECAST_CONFIG,
  type ForecastConfig,
} from '../../lib/forecast'

const cfg: ForecastConfig = { ...DEFAULT_FORECAST_CONFIG }

describe('classifyDemand', () => {
  it('chuỗi rỗng cầu → none', () => {
    const r = classifyDemand([0, 0, 0, 0])
    expect(r.pattern).toBe('none')
    expect(r.demandWeeks).toBe(0)
    expect(r.adi).toBeNull()
  })

  it('cầu đều, ổn định → smooth (ADI~1, CV² thấp)', () => {
    const r = classifyDemand([10, 11, 9, 10, 10, 11])
    expect(r.pattern).toBe('smooth')
    expect(r.adi).toBeCloseTo(1, 5)
    expect(r.demandWeeks).toBe(6)
  })

  it('bán cách quãng, cỡ đều → intermittent (ADI cao, CV² thấp)', () => {
    // 8 tuần, bán tuần 0/4 với cỡ giống nhau → ADI=4, CV²≈0
    const r = classifyDemand([10, 0, 0, 0, 10, 0, 0, 0])
    expect(r.adi).toBeCloseTo(4, 5)
    expect(r.pattern).toBe('intermittent')
  })

  it('bán dồn cục, cỡ chênh lệch lớn → lumpy', () => {
    const r = classifyDemand([0, 0, 50, 0, 0, 0, 5, 0])
    expect(r.adi).toBeGreaterThanOrEqual(1.32)
    expect(r.cv2!).toBeGreaterThanOrEqual(0.49)
    expect(r.pattern).toBe('lumpy')
  })
})

describe('ses', () => {
  it('chuỗi rỗng → 0', () => {
    expect(ses([], 0.3)).toBe(0)
  })

  it('giá trị không đổi → hội tụ về chính nó', () => {
    expect(ses([5, 5, 5, 5, 5], 0.3)).toBeCloseTo(5, 6)
  })

  it('nằm giữa giá trị đầu và cuối khi tăng dần', () => {
    const v = ses([0, 10], 0.5) // 0.5*10 + 0.5*0 = 5
    expect(v).toBeCloseTo(5, 6)
  })

  it('alpha cao bám giá trị gần đây hơn', () => {
    const high = ses([0, 0, 10], 0.9)
    const low = ses([0, 0, 10], 0.1)
    expect(high).toBeGreaterThan(low)
  })
})

describe('crostonSBA', () => {
  it('không có cầu → 0', () => {
    expect(crostonSBA([0, 0, 0], 0.3)).toBe(0)
  })

  it('cầu cách đều: ≈ cỡ/khoảng cách × hiệu chỉnh SBA', () => {
    // cỡ 10 mỗi 4 tuần → ~10/4=2.5, ×(1-0.15)=2.125
    const v = crostonSBA([10, 0, 0, 0, 10, 0, 0, 0], 0.3)
    expect(v).toBeGreaterThan(1.5)
    expect(v).toBeLessThan(2.5)
  })

  it('bán dày hơn → dự báo/tuần cao hơn', () => {
    const dense = crostonSBA([10, 0, 10, 0, 10, 0], 0.3)
    const sparse = crostonSBA([10, 0, 0, 0, 0, 10], 0.3)
    expect(dense).toBeGreaterThan(sparse)
  })
})

describe('confidenceOf', () => {
  it('ít tuần → thấp', () => {
    expect(confidenceOf(4, 3, cfg)).toBe('low')
  })
  it('ít tuần có cầu → thấp dù dài lịch sử', () => {
    expect(confidenceOf(20, 2, cfg)).toBe('low')
  })
  it('đủ trung bình', () => {
    expect(confidenceOf(10, 5, cfg)).toBe('medium')
  })
  it('đủ dài → cao', () => {
    expect(confidenceOf(20, 10, cfg)).toBe('high')
  })
})

describe('forecast', () => {
  it('cầu rỗng → method none, tin cậy thấp', () => {
    const r = forecast([0, 0, 0, 0], cfg)
    expect(r.method).toBe('none')
    expect(r.weeklyForecast).toBe(0)
    expect(r.confidence).toBe('low')
  })

  it('lịch sử ngắn (4 tuần) → tin cậy THẤP dù có cầu (gate trung thực)', () => {
    const r = forecast([5, 6, 4, 5], cfg)
    expect(r.confidence).toBe('low')
    expect(r.weeklyForecast).toBeGreaterThan(0)
    expect(r.mape).toBeNull() // chưa đủ để backtest
  })

  it('cầu đều dài → method ses, horizonTotal = weekly × horizon', () => {
    const series = Array.from({ length: 20 }, () => 10)
    const r = forecast(series, cfg)
    expect(r.method).toBe('ses')
    expect(r.confidence).toBe('high')
    expect(r.weeklyForecast).toBeCloseTo(10, 4)
    expect(r.horizonTotal).toBeCloseTo(10 * cfg.horizonWeeks, 4)
  })

  it('cầu rời rạc dài → method croston', () => {
    const series = Array.from({ length: 20 }, (_, i) => (i % 4 === 0 ? 12 : 0))
    const r = forecast(series, cfg)
    expect(r.method).toBe('croston')
    expect(r.weeklyForecast).toBeGreaterThan(0)
  })

  it('dải bất định bao quanh dự báo và không âm', () => {
    const r = forecast([5, 8, 3, 9, 6, 7, 4, 8], cfg)
    expect(r.lower).toBeGreaterThanOrEqual(0)
    expect(r.lower).toBeLessThanOrEqual(r.horizonTotal)
    expect(r.upper).toBeGreaterThanOrEqual(r.horizonTotal)
  })

  it('dự báo không bao giờ âm', () => {
    const r = forecast([0, 0, 1, 0, 0, 2, 0, 0, 0, 0], cfg)
    expect(r.weeklyForecast).toBeGreaterThanOrEqual(0)
  })

  it('cắt zero dẫn đầu: SKU mới bán gần đây trong cửa sổ dài → tin cậy THẤP', () => {
    // 26 tuần nhưng chỉ bán 3 tuần gần nhất (SKU mới) → lịch sử thực = 3 tuần.
    const series = [...Array(23).fill(0), 8, 7, 9]
    const r = forecast(series, cfg)
    expect(r.historyWeeks).toBe(3)        // đếm theo span thực, không phải 26
    expect(r.confidence).toBe('low')      // không bị thổi phồng
    expect(r.weeklyForecast).toBeGreaterThan(5) // SES không bị 22 zero kéo về 0
  })

  it('cắt zero dẫn đầu không làm SES tụt về ~0', () => {
    const padded = forecast([...Array(20).fill(0), 10, 10, 10, 10], cfg)
    expect(padded.weeklyForecast).toBeGreaterThan(8)
  })
})
