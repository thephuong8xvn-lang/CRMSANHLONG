import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2, Edit2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export interface Unit {
  id: string
  name: string
  is_active: boolean
  created_at?: string
}

interface ManageUnitsModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const DEFAULT_UNITS: Unit[] = [
  { id: '1', name: 'lọ', is_active: true },
  { id: '2', name: 'kg', is_active: true },
  { id: '3', name: 'gói', is_active: true },
  { id: '4', name: 'cái', is_active: true },
  { id: '5', name: 'lon', is_active: true },
  { id: '6', name: 'túi', is_active: true },
  { id: '7', name: 'chai', is_active: true }
]

export default function ManageUnitsModal({ isOpen, onClose, onSuccess }: ManageUnitsModalProps) {
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isFallbackMode, setIsFallbackMode] = useState(false)

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)

  const loadFallbackUnits = () => {
    const saved = localStorage.getItem('product-units')
    if (saved) {
      setUnits(JSON.parse(saved))
    } else {
      localStorage.setItem('product-units', JSON.stringify(DEFAULT_UNITS))
      setUnits(DEFAULT_UNITS)
    }
  }

  const saveFallbackUnits = (updatedUnits: Unit[]) => {
    localStorage.setItem('product-units', JSON.stringify(updatedUnits))
    setUnits(updatedUnits)
  }

  const loadUnits = async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const { data, error } = await supabase
        .from('product_units')
        .select('*')
        .order('name', { ascending: true })

      if (error) {
        if (error.code === '42P01') {
          setIsFallbackMode(true)
          loadFallbackUnits()
          return
        }
        throw error
      }

      if (data) {
        setUnits(data as Unit[])
        setIsFallbackMode(false)
      }
    } catch (err: any) {
      console.warn('Supabase product_units select error, falling back to LocalStorage:', err.message || err)
      setIsFallbackMode(true)
      loadFallbackUnits()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadUnits()
      resetForm()
    }
  }, [isOpen])

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setIsActive(true)
    setErrorMsg('')
  }

  const handleEdit = (unit: Unit) => {
    setEditingId(unit.id)
    setName(unit.name)
    setIsActive(unit.is_active)
    setErrorMsg('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMsg('Vui lòng điền tên đơn vị tính.')
      return
    }

    const trimmedName = name.trim().toLowerCase()

    // Check duplicate
    const isDuplicate = units.some(u => u.name.toLowerCase() === trimmedName && u.id !== editingId)
    if (isDuplicate) {
      setErrorMsg('Tên đơn vị tính này đã tồn tại.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')
    setSuccessMsg('')

    if (isFallbackMode) {
      // LocalStorage Mode
      let updatedUnits = [...units]
      if (editingId) {
        updatedUnits = updatedUnits.map(u => 
          u.id === editingId ? { ...u, name: trimmedName, is_active: isActive } : u
        )
        setSuccessMsg('Cập nhật đơn vị tính thành công!')
      } else {
        const newUnit: Unit = {
          id: Date.now().toString(),
          name: trimmedName,
          is_active: isActive
        }
        updatedUnits.push(newUnit)
        setSuccessMsg('Thêm đơn vị tính mới thành công!')
      }
      saveFallbackUnits(updatedUnits)
      resetForm()
      setSubmitting(false)
      onSuccess()
      return
    }

    // Database Mode
    try {
      const payload = {
        name: trimmedName,
        is_active: isActive
      }

      if (editingId) {
        const { error } = await supabase
          .from('product_units')
          .update(payload)
          .eq('id', editingId)

        if (error) throw error
        setSuccessMsg('Cập nhật đơn vị tính thành công!')
      } else {
        const { error } = await supabase
          .from('product_units')
          .insert([payload])

        if (error) throw error
        setSuccessMsg('Thêm đơn vị tính mới thành công!')
      }

      resetForm()
      await loadUnits()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi lưu đơn vị tính. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa đơn vị tính này?')) return

    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    if (isFallbackMode) {
      // LocalStorage Mode
      const updatedUnits = units.filter(u => u.id !== id)
      saveFallbackUnits(updatedUnits)
      setSuccessMsg('Xóa đơn vị tính thành công!')
      setLoading(false)
      onSuccess()
      return
    }

    // Database Mode
    try {
      const { error } = await supabase
        .from('product_units')
        .delete()
        .eq('id', id)

      if (error) {
        if (error.code === '23503') {
          throw new Error('Không thể xóa vì đơn vị tính này đang được sử dụng ở sản phẩm khác!')
        }
        throw error
      }

      setSuccessMsg('Xóa đơn vị tính thành công!')
      await loadUnits()
      onSuccess()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Lỗi khi xóa đơn vị tính.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (unit: Unit) => {
    setErrorMsg('')
    setSuccessMsg('')

    if (isFallbackMode) {
      const updatedUnits = units.map(u => 
        u.id === unit.id ? { ...u, is_active: !u.is_active } : u
      )
      saveFallbackUnits(updatedUnits)
      setSuccessMsg(`Đã ${!unit.is_active ? 'bật' : 'tắt'} trạng thái hoạt động!`)
      onSuccess()
      return
    }

    try {
      const { error } = await supabase
        .from('product_units')
        .update({ is_active: !unit.is_active })
        .eq('id', unit.id)

      if (error) throw error
      setSuccessMsg(`Đã ${!unit.is_active ? 'bật' : 'tắt'} trạng thái hoạt động!`)
      await loadUnits()
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
          <div>
            <h3 className="text-body-lg font-bold text-gray-700">Quản lý Đơn vị tính</h3>
            {isFallbackMode && (
              <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-semibold mt-1 inline-block">
                ⚠️ Chế độ dự phòng (Lưu cục bộ)
              </span>
            )}
          </div>
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
                {editingId ? 'Sửa đơn vị tính' : 'Thêm đơn vị tính'}
              </h4>

              <div>
                <label className="block text-tiny font-bold text-gray-400 uppercase tracking-wider mb-1">Tên đơn vị tính</label>
                <input
                  type="text"
                  placeholder="Ví dụ: chai, lọ, kg, gói..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full h-9 px-3 bg-white border border-gray-200 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="unit-active"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="rounded text-blue-500 focus:ring-blue-500 w-4 h-4"
                />
                <label htmlFor="unit-active" className="text-tiny font-bold text-gray-500 cursor-pointer">Kích hoạt hoạt động</label>
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

          {/* Right Column: List of Units */}
          <div className="flex-1 flex flex-col border border-gray-200 rounded-lg overflow-hidden min-h-[300px]">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider flex justify-between shrink-0">
              <span>Đơn vị tính</span>
              <span>Thao tác</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 max-h-[400px]">
              {loading && units.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Đang tải...</div>
              ) : units.length === 0 ? (
                <div className="p-8 text-center text-gray-400 italic">Không có đơn vị tính nào</div>
              ) : (
                units.map(u => (
                  <div key={u.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-800 text-tiny capitalize">{u.name}</span>
                        <span className={`px-1.5 py-0.2 text-[9px] font-bold rounded uppercase ${
                          u.is_active ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-455 border border-gray-200'
                        }`}>
                          {u.is_active ? 'Đang chạy' : 'Ngừng'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                          u.is_active ? 'text-gray-500 hover:text-red-500 border-gray-200 hover:border-red-200 hover:bg-red-50' : 'text-blue-500 hover:text-blue-600 border-blue-200 hover:bg-blue-50'
                        }`}
                      >
                        {u.is_active ? 'Tắt' : 'Bật'}
                      </button>
                      <button
                        onClick={() => handleEdit(u)}
                        className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-gray-100 transition-colors"
                        title="Sửa"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
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
