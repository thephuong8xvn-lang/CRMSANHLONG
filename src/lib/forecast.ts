// ============================================================
// Engine dự báo nhu cầu — thống kê chuỗi thời gian (thuần, có unit test)
//
// Hai phương pháp, chọn tự động theo dạng cầu (Syntetos–Boylan):
//   • Exponential Smoothing (SES) — cầu ĐỀU/biến động (smooth/erratic).
//   • Croston (hiệu chỉnh SBA)     — cầu RỜI RẠC/dồn cục (intermittent/lumpy),
//                                    đúng cho thuốc thú y bán theo đợt.
//
// Triết lý: KHÔNG bịa độ tự tin. Output được "gate" theo lượng lịch sử —
// ít tuần → nhãn độ tin cậy THẤP (thực chất ≈ run-rate); tự chính xác dần
// khi dữ liệu tích lũy. Backtest MAPE chỉ tính khi đủ dữ liệu.
// ============================================================

export interface ForecastConfig {
  alpha: number             // hệ số làm mượt (0..1)
  horizonWeeks: number      // số tuần dự báo
  confLowWeeks: number      // < ngưỡng → độ tin cậy THẤP
  confHighWeeks: number     // >= ngưỡng (đủ điều kiện) → CAO
  confMinDemandWeeks: number // số tuần CÓ cầu tối thiểu để vượt mức THẤP
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  alpha: 0.3,
  horizonWeeks: 4,
  confLowWeeks: 8,
  confHighWeeks: 16,
  confMinDemandWeeks: 3,
}

export type DemandPattern = 'smooth' | 'erratic' | 'intermittent' | 'lumpy' | 'none'
export type ForecastMethod = 'ses' | 'croston' | 'none'
export type Confidence = 'low' | 'medium' | 'high'

