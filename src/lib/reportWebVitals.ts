import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { supabase } from './supabase'

async function sendToSupabase(metric: Metric) {
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('web_vitals_logs').insert({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    metric_id: metric.id,
    page_url: window.location.pathname,
    user_id: user?.id ?? null,
  })
}

export function reportWebVitals() {
  onCLS(sendToSupabase)
  onFCP(sendToSupabase)
  onINP(sendToSupabase)
  onLCP(sendToSupabase)
  onTTFB(sendToSupabase)
}
