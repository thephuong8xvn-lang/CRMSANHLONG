import { useState, useEffect, useMemo } from 'react'
import { X, Phone, User, MapPin, ShieldAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SmartSearchSelect from '../../components/SmartSearchSelect'

interface AddCustomerModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newCustomerId?: string) => void
}

// Danh sách dữ liệu tỉnh thành - quận huyện mẫu của các tỉnh trọng điểm chăn nuôi
const LOCATION_DATA: Record<string, string[]> = {
  'Đồng Nai': ['Biên Hòa', 'Long Thành', 'Trảng Bom', 'Thống Nhất', 'Xuân Lộc', 'Cẩm Mỹ', 'Định Quán', 'Tân Phú', 'Nhơn Trạch'],
  'Hà Nội': ['Ba Vì', 'Ứng Hòa', 'Mỹ Đức', 'Chương Mỹ', 'Đông Anh', 'Sóc Sơn', 'Quốc Oai', 'Mê Linh', 'Thường Tín'],
  'Tiền Giang': ['Mỹ Tho', 'Chợ Gạo', 'Cai Lậy', 'Gò Công Tây', 'Gò Công Đông', 'Cái Bè', 'Châu Thành', 'Tân Phước'],
  'Bến Tre': ['Thành phố Bến Tre', 'Ba Tri', 'Mỏ Cày Nam', 'Mỏ Cày Bắc', 'Chợ Lách', 'Châu Thành', 'Giồng Trôm', 'Thạnh Phú', 'Bình Đại'],
  'Bình Dương': ['Thủ Dầu Một', 'Dĩ An', 'Thuận An', 'Bến Cát', 'Tân Uyên', 'Bàu Bàng', 'Dầu Tiếng', 'Phú Giáo'],
  'Lâm Đồng': ['Đà Lạt', 'Bảo Lộc', 'Đức Trọng', 'Đơn Dương', 'Lâm Hà', 'Di Linh', 'Cát Tiên', 'Đạ Tẻh'],
  'Long An': ['Tân An', 'Bến Lức', 'Đức Hòa', 'Cần Đước', 'Cần Giuộc', 'Thủ Thừa', 'Châu Thành', 'Thạnh Hóa']
}

