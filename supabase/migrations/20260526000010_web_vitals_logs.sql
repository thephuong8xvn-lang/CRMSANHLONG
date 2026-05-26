-- ============================================================
-- CRM SANHLONGVETCO – Web Vitals Logging (Sprint P3)
-- Lưu FCP, LCP, INP, CLS, TTFB từ client để theo dõi performance.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.web_vitals_logs (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT         NOT NULL,                        -- FCP | LCP | INP | CLS | TTFB
  value       NUMERIC(12,4) NOT NULL,
  rating      TEXT,                                         -- good | needs-improvement | poor
  delta       NUMERIC(12,4),
  metric_id   TEXT,                                         -- unique ID từ web-vitals lib
  page_url    TEXT,
  user_id     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  DEFAULT now() NOT NULL
);

ALTER TABLE public.web_vitals_logs ENABLE ROW LEVEL SECURITY;

-- Người dùng đã login có thể ghi metric của chính họ
CREATE POLICY "insert_own_vitals" ON public.web_vitals_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Chỉ admin/super_admin mới đọc được toàn bộ log
CREATE POLICY "read_vitals_admin" ON public.web_vitals_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.code IN ('super_admin', 'admin')
    )
  );

-- Index cho query theo ngày và loại metric
CREATE INDEX IF NOT EXISTS idx_web_vitals_name_created
  ON public.web_vitals_logs (name, created_at DESC);

COMMENT ON TABLE public.web_vitals_logs IS
'Lưu Core Web Vitals (FCP/LCP/INP/CLS/TTFB) từ client. Dùng để monitor Lighthouse score và INP < 200ms.';
