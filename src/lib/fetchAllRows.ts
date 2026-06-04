/**
 * fetchAllRows — nạp ĐỦ một danh sách lớn từ PostgREST, vượt qua giới hạn
 * mặc định 1000 dòng bằng cách lặp `.range()` theo lô.
 *
 * PostgREST cắt kết quả ở 1000 dòng/response. Mọi nơi preload toàn bộ danh
 * sách client-side để lọc/search trong RAM (Sản phẩm, Khách hàng, ...) đều
 * mất các bản ghi thứ 1001+ nếu không phân trang. Helper này nạp từng lô
 * (mặc định 1000) cho tới khi hết dữ liệu.
 *
 * ⚠️ Query truyền vào BẮT BUỘC có `.order()` ổn định kèm tie-break (vd
 * `.order('name').order('id')`) — nếu không, các lô `.range()` có thể trùng
 * hoặc sót dòng. Mọi query vẫn chạy dưới RLS hiện hành (không nới quyền).
 *
 * @example
 *   const products = await fetchAllRows<Product>((from, to) =>
 *     supabase.from('products').select('id, name, sku')
 *       .eq('is_active', true)
 *       .order('name', { ascending: true }).order('id')
 *       .range(from, to)
 *   )
 */
export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  batch = 1000,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  // Giới hạn vòng lặp an toàn (tối đa 100k dòng) để tránh lặp vô hạn nếu lỗi.
  for (let guard = 0; guard < 100; guard++) {
    const { data, error } = await makeQuery(from, from + batch - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as T[]))
    if (data.length < batch) break
    from += batch
  }
  return all
}
