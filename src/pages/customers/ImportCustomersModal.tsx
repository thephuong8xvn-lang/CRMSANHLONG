import React, { useState, useEffect } from 'react'
import { X, Upload, CheckCircle, AlertTriangle, Download, RefreshCw, HelpCircle, FileText } from 'lucide-react'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabase'

interface ImportCustomersModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  classifications: { code: string; name: string; is_active: boolean }[]
  tiers: { code: string; name: string; is_active: boolean }[]
  salesReps: { id: string; full_name: string }[]
}

interface ParsedRow {
  farmName: string
  phone: string
  isValid: boolean
  errors: string[]
}

// Normalize Vietnamese text to plain lowercase ASCII for column matching
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Column key aliases – covers KiotViet, Excel, custom CSV exports
const NAME_KEYS = [
  'ten khach hang', 'ten hang', 'ten', 'name', 'farmname', 'farm name',
  'ho ten', 'customer name', 'ten trang trai', 'ten co so', 'ten doanh nghiep',
  'ten cong ty', 'khach hang', 'tên khách hàng', 'tên hàng', 'tên',
  'ho va ten', 'full name', 'fullname', 'label', 'chu trai'
]
const PHONE_KEYS = [
  'so dien thoai', 'dien thoai', 'sdt', 'phone', 'mobile', 'di dong',
  'tel', 'telephone', 'so dt', 'so dien thoai chinh', 'phone number',
  'so phone', 'so mobile', 'điện thoại', 'số điện thoại'
]

