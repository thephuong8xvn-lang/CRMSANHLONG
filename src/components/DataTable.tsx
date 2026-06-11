import { useEffect, useState, Fragment, type ReactNode } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Skeleton } from './Skeleton'
import Pagination from './Pagination'

/**
 * ───────────────────────────────────────────────────────────────────────────
 * DataTable — Bảng danh sách CHUẨN dùng chung toàn cục (chắt lọc từ Đơn hàng).
 *
 * Mục tiêu: mọi trang danh sách có CÙNG 1 giao diện kế thừa:
 *  - `table-fixed w-full` → KHÔNG bao giờ cuộn ngang; nội dung dài tự cắt `…`.
 *  - 1 cột chính co giãn (flex) + các cột phụ width cố định → cân bằng, lấp đầy body.
 *  - Header chuẩn (bg-gray-25, text-tiny uppercase) + body divide-y + hover + truncate.
 *  - Tích hợp sẵn: loading skeleton · empty state · card mobile tự sinh · phân trang.
 *
 * Hỗ trợ nâng cao (tùy chọn, mặc định TẮT — không ảnh hưởng usage cũ):
 *  - `manualPagination`: phân trang server-side (parent điều khiển page/total).
 *  - `expandedRowRender`: click dòng → mở panel chi tiết inline.
 *  - `headerSummary`: 1 dòng tổng hợp dưới header (vd "Tổng cộng").
 *
 * Cách dùng: trang chỉ khai báo `columns` + truyền `rows`, KHÔNG tự dựng <table>.
 * DataTable CHỈ render — không fetch/không đụng RLS/phân quyền (do trang lo).
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface DataTableColumn<T> {
  /** Khóa duy nhất của cột */
  key: string
  /** Tiêu đề cột (chuỗi để tự dùng làm nhãn trên card mobile) */
  header: ReactNode
  /** Bề rộng cố định (px). Bỏ qua nếu là cột co giãn (flex). */
  width?: number
  /** Cột co giãn — hút phần dư để lấp đầy body. Chỉ nên có 1 cột flex/bảng. */
  flex?: boolean
  /** Bề rộng tối thiểu (px) cho cột flex. Mặc định 200. */
  minWidth?: number
  /** Canh lề nội dung. Mặc định 'left'. */
  align?: 'left' | 'center' | 'right'
  /** Hàm render nội dung ô. Tham số 2 = dòng có đang mở rộng không (cho mũi tên ▾). */
  render: (row: T, expanded: boolean) => ReactNode
  /** Class thêm cho <td> (vd đổi màu/độ đậm/kích thước chữ). */
  cellClassName?: string
  /** Không cắt `…` (vd ô chứa badge/nút). Mặc định false (có cắt). */
  noTruncate?: boolean
  /** Ẩn cột này trên card mobile. */
  hideOnMobile?: boolean
  /** Hiện cột này ở góc phải-trên card mobile (vd badge trạng thái). */
  mobileHeaderRight?: boolean
  /** Cho phép click header để sort (controlled — cần sortKey/onSortChange ở props bảng). */
  sortable?: boolean
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  loading?: boolean
  /** Bấm vào dòng (desktop) / card (mobile). Bỏ qua nếu có expandedRowRender. */
  onRowClick?: (row: T) => void
  /** Nội dung khi rỗng. */
  emptyText?: string
  emptyIcon?: ReactNode
  /** Số dòng/trang. Mặc định 20. Đặt 0 để tắt phân trang. */
  pageSize?: number
  /** Nhãn đơn vị cho phân trang (vd "đơn hàng", "phiếu nhập"). */
  itemLabel?: string
  /** Khi giá trị này đổi → nhảy về trang 1 (client-side). */
  resetSignal?: unknown
  /** Bọc bảng trong thẻ viền/bo góc. Mặc định true. Đặt false khi đã nằm trong card sẵn. */
  card?: boolean
  className?: string

  // ── Nâng cao (tùy chọn) ──
  /** Phân trang server-side: parent điều khiển. Khi true, KHÔNG slice rows. */
  manualPagination?: boolean
  /** Trang hiện tại (chỉ khi manualPagination). */
  page?: number
  /** Đổi trang (chỉ khi manualPagination). */
  onPageChange?: (page: number) => void
  /** Tổng số bản ghi (chỉ khi manualPagination — để tính số trang). */
  totalItems?: number
  /** Click dòng → mở panel chi tiết inline bên dưới. Tham số 2 = hàm đóng panel. */
  expandedRowRender?: (row: T, collapse: () => void) => ReactNode
  /** 1 dòng <tr> tổng hợp render ngay dưới header (desktop). */
  headerSummary?: ReactNode

  // ── Sort header (controlled, server-side — chỉ tác dụng với cột sortable) ──
  /** Key cột đang sort (null = không sort). */
  sortKey?: string | null
  /** Chiều sort hiện tại. */
  sortDir?: 'asc' | 'desc'
  /** Click header cột sortable: asc ↔ desc (bắt đầu asc). Parent tự fetch lại. */
  onSortChange?: (key: string, dir: 'asc' | 'desc') => void
}

