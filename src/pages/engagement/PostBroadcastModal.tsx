import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Post, PostPreview, Recipient } from './postTypes'

/**
 * Gửi bài viết vào nhóm Telegram của khách.
 *
 * Ba bước cố ý theo đúng thứ tự: xem trước (ai nhận, nội dung ra sao) → gửi thử
 * vào nhóm nội bộ → gửi thật. Không có nút nào gửi thẳng cho khách mà chưa qua
 * bản xem trước.
 *
 * ⛔ KHÔNG có trần tần suất. User chốt 08/08/2026: "1 ngày có thể gởi nhiều tin
 * vào nhóm, điều này là không thể tránh khỏi". Thứ duy nhất còn chặn là CHỐNG
 * TRÙNG — cùng một bài không tự gửi lại cho cùng một khách — và có ô "Gửi lại"
 * để cố ý vượt qua. Phanh thật nằm ở nút từ chối nhận của khách.
 */

type Scope = 'all' | 'filter' | 'pick'

interface BranchLite { id: string; name: string }
interface GroupLite {
  id: string; name: string; kind: string
  so_thanh_vien: number; so_co_nhom_tg: number
}

const GROUP_KIND_LABELS: Record<string, string> = {
  khu_vuc: 'Khu vực', hang_khach: 'Hạng khách', chan_nuoi: 'Chăn nuôi', khac: 'Khác',
}

const LIFECYCLE_STAGES = [
  { value: 'lead', label: 'Tiềm năng' },
  { value: 'active', label: 'Đang mua' },
  { value: 'at_risk', label: 'Nguy cơ rời' },
  { value: 'churned', label: 'Đã rời' },
]

const CUSTOMER_TYPES = [
  { value: 'farm_household', label: 'Hộ chăn nuôi' },
  { value: 'farm_commercial', label: 'Trang trại' },
  { value: 'dealer', label: 'Đại lý' },
  { value: 'enterprise', label: 'Doanh nghiệp' },
  { value: 'other', label: 'Khác' },
]

const CUSTOMER_TIERS = [
  { value: 'vip', label: 'VIP' },
  { value: 'high', label: 'Cao' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'low', label: 'Thấp' },
]

