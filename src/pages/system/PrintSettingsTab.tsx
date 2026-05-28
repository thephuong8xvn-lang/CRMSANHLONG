import React, { useState, useEffect } from 'react'
import {
  Printer,
  Save,
  RefreshCw,
  Building2,
  Phone,
  Mail,
  Globe,
  FileText,
  Image,
  LayoutTemplate
} from 'lucide-react'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'

export default function PrintSettingsTab() {
  const { settings, updateSettings, loading } = useDisplaySettings()

  const [companyName, setCompanyName] = useState(settings.print_company_name)
  const [address, setAddress] = useState(settings.print_company_address)
  const [phone, setPhone] = useState(settings.print_company_phone)
  const [email, setEmail] = useState(settings.print_company_email)
  const [mst, setMst] = useState(settings.print_company_mst)
  const [website, setWebsite] = useState(settings.print_company_website)
  const [logoUrl, setLogoUrl] = useState(settings.print_company_logo_url || '')
  const [defaultPaper, setDefaultPaper] = useState<'A4' | 'A5'>(settings.print_default_paper)
  const [defaultOrientation, setDefaultOrientation] = useState<'portrait' | 'landscape'>(settings.print_default_orientation)

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setCompanyName(settings.print_company_name)
    setAddress(settings.print_company_address)
    setPhone(settings.print_company_phone)
    setEmail(settings.print_company_email)
    setMst(settings.print_company_mst)
    setWebsite(settings.print_company_website)
    setLogoUrl(settings.print_company_logo_url || '')
    setDefaultPaper(settings.print_default_paper)
    setDefaultOrientation(settings.print_default_orientation)
  }, [settings])

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({
        print_company_name: companyName.trim(),
        print_company_address: address.trim(),
        print_company_phone: phone.trim(),
        print_company_email: email.trim(),
        print_company_mst: mst.trim(),
        print_company_website: website.trim(),
        print_company_logo_url: logoUrl.trim() || null,
        print_default_paper: defaultPaper,
        print_default_orientation: defaultOrientation,
      })
      showToast('success', 'Lưu cấu hình in ấn thành công!')
    } catch (err: any) {
      showToast('error', 'Lỗi lưu cấu hình: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center gap-3 text-gray-400">
        <RefreshCw className="animate-spin" size={20} />
        <span>Đang tải cấu hình in ấn...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-body-md font-medium animate-in fade-in slide-in-from-top-4 duration-300 ${
          toast.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-red-50 text-red-800 border-red-200'
        }`}>
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Company Info */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-blue-500" />
              <h3 className="text-body-md font-bold text-gray-800">Thông tin công ty trên chứng từ</h3>
            </div>

            <div className="space-y-1.5">
              <label className="block text-body-md font-semibold text-gray-700">
                Tên công ty <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                placeholder="CÔNG TY VẬT TƯ THUỐC THÚ Y SANH LONG"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-body-md font-semibold text-gray-700">Địa chỉ công ty</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                placeholder="Số nhà, tên đường, phường/xã, tỉnh/thành..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">
                  <Phone size={12} className="inline mr-1.5 text-gray-400" />
                  Số điện thoại
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  placeholder="0945.195.156 - 1900 6789"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">
                  <Mail size={12} className="inline mr-1.5 text-gray-400" />
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  placeholder="lienhe@sanhlongvetco.vn"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">
                  <FileText size={12} className="inline mr-1.5 text-gray-400" />
                  Mã số thuế (MST)
                </label>
                <input
                  type="text"
                  value={mst}
                  onChange={e => setMst(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md font-mono focus:outline-none focus:border-blue-500"
                  placeholder="4101672005"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-body-md font-semibold text-gray-700">
                  <Globe size={12} className="inline mr-1.5 text-gray-400" />
                  Website
                </label>
                <input
                  type="text"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                  placeholder="www.sanhlongvetco.vn"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-body-md font-semibold text-gray-700">
                <Image size={12} className="inline mr-1.5 text-gray-400" />
                URL Logo công ty <span className="text-gray-400 font-normal">(tuỳ chọn)</span>
              </label>
              <input
                type="url"
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-body-md focus:outline-none focus:border-blue-500"
                placeholder="https://... (để trống = dùng ô chữ SL)"
              />
              <p className="text-[11px] text-gray-400">
                Nếu để trống, header chứng từ sẽ hiển thị ô chữ "SL" màu đen thay ảnh logo.
              </p>
            </div>
          </div>

          {/* Paper & Orientation */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <LayoutTemplate size={18} className="text-blue-500" />
              <h3 className="text-body-md font-bold text-gray-800">Khổ giấy &amp; hướng in mặc định</h3>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-body-md font-semibold text-gray-700">Khổ giấy mặc định</label>
                <div className="flex gap-3">
                  {(['A4', 'A5'] as const).map(size => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setDefaultPaper(size)}
                      className={`flex-1 h-10 rounded-lg border font-bold text-body-md transition-all ${
                        defaultPaper === size
                          ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-body-md font-semibold text-gray-700">Hướng in mặc định</label>
                <div className="flex gap-3">
                  {([['portrait', 'Dọc'], ['landscape', 'Ngang']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDefaultOrientation(val)}
                      className={`flex-1 h-10 rounded-lg border font-semibold text-body-md transition-all ${
                        defaultOrientation === val
                          ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="h-10 px-6 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg flex items-center gap-2 shadow-md active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? 'Đang lưu...' : 'Lưu cấu hình in ấn'}
            </button>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-gray-400" />
            <h3 className="text-body-md font-bold text-gray-700">Xem trước header chứng từ</h3>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex justify-between items-start border-b border-black pb-3 mb-3 text-black font-sans">
                <div className="flex-1 pr-3 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="w-7 h-7 rounded object-contain shrink-0" />
                    ) : (
                      <div className="w-6 h-6 bg-black text-white rounded flex items-center justify-center font-bold text-[10px] shrink-0">SL</div>
                    )}
                    <span className="font-extrabold text-[10px] leading-tight tracking-wide text-black break-words">
                      {companyName || 'Tên công ty...'}
                    </span>
                  </div>
                  <p className="text-[8px] leading-relaxed text-black">
                    <strong>Địa chỉ:</strong> {address || '-'}
                  </p>
                  <p className="text-[8px] leading-relaxed text-black">
                    <strong>ĐT:</strong> {phone || '-'}
                    {email && <> | <strong>Email:</strong> {email}</>}
                  </p>
                  {mst && (
                    <p className="text-[8px] leading-relaxed text-black">
                      <strong>MST:</strong> {mst}
                      {website && <> | {website}</>}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-[10px] font-black tracking-tight uppercase">HÓA ĐƠN</p>
                  <p className="text-[8px] text-gray-400 mt-0.5">BÁN HÀNG</p>
                </div>
              </div>
              <div className="text-[8px] text-gray-400 text-center font-medium">
                Khổ: <strong className="text-gray-600">{defaultPaper}</strong> —{' '}
                Hướng: <strong className="text-gray-600">{defaultOrientation === 'portrait' ? 'Dọc' : 'Ngang'}</strong>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Header này xuất hiện trên tất cả 6 loại chứng từ: hóa đơn, phiếu nhập, phiếu trả, phiếu chuyển kho, phiếu thu, phiếu chi.
          </p>
        </div>
      </div>
    </div>
  )
}
