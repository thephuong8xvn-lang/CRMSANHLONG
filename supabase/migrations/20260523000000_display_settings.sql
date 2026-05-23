-- Create table for global display configurations
CREATE TABLE public.display_settings (
  id                          TEXT        PRIMARY KEY DEFAULT 'global',
  
  -- 1. Numeric & Currency
  currency_symbol             TEXT        NOT NULL DEFAULT 'VND',
  currency_position           TEXT        NOT NULL DEFAULT 'after', -- 'before' ($100) or 'after' (100 đ)
  thousands_separator         TEXT        NOT NULL DEFAULT '.',
  decimal_separator           TEXT        NOT NULL DEFAULT ',',
  decimal_places_currency     INTEGER     NOT NULL DEFAULT 0,
  decimal_places_quantity     INTEGER     NOT NULL DEFAULT 2,
  decimal_places_percent      INTEGER     NOT NULL DEFAULT 1,
  enable_compact_numbers      BOOLEAN     NOT NULL DEFAULT FALSE,
  
  -- 2. Date, Time & Cycle
  date_format                 TEXT        NOT NULL DEFAULT 'DD/MM/YYYY',
  time_format                 TEXT        NOT NULL DEFAULT '24h', -- '24h' (HH:mm) or '12h' (hh:mm A)
  datetime_format             TEXT        NOT NULL DEFAULT 'DD/MM/YYYY HH:mm:ss',
  first_day_of_week           TEXT        NOT NULL DEFAULT 'monday', -- 'monday' or 'sunday'
  cycle_time_unit             TEXT        NOT NULL DEFAULT 'day', -- 'day', 'week', 'month', 'year'
  
  -- 3. Text & ID Style
  phone_format                TEXT        NOT NULL DEFAULT 'space', -- 'space' (09xx xxx xxx) or 'plus_prefix' (+84 9xx xxx xxx)
  id_prefix_opportunity       TEXT        NOT NULL DEFAULT 'OPO-',
  id_prefix_invoice           TEXT        NOT NULL DEFAULT 'HD-',
  id_prefix_customer          TEXT        NOT NULL DEFAULT 'KH-',
  id_prefix_lot               TEXT        NOT NULL DEFAULT 'LOT-',
  text_truncation_limit       INTEGER     NOT NULL DEFAULT 50,
  empty_state_format          TEXT        NOT NULL DEFAULT '-',
  
  -- 4. UI Components & Input Types
  default_layout_view         TEXT        NOT NULL DEFAULT 'table', -- 'table', 'card', 'grid', 'list'
  field_visibility_config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  field_input_controls        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  input_masking_config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  
  -- 5. Visual & Analytics
  status_badges_config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  icons_map_config            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  trend_indicator_config      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  default_chart_type          TEXT        NOT NULL DEFAULT 'bar', -- 'bar', 'line', 'pie', 'funnel'
  gauge_thresholds            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  
  -- 6. Localization & Units
  system_language             TEXT        NOT NULL DEFAULT 'vi-VN',
  system_timezone             TEXT        NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  address_structure_format    TEXT        NOT NULL DEFAULT 'detail_ward_district_province',
  default_units_weight        TEXT        NOT NULL DEFAULT 'kg',
  default_units_volume        TEXT        NOT NULL DEFAULT 'lit',
  default_units_area          TEXT        NOT NULL DEFAULT 'm2',
  default_units_count         TEXT        NOT NULL DEFAULT 'con',
  
  -- 7. Security Display
  enable_partial_masking      BOOLEAN     NOT NULL DEFAULT FALSE,
  field_level_security_rules  JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT check_id_is_global CHECK (id = 'global')
);

-- RLS policies
ALTER TABLE public.display_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read display settings for authenticated users" 
  ON public.display_settings 
  FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Allow update display settings for admin users only" 
  ON public.display_settings 
  FOR UPDATE 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid() AND r.code = 'admin'
    )
  );

-- Insert default row
INSERT INTO public.display_settings (id) 
VALUES ('global')
ON CONFLICT (id) DO NOTHING;
