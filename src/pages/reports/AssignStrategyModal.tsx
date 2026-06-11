import { useState, useEffect } from 'react'
import { X, Target, Layers } from 'lucide-react'
import SmartSearchSelect, { SmartSearchOption } from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAssignStrategy, StrategyClass } from '../../hooks/queries/useStrategicProducts'

// ─────────────────────────────────────────────────────────────
// Modal gán SP vào nhóm chiến lược / hàng nền (admin-only — RLS enforce).
// ─────────────────────────────────────────────────────────────

interface AssignStrategyModalProps {
  open: boolean
  onClose: () => void
  defaultClass?: StrategyClass
}

export default function AssignStrategyModal({ open, onClose, defaultClass = 'strategic' }: AssignStrategyModalProps) {
  const [productOptions, setProductOptions] = useState<SmartSearchOption[]>([])
  const [productId, setProductId] = useState('')
  const [cls, setCls] = useState<StrategyClass>(defaultClass)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const assignMutation = useAssignStrategy()

  useEffect(() => {
    if (!open) return
    setCls(defaultClass)
    setProductId('')
    setNote('')
    setError('')
    fetchAllRows<{ id: string; sku: string; name: string }>((f, t) =>
      supabase.from('products').select('id, sku, name')
        .eq('is_active', true)
        .order('name', { ascending: true }).order('id')
        .range(f, t)
    ).then(list => {
      setProductOptions(list.map(p => ({ value: p.id, label: p.name, desc: p.sku })))
    }).catch(() => {})
  }, [open, defaultClass])

  if (!open) return null

  const handleSave = async () => {
    if (!productId) { setError('Chọn sản phẩm cần gán nhóm'); return }
    setError('')
    try {
      await assignMutation.mutateAsync({ productId, cls, note })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được — thử lại')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-bold text-gray-800">Gán sản phẩm vào nhóm</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-tiny font-semibold text-gray-600 mb-1.5">Sản phẩm *</label>
            <SmartSearchSelect
              options={productOptions}
              value={productId}
              onChange={setProductId}
              placeholder="Tìm sản phẩm…"
              searchPlaceholder="Gõ tên hoặc SKU (không dấu)…"
            />
          </div>
          <div>
            <label className="block text-tiny font-semibold text-gray-600 mb-1.5">Nhóm *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCls('strategic')}
                className={`p-3 rounded-lg border text-left transition-all ${cls === 'strategic' ? 'border-[#1E5A9C] bg-blue-50 ring-1 ring-[#1E5A9C]' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-tiny text-[#1E5A9C]"><Target size={14} />Nhóm 1 — Chiến lược</div>
                <div className="text-tiny text-gray-500 mt-1">Markup ≥ 50% giá vốn, nguồn lợi nhuận chính</div>
              </button>
              <button
                type="button"
                onClick={() => setCls('baseline')}
                className={`p-3 rounded-lg border text-left transition-all ${cls === 'baseline' ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-tiny text-emerald-700"><Layers size={14} />Nhóm 2 — Hàng nền</div>
                <div className="text-tiny text-gray-500 mt-1">Bắt buộc có mặt, quay nhanh, chấp nhận hòa/lỗ</div>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-tiny font-semibold text-gray-600 mb-1.5">Ghi chú</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="VD: hàng kéo khách mùa dịch tả…"
              className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
          {error && <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-tiny text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="h-10 px-4 rounded-lg text-tiny font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
          <button
            onClick={handleSave}
            disabled={assignMutation.isPending}
            className="h-10 px-5 bg-[#1E5A9C] text-white rounded-lg font-semibold text-tiny hover:bg-[#143C69] active:scale-95 transition-all disabled:opacity-50"
          >
            {assignMutation.isPending ? 'Đang lưu…' : 'Gán nhóm'}
          </button>
        </div>
      </div>
    </div>
  )
}