export default function ImportCustomersModal({
  isOpen,
  onClose,
  onSuccess,
  salesReps
}: ImportCustomersModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [defaultOwnerId, setDefaultOwnerId] = useState('')
  const [defaultBranchId, setDefaultBranchId] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ success: number; failed: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [columnWarning, setColumnWarning] = useState('')

  useEffect(() => {
    if (!isOpen) return
    const loadBranches = async () => {
      try {
        const { data } = await supabase.from('branches').select('id, name').eq('is_active', true)
        if (data) {
          setBranches(data)
          if (data.length > 0) setDefaultBranchId(data[0].id)
        }
      } catch (err) {
        console.error('Error fetching branches:', err)
      }
    }
    loadBranches()
    if (salesReps.length > 0) setDefaultOwnerId(salesReps[0].id)
    setFile(null)
    setParsedRows([])
    setImportSummary(null)
    setErrorMsg('')
    setColumnWarning('')
  }, [isOpen, salesReps])

  if (!isOpen) return null

  // Generate and download template as Blob – no static file needed
  const handleDownloadTemplate = () => {
    const rows = [
      ['Tên khách hàng (Bắt buộc)', 'Số điện thoại'],
      ['Trang trại heo Bình Minh', '0912345678'],
      ['Đại lý thuốc thú y Kim Anh', '0987654321'],
      ['Hộ chăn nuôi Văn Tám', ''],
    ]
    const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'template_import_khach_hang.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const findValue = (row: Record<string, string>, keys: string[]): string => {
    const rowKeys = Object.keys(row)
    const matched = rowKeys.find(k => keys.some(key => normalize(k).includes(key) || key.includes(normalize(k))))
    return matched ? String(row[matched] ?? '').trim() : ''
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return
    setFile(selectedFile)
    setParsedRows([])
    setImportSummary(null)
    setErrorMsg('')
    setColumnWarning('')
    setLoading(true)

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        setLoading(false)
        try {
          const rawData = results.data as Record<string, string>[]
          if (rawData.length === 0) {
            setErrorMsg('Tệp CSV trống hoặc không đúng định dạng.')
            return
          }

          // Detect if phone column is present
          const firstRowKeys = Object.keys(rawData[0])
          const hasPhoneCol = firstRowKeys.some(k => PHONE_KEYS.some(key => normalize(k).includes(key) || key.includes(normalize(k))))
          if (!hasPhoneCol) {
            setColumnWarning('Không tìm thấy cột số điện thoại trong file. Hệ thống sẽ nhập tên khách hàng và để trống số điện thoại.')
          }

          const processed: ParsedRow[] = rawData.map((row, index) => {
            const errors: string[] = []
            const farmName = findValue(row, NAME_KEYS)
            const phone = findValue(row, PHONE_KEYS)

            if (!farmName) {
              errors.push(`Dòng ${index + 1}: Thiếu Tên khách hàng.`)
            }

            return {
              farmName,
              phone,
              isValid: errors.length === 0,
              errors
            }
          })

          setParsedRows(processed)
        } catch (err: unknown) {
          console.error(err)
          setErrorMsg('Lỗi xử lý file CSV: ' + (err instanceof Error ? err.message : String(err)))
        }
      },
      error: (error) => {
        setLoading(false)
        setErrorMsg('Lỗi đọc file: ' + error.message)
      }
    })
  }

  const handleImportSubmit = async () => {
    const validRows = parsedRows.filter(r => r.isValid)
    if (validRows.length === 0) {
      setErrorMsg('Không có dòng dữ liệu hợp lệ nào để nhập.')
      return
    }
    if (!defaultOwnerId) {
      setErrorMsg('Vui lòng chọn nhân viên phụ trách mặc định.')
      return
    }

    setImporting(true)
    setErrorMsg('')
    let successCount = 0
    let failedCount = 0

    try {
      let defaultPriceListId: string | null = null
      const { data: defaultPlist } = await supabase
        .from('price_lists')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single()
      if (defaultPlist) defaultPriceListId = defaultPlist.id

      // Bulk insert customers
      const customersToInsert = validRows.map(row => ({
        farm_name: row.farmName,
        customer_type: 'farm_household',
        value_tier: 'normal',
        credit_limit: 0,
        price_list_id: defaultPriceListId,
        owner_user_id: defaultOwnerId,
        branch_id: defaultBranchId || null,
        is_active: true
      }))

      const { data: insertedCustomers, error: custErr } = await supabase
        .from('customers')
        .insert(customersToInsert)
        .select('id, farm_name')

      if (custErr) throw custErr
      if (!insertedCustomers || insertedCustomers.length === 0) {
        throw new Error('Lỗi lưu danh sách khách hàng.')
      }

      // Build contacts bulk list
      const contactsToInsert = insertedCustomers.map((cust: { id: string; farm_name: string }, idx: number) => {
        const row = validRows[idx]
        return {
          customer_id: cust.id,
          full_name: cust.farm_name,
          role_at_farm: 'Chủ trại',
          phone: row.phone || null,
          is_primary: true,
          is_decision_maker: true
        }
      })

      const { error: contactErr } = await supabase
        .from('customer_contacts')
        .insert(contactsToInsert)

      if (contactErr) {
        console.warn('Warning: failed to import contacts:', contactErr)
      }

      successCount = validRows.length
      failedCount = parsedRows.length - validRows.length
      setImportSummary({ success: successCount, failed: failedCount })
    } catch (err: unknown) {
      console.error(err)
      setErrorMsg('Lỗi nhập dữ liệu: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setImporting(false)
    }
  }

  const validCount = parsedRows.filter(r => r.isValid).length
  const invalidCount = parsedRows.filter(r => !r.isValid).length

  return (
    <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
          <div>
            <h3 className="text-body-lg font-bold text-gray-800">Nhập danh sách khách hàng</h3>
            <p className="text-tiny text-gray-400">Hỗ trợ file CSV từ KiotViet, Excel hoặc file tự tạo. Chỉ cần cột Tên khách hàng.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-650 transition-colors p-1 rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200 text-danger-500 rounded-lg text-body-md flex items-start gap-2.5">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Đã xảy ra lỗi</p>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {columnWarning && !errorMsg && (
            <div className="p-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-body-md flex items-start gap-2.5">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
              <p>{columnWarning}</p>
            </div>
          )}

          {importSummary ? (
            <div className="py-8 text-center max-w-md mx-auto space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle size={36} />
              </div>
              <div>
                <h4 className="text-h2 font-bold text-gray-800">Nhập dữ liệu hoàn tất!</h4>
                <p className="text-body-md text-gray-500 mt-2">
                  Đã nhập thành công <span className="font-bold text-emerald-600">{importSummary.success}</span> khách hàng mới vào hệ thống.
                  {importSummary.failed > 0 && (
                    <> Bỏ qua <span className="font-bold text-red-500">{importSummary.failed}</span> dòng lỗi.</>
                  )}
                </p>
              </div>
              <div className="pt-4 flex justify-center gap-3">
                <button
                  onClick={() => { onSuccess(); onClose() }}
                  className="px-6 h-11 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md"
                >
                  Xác nhận &amp; Đóng
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {!file ? (
                <div className="space-y-4">
                  {/* How-to hint */}
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-body-md text-blue-700 space-y-1.5">
                    <p className="font-bold flex items-center gap-1.5"><FileText size={15} /> Hướng dẫn nhập từ KiotViet / Excel</p>
                    <ul className="list-disc list-inside text-tiny space-y-1 text-blue-600">
                      <li>Xuất file danh sách khách hàng từ KiotViet ra định dạng <strong>CSV</strong></li>
                      <li>Hệ thống tự động nhận dạng cột <strong>Tên khách hàng</strong> và <strong>Số điện thoại</strong></li>
                      <li>Các cột khác (địa chỉ, phân loại…) sẽ được bỏ qua, không gây lỗi</li>
                      <li>Chỉ cần cột Tên là bắt buộc – Số điện thoại có thể để trống</li>
                    </ul>
                  </div>

                  {/* Drag-drop zone */}
                  <div className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl p-10 text-center transition-all bg-gray-25/50 relative">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload size={36} className="text-gray-400 mx-auto mb-3" />
                    <p className="font-bold text-body-lg text-gray-700">Kéo thả hoặc nhấn để tải tệp CSV lên</p>
                    <p className="text-tiny text-gray-450 mt-1">Hỗ trợ tệp định dạng CSV (.csv) – UTF-8 hoặc ANSI</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadTemplate() }}
                      type="button"
                      className="mt-5 inline-flex items-center gap-2 text-blue-500 hover:text-blue-600 font-semibold text-body-md px-4 py-2 bg-blue-50/50 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Download size={14} />
                      Tải file mẫu (CSV)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* File info card */}
                  <div className="bg-gray-25 border border-gray-100 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 text-blue-500 rounded font-mono font-bold text-tiny uppercase">CSV</div>
                      <div>
                        <p className="font-bold text-gray-700">{file.name}</p>
                        <p className="text-tiny text-gray-400">{(file.size / 1024).toFixed(1)} KB • {parsedRows.length} dòng dữ liệu</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setFile(null); setColumnWarning('') }}
                      className="text-danger-500 hover:bg-red-50 px-3 py-1.5 rounded-lg text-body-md font-semibold transition-all"
                    >
                      Chọn file khác
                    </button>
                  </div>

                  {/* Default owner/branch config */}
                  <div className="bg-white p-5 rounded-lg border border-gray-100 shadow-sm space-y-4">
                    <h4 className="text-body-md font-bold text-gray-700 flex items-center gap-1.5">
                      <HelpCircle size={16} className="text-blue-500" />
                      Cài đặt gán mặc định
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="block text-body-md font-semibold text-gray-600">Nhân viên phụ trách mặc định</label>
                        <select
                          value={defaultOwnerId}
                          onChange={(e) => setDefaultOwnerId(e.target.value)}
                          className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                        >
                          {salesReps.map(r => (
                            <option key={r.id} value={r.id}>{r.full_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-body-md font-semibold text-gray-600">Chi nhánh mặc định</label>
                        <select
                          value={defaultBranchId}
                          onChange={(e) => setDefaultBranchId(e.target.value)}
                          className="w-full h-10 px-3 border border-gray-100 rounded-lg text-body-md focus:outline-none focus:border-blue-500 bg-white"
                        >
                          {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-4">
                    <div className="bg-emerald-50/50 border border-emerald-100 px-4 py-2.5 rounded-lg text-emerald-700 text-body-md">
                      Hợp lệ: <span className="font-bold">{validCount}</span> dòng
                    </div>
                    {invalidCount > 0 && (
                      <div className="bg-red-50/50 border border-red-100 px-4 py-2.5 rounded-lg text-red-600 text-body-md">
                        Bỏ qua: <span className="font-bold">{invalidCount}</span> dòng (thiếu tên)
                      </div>
                    )}
                  </div>

                  {/* Preview Table */}
                  <div className="border border-gray-100 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-body-md">
                      <thead>
                        <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider sticky top-0 z-10">
                          <th className="px-4 py-3 w-8">#</th>
                          <th className="px-4 py-3">Tên khách hàng</th>
                          <th className="px-4 py-3">Số điện thoại</th>
                          <th className="px-4 py-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-650">
                        {parsedRows.map((row, idx) => (
                          <tr key={idx} className={row.isValid ? 'hover:bg-gray-25/50' : 'bg-red-25/10 hover:bg-red-25/20'}>
                            <td className="px-4 py-3 text-gray-400 text-tiny">{idx + 1}</td>
                            <td className="px-4 py-3 font-semibold text-gray-700">
                              {row.farmName || <span className="text-red-400 italic">Trống</span>}
                            </td>
                            <td className="px-4 py-3 font-mono text-gray-500">
                              {row.phone || <span className="text-gray-300 italic">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {row.isValid ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-tiny">
                                  <CheckCircle size={12} /> Hợp lệ
                                </span>
                              ) : (
                                <div className="text-red-500 text-tiny font-semibold space-y-0.5">
                                  {row.errors.map((err, eIdx) => (
                                    <p key={eIdx}>{err}</p>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-25">
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="px-5 h-10 border border-gray-150 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
          >
            Đóng lại
          </button>
          {file && !importSummary && (
            <button
              onClick={handleImportSubmit}
              disabled={importing || loading || validCount === 0}
              className="px-6 h-10 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {importing ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  Đang nhập ({validCount} dòng)...
                </>
              ) : (
                <>Nhập {validCount} khách hàng hợp lệ</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
