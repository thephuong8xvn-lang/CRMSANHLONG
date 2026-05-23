import React, { useState, useEffect } from 'react'
import { X, Upload, CheckCircle, AlertTriangle, Download, RefreshCw, HelpCircle } from 'lucide-react'
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
  contactName: string
  type: string
  tier: string
  province: string
  district: string
  address: string
  creditLimit: number
  isValid: boolean
  errors: string[]
}

export default function ImportCustomersModal({
  isOpen,
  onClose,
  onSuccess,
  classifications,
  tiers,
  salesReps
}: ImportCustomersModalProps) {
  // State variables
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [defaultOwnerId, setDefaultOwnerId] = useState('')
  const [defaultBranchId, setDefaultBranchId] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ success: number; failed: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Fetch branches for defaults
  useEffect(() => {
    if (!isOpen) return

    const loadBranches = async () => {
      try {
        const { data } = await supabase
          .from('branches')
          .select('id, name')
          .eq('is_active', true)
        if (data) {
          setBranches(data)
          if (data.length > 0) setDefaultBranchId(data[0].id)
        }
      } catch (err) {
        console.error('Error fetching branches:', err)
      }
    }

    loadBranches()

    // Pre-populate default owner
    if (salesReps.length > 0) {
      setDefaultOwnerId(salesReps[0].id)
    }

    // Reset state
    setFile(null)
    setParsedRows([])
    setImportSummary(null)
    setErrorMsg('')
  }, [isOpen, salesReps])

  if (!isOpen) return null

  // Function to download CSV Template
  const handleDownloadTemplate = () => {
    const headers = [
      'Tên trang trại/Doanh nghiệp (Bắt buộc)',
      'Số điện thoại (Bắt buộc)',
      'Người đại diện/liên hệ',
      'Phân loại (Mã hoặc Tên)',
      'Hạng khách hàng (Mã hoặc Tên)',
      'Tỉnh/Thành phố',
      'Quận/Huyện',
      'Địa chỉ',
      'Hạn mức công nợ'
    ]

    const samples = [
      [
        'Trang trại heo Bình Minh',
        '0912345678',
        'Nguyễn Văn A',
        'farm_household',
        'normal',
        'Đồng Nai',
        'Trảng Bom',
        'Ấp 3 xã Sông Trầu',
        '50000000'
      ],
      [
        'Đại lý thuốc thú y Kim Anh',
        '0987654321',
        'Trần Thị Kim Anh',
        'Đại lý',
        'VIP',
        'Tiền Giang',
        'Cai Lậy',
        '12 Hùng Vương',
        '100000000'
      ]
    ]

    // Create CSV content with UTF-8 BOM
    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...samples.map(row => row.map(v => `"${v}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', 'template_import_khach_hang.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle file select and parse CSV
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
          const rawData = results.data as any[]
          if (rawData.length === 0) {
            setErrorMsg('Tệp CSV trống hoặc không đúng định dạng.')
            return
          }

          const processed: ParsedRow[] = rawData.map((row, index) => {
            const errors: string[] = []
            
            // Normalize keys by removing accents, spaces, and converting to lowercase
            const findValue = (keys: string[]) => {
              const matchedKey = Object.keys(row).find(k => 
                keys.some(key => k.trim().toLowerCase().includes(key))
              )
              return matchedKey ? String(row[matchedKey]).trim() : ''
            }

            const farmName = findValue(['ten trang trai', 'ten doanh nghiep', 'ten khach hang', 'farm', 'name', 'tên'])
            const phone = findValue(['so dien thoai', 'sdt', 'phone', 'điện thoại'])
            const contactName = findValue(['nguoi dai dien', 'nguoi lien he', 'contact', 'đại diện', 'liên hệ'])
            const rawType = findValue(['phan loai', 'type', 'loại'])
            const rawTier = findValue(['hang khach hang', 'tier', 'hạng'])
            const province = findValue(['tinh', 'thanh pho', 'province'])
            const district = findValue(['quan', 'huyen', 'district'])
            const address = findValue(['dia chi', 'address'])
            const rawLimit = findValue(['han muc', 'credit', 'nợ'])

            // 1. Validation
            if (!farmName) {
              errors.push(`Dòng ${index + 1}: Thiếu Tên trang trại/Doanh nghiệp.`)
            }
            if (!phone) {
              errors.push(`Dòng ${index + 1}: Thiếu Số điện thoại liên hệ chính.`)
            }

            // 2. Resolve Classification
            let type = 'farm_household' // Default fallback
            if (rawType) {
              const matchedClass = classifications.find(c => 
                c.code.toLowerCase() === rawType.toLowerCase() || 
                c.name.toLowerCase() === rawType.toLowerCase()
              )
              if (matchedClass) {
                type = matchedClass.code
              }
            }

            // 3. Resolve Tier
            let tier = 'normal' // Default fallback
            if (rawTier) {
              const matchedTier = tiers.find(t => 
                t.code.toLowerCase() === rawTier.toLowerCase() || 
                t.name.toLowerCase() === rawTier.toLowerCase()
              )
              if (matchedTier) {
                tier = matchedTier.code
              }
            }

            // 4. Resolve Credit Limit
            let creditLimit = 0
            if (rawLimit) {
              const parsedNum = Number(rawLimit.replace(/[^0-9.-]+/g, ''))
              if (!isNaN(parsedNum)) {
                creditLimit = parsedNum
              } else {
                errors.push(`Dòng ${index + 1}: Hạn mức nợ "${rawLimit}" không phải là số hợp lệ.`)
              }
            }

            return {
              farmName,
              phone,
              contactName: contactName || farmName,
              type,
              tier,
              province,
              district,
              address,
              creditLimit,
              isValid: errors.length === 0,
              errors
            }
          })

          setParsedRows(processed)
        } catch (err: any) {
          console.error(err)
          setErrorMsg('Lỗi xử lý file CSV: ' + err.message)
        }
      },
      error: (error) => {
        setLoading(false)
        setErrorMsg('Lỗi đọc file: ' + error.message)
      }
    })
  }

  // Submit and Save Valid Customers to Database
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
      // Fetch default price list to associate if needed
      let defaultPriceListId: string | null = null
      const { data: defaultPlist } = await supabase
        .from('price_lists')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single()
      if (defaultPlist) defaultPriceListId = defaultPlist.id

      // To optimize performance, we bulk insert the customers.
      // Since code is auto-generated by the trigger, we don't supply it.
      // Branch and Team are filled from owner_user_id by trigger public.fn_fill_org_from_owner.
      const customersToInsert = validRows.map(row => ({
        farm_name: row.farmName,
        customer_type: row.type,
        value_tier: row.tier,
        province: row.province || null,
        district: row.district || null,
        address: row.address || null,
        credit_limit: row.creditLimit,
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
      const contactsToInsert = insertedCustomers.map((cust, idx) => {
        const row = validRows[idx]
        return {
          customer_id: cust.id,
          full_name: row.contactName || cust.farm_name,
          role_at_farm: ['dealer', 'enterprise', 'vet_clinic'].includes(row.type) ? 'Người đại diện' : 'Chủ trại',
          phone: row.phone,
          is_primary: true,
          is_decision_maker: true
        }
      })

      const { error: contactErr } = await supabase
        .from('customer_contacts')
        .insert(contactsToInsert)

      if (contactErr) {
        console.error('Warning: failed to import contacts:', contactErr)
      }

      successCount = validRows.length
      failedCount = parsedRows.length - validRows.length
      setImportSummary({ success: successCount, failed: failedCount })
    } catch (err: any) {
      console.error(err)
      setErrorMsg('Lỗi nhập dữ liệu: ' + err.message)
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
            <p className="text-tiny text-gray-400">Tải tệp CSV/Excel chứa danh sách trang trại của bạn</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-650 transition-colors p-1 rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
            /* Success Summary View */
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
                  onClick={() => {
                    onSuccess()
                    onClose()
                  }}
                  className="px-6 h-11 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg active:scale-95 transition-all shadow-md"
                >
                  Xác nhận &amp; Đóng
                </button>
              </div>
            </div>
          ) : (
            /* Upload and Preview Form */
            <div className="space-y-6">
              {/* File upload drag drop zone */}
              {!file ? (
                <div className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl p-10 text-center transition-all bg-gray-25/50 relative">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Upload size={36} className="text-gray-400 mx-auto mb-3" />
                  <p className="font-bold text-body-lg text-gray-700">Kéo thả hoặc nhấn để tải tệp CSV lên</p>
                  <p className="text-tiny text-gray-450 mt-1">Hỗ trợ tệp định dạng CSV (.csv) mã hóa UTF-8</p>
                  
                  <button
                    onClick={handleDownloadTemplate}
                    type="button"
                    className="mt-5 inline-flex items-center gap-2 text-blue-500 hover:text-blue-600 font-semibold text-body-md px-4 py-2 bg-blue-50/50 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Download size={14} />
                    Tải file mẫu template (Excel/CSV)
                  </button>
                </div>
              ) : (
                /* File selected, show details and filters */
                <div className="space-y-6">
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
                      onClick={() => setFile(null)}
                      className="text-danger-500 hover:bg-red-50 px-3 py-1.5 rounded-lg text-body-md font-semibold transition-all"
                    >
                      Chọn file khác
                    </button>
                  </div>

                  {/* Defaults configuration */}
                  <div className="bg-white p-5 rounded-lg border border-gray-100 shadow-sm space-y-4">
                    <h4 className="text-body-md font-bold text-gray-700 flex items-center gap-1.5">
                      <HelpCircle size={16} className="text-blue-500" />
                      Cài đặt gán mặc định (Áp dụng nếu tệp CSV không khai báo)
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

                  {/* Import summary statistics */}
                  <div className="flex gap-4">
                    <div className="bg-emerald-50/50 border border-emerald-100 px-4 py-2.5 rounded-lg text-emerald-700 text-body-md">
                      Hợp lệ: <span className="font-bold">{validCount}</span> dòng
                    </div>
                    {invalidCount > 0 && (
                      <div className="bg-red-50/50 border border-red-100 px-4 py-2.5 rounded-lg text-red-600 text-body-md">
                        Lỗi/Cảnh báo: <span className="font-bold">{invalidCount}</span> dòng
                      </div>
                    )}
                  </div>

                  {/* Data Preview Table */}
                  <div className="border border-gray-100 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-body-md">
                      <thead>
                        <tr className="bg-gray-25 border-b border-gray-100 text-gray-400 font-semibold text-tiny uppercase tracking-wider sticky top-0 z-10">
                          <th className="px-4 py-3">Tên trang trại</th>
                          <th className="px-4 py-3">Số điện thoại</th>
                          <th className="px-4 py-3">Phân loại</th>
                          <th className="px-4 py-3">Hạng</th>
                          <th className="px-4 py-3">Khu vực</th>
                          <th className="px-4 py-3">Trạng thái dòng</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-650">
                        {parsedRows.map((row, idx) => (
                          <tr key={idx} className={row.isValid ? 'hover:bg-gray-25/50' : 'bg-red-25/10 hover:bg-red-25/20'}>
                            <td className="px-4 py-3 font-semibold text-gray-700">{row.farmName || <span className="text-red-400 italic">Trống</span>}</td>
                            <td className="px-4 py-3 font-mono">{row.phone || <span className="text-red-400 italic">Trống</span>}</td>
                            <td className="px-4 py-3">{row.type}</td>
                            <td className="px-4 py-3 uppercase">{row.tier}</td>
                            <td className="px-4 py-3 text-tiny">
                              {[row.district, row.province].filter(Boolean).join(', ') || '---'}
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
