import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Package,
  FileSpreadsheet,
  Settings,
  Star,
  Download,
  Upload,
  Layers,
  Award,
  Filter,
  X
} from 'lucide-react'
import Layout from '../../components/Layout'
import { ProductImage } from '../../components/ProductImage'
import { Skeleton } from '../../components/Skeleton'
import AddProductModal from './AddProductModal'
import ManageCategoriesModal from './ManageCategoriesModal'
import ManageBrandsModal from './ManageBrandsModal'
import ImportProductsModal from './ImportProductsModal'
import ManageUnitsModal from './ManageUnitsModal'
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  useProductsList,
  useProductCategories,
  useProductBrands,
  type ProductStockRow,
} from '../../hooks/queries/useProducts'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'
import { logger } from '../../lib/logger'
import { useAuth } from '../../contexts/AuthContext'

const PAGE_SIZE = 10

export default function ProductListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { formatCurrency } = useDisplaySettings()
  const { profile } = useAuth()

  // Modal Dialogs States
  const [isAddModalOpen, setIsAddModalOpen]       = useState(false)
  const [isManageCatsOpen, setIsManageCatsOpen]   = useState(false)
  const [isManageBrandsOpen, setIsManageBrandsOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isManageUnitsOpen, setIsManageUnitsOpen] = useState(false)

  // Filters State
  const [searchTerm, setSearchTerm]           = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand]     = useState('')
  const [selectedStatus, setSelectedStatus]   = useState<'active' | 'inactive' | 'all'>('active')
  const [currentPage, setCurrentPage]         = useState(1)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(searchTerm, 300)

  // Starred Products (Favorite) Local State
  const [starredProducts, setStarredProducts] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('starred-products')
    return saved ? JSON.parse(saved) : {}
  })

  // Reset page when filter changes
  useMemo(() => { setCurrentPage(1) }, [debouncedSearch, selectedCategory, selectedBrand, selectedStatus])

  // ── Server-side query qua product_stock_summary_view
  const listParams = useMemo(() => ({
    page: currentPage,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    categoryId: selectedCategory || undefined,
    brandId: selectedBrand || undefined,
    status: selectedStatus,
    branchId: profile?.branch_id || undefined,
  }), [currentPage, debouncedSearch, selectedCategory, selectedBrand, selectedStatus, profile?.branch_id])

  const productsQuery   = useProductsList(listParams)
  const categoriesQuery = useProductCategories()
  const brandsQuery     = useProductBrands()

  const rows         = productsQuery.data?.rows ?? []
  const totalItems   = productsQuery.data?.total ?? 0
  const totalStockSum   = productsQuery.data?.totalStockAll ?? 0
  const totalOrderedSum = productsQuery.data?.totalOnOrderAll ?? 0
  const loading      = productsQuery.isLoading
  const categories   = categoriesQuery.data ?? []
  const brands       = brandsQuery.data ?? []

  const totalPages       = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const indexOfFirstItem = (currentPage - 1) * PAGE_SIZE
  const indexOfLastItem  = indexOfFirstItem + PAGE_SIZE

  const handleToggleStar = (prodId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setStarredProducts(prev => {
      const next = { ...prev, [prodId]: !prev[prodId] }
      localStorage.setItem('starred-products', JSON.stringify(next))
      return next
    })
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.products.all })

  const formatDaysToOOS = (days: number | null): string => {
    if (days === null) return '---'
    if (days <= 0) return '0 ngày'
    return `${days} ngày`
  }

  const handleExportCSV = async () => {
    try {
      let q = supabase
        .from('product_stock_summary_view')
        .select('*')
        .order('created_at', { ascending: false })
      if (selectedCategory)              q = q.eq('category_id', selectedCategory)
      if (selectedBrand)                 q = q.eq('brand_id', selectedBrand)
      if (selectedStatus === 'active')   q = q.eq('is_active', true)
      if (selectedStatus === 'inactive') q = q.eq('is_active', false)
      if (debouncedSearch) {
        const term = debouncedSearch.trim().replace(/[%_]/g, '\\$&')
        q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`)
      }
      const { data, error } = await q
      if (error) throw error

      const headers = [
        'Mã SKU','Tên sản phẩm','Đơn vị tính','Nhóm sản phẩm','Thương hiệu','Quy cách',
        'Giá bán lẻ','Giá vốn','Tồn kho','Khách đặt','Trạng thái kinh doanh','Thời gian tạo'
      ]

      const exportRows = (data as ProductStockRow[] ?? []).map(prod => [
        prod.sku || '',
        prod.name,
        prod.unit || 'lọ',
        prod.category_name || '-',
        prod.brand_name || '-',
        prod.package_specs || '-',
        prod.retail_price,
        prod.retail_cost,
        prod.stock_on_hand,
        prod.on_order_qty,
        prod.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh',
        new Date(prod.created_at).toLocaleDateString('vi-VN'),
      ])

      const csvContent = '﻿' + [
        headers.join(','),
        ...exportRows.map(row =>
          row.map(val => {
            const text = String(val ?? '').replace(/"/g, '""')
            return text.includes(',') || text.includes('\n') || text.includes('"') ? `"${text}"` : text
          }).join(',')
        )
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const today = new Date().toISOString().split('T')[0]
      link.setAttribute('href', url)
      link.setAttribute('download', `danh_sach_hang_hoa_${today}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err: any) {
      logger.error('[ProductListPage] export error:', err?.message ?? err)
      alert('Xuất CSV thất bại. Vui lòng thử lại.')
    }
  }

  return (
    <Layout activeMenu="Sản phẩm">
      <div className="p-4 md:p-6 max-w-[1600px] w-full mx-auto">
        {/* Top Header Section */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-display-xs font-bold text-gray-800">Danh mục Hàng hóa</h2>
            <p className="text-body-sm text-gray-500">Quản lý nhóm sản phẩm, giá bán lẻ, giá vốn và định lượng tồn kho</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/products/prices')}
              className="h-9 px-3.5 border border-gray-200 rounded text-tiny font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <FileSpreadsheet size={15} className="text-blue-500" />
              Bảng giá áp dụng
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="h-9 px-4 bg-blue-600 text-white rounded text-tiny font-bold flex items-center gap-1.5 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md"
            >
              <Plus size={16} />
              Thêm mới
            </button>
          </div>
        </div>

        {/* Outer Split Container */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* 1. Left Filters Sidebar Pane */}
          <aside className="hidden md:block w-full md:w-[22%] bg-white border border-gray-100 rounded-xl p-4 shrink-0 shadow-sm space-y-6">
            {/* Nhóm sản phẩm */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={14} className="text-gray-400" /> Nhóm sản phẩm
                </span>
                <button onClick={() => setIsManageCatsOpen(true)} className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all" title="Quản lý nhóm sản phẩm">
                  <Settings size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedCategory('')}
                  className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all ${
                    !selectedCategory ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tất cả nhóm sản phẩm
                </button>
                {categories.map((cat: any) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                      selectedCategory === cat.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate pr-1">{cat.name}</span>
                    {!cat.is_active && (
                      <span className="text-[8px] bg-gray-100 text-gray-400 px-1 py-0.2 rounded border border-gray-200 uppercase shrink-0 font-bold">Ngừng</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Thương hiệu */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Award size={14} className="text-gray-400" /> Thương hiệu
                </span>
                <button onClick={() => setIsManageBrandsOpen(true)} className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all" title="Quản lý thương hiệu">
                  <Settings size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedBrand('')}
                  className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all ${
                    !selectedBrand ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tất cả thương hiệu
                </button>
                {brands.map((brand: any) => (
                  <button
                    key={brand.id}
                    onClick={() => setSelectedBrand(brand.id)}
                    className={`text-left text-tiny font-semibold px-2 py-1.5 rounded transition-all flex items-center justify-between ${
                      selectedBrand === brand.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate pr-1">{brand.name}</span>
                    {!brand.is_active && (
                      <span className="text-[8px] bg-gray-100 text-gray-400 px-1 py-0.2 rounded border border-gray-200 uppercase shrink-0 font-bold">Ngừng</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Đơn vị tính */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Settings size={14} className="text-gray-400" /> Đơn vị tính
                </span>
                <button onClick={() => setIsManageUnitsOpen(true)} className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-all" title="Quản lý đơn vị tính">
                  <Settings size={14} />
                </button>
              </div>
              <p className="text-[11px] text-gray-400">Cấu hình các đơn vị đo lường (lọ, chai, gói, cái...).</p>
            </div>

            {/* Trạng thái */}
            <div className="space-y-2.5 pt-1">
              <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider block border-b border-gray-100 pb-2">
                Trạng thái kinh doanh
              </span>
              <div className="flex flex-col gap-2.5">
                {[
                  { value: 'active',   label: 'Đang kinh doanh' },
                  { value: 'inactive', label: 'Ngừng kinh doanh' },
                  { value: 'all',      label: 'Tất cả trạng thái' },
                ].map(item => (
                  <label key={item.value} className="flex items-center gap-2 text-tiny font-bold text-gray-600 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="status-filter"
                      value={item.value}
                      checked={selectedStatus === item.value}
                      onChange={e => setSelectedStatus(e.target.value as 'active' | 'inactive' | 'all')}
                      className="text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* 2. Right Products Table Panel */}
          <div className="flex-1 w-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="p-4 border-b border-gray-100 bg-gray-25 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="flex w-full sm:max-w-xs items-center gap-2 text-gray-700">
                <div className="relative flex-grow">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                  <input
                    type="text"
                    placeholder="Theo mã, tên hàng..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full h-9 pl-9 pr-4 bg-white border border-gray-205 rounded text-tiny focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="flex md:hidden h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 items-center justify-center gap-1.5 shadow-sm transition-all"
                >
                  <Filter size={14} className="text-gray-400" />
                  <span>Lọc</span>
                  {(selectedCategory || selectedBrand || selectedStatus !== 'active') && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Upload size={14} className="text-gray-400" /> Import file
                </button>
                <button
                  onClick={handleExportCSV}
                  className="h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Download size={14} className="text-gray-400" /> Xuất file
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-x-auto hidden md:block">
              <table className="w-full border-collapse text-[13px] text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px] font-bold">
                    <th className="py-2.5 px-3 text-center w-8"></th>
                    <th className="py-2.5 px-1 text-center w-8"></th>
                    <th className="py-2.5 px-3 text-center w-12">Ảnh</th>
                    <th className="py-2.5 px-3 w-28">Mã hàng</th>
                    <th className="py-2.5 px-4 min-w-[200px]">Tên hàng</th>
                    <th className="py-2.5 px-3 text-right w-28">Giá bán</th>
                    <th className="py-2.5 px-3 text-right w-28">Giá vốn</th>
                    <th className="py-2.5 px-3 text-right w-24">Tồn kho</th>
                    <th className="py-2.5 px-3 text-right w-24">Khách đặt</th>
                    <th className="py-2.5 px-4 w-36">Thời gian tạo</th>
                    <th className="py-2.5 px-4 w-32">Dự kiến hết</th>
                  </tr>

                  {/* Totals Header Row – server-side aggregate */}
                  <tr className="bg-blue-50/20 border-b border-gray-200 font-bold text-gray-700">
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-1"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 text-tiny italic text-gray-400">Tổng cộng:</td>
                    <td className="py-2 px-4"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3"></td>
                    <td className="py-2 px-3 text-right font-extrabold text-blue-700">{totalStockSum.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-3 text-right font-extrabold text-blue-700">{totalOrderedSum.toLocaleString('vi-VN')}</td>
                    <td className="py-2 px-4"></td>
                    <td className="py-2 px-4"></td>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <Skeleton.TableRows count={8} cols={11} />
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-20 text-center text-gray-400 italic">Không tìm thấy sản phẩm nào khớp với bộ lọc.</td>
                    </tr>
                  ) : (
                    rows.map(prod => {
                      const image = prod.image_urls && prod.image_urls.length > 0 ? prod.image_urls[0] : null
                      const createdAt = prod.created_at
                        ? new Date(prod.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'
                      const daysLabel = formatDaysToOOS(prod.days_to_oos)
                      return (
                        <tr
                          key={prod.id}
                          onClick={() => navigate(`/products/${prod.id}`)}
                          className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                        >
                          <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" className="rounded border-gray-300 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5" />
                          </td>
                          <td className="py-3 px-1 text-center">
                            <button
                              onClick={e => handleToggleStar(prod.id, e)}
                              className="p-1 hover:bg-gray-100 rounded transition-all text-gray-300 hover:text-amber-500"
                            >
                              <Star size={14} className={starredProducts[prod.id] ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
                            </button>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="w-10 h-10 rounded border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center mx-auto">
                              <ProductImage src={image} alt={prod.name} />
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-[12px] text-gray-500 font-semibold group-hover:text-blue-500 transition-colors">
                            {prod.sku || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-gray-800 leading-snug group-hover:text-blue-600 transition-colors line-clamp-2">
                                {prod.name}
                              </span>
                              <div className="flex gap-2 items-center text-[10px] text-gray-400 font-medium">
                                <span>Nhóm: <strong className="text-gray-500">{prod.category_name || '-'}</strong></span>
                                <span>•</span>
                                <span>Hãng: <strong className="text-gray-500">{prod.brand_name || '-'}</strong></span>
                                {prod.package_specs && (
                                  <>
                                    <span>•</span>
                                    <span>Quy cách: <strong className="text-gray-500">{prod.package_specs}</strong></span>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-blue-600 tabular-nums">
                            {formatCurrency(prod.retail_price)}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-500 tabular-nums">
                            {formatCurrency(prod.retail_cost)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-gray-700 tabular-nums">
                            {prod.stock_on_hand.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-600 tabular-nums">
                            {prod.on_order_qty.toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-tiny font-mono">{createdAt}</td>
                          <td className="py-3 px-4">
                            <span className={`px-1.5 py-0.5 text-[11px] font-bold rounded ${
                              daysLabel === '0 ngày' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-50 text-gray-600 border border-gray-100'
                            }`}>
                              {daysLabel}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden divide-y divide-gray-100 flex-1">
              {loading && rows.length === 0 ? (
                <div className="p-4 space-y-3">
                  <Skeleton.TableRows count={5} cols={4} />
                </div>
              ) : rows.length === 0 ? (
                <div className="py-20 text-center text-gray-450 italic">Không tìm thấy sản phẩm nào khớp với bộ lọc.</div>
              ) : (
                rows.map(prod => {
                  const image = prod.image_urls && prod.image_urls.length > 0 ? prod.image_urls[0] : null
                  const daysLabel = formatDaysToOOS(prod.days_to_oos)
                  return (
                    <div
                      key={prod.id}
                      onClick={() => navigate(`/products/${prod.id}`)}
                      className="p-4 hover:bg-gray-50/50 transition-colors cursor-pointer space-y-3 relative"
                    >
                      <div className="flex gap-3">
                        <div className="w-16 h-16 rounded border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                          <ProductImage src={image} alt={prod.name} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-[11px] text-gray-400 font-semibold">{prod.sku || '-'}</span>
                            <button
                              onClick={e => handleToggleStar(prod.id, e)}
                              className="p-1 hover:bg-gray-100 rounded transition-all text-gray-300 hover:text-amber-500"
                            >
                              <Star size={14} className={starredProducts[prod.id] ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
                            </button>
                          </div>
                          <h4 className="font-bold text-gray-800 leading-snug break-words line-clamp-2 mt-0.5">
                            {prod.name}
                          </h4>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-gray-500 font-semibold">
                        <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">Nhóm: {prod.category_name || '-'}</span>
                        <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">Hãng: {prod.brand_name || '-'}</span>
                        {prod.package_specs && (
                          <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">Quy cách: {prod.package_specs}</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-gray-50 text-tiny text-gray-500">
                        <div>
                          <span className="text-gray-400 block mb-0.5">Giá bán:</span>
                          <span className="font-bold text-blue-600">{formatCurrency(prod.retail_price)}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">Giá vốn:</span>
                          <span className="font-semibold text-gray-750">{formatCurrency(prod.retail_cost)}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">Tồn kho / Khách đặt:</span>
                          <span className="font-bold text-gray-800">{prod.stock_on_hand.toLocaleString('vi-VN')} / {prod.on_order_qty.toLocaleString('vi-VN')}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5">Dự kiến hết:</span>
                          <span className={`px-1.5 py-0.2 rounded font-bold text-[11px] ${
                            daysLabel === '0 ngày' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'
                          }`}>
                            {daysLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Pagination */}
            {!loading && rows.length > 0 && (
              <div className="p-4 border-t border-gray-100 bg-gray-25 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
                <span className="text-tiny text-gray-450 font-medium">
                  Hiển thị <span className="font-bold text-gray-600">{indexOfFirstItem + 1}-{Math.min(indexOfLastItem, totalItems)}</span> trên tổng số <span className="font-bold text-gray-600">{totalItems}</span> sản phẩm
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="w-8 h-8 rounded border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-sm"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    const page = idx + 1
                    if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
                      return (
                        <button
                          key={idx}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 rounded text-tiny font-bold transition-all shadow-sm ${
                            currentPage === page
                              ? 'bg-blue-600 text-white border border-blue-600'
                              : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    }
                    if (page === 2 || page === totalPages - 1) {
                      return <span key={idx} className="px-1 text-gray-300">...</span>
                    }
                    return null
                  })}
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="w-8 h-8 rounded border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-sm"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Filter Sheet */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 bg-gray-700/50 backdrop-blur-sm z-50 flex items-end justify-center p-0">
          <div className="bg-gray-0 w-full rounded-t-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-250 flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-25 shrink-0">
              <div>
                <h3 className="text-body-lg font-bold text-gray-800">Bộ lọc hàng hóa</h3>
                <p className="text-tiny text-gray-400">Chọn nhóm sản phẩm, thương hiệu và trạng thái</p>
              </div>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Nhóm sản phẩm */}
              <div className="space-y-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider block border-b border-gray-100 pb-1">
                  Nhóm sản phẩm
                </span>
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Tất cả nhóm sản phẩm</option>
                  {categories.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{cat.name} {!cat.is_active ? '(Ngừng)' : ''}</option>
                  ))}
                </select>
              </div>

              {/* Thương hiệu */}
              <div className="space-y-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider block border-b border-gray-100 pb-1">
                  Thương hiệu
                </span>
                <select
                  value={selectedBrand}
                  onChange={e => setSelectedBrand(e.target.value)}
                  className="w-full h-10 px-3 bg-gray-25 border border-gray-100 rounded-lg text-body-md text-gray-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Tất cả thương hiệu</option>
                  {brands.map((brand: any) => (
                    <option key={brand.id} value={brand.id}>{brand.name} {!brand.is_active ? '(Ngừng)' : ''}</option>
                  ))}
                </select>
              </div>

              {/* Trạng thái */}
              <div className="space-y-2">
                <span className="text-tiny font-extrabold text-gray-400 uppercase tracking-wider block border-b border-gray-100 pb-1">
                  Trạng thái kinh doanh
                </span>
                <div className="flex flex-col gap-2.5">
                  {[
                    { value: 'active',   label: 'Đang kinh doanh' },
                    { value: 'inactive', label: 'Ngừng kinh doanh' },
                    { value: 'all',      label: 'Tất cả trạng thái' },
                  ].map(item => (
                    <label key={item.value} className="flex items-center gap-2 text-body-md text-gray-600 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="mobile-status-filter"
                        value={item.value}
                        checked={selectedStatus === item.value}
                        onChange={e => setSelectedStatus(e.target.value as 'active' | 'inactive' | 'all')}
                        className="text-blue-500 focus:ring-blue-500 w-4 h-4"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-25 flex gap-4 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('')
                  setSelectedBrand('')
                  setSelectedStatus('active')
                }}
                className="flex-1 h-10 border border-gray-205 rounded-lg text-body-md font-semibold hover:bg-gray-50 transition-colors text-gray-600 bg-white"
              >
                Đặt lại
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="flex-1 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-body-md font-semibold transition-all shadow-sm flex items-center justify-center"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}

      <AddProductModal       isOpen={isAddModalOpen}       onClose={() => setIsAddModalOpen(false)}       onSuccess={invalidate} />
      <ManageCategoriesModal isOpen={isManageCatsOpen}     onClose={() => setIsManageCatsOpen(false)}     onSuccess={invalidate} />
      <ManageBrandsModal     isOpen={isManageBrandsOpen}   onClose={() => setIsManageBrandsOpen(false)}   onSuccess={invalidate} />
      <ImportProductsModal   isOpen={isImportModalOpen}    onClose={() => setIsImportModalOpen(false)}    onSuccess={invalidate} />
      <ManageUnitsModal      isOpen={isManageUnitsOpen}    onClose={() => setIsManageUnitsOpen(false)}    onSuccess={invalidate} />
    </Layout>
  )
}
