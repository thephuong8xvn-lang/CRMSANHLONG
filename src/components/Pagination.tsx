import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  /** Nhãn đơn vị (vd: "lô", "đơn", "phiếu"). Mặc định "dòng". */
  itemLabel?: string
}

/**
 * Thanh phân trang client-side dùng chung.
 * Hiển thị khoảng đang xem + nút điều hướng (Trước / số trang / Sau).
 * Ẩn hoàn toàn khi không có dữ liệu.
 */
export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  itemLabel = 'dòng'
}: PaginationProps) {
  if (totalItems === 0) return null

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const indexOfFirstItem = (currentPage - 1) * pageSize
  const indexOfLastItem = indexOfFirstItem + pageSize

  return (
    <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <span className="text-tiny text-gray-450 font-medium">
        Hiển thị{' '}
        <span className="font-bold text-gray-600">
          {indexOfFirstItem + 1}-{Math.min(indexOfLastItem, totalItems)}
        </span>{' '}
        trên tổng số <span className="font-bold text-gray-600">{totalItems}</span> {itemLabel}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
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
                  onClick={() => onPageChange(page)}
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
            onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="w-8 h-8 rounded border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all shadow-sm"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