function FilterChips({ label, options, selected, onChange }: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  if (options.length === 0) return null
  return (
    <div>
      <p className="text-tiny text-gray-500 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map(o => {
          const on = selected.includes(o.value)
          return (
            <button key={o.value} type="button"
              onClick={() => onChange(on ? selected.filter(v => v !== o.value) : [...selected, o.value])}
              className={`px-2 py-1 text-tiny rounded-lg border ${on
                ? 'bg-blue-500 text-gray-0 border-blue-500'
                : 'bg-gray-0 text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function PostBroadcastModal({ post, onClose }: {
  post: Post
  onClose: () => void
}) {
  const [branches, setBranches] = useState<BranchLite[]>([])
  const [groups, setGroups] = useState<GroupLite[]>([])
  const [preview, setPreview] = useState<PostPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const [scope, setScope] = useState<Scope>('filter')
  const [fGroup, setFGroup] = useState<string[]>([])
  const [fStage, setFStage] = useState<string[]>([])
  const [fTier, setFTier] = useState<string[]>([])
  const [fType, setFType] = useState<string[]>([])
  const [fBranch, setFBranch] = useState<string[]>([])
  const [picked, setPicked] = useState<Recipient[]>([])
  const [pickQuery, setPickQuery] = useState('')
  const [candidates, setCandidates] = useState<Recipient[]>([])
  const [note, setNote] = useState('')
  const [resend, setResend] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)

  const pickedIds = useMemo(() => picked.map(c => c.id), [picked])

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }: { data: BranchLite[] | null }) => { if (data) setBranches(data) })
    supabase.rpc('fn_customer_groups_overview')
      .then(({ data }: { data: GroupLite[] | null }) => {
        // Nhóm rỗng không hiện ở đây — gửi cho nhóm 0 người là vô nghĩa, và
        // để nguyên trong danh sách chỉ làm người dùng tưởng đã chọn đúng.
        if (data) setGroups(data.filter(g => g.so_thanh_vien > 0))
      })
  }, [])

  /** Tham số phạm vi kèm mọi lời gọi RPC, để xem trước và gửi thật luôn khớp. */
  const scopeArgs = useMemo(() => {
    if (scope === 'pick') {
      return { p_customer_ids: pickedIds, p_filter: {} }
    }
    if (scope === 'filter') {
      return {
        p_customer_ids: null,
        p_filter: {
          // Chọn nhiều nhóm = phép HỢP. Khách thuộc cả ba nhóm vẫn chỉ nhận MỘT tin.
          ...(fGroup.length ? { group_ids: fGroup } : {}),
          ...(fStage.length ? { lifecycle_stage: fStage } : {}),
          ...(fTier.length ? { value_tier: fTier } : {}),
          ...(fType.length ? { customer_type: fType } : {}),
          ...(fBranch.length ? { branch_ids: fBranch } : {}),
        },
      }
    }
    return { p_customer_ids: null, p_filter: {} }
  }, [scope, pickedIds, fGroup, fStage, fTier, fType, fBranch])

  const call = useCallback(async (
    mode: 'preview' | 'test' | 'send',
    args: Record<string, unknown>,
  ) => {
    const { data, error: err } = await supabase.rpc('fn_post_broadcast', {
      p_post_id: post.id, p_mode: mode, p_resend: resend,
      p_extra_note: note.trim() || null, ...args,
    })
    if (err) throw new Error(err.message)
    if (data && data.ok === false) throw new Error(data.loi || 'Không gửi được')
    return data as PostPreview
  }, [post.id, note, resend])

  // Xem trước chạy lại mỗi khi phạm vi hoặc ghi chú đổi. Hoãn 350ms vì gõ ghi
  // chú sẽ bắn một lượt RPC cho mỗi ký tự.
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      setLoading(true); setError('')
      call('preview', scopeArgs)
        .then(d => { if (alive) setPreview(d) })
        .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (alive) setLoading(false) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [call, scopeArgs])

  // Danh sách khách để tick — lấy qua chính RPC xem trước với bộ lọc tìm kiếm,
  // nên không cần quyền đọc thẳng bảng khách hàng từ màn này.
  useEffect(() => {
    if (scope !== 'pick') return
    const kw = pickQuery.trim()
    if (kw.length < 2) { setCandidates([]); return }
    let alive = true
    const t = setTimeout(() => {
      supabase.rpc('fn_post_broadcast', {
        p_post_id: post.id, p_mode: 'preview',
        p_customer_ids: null, p_filter: { search: kw }, p_resend: true,
      }).then(({ data }: { data: PostPreview | null }) => {
        if (!alive || !data) return
        setCandidates([...(data.danh_sach ?? []), ...(data.danh_sach_bo_qua ?? [])].slice(0, 40))
      })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [scope, pickQuery, post.id])

  const run = async (mode: 'test' | 'send') => {
    setBusy(mode); setError(''); setDone('')
    try {
      const d = await call(mode, scopeArgs)
      setDone(mode === 'test'
        ? 'Đã gửi bản xem thử vào nhóm nội bộ Tổng hợp.'
        : `Đã xếp hàng gửi tới ${d.da_xep_hang ?? 0} nhóm. Tin đi trong khoảng 15 giây mỗi lượt.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const nhan = preview?.so_nhom_nhan ?? 0
  const boQua = preview?.so_nhom_bo_qua ?? 0
  const quaDai = preview?.qua_dai === true
  const soKyTu = preview?.so_ky_tu ?? 0
  const tran = preview?.gioi_han_ky_tu ?? 4000

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-0 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <div className="min-w-0">
            <h3 className="text-body-lg font-semibold text-gray-900">Gửi bài vào nhóm Telegram</h3>
            <p className="text-tiny text-gray-400 truncate">{post.title}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400 shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ── Gửi cho ai ─────────────────────────────────────────── */}
          <div>
            <p className="text-tiny text-gray-500 mb-1.5">Gửi cho ai</p>
            <div className="flex gap-1.5">
              {([
                { v: 'filter', l: 'Theo nhóm khách' },
                { v: 'pick', l: 'Chọn từng khách' },
                { v: 'all', l: 'Tất cả khách' },
              ] as { v: Scope; l: string }[]).map(o => (
                <button key={o.v} type="button" onClick={() => setScope(o.v)}
                  className={`px-3 py-1.5 text-body-md rounded-lg border ${scope === o.v
                    ? 'bg-blue-500 text-gray-0 border-blue-500'
                    : 'bg-gray-0 text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          {scope === 'filter' && (
            <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
              {groups.length > 0 ? (
                <FilterChips
                  label="Nhóm khách hàng — chọn nhiều nhóm là phép HỢP"
                  options={groups.map(g => ({
                    value: g.id,
                    label: `${g.name} · ${GROUP_KIND_LABELS[g.kind] ?? 'Khác'} · ${g.so_co_nhom_tg}/${g.so_thanh_vien}`,
                  }))}
                  selected={fGroup}
                  onChange={setFGroup}
                />
              ) : (
                <p className="text-tiny text-gray-500">
                  Chưa có nhóm nào có thành viên. Sang tab <b>Nhóm khách hàng</b> tạo
                  nhóm và thêm khách vào, rồi quay lại đây. Nhóm rỗng không hiện ở
                  danh sách này.
                </p>
              )}
              <FilterChips label="Giai đoạn" options={LIFECYCLE_STAGES} selected={fStage} onChange={setFStage} />
              <FilterChips label="Hạng khách" options={CUSTOMER_TIERS} selected={fTier} onChange={setFTier} />
              <FilterChips label="Loại khách" options={CUSTOMER_TYPES} selected={fType} onChange={setFType} />
              <FilterChips label="Chi nhánh"
                options={branches.map(b => ({ value: b.id, label: b.name }))}
                selected={fBranch} onChange={setFBranch} />
              <p className="text-tiny text-gray-400">
                Không chọn gì ở một chiều nghĩa là không lọc theo chiều đó. Các chiều
                khác nhau thì GIAO nhau: chọn nhóm “Ân Hảo” và hạng “VIP” nghĩa là
                khách vừa thuộc Ân Hảo vừa là VIP.
              </p>
            </div>
          )}

          {scope === 'pick' && (
            <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center gap-1.5 bg-gray-0 border border-gray-200 rounded-lg px-2 py-1.5">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input
                  className="w-full text-body-md outline-none"
                  placeholder="Gõ tên, mã hoặc số điện thoại khách…"
                  value={pickQuery}
                  onChange={e => setPickQuery(e.target.value)}
                />
              </div>

              {candidates.length > 0 && (
                <div className="max-h-40 overflow-y-auto bg-gray-0 border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {candidates.map(c => {
                    const on = pickedIds.includes(c.id)
                    return (
                      <button key={c.id} type="button"
                        onClick={() => setPicked(on ? picked.filter(x => x.id !== c.id) : [...picked, c])}
                        className={`w-full text-left px-2.5 py-1.5 text-body-md hover:bg-blue-50 ${on ? 'bg-blue-50' : ''}`}>
                        <span className="text-gray-800">{c.ten}</span>
                        <span className="text-tiny text-gray-400 font-mono ml-1.5">{c.ma}</span>
                        {c.ly_do && <span className="block text-tiny text-warning-500">{c.ly_do}</span>}
                      </button>
                    )
                  })}
                </div>
              )}

              {picked.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {picked.map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-tiny px-2 py-1 rounded-lg">
                      {c.ten}
                      <button type="button" onClick={() => setPicked(picked.filter(x => x.id !== c.id))}
                        className="text-blue-400 hover:text-danger-500">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Gửi lại ────────────────────────────────────────────── */}
          <label className="flex items-start gap-2 text-tiny text-gray-600">
            <input type="checkbox" className="mt-0.5" checked={resend}
              onChange={e => setResend(e.target.checked)} />
            <span>
              Gửi lại cho cả khách đã nhận bài này rồi.
              <span className="block text-gray-400">
                Bình thường mỗi khách chỉ nhận một bài một lần — đây là chống bấm
                nhầm, không phải giới hạn số tin mỗi ngày.
              </span>
            </span>
          </label>

          {/* ── Ghi chú riêng ──────────────────────────────────────── */}
          <div>
            <p className="text-tiny text-gray-500 mb-1">Ghi chú thêm vào cuối tin (tuỳ chọn)</p>
            <textarea
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md"
              placeholder="Ví dụ: Gọi 0367383077 để đặt hàng trong hôm nay."
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          {/* ── Kết quả xem trước ──────────────────────────────────── */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg bg-blue-50 border border-blue-100 p-3">
              <p className="text-tiny text-gray-500">Nhóm sẽ nhận</p>
              <p className="text-heading-md font-semibold text-blue-700">{loading ? '…' : nhan}</p>
            </div>
            <div className="flex-1 rounded-lg bg-gray-50 border border-gray-100 p-3">
              <p className="text-tiny text-gray-500">Bỏ qua</p>
              <p className="text-heading-md font-semibold text-gray-600">{loading ? '…' : boQua}</p>
              {(preview?.ly_do_bo_qua ?? []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {(preview?.ly_do_bo_qua ?? []).map(r => (
                    <li key={r.ly_do} className="text-tiny text-gray-400">
                      {r.so_khach} — {r.ly_do}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {quaDai && (
            <p className="text-body-md text-danger-500 bg-danger-500/10 rounded-lg p-3">
              Bài có ảnh nên nội dung tối đa {tran.toLocaleString('vi-VN')} ký tự, hiện{' '}
              {soKyTu.toLocaleString('vi-VN')}. Telegram sẽ từ chối cả tin. Rút gọn{' '}
              {(soKyTu - tran).toLocaleString('vi-VN')} ký tự, hoặc bỏ ảnh khỏi bài.
            </p>
          )}

          {!loading && !quaDai && nhan === 0 && (
            <p className="text-body-md text-warning-500 bg-warning-500/10 rounded-lg p-3">
              Không có nhóm nào đủ điều kiện nhận. Khách chỉ nhận được tin khi hồ sơ
              đã gán id nhóm Telegram và bật nhận tin.
            </p>
          )}

          {(preview?.danh_sach ?? []).length > 0 && (
            <div>
              <p className="text-tiny text-gray-500 mb-1">Sẽ nhận ({nhan})</p>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
                {(preview?.danh_sach ?? []).map(c => (
                  <p key={c.id} className="px-2.5 py-1 text-body-md text-gray-700">
                    {c.ten} <span className="text-tiny text-gray-400 font-mono">{c.ma}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {(preview?.danh_sach_bo_qua ?? []).length > 0 && (
            <div>
              <button type="button" onClick={() => setShowSkipped(v => !v)}
                className="text-tiny text-blue-600 hover:underline">
                {showSkipped ? 'Ẩn' : 'Xem'} danh sách bị bỏ qua
              </button>
              {showSkipped && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
                  {(preview?.danh_sach_bo_qua ?? []).map(c => (
                    <p key={c.id} className="px-2.5 py-1 text-body-md text-gray-600">
                      {c.ten}
                      <span className="text-tiny text-gray-400 ml-1.5">{c.ly_do}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-tiny text-gray-500">Khách sẽ thấy như thế này</p>
              <p className={`text-tiny ${quaDai ? 'text-danger-500' : 'text-gray-400'}`}>
                {soKyTu.toLocaleString('vi-VN')}/{tran.toLocaleString('vi-VN')} ký tự
                {(preview?.so_anh ?? 0) > 0 && ` · ${preview?.so_anh} ảnh`}
              </p>
            </div>
            <pre className="text-body-md bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-sans text-gray-700">
              {(preview?.noi_dung ?? '').replace(/<\/?b>|<\/?i>/g, '')}
            </pre>
          </div>

          {error && <p className="text-body-md text-danger-500 bg-danger-500/10 rounded-lg p-3">{error}</p>}
          {done && <p className="text-body-md text-success-500 bg-success-500/10 rounded-lg p-3">{done}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-body-md text-gray-600 hover:bg-gray-100 rounded-lg">
            Đóng
          </button>
          <button onClick={() => run('test')} disabled={!!busy || loading}
            className="px-4 py-2 text-body-md border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {busy === 'test' ? 'Đang gửi…' : 'Gửi thử vào nhóm nội bộ'}
          </button>
          <button onClick={() => run('send')}
            disabled={!!busy || loading || nhan === 0 || quaDai}
            className="px-4 py-2 text-body-md bg-blue-500 text-gray-0 rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {busy === 'send' ? 'Đang gửi…' : `Gửi cho ${nhan} nhóm`}
          </button>
        </div>
      </div>
    </div>
  )
}
