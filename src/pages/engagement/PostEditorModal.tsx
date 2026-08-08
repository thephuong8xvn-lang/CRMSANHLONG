import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Upload, Trash2, Image as ImageIcon, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { POST_KINDS, type Post, type PostImage } from './postTypes'

/**
 * Soạn bài viết gửi khách.
 *
 * 🪤 GIỚI HẠN CHÚ THÍCH ẢNH CỦA TELEGRAM LÀ 1024 KÝ TỰ. Bài có ảnh mà viết dài
 * hơn thì Telegram TỪ CHỐI cả tin — không phải cắt bớt. Nên ô soạn thảo đếm
 * ngược ngay tại chỗ thay vì để người dùng phát hiện lúc bấm gửi. Bài không
 * ảnh thì trần là 4.096, thoải mái hơn nhiều.
 *
 * Ảnh nằm ở kho Supabase Storage chứ không phải Google Ảnh: link chia sẻ của
 * Google Ảnh là một trang web, Telegram không tải được. Và cũng không cần tiết
 * kiệm bằng cách đó — Telegram tải ảnh đúng MỘT lần rồi trả `file_id`, hệ
 * thống lưu lại mã đó nên gửi cho 500 nhóm vẫn chỉ tốn một lần tải.
 */

const BUCKET = 'post-images'
const MAX_ANH = 2
const MAX_MB = 5

/** Phần khung bao quanh thân bài (tiêu đề, nhãn loại, dòng từ chối nhận) tốn
 *  chừng này ký tự. Dùng để ước lượng còn lại bao nhiêu cho người soạn. */
const KHUNG_UOC_LUONG = 150

