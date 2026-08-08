-- ═══════════════════════════════════════════════════════════════════════════
-- TỔNG QUAN BÀI VIẾT — một lượt gọi cho cả danh sách
-- 2026-08-08 · đi kèm `20260791` + `20260792`
--
-- Màn danh sách cần cho mỗi bài: số ảnh, đã gửi cho bao nhiêu nhóm, gửi lần
-- cuối lúc nào. Đếm ở phía giao diện thì phải bắn một lượt gọi cho mỗi bài, mà
-- `notification_log` lại khoá RLS ở mức quản trị hệ thống nên còn dễ trả rỗng
-- một cách khó hiểu. Gom vào một hàm SECURITY DEFINER là gọn và đúng nhất.
--
-- 🔑 "Đã gửi" đếm theo `subject_key` chứ không theo `event_ids`, vì khoá này
--    mang sẵn mã bài: `post:<post_id>_<customer_id>_<dấu thời gian>`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_posts_overview()
RETURNS TABLE(
  id           UUID,
  title        TEXT,
  body         TEXT,
  kind         TEXT,
  link_url     TEXT,
  is_active    BOOLEAN,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  so_anh       INTEGER,
  so_anh_cache INTEGER,
  so_da_gui    INTEGER,
  gui_lan_cuoi TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id, p.title, p.body, p.kind, p.link_url, p.is_active,
         p.created_at, p.updated_at,
         COALESCE(a.n, 0)::int      AS so_anh,
         COALESCE(a.n_cache, 0)::int AS so_anh_cache,
         COALESCE(g.n, 0)::int      AS so_da_gui,
         g.lan_cuoi                  AS gui_lan_cuoi
  FROM public.posts p
  LEFT JOIN LATERAL (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE NULLIF(btrim(COALESCE(tg_file_id,'')),'') IS NOT NULL) AS n_cache
    FROM public.post_images WHERE post_id = p.id
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT l.customer_id) AS n, max(l.created_at) AS lan_cuoi
    FROM public.notification_log l
    WHERE l.event_type = 'post.broadcast'
      AND l.status <> 'skipped'
      AND l.subject_key LIKE 'post:' || p.id || '_%'
  ) g ON true
  WHERE public.fn_is_active()
  ORDER BY p.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.fn_posts_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_posts_overview() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
