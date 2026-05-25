import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Edit2, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Category {
  id: string
  parent_id: string | null
  code: string
  name: string
  sort_order: number
  is_active: boolean
}

interface ManageCategoriesModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function ManageCategoriesModal({ isOpen, onClose, onSuccess }: ManageCategoriesModalProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [isActive, setIsActive] = useState(true)

  const loadCategories = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .order('sort_order', { ascending: true })
      if (!error && data) {
        setCategories(data as Category[])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadCategories()
      resetForm()
    }
  }, [isOpen])

  const resetForm = () => {
    setEditingId(null)
    setCode('')
    setName('')
    setSortOrder(0)
    setIsActive(true)
    setErrorMsg('')
  }

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id)
    setCode(cat.code)
    setName(cat.name)
    setSortOrder(cat.sort_order)
    setIsActive(cat.is_active)
    setErrorMsg('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || !name.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ Mã nhóm và Tên nhóm.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        sort_order: Number(sortOrder),
        is_active: isActive
      }

      if (editingId) {
        const { error } = await supabase
          .from('product_categories')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
        setSuccessMsg('Cập nhật nhóm sản phẩm thành công!')
      } else {
        const { error } = await supabase
          .from('product_categories')
          .insert([payload])

        if (error) throw error
        setSuccessMsg('Thêm nhóm sản phẩm mới thành công!')
      }

      resetForm()
      await loadCategories()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi lưu nhóm sản phẩm. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa nhóm sản phẩm này?')) return

    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const { error } = await supabase
        .from('product_categories')
        .delete()
        .eq('id', id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa vì đang có sản phẩm thuộc nhóm này!')
        }
        throw error
      }

      setSuccessMsg('Xóa nhóm sản phẩm thành công!')
      await loadCategories()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi xóa nhóm sản phẩm.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (cat: Category) => {
    try {
      const { error } = await supabase
        .from('product_categories')
        .update({ is_active: !cat.is_active })
        .eq('id', cat.id)

      if (error) throw error
      setSuccessMsg(`Đã ${!cat.is_active ? 'bật' : 'tắt'} trạng thái hoạt động!`)
      await loadCategories()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi đổi trạng thái.')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25 shrink-0">
          <h3 className="text-body-lg font-bold text-gray-700">Quản lý Nhóm sản phẩm</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-400">
            <X size={20} />
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-red-50 text-red-800 rounded border border-red-200 flex items-center gap-2 text-tiny">
            <AlertCircle className="text-red-500 shrink-0" size={16} />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 text-emerald-800 rounded border border-emerald-200 flex items-center gap-2 text-tiny">
            <CheckCircle2 className="text-emerald-500 shrink-0" size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
          
          {/* Left Column: Form */}
          <div className="w-full md:w-[45%] shrink-0">
            <form onSubmit={handleSubmit} className="space-y-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h4 className="font-bold text-[13px] text-gray-700 uppercase tracking-wider mb-2">
                {editingId ? 'Sửa nhóm sản phẩm' : 'Thêm nhóm sản phẩm'}
              </h4>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Mã nhóm</label>
                <input
                  type="text"
                  placeholder="Ví dụ: VACCINE, THUOC"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tên nhóm</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Vaccine thú y"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Thứ tự sắp xếp</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={e => setSortOrder(parseInt(e.target.value) || 0)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cat-active"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="rounded text-blue-500 focus:ring-blue-500 w-4 h-4"
                />
                <label htmlFor="cat-active" className="text-tiny font-bold text-gray-500 cursor-pointer">Kích hoạt hoạt động</label>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 h-9 bg-blue-500 text-white rounded text-tiny font-bold hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50"
                >
                  {editingId ? 'Cập nhật' : 'Thêm mới'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 h-9 bg-gray-200 text-gray-700 rounded text-tiny font-bold hover:bg-gray-300 transition-all"
                  >
                    Hủy
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: List of Categories */}
          <div className="flex-1 flex flex-col border border-gray-200 rounded-lg overflow-hidden min-h-[300px]">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider flex justify-between shrink-0">
              <span>Mã &amp; Tên nhóm</span>
              <span>Thao tác</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 max-h-[400px]">
              {loading && categories.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Đang tải...</div>
              ) : categories.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Không có nhóm sản phẩm nào</div>
              ) : (
                categories.map(cat => (
                  <div key={cat.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-800 text-tiny">{cat.name}</span>
                        <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded uppercase ${
                          cat.is_active ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-450 border border-gray-200'
                        }`}>
                          {cat.is_active ? 'Đang chạy' : 'Ngừng'}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono mt-0.5">Mã: {cat.code} | Sắp xếp: {cat.sort_order}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(cat)}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                          cat.is_active ? 'text-gray-500 hover:text-red-500 border-gray-200 hover:border-red-200 hover:bg-red-50' : 'text-blue-500 hover:text-blue-600 border-blue-200 hover:bg-blue-50'
                        }`}
                      >
                        {cat.is_active ? 'Tắt' : 'Bật'}
                      </button>
                      <button
                        onClick={() => handleEdit(cat)}
                        className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-gray-100 transition-colors"
                        title="Sửa"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-gray-100 transition-colors"
                        title="Xóa"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
