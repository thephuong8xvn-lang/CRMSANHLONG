import React, { useState, useEffect } from 'react'
import { X, Upload, CheckCircle, AlertTriangle, Download, RefreshCw, FileText } from 'lucide-react'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabase'

interface ImportProductsModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ParsedProductRow {
  name: string
  isValid: boolean
  errors: string[]
}

// Normalize Vietnamese text to plain lowercase ASCII for flexible column matching
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

// Wide set of aliases covering KiotViet, sanh long exports, and generic CSV
const PRODUCT_NAME_KEYS = [
  'ten san pham', 'ten hang hoa', 'ten hang', 'ten', 'name', 'productname', 'product name',
  'ten thuoc', 'ten vaccine', 'ten vat tu', 'ma hang', 'ten sp', 'ten mat hang',
  'tên sản phẩm', 'tên hàng hóa', 'tên hàng', 'tên thuốc', 'tên',
  'mo ta', 'description', 'label', 'item name', 'itemname', 'hang hoa', 'san pham'
]

export default function ImportProductsModal({
  isOpen,
  onClose,
  onSuccess
}: ImportProductsModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ success: number; failed: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setFile(null)
    setParsedRows([])
    setImportSummary(null)
    setErrorMsg('')
  }, [isOpen])

  if (!isOpen) return null

  // Generate and download template as Blob – no static file needed
  const handleDownloadTemplate = () => {
    const rows = [
      ['Tên sản phẩm (Bắt buộc)'],
      ['Vaccine dịch tả heo Châu Phi'],
      ['Thuốc hạ sốt Para-C'],
      ['Dung dịch sát trùng chuồng trại'],
      ['Thuốc kháng sinh Tylosin 20%'],
    ]
    const csvContent = '\uFEFF' + rows.map(r => r.join(',')).join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'template_import_hang_hoa.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const findValue = (row: Record<string, string>, keys: string[]): string => {
    const rowKeys = Object.keys(row)
    const matched = rowKeys.find(k =>
      keys.some(key => normalize(k).includes(key) || key.includes(normalize(k)))
    )
    return matched ? String(row[matched] ?? '').trim() : ''
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return
    setFile(selectedFile)
    setParsedRows([])
    setImportSummary(null)
    setErrorMsg('')
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

          const processed: ParsedProductRow[] = rawData.map((row, index) => {
            const errors: string[] = []
            const name = findValue(row, PRODUCT_NAME_KEYS)

            if (!name) {
              errors.push(`Dòng ${index + 1}: Thiếu Tên sản phẩm.`)
            }

            return {
              name,
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

    setImporting(true)
    setErrorMsg('')

    try {
      // Fetch price lists, categories, brands for defaults
      const [{ data: priceLists }, { data: categories }, { data: brands }] = await Promise.all([
        supabase.from('price_lists').select('id, code').eq('is_active', true),
        supabase.from('product_categories').select('id').eq('is_active', true).limit(1),
        supabase.from('brands').select('id').eq('is_active', true).limit(1)
      ])

      const defaultCategoryId = categories && categories.length > 0 ? categories[0].id : null
      const defaultBrandId = brands && brands.length > 0 ? brands[0].id : null

      let successCount = 0
      let failedCount = 0

      for (const row of validRows) {
        // Generate unique SKU
        const uniqueSku = `SP-${Date.now().toString().slice(-7)}-${Math.floor(100 + Math.random() * 900)}`

        const { data: newProd, error: insertErr } = await supabase
          .from('products')
          .insert({
            sku: uniqueSku,
            name: row.name,
            unit: 'lọ',
            category_id: defaultCategoryId,
            brand_id: defaultBrandId,
            is_lot_managed: false,
            is_active: true,
            image_urls: []
          })
          .select('id')
          .single()

        if (insertErr) {
          console.error('Error inserting product:', insertErr)
          failedCount++
          continue
        }

        if (newProd && priceLists && priceLists.length > 0) {
          const priceItems = priceLists.map((list: { id: string; code: string }) => ({
            price_list_id: list.id,
            product_id: newProd.id,
            cost_price: 0,
            selling_price: 0,
            min_quantity: 1
          }))

          const { error: priceErr } = await supabase
            .from('price_list_items')
            .insert(priceItems)

          if (priceErr) {
            console.warn('Error inserting default prices:', priceErr)
          }
        }
        successCount++
      }

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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-25">
          <div>
            <h3 className="text-body-lg font-bold text-gray-800">Nhập danh sách hàng hóa</h3>
            <p className="text-tiny text-gray-400">Hỗ trợ CSV từ KiotViet, Excel hoặc file tự tạo. Chỉ cần cột Tên sản phẩm.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100">
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

          {importSummary ? (
            <div className="py-8 text-center max-w-md mx-auto space-y-5">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle size={36} />
              </div>
              <div>
                <h4 className="text-h2 font-bold text-gray-800">Nhập dữ liệu hoàn tất!</h4>
                <p className="text-body-md text-gray-500 mt-2">
                  Đã nhập thành công <span className="font-bold text-emerald-600">{importSummary.success}</span> sản phẩm mới.
                  {importSummary.failed > 0 && (
                    <> Thất bại <span className="font-bold text-red-500">{importSummary.failed}</span> dòng.</>
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
                      <li>Xuất file danh sách hàng hóa từ KiotViet ra định dạng <strong>CSV</strong></li>
                      <li>Hệ thống tự nhận dạng cột <strong>Tên sản phẩm</strong> / <strong>Tên hàng hóa</strong> / <strong>Tên</strong></li>
                      <li>Các cột khác (giá, mã, tồn kho…) sẽ được bỏ qua, không gây lỗi</li>
                      <li>Mỗi sản phẩm được tạo với giá mặc định 0 và mã SKU tự động – có thể chỉnh sửa sau</li>
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
                  {/* File info */}
                  <div className="bg-gray-25 border border-gray-100 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 text-blue-500 rounded font-mono font-bold text-tiny uppercase">CSV</div>
                      <div>
                        <p className="font-bold text-gray-700">{file.name}</p>
                        <p className="text-tiny text-gray-400">{(file.size / 1024).toFixed(1)} KB • {parsedRows.length} dòng dữ liệu</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="text-danger-500 hover:bg-red-50 px-3 py-1.5 rounded-lg text-body-md font-semibold transition-all"
                    >
                      Chọn file khác
                    </button>
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
                          <th className="px-4 py-3">Tên sản phẩm</th>
                          <th className="px-4 py-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-650">
                        {parsedRows.map((row, idx) => (
                          <tr key={idx} className={row.isValid ? 'hover:bg-gray-25/50' : 'bg-red-25/10 hover:bg-red-25/20'}>
                            <td className="px-4 py-3 text-gray-400 text-tiny">{idx + 1}</td>
                            <td className="px-4 py-3 font-semibold text-gray-700">
                              {row.name || <span className="text-red-400 italic">Trống</span>}
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
            className="px-5 h-10 border border-gray-100 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
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
                <>Nhập {validCount} sản phẩm hợp lệ</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
