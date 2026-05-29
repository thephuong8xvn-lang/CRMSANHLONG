-- 1. Bổ sung cột GPS cho bảng chuồng trại (farms)
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7);
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(10,7);

-- 2. Tạo bảng theo dõi vị trí nhân viên kinh doanh
CREATE TABLE IF NOT EXISTS public.employee_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gps_lat NUMERIC(10,7) NOT NULL,
  gps_lng NUMERIC(10,7) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_locations IS 'Bảng ghi nhận lịch sử vị trí GPS của nhân viên đi thị trường';

-- 3. Thiết lập chỉ mục (Indexes) để tối ưu hóa truy vấn lịch sử di chuyển
CREATE INDEX IF NOT EXISTS idx_emp_loc_history 
  ON public.employee_locations(employee_id, recorded_at DESC);

-- 4. Bật bảo mật mức dòng (Row Level Security - RLS)
ALTER TABLE public.employee_locations ENABLE ROW LEVEL SECURITY;

-- Quyền SELECT: Nhân viên đã đăng nhập được phép xem vị trí của đồng nghiệp (phục vụ giám sát và tính khoảng cách)
CREATE POLICY "Allow select for authenticated users" 
  ON public.employee_locations
  FOR SELECT TO authenticated USING (true);

-- Quyền INSERT: Nhân viên chỉ được ghi nhận tọa độ cho chính tài khoản của họ
CREATE POLICY "Allow insert for self" 
  ON public.employee_locations
  FOR INSERT TO authenticated WITH CHECK (employee_id = auth.uid());

-- 5. Cập nhật tọa độ GPS mẫu cho một số khách hàng hiện tại (khu vực Bình Định)
-- Hoài An: Lat ~ 14.3725, Lng ~ 108.9958
-- Phù Mỹ: Lat ~ 14.1950, Lng ~ 109.0717
-- Hoài Nhơn: Lat ~ 14.5126, Lng ~ 109.0142
-- Quy Nhơn: Lat ~ 13.7830, Lng ~ 109.2192

DO $$
DECLARE
  v_cust1_id UUID;
  v_cust2_id UUID;
  v_cust3_id UUID;
  v_farm1_id UUID;
  v_farm2_id UUID;
  v_user_id UUID;
BEGIN
  -- Lấy danh sách ID khách hàng mẫu
  SELECT id INTO v_cust1_id FROM public.customers ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cust2_id FROM public.customers ORDER BY created_at OFFSET 1 LIMIT 1;
  SELECT id INTO v_cust3_id FROM public.customers ORDER BY created_at OFFSET 2 LIMIT 1;

  -- Cập nhật tọa độ GPS mẫu cho khách hàng
  IF v_cust1_id IS NOT NULL THEN
    UPDATE public.customers SET gps_lat = 14.372545, gps_lng = 108.995812 WHERE id = v_cust1_id;
  END IF;
  
  IF v_cust2_id IS NOT NULL THEN
    UPDATE public.customers SET gps_lat = 14.195012, gps_lng = 109.071734 WHERE id = v_cust2_id;
  END IF;

  IF v_cust3_id IS NOT NULL THEN
    UPDATE public.customers SET gps_lat = 14.512687, gps_lng = 109.014234 WHERE id = v_cust3_id;
  END IF;

  -- Lấy danh sách ID chuồng trại mẫu
  SELECT id INTO v_farm1_id FROM public.farms ORDER BY created_at LIMIT 1;
  SELECT id INTO v_farm2_id FROM public.farms ORDER BY created_at OFFSET 1 LIMIT 1;

  -- Cập nhật tọa độ GPS mẫu cho các chuồng trại
  IF v_farm1_id IS NOT NULL THEN
    UPDATE public.farms SET gps_lat = 14.373200, gps_lng = 108.996100 WHERE id = v_farm1_id;
  END IF;

  IF v_farm2_id IS NOT NULL THEN
    UPDATE public.farms SET gps_lat = 14.195500, gps_lng = 109.072200 WHERE id = v_farm2_id;
  END IF;

  -- Lấy một profile id bất kỳ để làm nhân viên mẫu
  SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
  
  IF v_user_id IS NOT NULL THEN
    -- Thêm dữ liệu di chuyển mẫu cho nhân viên này (lộ trình di chuyển tại Bình Định trong ngày hôm nay)
    INSERT INTO public.employee_locations (employee_id, gps_lat, gps_lng, recorded_at) VALUES
      (v_user_id, 14.372500, 108.995800, now() - INTERVAL '4 hours'),
      (v_user_id, 14.390000, 109.001000, now() - INTERVAL '3 hours'),
      (v_user_id, 14.420000, 109.012000, now() - INTERVAL '2 hours'),
      (v_user_id, 14.450000, 109.008000, now() - INTERVAL '1 hour'),
      (v_user_id, 14.512600, 109.014200, now())
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
