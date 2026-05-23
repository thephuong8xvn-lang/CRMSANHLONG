import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Edit2, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Brand {
  id: string
  name: string
  country: string | null
  website: string | null
  is_active: boolean
}

interface ManageBrandsModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function ManageBrandsModal({ isOpen, onClose, onSuccess }: ManageBrandsModalProps) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [website, setWebsite] = useState('')
  const [isActive, setIsActive] = useState(true)

  const loadBrands = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .order('name', { ascending: true })
      if (!error && data) {
        setBrands(data as Brand[])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadBrands()
      resetForm()
    }
  }, [isOpen])

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setCountry('')
    setWebsite('')
    setIsActive(true)
    setErrorMsg('')
  }

  const handleEdit = (brand: Brand) => {
    setEditingId(brand.id)
    setName(brand.name)
    setCountry(brand.country || '')
    setWebsite(brand.website || '')
    setIsActive(brand.is_active)
    setErrorMsg('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ Tên thương hiệu.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const payload = {
        name: name.trim(),
        country: country.trim() || null,
        website: website.trim() || null,
        is_active: isActive
      }

      if (editingId) {
        const { error } = await supabase
          .from('brands')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
        setSuccessMsg('Cập nhật thương hiệu thành công!')
      } else {
        const { error } = await supabase
          .from('brands')
          .insert([payload])

        if (error) throw error
        setSuccessMsg('Thêm thương hiệu mới thành công!')
      }

      resetForm()
      await loadBrands()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi lưu thương hiệu. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa thương hiệu này?')) return

    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const { error } = await supabase
        .from('brands')
        .delete()
        .eq('id', id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa vì đang có sản phẩm thuộc thương hiệu này!')
        }
        throw error
      }

      setSuccessMsg('Xóa thương hiệu thành công!')
      await loadBrands()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi xóa thương hiệu.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (brand: Brand) => {
    try {
      const { error } = await supabase
        .from('brands')
        .update({ is_active: !brand.is_active })
        .eq('id', brand.id)

      if (error) throw error
      setSuccessMsg(`Đã ${!brand.is_active ? 'bật' : 'tắt'} trạng thái hoạt động!`)
      await loadBrands()
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
        <div className="px-6 py-4 border-b border-gray-150 flex justify-between items-center bg-gray-25 shrink-0">
          <h3 className="text-body-lg font-bold text-gray-700">Quản lý Thương hiệu</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-150 rounded-full text-gray-400">
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
                {editingId ? 'Sửa thương hiệu' : 'Thêm thương hiệu'}
              </h4>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tên thương hiệu</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Zoetis, Hanvet, MSD"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Quốc gia sản xuất</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Mỹ, Việt Nam, Đức"
                  value={country}
                  onChange={e => setCountry(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Website</label>
                <input
                  type="text"
                  placeholder="Ví dụ: https://zoetis.com"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="brand-active"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="rounded text-blue-500 focus:ring-blue-500 w-4 h-4"
                />
                <label htmlFor="brand-active" className="text-tiny font-bold text-gray-500 cursor-pointer">Kích hoạt hoạt động</label>
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

          {/* Right Column: List of Brands */}
          <div className="flex-1 flex flex-col border border-gray-200 rounded-lg overflow-hidden min-h-[300px]">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider flex justify-between shrink-0">
              <span>Tên thương hiệu</span>
              <span>Thao tác</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 max-h-[400px]">
              {loading && brands.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Đang tải...</div>
              ) : brands.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Không có thương hiệu nào</div>
              ) : (
                brands.map(brand => (
                  <div key={brand.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-800 text-tiny">{brand.name}</span>
                        <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded uppercase ${
                          brand.is_active ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-450 border border-gray-200'
                        }`}>
                          {brand.is_active ? 'Đang chạy' : 'Ngừng'}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        QG: {brand.country || '-'} {brand.website && `| Web: ${brand.website}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(brand)}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                          brand.is_active ? 'text-gray-500 hover:text-red-500 border-gray-200 hover:border-red-200 hover:bg-red-50' : 'text-blue-500 hover:text-blue-600 border-blue-200 hover:bg-blue-50'
                        }`}
                      >
                        {brand.is_active ? 'Tắt' : 'Bật'}
                      </button>
                      <button
                        onClick={() => handleEdit(brand)}
                        className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-gray-100 transition-colors"
                        title="Sửa"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(brand.id)}
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
