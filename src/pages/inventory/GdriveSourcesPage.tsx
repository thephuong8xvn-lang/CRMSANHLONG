import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Trash2, FolderOpen, AlertCircle, Save, X, Copy, Check } from 'lucide-react'
import Layout from '../../components/Layout'
import SmartSearchSelect from '../../components/SmartSearchSelect'
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { useAuth } from '../../contexts/AuthContext'
import { useGdriveSources, useGdriveSaEmail, type GdriveSource } from '../../hooks/useGdriveImport'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queryClient'
import { COLUMN_FIELDS, type ColumnMap } from '../../lib/gdriveMapping'

interface Opt { value: string; label: string }

const emptyForm = {
  id: '' as string,
  label: '',
  supplier_id: '',
  drive_folder_id: '',
  default_warehouse_id: '',
  header_row: 3,
  data_start_row: 4,
  column_map: {} as ColumnMap,
  vat_default: '5' as 'none' | '5' | '10',
  is_active: true,
}

export default function GdriveSourcesPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: sources = [], isLoading } = useGdriveSources(false)
  const { data: saEmail = '' } = useGdriveSaEmail()
  const [copied, setCopied] = useState(false)

  const [suppliers, setSuppliers] = useState<Opt[]>([])
  const [warehouses, setWarehouses] = useState<Opt[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      const sup = await fetchAllRows<any>((from, to) =>
        supabase.from('suppliers').select('id, name').eq('is_active', true).order('name').order('id').range(from, to))
      setSuppliers(sup.map((s) => ({ value: s.id, label: s.name })))
      const { data: wh } = await supabase.from('warehouses').select('id, name').order('name')
      setWarehouses((wh ?? []).map((w: any) => ({ value: w.id, label: w.name })))
    }
    load()
  }, [])

  useEffect(() => {
    if (alert) { const t = setTimeout(() => setAlert(null), 4000); return () => clearTimeout(t) }
  }, [alert])

  const openNew = () => { setForm(emptyForm); setShowModal(true) }
  const openEdit = (s: GdriveSource) => {
    setForm({
      id: s.id, label: s.label, supplier_id: s.supplier_id, drive_folder_id: s.drive_folder_id,
      default_warehouse_id: s.default_warehouse_id || '', header_row: s.header_row,
      data_start_row: s.data_start_row, column_map: s.column_map || {}, vat_default: s.vat_default, is_active: s.is_active,
    })
    setShowModal(true)
  }

  const setCol = (key: keyof ColumnMap, val: string) =>
    setForm((f) => ({ ...f, column_map: { ...f.column_map, [key]: val.trim().toUpperCase() || null } }))

  const handleSave = async () => {
    if (!form.label.trim()) { setAlert({ type: 'error', text: 'Nhập tên hiển thị.' }); return }
    if (!form.supplier_id) { setAlert({ type: 'error', text: 'Chọn nhà cung cấp.' }); return }
    if (!form.drive_folder_id.trim()) { setAlert({ type: 'error', text: 'Nhập ID thư mục Google Drive.' }); return }
    if (!form.column_map.name || !form.column_map.import_price) {
      setAlert({ type: 'error', text: 'Bắt buộc ánh xạ cột Tên sản phẩm và Giá nhập.' }); return
    }
    setSaving(true)
    try {
      const payload = {
        label: form.label.trim(),
        supplier_id: form.supplier_id,
        drive_folder_id: form.drive_folder_id.trim(),
        default_warehouse_id: form.default_warehouse_id || null,
        header_row: form.header_row,
        data_start_row: form.data_start_row,
        column_map: form.column_map,
        vat_default: form.vat_default,
        is_active: form.is_active,
      }
      if (form.id) {
        const { error } = await supabase.from('gdrive_sources').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('gdrive_sources').insert({ ...payload, created_by: profile?.id ?? null })
        if (error) throw error
      }
      qc.invalidateQueries({ queryKey: qk.gdrive.sources })
      setShowModal(false)
      setAlert({ type: 'success', text: 'Đã lưu cấu hình nguồn.' })
    } catch (e: any) {
      setAlert({ type: 'error', text: 'Lỗi lưu: ' + (e.message || e) })
    } finally { setSaving(false) }
  }

  const handleDelete = async (s: GdriveSource) => {
    if (!confirm(`Xóa cấu hình nguồn "${s.label}"? Bí danh SP đã học theo NCC vẫn được giữ.`)) return
    const { error } = await supabase.from('gdrive_sources').delete().eq('id', s.id)
    if (error) { setAlert({ type: 'error', text: 'Lỗi xóa: ' + error.message }); return }
    qc.invalidateQueries({ queryKey: qk.gdrive.sources })
    setAlert({ type: 'success', text: 'Đã xóa nguồn.' })
  }

  const supplierName = useMemo(() => {
    const m = new Map(suppliers.map((s) => [s.value, s.label]))
    return (id: string) => m.get(id) || '—'
  }, [suppliers])

  return (
    <Layout activeMenu="Nhập từ Drive">
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
        {alert && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-body-md ${alert.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            <AlertCircle size={18} /><span>{alert.text}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <button onClick={() => navigate('/inventory/gdrive-import')} className="text-body-md text-gray-400 hover:text-blue-500 flex items-center gap-1 mb-1">
              <ArrowLeft size={14} /> Về Nhập từ Drive
            </button>
            <h1 className="text-headline-md font-bold text-gray-800">Cấu hình nguồn Google Drive</h1>
            <p className="text-body-md text-gray-400">Mỗi công ty/NCC = 1 thư mục Drive + ánh xạ cột riêng.</p>
          </div>
          <button onClick={openNew} className="h-10 px-4 bg-blue-500 text-white rounded-lg font-semibold text-body-md hover:bg-blue-600 flex items-center gap-1.5 shadow-sm">
            <Plus size={16} /> Thêm nguồn
          </button>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm divide-y divide-gray-50">
          {isLoading ? (
            <div className="p-10 text-center text-gray-400">Đang tải…</div>
          ) : sources.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              <FolderOpen className="w-10 h-10 mx-auto text-gray-200 mb-2" />
              Chưa có nguồn nào. Bấm "Thêm nguồn" để cấu hình.
            </div>
          ) : sources.map((s) => (
            <div key={s.id} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-25/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-800">{s.label}</span>
                  {!s.is_active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">TẮT</span>}
                </div>
                <div className="text-tiny text-gray-450">
                  NCC: {supplierName(s.supplier_id)} · Tên→{s.column_map?.name || '?'} · Giá→{s.column_map?.import_price || '?'} · Header dòng {s.header_row}
                </div>
                <div className="text-[11px] text-gray-400 font-mono truncate">folder: {s.drive_folder_id}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(s)} className="p-2 text-gray-400 hover:text-blue-500" title="Sửa"><Pencil size={16} /></button>
                <button onClick={() => handleDelete(s)} className="p-2 text-gray-400 hover:text-red-500" title="Xóa"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="text-body-lg font-bold text-gray-800">{form.id ? 'Sửa nguồn' : 'Thêm nguồn'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">Tên hiển thị *</label>
                  <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="VD: MKV-Cai Lậy" className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:border-blue-500 focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">Nhà cung cấp *</label>
                  <SmartSearchSelect options={suppliers} value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} placeholder="-- Chọn NCC --" searchPlaceholder="Tìm NCC…" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-body-md font-semibold text-gray-700">ID thư mục Google Drive *</label>
                <input value={form.drive_folder_id} onChange={(e) => setForm({ ...form, drive_folder_id: e.target.value })} placeholder="VD: 1MTBChqIF0-uABQQoypqZ4GiHEvo-RyAb" className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md font-mono focus:border-blue-500 focus:outline-none" />
                <p className="text-tiny text-gray-400">Lấy từ URL thư mục Drive: drive.google.com/drive/folders/<b>&lt;ID&gt;</b>. Nhớ chia sẻ thư mục cho service account (quyền Editor) — nếu không, danh sách file sẽ trống.</p>
                {saEmail && (
                  <div className="flex items-center gap-2 mt-1 px-2 py-1.5 bg-blue-25 border border-blue-100 rounded-lg">
                    <span className="text-tiny text-gray-500 shrink-0">Chia sẻ cho:</span>
                    <code className="text-tiny font-mono text-blue-700 break-all flex-1">{saEmail}</code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard?.writeText(saEmail); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                      className="text-blue-500 hover:text-blue-700 shrink-0"
                      title="Sao chép email"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">Kho mặc định</label>
                  <select value={form.default_warehouse_id} onChange={(e) => setForm({ ...form, default_warehouse_id: e.target.value })} className="w-full h-10 px-2 border border-gray-100 rounded-lg text-body-md bg-white">
                    <option value="">—</option>
                    {warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">Dòng header</label>
                  <input type="number" value={form.header_row} onChange={(e) => setForm({ ...form, header_row: Number(e.target.value) })} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md" />
                </div>
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">Dòng dữ liệu</label>
                  <input type="number" value={form.data_start_row} onChange={(e) => setForm({ ...form, data_start_row: Number(e.target.value) })} className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md" />
                </div>
                <div className="space-y-1">
                  <label className="text-body-md font-semibold text-gray-700">VAT mặc định</label>
                  <select value={form.vat_default} onChange={(e) => setForm({ ...form, vat_default: e.target.value as any })} className="w-full h-10 px-2 border border-gray-100 rounded-lg text-body-md bg-white">
                    <option value="none">Không</option><option value="5">5%</option><option value="10">10%</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-body-md font-semibold text-gray-700">Ánh xạ cột (chữ cột Sheet, vd B, J)</label>
                <p className="text-tiny text-gray-400 mb-2">Tên SP và Giá nhập bắt buộc. Để trống các cột không dùng.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {COLUMN_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <label className="text-tiny text-gray-500">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
                      <input
                        value={(form.column_map[f.key] as string) || ''}
                        onChange={(e) => setCol(f.key, e.target.value)}
                        placeholder="—"
                        maxLength={3}
                        className="w-full h-9 px-2 border border-gray-100 rounded-lg text-body-md text-center font-mono uppercase focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-body-md text-gray-700">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                Kích hoạt nguồn này
              </label>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={() => setShowModal(false)} className="h-10 px-4 border border-gray-200 rounded-lg text-body-md font-semibold text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="h-10 px-5 bg-blue-500 text-white rounded-lg text-body-md font-semibold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
                <Save size={15} /> {saving ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
