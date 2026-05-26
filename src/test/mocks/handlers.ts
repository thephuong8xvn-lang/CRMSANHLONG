import { http, HttpResponse } from 'msw'

const SUPABASE_URL = 'https://mock.supabase.co'

export const handlers = [
  http.get(`${SUPABASE_URL}/rest/v1/customers`, () =>
    HttpResponse.json({ data: [], count: 0 })
  ),
  http.get(`${SUPABASE_URL}/rest/v1/products`, () =>
    HttpResponse.json({ data: [], count: 0 })
  ),
  http.get(`${SUPABASE_URL}/rest/v1/web_vitals_logs`, () =>
    HttpResponse.json([])
  ),
  http.post(`${SUPABASE_URL}/rest/v1/web_vitals_logs`, () =>
    HttpResponse.json({}, { status: 201 })
  ),
]