export default function AddCustomerModal({ isOpen, onClose, onSuccess }: AddCustomerModalProps) {
  // Form States
  const [farmName, setFarmName] = useState('')
  const [phone, setPhone] = useState('')
  const [contactName, setContactName] = useState('')
  const [customerType, setCustomerType] = useState('farm_household')
  const [province, setProvince] = useState('')
  const [district, setDistrict] = useState('')
  const [address, setAddress] = useState('')
  const [priceListId, setPriceListId] = useState('')
  const [creditLimit, setCreditLimit] = useState(0)
  const [ownerUserId, setOwnerUserId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [gpsLat, setGpsLat] = useState('')
  const [gpsLng, setGpsLng] = useState('')

  // Additional detail states (Business/Personal)
  const [taxCode, setTaxCode] = useState('')
  const [legalName, setLegalName] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccountNo, setBankAccountNo] = useState('')
  const [idCardNo, setIdCardNo] = useState('')

  // Lookup lists
  const [priceLists, setPriceLists] = useState<{ id: string; name: string }[]>([])
  const [salesReps, setSalesReps] = useState<{ id: string; full_name: string }[]>([])
  const [classifications, setClassifications] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const provinceOptions = useMemo(() => {
    return Object.keys(LOCATION_DATA).map(p => ({ value: p, label: p }))
  }, [])

  const districtOptions = useMemo(() => {
    if (!province) return []
    return (LOCATION_DATA[province] || []).map(d => ({ value: d, label: d }))
  }, [province])

  // Load lookup data
  useEffect(() => {
    if (!isOpen) return

    const loadLookupData = async () => {
      setLoading(true)
      try {
        // Fetch active price lists
        const { data: plist, error: plistErr } = await supabase
          .from('price_lists')
          .select('id, name')
          .eq('is_active', true)
        if (!plistErr && plist) {
          setPriceLists(plist)
          // Default to first price list if available
          if (plist.length > 0) setPriceListId(plist[0].id)
        }

        // Fetch active classifications
        const { data: ccData, error: ccErr } = await supabase
          .from('customer_classifications')
          .select('code, name')
          .eq('is_active', true)
        if (!ccErr && ccData) {
          setClassifications(ccData)
          if (ccData.length > 0) setCustomerType(ccData[0].code)
        }

        // Fetch active sales reps (profiles)
        const { data: reps, error: repsErr } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('is_active', true)
        if (!repsErr && reps) {
          setSalesReps(reps)
          // Fetch current user to default owner
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            const hasUserInReps = reps.some((r: { id: string; full_name: string }) => r.id === user.id)
            if (hasUserInReps) {
              setOwnerUserId(user.id)
            } else if (reps.length > 0) {
              setOwnerUserId(reps[0].id)
            }
          }
        }
      } catch (err) {
        console.error('Error loading lookup data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadLookupData()
  }, [isOpen])

  // Clear form
  const resetForm = () => {
    setFarmName('')
    setPhone('')
    setContactName('')
    setCustomerType('farm_household')
    setProvince('')
    setDistrict('')
    setAddress('')
    setGpsLat('')
    setGpsLng('')
    setCreditLimit(0)
    setTaxCode('')
    setLegalName('')
    setBankName('')
    setBankAccountNo('')
    setIdCardNo('')
    setErrorMsg('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!farmName.trim()) {
      setErrorMsg('Vui lòng nhập tên khách hàng/trang trại.')
      return
    }
    if (!phone.trim()) {
      setErrorMsg('Vui lòng nhập số điện thoại.')
      return
    }
    const phoneRegex = /^(\+84|0)[3-9][0-9]{8}$/
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
      setErrorMsg('Số điện thoại không hợp lệ. Vui lòng nhập đúng định dạng (VD: 0912345678 hoặc +84912345678).')
      return
    }
    if (Number(creditLimit) < 0) {
      setErrorMsg('Hạn mức công nợ không được nhỏ hơn 0.')
      return
    }
    if (!priceListId) {
      setErrorMsg('Vui lòng chọn nhóm giá áp dụng.')
      return
    }
    if (!ownerUserId) {
      setErrorMsg('Vui lòng gán nhân viên phụ trách.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      // 1. Insert into customers table
      const { data: newCust, error: custErr } = await supabase
        .from('customers')
        .insert({
          farm_name: farmName.trim(),
          customer_type: customerType,
          price_list_id: priceListId,
          credit_limit: Number(creditLimit),
          province: province || null,
          district: district || null,
          address: address.trim() || null,
          gps_lat: gpsLat ? Number(gpsLat) : null,
          gps_lng: gpsLng ? Number(gpsLng) : null,
          owner_user_id: ownerUserId,
          is_active: isActive
        })
        .select('id')
        .single()

      if (custErr) throw custErr
      if (!newCust) throw new Error('Không nhận được thông tin khách hàng mới tạo.')

      const customerId = newCust.id

      // 2. Insert into customer_contacts (Primary contact)
      const { error: contactErr } = await supabase
        .from('customer_contacts')
        .insert({
          customer_id: customerId,
          full_name: contactName.trim() || farmName.trim(),
          role_at_farm: customerType === 'farm_household' || customerType === 'farm_commercial' ? 'Chủ trại' : 'Đại diện pháp luật',
          phone: phone.trim(),
          is_primary: true,
          is_decision_maker: true
        })

      if (contactErr) console.error('Error adding primary contact:', contactErr)

      // 3. Insert Business or Personal additional info if input
      if (['dealer', 'enterprise', 'vet_clinic'].includes(customerType) && (taxCode || legalName || bankAccountNo)) {
        await supabase
          .from('customer_business_info')
          .insert({
            customer_id: customerId,
            tax_code: taxCode.trim() || null,
            legal_name: legalName.trim() || farmName.trim(),
            bank_name: bankName.trim() || null,
            bank_account_no: bankAccountNo.trim() || null,
            invoice_address: address.trim() || null
          })
      } else if (customerType === 'farm_household' && idCardNo) {
        await supabase
          .from('customer_personal_info')
          .insert({
            customer_id: customerId,
            id_card_no: idCardNo.trim() || null
          })
      }

      resetForm()
      onSuccess(customerId)
    } catch (err: any) {
      console.error('Error creating customer:', err)
      setErrorMsg(err.message || 'Có lỗi xảy ra khi tạo khách hàng.')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Province change
  const handleProvinceChange = (val: string) => {
    setProvince(val)
    setDistrict('') // Reset district when province changes
  }

  if (!isOpen) return null

  const isBusiness = ['dealer', 'enterprise', 'vet_clinic'].includes(customerType)

  return (
    <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Drawer Panel */}
      <div className="bg-gray-0 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-250">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25">
          <div>
            <h3 className="text-h2 font-semibold text-gray-700">Thêm khách hàng mới</h3>
            <p className="text-tiny text-gray-400">Tạo hồ sơ khách hàng mới và gán chính sách bán hàng</p>
          </div>
          <button
            onClick={() => { resetForm(); onClose() }}
            className="p-1 hover:bg-gray-100 rounded-full text-gray-400 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-danger-500 rounded-lg text-body-md flex items-center gap-2">
              <ShieldAlert size={16} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-gray-400">
              <div className="w-8 h-8 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin mb-2"></div>
              <span>Đang tải thông tin cấu hình...</span>
            </div>
          ) : (
            <div className="space-y-6">
              
              {/* Row 1: Tên khách hàng & SĐT */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600 flex items-center gap-1">
                    Tên trang trại / doanh nghiệp <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    placeholder="VD: Trang trại Hòa Phát, Đại lý Bình An"
                    value={farmName}
                    onChange={(e) => setFarmName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600 flex items-center gap-1">
                    Số điện thoại chính <span className="text-danger-500">*</span>
                  </label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="tel"
                      required
                      className="w-full h-10 pl-9 pr-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                      placeholder="VD: 0912345678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: Phân loại & Tên người liên hệ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Phân loại đối tác</label>
                  <select
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                  >
                    {classifications.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Họ tên người đại diện / liên hệ</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      className="w-full h-10 pl-9 pr-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                      placeholder="VD: Nguyễn Văn A (Mặc định lấy tên trại)"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Row 3: Nhóm giá & Hạn mức công nợ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600 flex items-center gap-1">
                    Nhóm giá áp dụng <span className="text-danger-500">*</span>
                  </label>
                  <select
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    value={priceListId}
                    onChange={(e) => setPriceListId(e.target.value)}
                  >
                    <option value="">-- Chọn nhóm giá --</option>
                    {priceLists.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Hạn mức công nợ (VND)</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    placeholder="VD: 50000000 (0 = Bán tiền mặt)"
                    value={creditLimit || ''}
                    onChange={(e) => setCreditLimit(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Row 4: Tỉnh thành & Quận huyện (Phụ thuộc) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Tỉnh / Thành phố</label>
                  <SmartSearchSelect
                    options={provinceOptions}
                    value={province}
                    onChange={(val) => handleProvinceChange(val)}
                    placeholder="-- Chọn tỉnh thành --"
                    searchPlaceholder="Tìm kiếm tỉnh thành..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Quận / Huyện</label>
                  <SmartSearchSelect
                    options={districtOptions}
                    value={district}
                    onChange={(val) => setDistrict(val)}
                    placeholder="-- Chọn quận huyện --"
                    searchPlaceholder="Tìm kiếm quận huyện..."
                    disabled={!province}
                  />
                </div>
              </div>

              {/* Row 5: Địa chỉ cụ thể */}
              <div className="space-y-1.5">
                <label className="text-body-md font-semibold text-gray-600">Địa chỉ cụ thể</label>
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-3 text-gray-400" />
                  <textarea
                    rows={2}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    placeholder="Số nhà, thôn, đường/phố..."
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>

              {/* Row: Tọa độ GPS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Vĩ độ (GPS Latitude)</label>
                  <input
                    type="number"
                    step="any"
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    placeholder="VD: 14.3725"
                    value={gpsLat}
                    onChange={(e) => setGpsLat(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600">Kinh độ (GPS Longitude)</label>
                  <input
                    type="number"
                    step="any"
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    placeholder="VD: 108.9958"
                    value={gpsLng}
                    onChange={(e) => setGpsLng(e.target.value)}
                  />
                </div>
              </div>

              {/* Phân hệ thông tin mở rộng tùy theo phân loại khách hàng */}
              {isBusiness ? (
                <div className="pt-4 border-t border-gray-100 space-y-4">
                  <h4 className="text-body-md font-bold text-blue-700">Thông tin doanh nghiệp / hóa đơn (Tùy chọn)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-tiny font-semibold text-gray-500">Mã số thuế</label>
                      <input
                        type="text"
                        className="w-full h-9 px-3 bg-white border border-gray-100 rounded-lg text-body-md"
                        placeholder="MST doanh nghiệp"
                        value={taxCode}
                        onChange={(e) => setTaxCode(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-tiny font-semibold text-gray-500">Tên pháp nhân xuất hóa đơn</label>
                      <input
                        type="text"
                        className="w-full h-9 px-3 bg-white border border-gray-100 rounded-lg text-body-md"
                        placeholder="Tên đầy đủ công ty"
                        value={legalName}
                        onChange={(e) => setLegalName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-tiny font-semibold text-gray-500">Tên ngân hàng</label>
                      <input
                        type="text"
                        className="w-full h-9 px-3 bg-white border border-gray-100 rounded-lg text-body-md"
                        placeholder="Techcombank, Vietcombank..."
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-tiny font-semibold text-gray-500">Số tài khoản</label>
                      <input
                        type="text"
                        className="w-full h-9 px-3 bg-white border border-gray-100 rounded-lg text-body-md"
                        placeholder="Số TK ngân hàng"
                        value={bankAccountNo}
                        onChange={(e) => setBankAccountNo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pt-4 border-t border-gray-100 space-y-4">
                  <h4 className="text-body-md font-bold text-blue-700">Thông tin cá nhân chủ trại (Tùy chọn)</h4>
                  <div className="space-y-1.5 max-w-sm">
                    <label className="text-tiny font-semibold text-gray-500">Số CCCD / CMND</label>
                    <input
                      type="text"
                      className="w-full h-9 px-3 bg-white border border-gray-100 rounded-lg text-body-md"
                      placeholder="Số căn cước công dân"
                      value={idCardNo}
                      onChange={(e) => setIdCardNo(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Row 6: Nhân viên phụ trách & Trạng thái hoạt động */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                <div className="space-y-1.5">
                  <label className="text-body-md font-semibold text-gray-600 flex items-center gap-1">
                    Nhân viên phụ trách chính <span className="text-danger-500">*</span>
                  </label>
                  <select
                    className="w-full h-10 px-3 bg-white border border-gray-100 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-body-md text-body-md"
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                  >
                    <option value="">-- Chọn nhân viên --</option>
                    {salesReps.map(r => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-25 rounded-lg border border-gray-100 h-10 self-end">
                  <span className="text-body-md font-semibold text-gray-600">Kích hoạt tài khoản</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>
              </div>

            </div>
          )}
        </form>

        {/* Footer Actions */}
        <div className="p-6 bg-gray-25 border-t border-gray-100 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => { resetForm(); onClose() }}
            className="sm:order-1 flex-1 h-12 px-6 border border-gray-100 text-gray-500 font-semibold rounded-xl hover:bg-gray-50 transition-all"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            disabled={submitting}
            onClick={handleSubmit}
            className="sm:order-2 flex-[2] h-12 px-6 bg-blue-500 text-gray-0 font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Đang xử lý...
              </>
            ) : (
              'Lưu khách hàng'
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
