import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  ChevronDown,
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
import DataTable, { type DataTableColumn } from '../../components/DataTable'
import ProductQuickView from './ProductQuickView'
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
  const { profile, userRole } = useAuth()

  // Modal Dialogs States
  const [isAddModalOpen, setIsAddModalOpen]       = useState(false)
  const [isManageCatsOpen, setIsManageCatsOpen]   = useState(false)
  const [isManageBrandsOpen, setIsManageBrandsOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isManageUnitsOpen, setIsManageUnitsOpen] = useState(false)
  const [catMenuOpen, setCatMenuOpen] = useState(false)

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
    branchId: (userRole?.code !== 'admin' && userRole?.code !== 'ceo') ? profile?.branch_id || undefined : undefined,
  }), [currentPage, debouncedSearch, selectedCategory, selectedBrand, selectedStatus, profile?.branch_id, userRole?.code])

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

  // ── Cấu hình cột chuẩn DataTable: Sản phẩm ──
  const productColumns: DataTableColumn<ProductStockRow>[] = [
    { key: 'expand', header: '', width: 36, align: 'center', noTruncate: true, hideOnMobile: true, render: (_p, expanded) => <ChevronDown size={15} className={`mx-auto text-gray-400 transition-transform ${expanded ? 'rotate-180 text-blue-500' : ''}`} /> },
    { key: 'star', header: '', width: 36, align: 'center', noTruncate: true, hideOnMobile: true, render: p => <button onClick={e => handleToggleStar(p.id, e)} className="p-1 hover:bg-gray-100 rounded text-gray-300 hover:text-amber-500"><Star size={14} className={starredProducts[p.id] ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} /></button> },
    { key: 'image', header: 'Ảnh', width: 56, align: 'center', noTruncate: true, render: p => { const image = p.image_urls && p.image_urls.length > 0 ? p.image_urls[0] : null; return <div className="w-10 h-10 rounded border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center mx-auto"><ProductImage src={image} alt={p.name} /></div> } },
    { key: 'sku', header: 'Mã hàng', width: 110, render: p => <span className="font-mono text-[12px] text-gray-500 font-semibold group-hover:text-blue-500">{p.sku || '-'}</span> },
    {
      key: 'name', header: 'Tên hàng', flex: true, minWidth: 200, noTruncate: true,
      render: p => (
        <div className="min-w-0">
          <span className="font-bold text-gray-800 leading-snug group-hover:text-blue-600 line-clamp-2 block">{p.name}</span>
          <div className="flex gap-2 items-center text-[10px] text-gray-400 font-medium truncate">
            <span className="truncate">Nhóm: <strong className="text-gray-500">{p.category_name || '-'}</strong></span>
            <span>•</span>
            <span className="truncate">Hãng: <strong className="text-gray-500">{p.brand_name || '-'}</strong></span>
            {p.package_specs && <><span>•</span><span className="truncate">Quy cách: <strong className="text-gray-500">{p.package_specs}</strong></span></>}
          </div>
        </div>
      )
    },
    { key: 'price', header: 'Giá bán', width: 110, align: 'right', render: p => <span className="font-bold text-blue-600 tabular-nums">{formatCurrency(p.retail_price)}</span> },
    { key: 'cost', header: 'Giá vốn', width: 110, align: 'right', render: p => <span className="text-gray-500 tabular-nums">{formatCurrency(p.retail_cost)}</span> },
    { key: 'stock', header: 'Tồn kho', width: 96, align: 'right', render: p => <span className="font-bold text-gray-700 tabular-nums">{p.stock_on_hand.toLocaleString('vi-VN')}</span> },
    { key: 'order', header: 'Khách đặt', width: 96, align: 'right', render: p => <span className="text-gray-600 tabular-nums">{p.on_order_qty.toLocaleString('vi-VN')}</span> },
    { key: 'created', header: 'Thời gian tạo', width: 130, render: p => <span className="text-gray-400 text-tiny font-mono">{p.created_at ? new Date(p.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span> },
    { key: 'days', header: 'Dự kiến hết', width: 110, noTruncate: true, render: p => { const daysLabel = formatDaysToOOS(p.days_to_oos); return <span className={`px-1.5 py-0.5 text-[11px] font-bold rounded ${daysLabel === '0 ngày' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-50 text-gray-600 border border-gray-100'}`}>{daysLabel}</span> } }
  ]

  const productSummary = (
    <tr className="bg-blue-50/20 border-b border-gray-100 font-bold text-gray-700">
      <td></td><td></td><td></td>
      <td className="px-3 py-2 text-tiny italic text-gray-400 whitespace-nowrap">Tổng cộng:</td>
      <td></td><td></td><td></td>
      <td className="px-3 py-2 text-right font-extrabold text-blue-700 tabular-nums">{totalStockSum.toLocaleString('vi-VN')}</td>
      <td className="px-3 py-2 text-right font-extrabold text-blue-700 tabular-nums">{totalOrderedSum.toLocaleString('vi-VN')}</td>
      <td></td><td></td>
    </tr>
  )

  return (
    <Layout activeMenu="Sản phẩm">
      <div className="p-4 md:p-6 max-w-[1600px] w-full mx-auto">
        {/* Top Header Section */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-display-xs font-bold text-gray-800">Danh mục Hàng hóa</h2>
            <p className="text-body-sm text-gray-500">Quản lý nhóm sản phẩm, giá bán lẻ, giá vốn và định lượng tồn kho</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Quản lý danh mục dropdown */}
            <div className="relative">
              <button
                onClick={() => setCatMenuOpen(v => !v)}
                onBlur={() => setTimeout(() => setCatMenuOpen(false), 150)}
                className="h-9 px-3.5 border border-gray-200 rounded text-tiny font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Settings size={15} className="text-blue-500" /> Quản lý danh mục
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${catMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {catMenuOpen && (
                <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-150 rounded-lg shadow-lg z-30 py-1">
                  <button onMouseDown={() => { setIsManageCatsOpen(true); setCatMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Layers size={14} className="text-gray-400" /> Nhóm sản phẩm</button>
                  <button onMouseDown={() => { setIsManageBrandsOpen(true); setCatMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Award size={14} className="text-gray-400" /> Thương hiệu</button>
                  <button onMouseDown={() => { setIsManageUnitsOpen(true); setCatMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-tiny font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Settings size={14} className="text-gray-400" /> Đơn vị tính</button>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="h-9 px-3 border border-gray-200 rounded text-tiny font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Upload size={15} className="text-gray-400" /> Import
            </button>
            <button
              onClick={handleExportCSV}
              className="h-9 px-3 border border-gray-200 rounded text-tiny font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Download size={15} className="text-gray-400" /> Xuất file
            </button>
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

        {/* Products Table Panel (full width — sidebar đã chuyển thành bộ lọc trên toolbar) */}
        <div className="w-full">
          <div className="w-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm flex flex-col min-w-0">
            {/* Toolbar: tìm kiếm + bộ lọc (Nhóm / Thương hiệu / Trạng thái) */}
            <div className="p-4 border-b border-gray-100 bg-gray-25 flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                  type="text"
                  placeholder="Theo mã, tên hàng..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-9 pl-9 pr-4 bg-white border border-gray-205 rounded text-tiny focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Bộ lọc desktop */}
              <div className="hidden md:flex flex-wrap items-center gap-2">
                <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                  className="h-9 px-2.5 bg-white border border-gray-200 rounded text-tiny text-gray-600 focus:border-blue-500 focus:outline-none cursor-pointer">
                  <option value="">Tất cả nhóm SP</option>
                  {categories.map((cat: any) => <option key={cat.id} value={cat.id}>{cat.name}{!cat.is_active ? ' (Ngừng)' : ''}</option>)}
                </select>
                <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
                  className="h-9 px-2.5 bg-white border border-gray-200 rounded text-tiny text-gray-600 focus:border-blue-500 focus:outline-none cursor-pointer">
                  <option value="">Tất cả thương hiệu</option>
                  {brands.map((brand: any) => <option key={brand.id} value={brand.id}>{brand.name}{!brand.is_active ? ' (Ngừng)' : ''}</option>)}
                </select>
                <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value as 'active' | 'inactive' | 'all')}
                  className="h-9 px-2.5 bg-white border border-gray-200 rounded text-tiny text-gray-600 focus:border-blue-500 focus:outline-none cursor-pointer">
                  <option value="active">Đang kinh doanh</option>
                  <option value="inactive">Ngừng kinh doanh</option>
                  <option value="all">Tất cả trạng thái</option>
                </select>
                {(selectedCategory || selectedBrand || selectedStatus !== 'active') && (
                  <button onClick={() => { setSelectedCategory(''); setSelectedBrand(''); setSelectedStatus('active') }}
                    className="h-9 px-2.5 text-tiny font-semibold text-gray-500 hover:text-blue-600">Xóa lọc</button>
                )}
              </div>

              {/* Nút lọc mobile */}
              <button
                onClick={() => setMobileFiltersOpen(true)}
                className="flex md:hidden h-9 px-3 border border-gray-200 bg-white hover:bg-gray-50 rounded text-tiny font-semibold text-gray-600 items-center justify-center gap-1.5 shadow-sm transition-all self-start"
              >
                <Filter size={14} className="text-gray-400" />
                <span>Lọc</span>
                {(selectedCategory || selectedBrand || selectedStatus !== 'active') && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                )}
              </button>
            </div>

            {/* Bảng sản phẩm (layout chuẩn DataTable) */}
            <div className="px-3 pb-3">
              <DataTable
                rows={rows}
                columns={productColumns}
                getRowKey={p => p.id}
                loading={loading}
                card={false}
                pageSize={PAGE_SIZE}
                itemLabel="sản phẩm"
                manualPagination
                page={currentPage}
                onPageChange={setCurrentPage}
                totalItems={totalItems}
                headerSummary={productSummary}
                expandedRowRender={(prod, collapse) => (
                  <ProductQuickView row={prod} branchId={listParams.branchId} onClose={collapse} onOpenDetail={() => navigate(`/products/${prod.id}`)} />
                )}
                emptyText="Không tìm thấy sản phẩm nào khớp với bộ lọc."
              />
            </div>
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