export default function PostEditorModal({ post, onClose, onSaved }: {
  post?: Post
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [kind, setKind] = useState(post?.kind ?? 'thong_bao')
  const [linkUrl, setLinkUrl] = useState(post?.link_url ?? '')
  const [images, setImages] = useState<PostImage[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const postId = post?.id

  const loadImages = useCallback(async () => {
    if (!postId) { setImages([]); return }
    const { data } = await supabase.from('post_images')
      .select('id, post_id, url, tg_file_id, sort_order')
      .eq('post_id', postId).order('sort_order')
    setImages((data ?? []) as PostImage[])
  }, [postId])

  useEffect(() => { loadImages() }, [loadImages])

  const uocTinh = title.length + body.length + linkUrl.length + KHUNG_UOC_LUONG
  const tran = images.length > 0 ? 1000 : 4000
  const conLai = tran - uocTinh

  const save = async () => {
    if (!title.trim()) { setError('Chưa nhập tiêu đề'); return }
    setBusy('save'); setError('')
    const payload = {
      title: title.trim(),
      body: body.trim(),
      kind,
      link_url: linkUrl.trim() || null,
    }
    const { data, error: err } = postId
      ? await supabase.from('posts').update(payload).eq('id', postId).select('id').single()
      : await supabase.from('posts')
          .insert({ ...payload, created_by: user?.id ?? null }).select('id').single()
    setBusy('')
    if (err) { setError(err.message); return }
    onSaved()
    if (!postId && data?.id) {
      // Bài mới: giữ cửa sổ mở để tải ảnh lên, vì ảnh cần post_id.
      setError('')
      onClose()
    } else {
      onClose()
    }
  }

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!postId) {
      setError('Lưu bài trước rồi mới thêm ảnh được — ảnh cần gắn vào bài.')
      return
    }
    const file = files[0]
    if (images.length >= MAX_ANH) { setError(`Tối đa ${MAX_ANH} ảnh mỗi bài.`); return }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`Ảnh tối đa ${MAX_MB} MB.`); return }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Chỉ nhận ảnh JPG, PNG hoặc WEBP.'); return
    }

    setBusy('upload'); setError('')
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${postId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(BUCKET)
      .upload(path, file, { cacheControl: '31536000', upsert: false })
    if (upErr) { setBusy(''); setError('Tải ảnh lỗi: ' + upErr.message); return }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const { error: insErr } = await supabase.from('post_images').insert({
      post_id: postId,
      url: pub.publicUrl,
      sort_order: (images[images.length - 1]?.sort_order ?? 0) + 1,
    })
    setBusy('')
    if (insErr) { setError(insErr.message); return }
    loadImages()
    if (fileRef.current) fileRef.current.value = ''
  }

  const removeImage = async (img: PostImage) => {
    setBusy('del')
    // Xoá bản ghi trước: nếu file trong kho có sót lại thì cũng vô hại, còn
    // ngược lại (mất file mà còn bản ghi) sẽ làm tin gửi đi hỏng ảnh.
    await supabase.from('post_images').delete().eq('id', img.id)
    const path = img.url.split(`/${BUCKET}/`)[1]
    if (path) await supabase.storage.from(BUCKET).remove([decodeURIComponent(path)])
    setBusy('')
    loadImages()
  }

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-0 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-body-lg font-semibold text-gray-900">
            {postId ? 'Sửa bài viết' : 'Bài viết mới'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-tiny text-gray-500">Loại bài</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {POST_KINDS.map(k => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={`px-2.5 py-1 text-tiny rounded-lg border ${
                    kind === k.value
                      ? 'bg-blue-500 text-gray-0 border-blue-500'
                      : 'bg-gray-0 text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {k.icon} {k.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-tiny text-gray-400">
              {POST_KINDS.find(k => k.value === kind)?.hint}
            </p>
          </div>

          <div>
            <label className="text-tiny text-gray-500">Tiêu đề</label>
            <input
              autoFocus
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md"
              placeholder="Ví dụ: Cảnh báo cúm gia cầm tại Hoài Ân"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-tiny text-gray-500">Nội dung</label>
              <span className={`text-tiny ${conLai < 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                {conLai < 0
                  ? `Thừa ${-conLai} ký tự`
                  : `Còn khoảng ${conLai} ký tự`}
              </span>
            </div>
            <textarea
              rows={8}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md font-sans"
              placeholder={'Viết như đang nhắn cho bà con.\n\nXuống dòng và gạch đầu dòng đều giữ nguyên khi gửi.'}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
            <p className="mt-1 text-tiny text-gray-400">
              {images.length > 0
                ? 'Bài có ảnh nên toàn bộ tin tối đa 1.000 ký tự — Telegram từ chối tin dài hơn.'
                : 'Bài không ảnh thì thoải mái tới 4.000 ký tự. Thêm ảnh sẽ rút trần xuống 1.000.'}
            </p>
          </div>

          <div>
            <label className="text-tiny text-gray-500">Đường dẫn kèm theo (tuỳ chọn)</label>
            <input
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-body-md"
              placeholder="https://…"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
            />
          </div>

          {/* ── Ảnh ─────────────────────────────────────────────────── */}
          <div>
            <label className="text-tiny text-gray-500">Ảnh ({images.length}/{MAX_ANH})</label>

            {!postId && (
              <p className="mt-1 text-tiny text-warning-500 bg-warning-500/10 rounded-lg p-2">
                Lưu bài trước rồi quay lại thêm ảnh — ảnh phải gắn vào một bài đã có.
              </p>
            )}

            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map(img => (
                  <div key={img.id} className="relative">
                    <img src={img.url} alt=""
                      className="h-24 w-24 object-cover rounded-lg border border-gray-200" />
                    <button onClick={() => removeImage(img)} disabled={!!busy}
                      className="absolute -top-1.5 -right-1.5 p-1 bg-gray-0 border border-gray-200 rounded-full text-gray-400 hover:text-red-600 shadow-sm disabled:opacity-50">
                      <Trash2 size={12} />
                    </button>
                    {img.tg_file_id && (
                      <span className="absolute bottom-1 left-1 text-[10px] bg-emerald-600/90 text-gray-0 px-1 rounded"
                        title="Telegram đã lưu ảnh này — những lần gửi sau không tải lại nữa">
                        đã cache
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {postId && images.length < MAX_ANH && (
              <div className="mt-2">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                  className="hidden" onChange={e => upload(e.target.files)} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-2 text-body-md border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'upload'
                    ? <><Loader2 size={16} className="animate-spin" /> Đang tải…</>
                    : <><Upload size={16} /> Thêm ảnh</>}
                </button>
                <p className="mt-1 text-tiny text-gray-400">
                  JPG, PNG hoặc WEBP, tối đa {MAX_MB} MB. Ảnh chỉ tải lên máy chủ
                  Telegram một lần cho toàn bộ chiến dịch.
                </p>
              </div>
            )}

            {postId && images.length === 0 && (
              <p className="mt-2 text-tiny text-gray-400 flex items-center gap-1.5">
                <ImageIcon size={13} /> Chưa có ảnh. Bài không ảnh vẫn gửi được bình thường.
              </p>
            )}
          </div>

          {error && <p className="text-body-md text-danger-500 bg-danger-500/10 rounded-lg p-3">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-body-md text-gray-600 hover:bg-gray-100 rounded-lg">
            Đóng
          </button>
          <button onClick={save} disabled={!!busy || !title.trim()}
            className="px-4 py-2 text-body-md bg-blue-500 text-gray-0 rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {busy === 'save' ? 'Đang lưu…' : 'Lưu bài'}
          </button>
        </div>
      </div>
    </div>
  )
}