const PAD = 'px-3 py-2.5'

function alignClass(a?: 'left' | 'center' | 'right') {
  return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'
}

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  onRowClick,
  emptyText = 'Không có dữ liệu',
  emptyIcon,
  pageSize = 20,
  itemLabel = 'dòng',
  resetSignal,
  card = true,
  className = '',
  manualPagination = false,
  page,
  onPageChange,
  totalItems,
  expandedRowRender,
  headerSummary,
  sortKey = null,
  sortDir = 'asc',
  onSortChange
}: DataTableProps<T>) {
  const [internalPage, setInternalPage] = useState(1)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // Reset trang 1 khi lọc/tìm đổi (chỉ chế độ client-side)
  useEffect(() => { if (!manualPagination) setInternalPage(1) }, [resetSignal, manualPagination])

  const usePaging = pageSize > 0
  const displayTotal = manualPagination ? (totalItems ?? rows.length) : rows.length
  const totalPages = usePaging ? Math.max(1, Math.ceil(displayTotal / pageSize)) : 1
  const currentPage = manualPagination ? (page ?? 1) : Math.min(internalPage, totalPages)
  const pagedRows = (manualPagination || !usePaging) ? rows : rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const handlePageChange = manualPagination ? (onPageChange ?? (() => {})) : setInternalPage

  const expandable = !!expandedRowRender
  const activate = (row: T) => {
    if (expandable) {
      const k = getRowKey(row)
      setExpandedKey(prev => (prev === k ? null : k))
    } else if (onRowClick) {
      onRowClick(row)
    }
  }
  const clickable = expandable || !!onRowClick
  const rowCls = `transition-colors group hover:bg-gray-25/50 ${clickable ? 'cursor-pointer' : ''}`

  // ── Desktop table ──
  const desktop = (
    <div className="hidden md:block">
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <colgroup>
          {columns.map(c => (
            <col key={c.key} style={c.flex ? { minWidth: c.minWidth ?? 200 } : { width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-gray-25 text-gray-400 font-semibold text-tiny uppercase tracking-wider border-b border-gray-100">
            {columns.map(c => {
              const isSortable = !!c.sortable && !!onSortChange
              const isActive = isSortable && sortKey === c.key
              return (
                <th
                  key={c.key}
                  onClick={isSortable ? () => onSortChange(c.key, isActive && sortDir === 'asc' ? 'desc' : 'asc') : undefined}
                  className={`${PAD} whitespace-nowrap ${alignClass(c.align)} ${isSortable ? 'cursor-pointer select-none hover:text-gray-600 transition-colors' : ''}`}
                  title={isSortable ? 'Bấm để sắp xếp' : undefined}
                >
                  <span className={`inline-flex items-center gap-1 ${isActive ? 'text-blue-600' : ''}`}>
                    {c.header}
                    {isSortable && (
                      isActive
                        ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                        : <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
          {headerSummary && !loading && displayTotal > 0 && headerSummary}
        </thead>
        <tbody className="divide-y divide-gray-50 text-gray-700">
          {loading ? (
            <Skeleton.TableRows count={8} cols={columns.length} />
          ) : (
            pagedRows.map(row => {
              const key = getRowKey(row)
              const isExpanded = expandable && expandedKey === key
              return (
                <Fragment key={key}>
                  <tr
                    className={`${rowCls} ${isExpanded ? 'bg-blue-50/40' : ''}`}
                    onClick={clickable ? () => activate(row) : undefined}
                  >
                    {columns.map(c => (
                      <td
                        key={c.key}
                        className={`${PAD} overflow-hidden ${alignClass(c.align)} ${c.noTruncate ? '' : 'truncate'} ${c.cellClassName || ''}`}
                      >
                        {c.render(row, isExpanded)}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && expandedRowRender && (
                    <tr className="bg-blue-50/20">
                      <td colSpan={columns.length} className="px-4 pb-3 pt-0">{expandedRowRender(row, () => setExpandedKey(null))}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )

  // ── Mobile card (tự sinh từ columns) ──
  const codeCol = columns[0]
  const titleCol = columns.find(c => c.flex) ?? columns[1] ?? columns[0]
  const rightCols = columns.filter(c => c.mobileHeaderRight)
  const bodyCols = columns.filter(
    c => c !== codeCol && c !== titleCol && !c.mobileHeaderRight && !c.hideOnMobile
  )

  const mobile = (
    <div className="block md:hidden divide-y divide-gray-100">
      {!loading && pagedRows.map(row => {
        const key = getRowKey(row)
        const isExpanded = expandable && expandedKey === key
        return (
          <div key={key}>
            <div
              onClick={clickable ? () => activate(row) : undefined}
              className={`p-4 space-y-3 ${clickable ? 'cursor-pointer hover:bg-gray-25/50' : ''} ${isExpanded ? 'bg-blue-50/40' : ''} transition-colors`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-tiny">{codeCol.render(row, isExpanded)}</div>
                  {titleCol !== codeCol && (
                    <div className="font-bold text-gray-800 leading-snug break-words mt-1">{titleCol.render(row, isExpanded)}</div>
                  )}
                </div>
                {rightCols.length > 0 && (
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {rightCols.map(c => <div key={c.key}>{c.render(row, isExpanded)}</div>)}
                  </div>
                )}
              </div>
              {bodyCols.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-gray-50 text-tiny text-gray-500">
                  {bodyCols.map(c => (
                    <div key={c.key} className="min-w-0">
                      <span className="text-gray-400 block mb-0.5">{c.header}</span>
                      <span className="font-semibold text-gray-700 truncate block">{c.render(row, isExpanded)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isExpanded && expandedRowRender && (
              <div className="px-3 pb-3 bg-blue-50/10">{expandedRowRender(row, () => setExpandedKey(null))}</div>
            )}
          </div>
        )
      })}
    </div>
  )

  const body = (
    <>
      {desktop}
      {mobile}
      {!loading && displayTotal === 0 && (
        <div className="p-12 text-center text-gray-400 space-y-2">
          {emptyIcon}
          <p className="font-semibold text-body-lg">{emptyText}</p>
        </div>
      )}
    </>
  )

  const showPagination = usePaging && (manualPagination ? displayTotal > 0 : !loading)

  return (
    <div className={className}>
      {card ? (
        <div className="bg-gray-0 border border-gray-100 rounded-xl shadow-sm overflow-hidden">{body}</div>
      ) : body}
      {showPagination && (
        <Pagination
          currentPage={currentPage}
          totalItems={displayTotal}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          itemLabel={itemLabel}
        />
      )}
    </div>
  )
}
