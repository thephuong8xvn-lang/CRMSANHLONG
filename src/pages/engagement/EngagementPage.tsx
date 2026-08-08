import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, Send, Pencil, Trash2, RefreshCw, FileText, Layers,
  ToggleLeft, ToggleRight, Image as ImageIcon, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import CustomerGroupsPanel from './CustomerGroupsPanel'
import PostEditorModal from './PostEditorModal'
import PostBroadcastModal from './PostBroadcastModal'
import { kindMeta, KIND_COLORS, type Post } from './postTypes'

/**
 * Module Tương tác khách hàng.
 *
 * Gộp hai việc vốn phải làm cùng nhau nhưng trước đây nằm ở hai chỗ: SOẠN BÀI
 * để gửi khách, và GOM NHÓM khách để biết gửi cho ai. Trang nhóm khách hàng cũ
 * ở /customers/groups nay là tab thứ hai tại đây.
 *
 * Đường ống gửi dùng lại nguyên hạ tầng thông báo Telegram đã chạy thật: hàng
 * đợi `notification_events` → `fn_notify_drain` mỗi 15 giây. Module này chỉ
 * thêm một LOẠI NỘI DUNG mới, không dựng lại đường ống.
 */

type PostRow = Post & {
  so_anh: number
  so_anh_cache: number
  so_da_gui: number
  gui_lan_cuoi: string | null
}

type Tab = 'posts' | 'groups'

const fmtLuc = (s: string | null) =>
  s ? new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

export default function EngagementPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'groups' ? 'groups' : 'posts'
  const setTab = (t: Tab) => setParams(t === 'posts' ? {} : { tab: t }, { replace: true })

  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [editing, setEditing] = useState<Post | undefined>()
  const [showEditor, setShowEditor] = useState(false)
  const [sending, setSending] = useState<Post | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_posts_overview')
    if (error) setAlertMsg({ type: 'error', text: 'Lỗi tải bài viết: ' + error.message })
    else setPosts((data ?? []) as PostRow[])
    setLoading(false)
  }, [])

  useEffect(() => { if (tab === 'posts') load() }, [load, tab])

  useEffect(() => {
    if (!alertMsg) return
    const t = setTimeout(() => setAlertMsg(null), 4000)
    return () => clearTimeout(t)
  }, [alertMsg])

  const toggleActive = async (p: PostRow) => {
    const { error } = await supabase.from('posts')
      .update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) { setAlertMsg({ type: 'error', text: error.message }); return }
    load()
  }

  const remove = async (p: PostRow) => {
    if (!confirm(`Xoá bài “${p.title}”? Ảnh kèm theo cũng bị xoá. Tin đã gửi cho khách thì vẫn còn trong nhóm của họ.`)) return
    const { error } = await supabase.from('posts').delete().eq('id', p.id)
    if (error) { setAlertMsg({ type: 'error', text: error.message }); return }
    setAlertMsg({ type: 'success', text: 'Đã xoá bài viết.' })
    load()
  }

  return (
    <Layout activeMenu="Tương tác khách hàng">
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        {alertMsg && (
          <div className={`fixed top-4 right-4 z-55 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md font-medium ${
            alertMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}>
            {alertMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {alertMsg.text}
          </div>
        )}

        <div>
          <h1 className="text-heading-md font-semibold text-gray-900">Tương tác khách hàng</h1>
          <p className="text-tiny text-gray-500">
            Soạn bài viết và gửi vào nhóm Telegram của khách — khuyến mãi, cảnh báo
            dịch tễ, kiến thức chăn nuôi.
          </p>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="border-b border-gray-200 flex gap-1">
          {([
            { v: 'posts', l: 'Bài viết', icon: FileText },
            { v: 'groups', l: 'Nhóm khách hàng', icon: Layers },
          ] as { v: Tab; l: string; icon: typeof FileText }[]).map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`flex items-center gap-1.5 px-4 py-2 text-body-md font-medium border-b-2 -mb-px transition-colors ${
                tab === t.v
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <t.icon size={15} /> {t.l}
            </button>
          ))}
        </div>

        {tab === 'groups' ? <CustomerGroupsPanel /> : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-tiny text-gray-500">
                Bài viết soạn một lần, gửi được nhiều lần cho nhiều nhóm khác nhau.
              </p>
              <div className="flex gap-2 shrink-0">
                <button onClick={load} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                  title="Tải lại">
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => { setEditing(undefined); setShowEditor(true) }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 text-gray-0 rounded-lg text-body-md hover:bg-blue-600">
                  <Plus size={16} /> Bài viết mới
                </button>
              </div>
            </div>

            {!loading && posts.length === 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center space-y-2">
                <FileText className="mx-auto text-gray-300" size={32} />
                <p className="text-body-md text-gray-600">Chưa có bài viết nào.</p>
                <p className="text-tiny text-gray-500 max-w-md mx-auto">
                  Soạn bài đầu tiên, thêm 1–2 ảnh, rồi bấm ✈️ để gửi. Nên gửi thử
                  vào nhóm nội bộ trước khi gửi cho khách.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {posts.map(p => {
                const meta = kindMeta(p.kind)
                return (
                  <div key={p.id}
                    className={`rounded-lg border border-gray-200 bg-gray-0 p-4 ${p.is_active ? '' : 'opacity-60'}`}>
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-tiny px-2 py-0.5 rounded-lg border ${KIND_COLORS[p.kind] ?? KIND_COLORS.thong_bao}`}>
                            {meta.icon} {meta.label}
                          </span>
                          {p.so_anh > 0 && (
                            <span className="text-tiny text-gray-500 flex items-center gap-1">
                              <ImageIcon size={12} /> {p.so_anh} ảnh
                              {p.so_anh_cache > 0 && (
                                <span className="text-emerald-600"
                                  title="Telegram đã lưu ảnh — lần gửi sau không tải lại">
                                  · {p.so_anh_cache} đã cache
                                </span>
                              )}
                            </span>
                          )}
                          {!p.is_active && (
                            <span className="text-tiny bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">Tắt</span>
                          )}
                        </div>

                        <p className="text-body-md font-medium text-gray-900 truncate">{p.title}</p>
                        {p.body && (
                          <p className="text-tiny text-gray-500 line-clamp-2 whitespace-pre-wrap">{p.body}</p>
                        )}

                        <p className="mt-1.5 text-tiny text-gray-400">
                          {p.so_da_gui > 0
                            ? `Đã gửi cho ${p.so_da_gui} nhóm · lần cuối ${fmtLuc(p.gui_lan_cuoi)}`
                            : 'Chưa gửi lần nào'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => setSending(p)}
                          disabled={!p.is_active}
                          className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent"
                          title={p.is_active ? 'Gửi vào nhóm Telegram của khách' : 'Bài đang tắt'}>
                          <Send size={16} />
                        </button>
                        <button onClick={() => toggleActive(p)}
                          className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                          title={p.is_active ? 'Tắt bài' : 'Bật bài'}>
                          {p.is_active ? <ToggleRight size={20} className="text-blue-600" /> : <ToggleLeft size={20} />}
                        </button>
                        <button onClick={() => { setEditing(p); setShowEditor(true) }}
                          className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => remove(p)}
                          className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {showEditor && (
        <PostEditorModal
          post={editing}
          onClose={() => { setShowEditor(false); setEditing(undefined) }}
          onSaved={() => { load(); setAlertMsg({ type: 'success', text: 'Đã lưu bài viết.' }) }}
        />
      )}

      {sending && (
        <PostBroadcastModal
          post={sending}
          onClose={() => { setSending(null); load() }}
        />
      )}
    </Layout>
  )
}