export interface ForecastResult {
  method: ForecastMethod
  pattern: DemandPattern
  weeklyForecast: number   // cầu dự báo / tuần
  horizonTotal: number     // × horizon
  lower: number            // dải dưới (>= 0)
  upper: number            // dải trên
  confidence: Confidence
  historyWeeks: number
  demandWeeks: number      // số tuần có cầu > 0
  adi: number | null       // average inter-demand interval
  cv2: number | null       // bình phương hệ số biến thiên cầu (lần bán)
  mape: number | null      // % — null nếu chưa đủ dữ liệu backtest
  avgWeekly: number        // TB cộng đơn giản (đối chiếu)
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length

// Độ lệch chuẩn mẫu (sample, mẫu số n-1).
const stddevSample = (xs: number[]): number => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/** Phân loại dạng cầu theo ADI + CV² (Syntetos–Boylan, ngưỡng 1.32 / 0.49). */
export function classifyDemand(values: number[]): {
  pattern: DemandPattern
  adi: number | null
  cv2: number | null
  demandWeeks: number
} {
  const nz = values.filter((v) => v > 0)
  const demandWeeks = nz.length
  if (demandWeeks === 0) return { pattern: 'none', adi: null, cv2: null, demandWeeks: 0 }

  const adi = values.length / demandWeeks
  const m = mean(nz)
  const sd = stddevSample(nz)
  const cv2 = demandWeeks > 1 && m > 0 ? (sd / m) ** 2 : 0

  let pattern: DemandPattern
  if (adi < 1.32 && cv2 < 0.49) pattern = 'smooth'
  else if (adi >= 1.32 && cv2 < 0.49) pattern = 'intermittent'
  else if (adi < 1.32 && cv2 >= 0.49) pattern = 'erratic'
  else pattern = 'lumpy'

  return { pattern, adi, cv2, demandWeeks }
}

/** Single Exponential Smoothing — trả mức (dự báo 1 bước tới). */
export function ses(values: number[], alpha: number): number {
  if (values.length === 0) return 0
  let level = values[0]
  for (let i = 1; i < values.length; i++) {
    level = alpha * values[i] + (1 - alpha) * level
  }
  return level
}

/**
 * Croston hiệu chỉnh SBA — dự báo cầu TRUNG BÌNH mỗi kỳ cho cầu rời rạc.
 * Khởi tạo cỡ cầu = TB lần bán, khoảng cách = ADI (tránh chệch của khởi tạo
 * interval=1 cổ điển khi dữ liệu thưa), interval chỉ cập nhật từ lần bán thứ 2.
 */
export function crostonSBA(values: number[], alpha: number): number {
  const nz = values.filter((v) => v > 0)
  if (nz.length === 0) return 0

  let z = mean(nz)                    // mức cỡ cầu (demand size)
  let x = values.length / nz.length   // mức khoảng cách giữa các lần bán (≈ ADI)
  let q = 0                           // số kỳ kể từ lần bán gần nhất
  let seen = 0

  for (const v of values) {
    q++
    if (v > 0) {
      seen++
      z = alpha * v + (1 - alpha) * z
      if (seen >= 2) x = alpha * q + (1 - alpha) * x // chỉ cập nhật khi có khoảng cách thực
      q = 0
    }
  }
  if (x === 0) return 0
  return (1 - alpha / 2) * (z / x) // hiệu chỉnh SBA (giảm chệch của Croston gốc)
}

/**
 * Backtest 1-bước (rolling) cho phương pháp SES — chỉ chạy khi đủ dữ liệu.
 * Trả MAPE (%) trên các kỳ THỰC có cầu > 0, hoặc null nếu chưa đủ.
 */
function backtestMape(values: number[], alpha: number, minHistory: number): number | null {
  if (values.length < minHistory) return null
  const start = Math.max(2, Math.ceil(values.length / 2)) // dự đoán nửa sau
  let sumPct = 0
  let count = 0
  for (let t = start; t < values.length; t++) {
    const actual = values[t]
    if (actual <= 0) continue // MAPE không xác định khi cầu = 0
    const pred = ses(values.slice(0, t), alpha)
    sumPct += Math.abs(actual - pred) / actual
    count++
  }
  if (count < 3) return null
  return (sumPct / count) * 100
}

/** Mức độ tin cậy theo lượng lịch sử + số tuần có cầu. */
export function confidenceOf(
  historyWeeks: number,
  demandWeeks: number,
  cfg: ForecastConfig
): Confidence {
  if (historyWeeks < cfg.confLowWeeks || demandWeeks < cfg.confMinDemandWeeks) return 'low'
  if (historyWeeks < cfg.confHighWeeks) return 'medium'
  return 'high'
}

/**
 * Dự báo nhu cầu cho 1 chuỗi cầu theo tuần (TĂNG DẦN theo thời gian).
 * Tự chọn SES/Croston theo dạng cầu, gate độ tin cậy theo lịch sử.
 */
export function forecast(
  values: number[],
  cfg: ForecastConfig = DEFAULT_FORECAST_CONFIG
): ForecastResult {
  // Cắt các tuần ZERO DẪN ĐẦU (trước lần bán đầu tiên): chúng là "chưa có dữ
  // liệu / SKU chưa bán" chứ không phải cầu = 0. Nếu giữ, (1) SES bị kéo về 0,
  // (2) độ tin cậy bị thổi phồng vì cửa sổ luôn dài. Lịch sử "thực quan sát
  // được" = từ lần bán đầu đến hết → phản ánh trung thực dữ liệu còn mỏng.
  const firstNz = values.findIndex((v) => v > 0)
  const series = firstNz < 0 ? [] : values.slice(firstNz)

  const historyWeeks = series.length
  const { pattern, adi, cv2, demandWeeks } = classifyDemand(series)
  const avgWeekly = mean(series)

  if (pattern === 'none' || historyWeeks === 0) {
    return {
      method: 'none', pattern: 'none',
      weeklyForecast: 0, horizonTotal: 0, lower: 0, upper: 0,
      confidence: 'low', historyWeeks, demandWeeks: 0,
      adi: null, cv2: null, mape: null, avgWeekly: 0,
    }
  }

  const useCroston = pattern === 'intermittent' || pattern === 'lumpy'
  const method: ForecastMethod = useCroston ? 'croston' : 'ses'
  const weeklyRaw = useCroston ? crostonSBA(series, cfg.alpha) : ses(series, cfg.alpha)
  const weeklyForecast = Math.max(0, weeklyRaw)
  const horizonTotal = weeklyForecast * cfg.horizonWeeks

  // Dải bất định: σ cầu tuần × √horizon (xấp xỉ sai số tích lũy).
  const sd = stddevSample(series)
  const sigmaH = sd * Math.sqrt(cfg.horizonWeeks)
  const lower = Math.max(0, horizonTotal - sigmaH)
  const upper = horizonTotal + sigmaH

  // MAPE chỉ tính cho cầu đều (SES) khi đủ lịch sử — tránh số liệu giả.
  const mape = method === 'ses'
    ? backtestMape(series, cfg.alpha, cfg.confLowWeeks)
    : null

  return {
    method, pattern,
    weeklyForecast, horizonTotal, lower, upper,
    confidence: confidenceOf(historyWeeks, demandWeeks, cfg),
    historyWeeks, demandWeeks, adi, cv2, mape, avgWeekly,
  }
}
