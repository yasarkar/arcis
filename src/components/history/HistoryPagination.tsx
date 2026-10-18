import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface HistoryPaginationProps {
  totalItems: number
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  onPageChange: (page: number) => void
}

export function HistoryPagination({
  totalItems,
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  onPageChange,
}: HistoryPaginationProps) {
  if (totalItems <= 0) return null

  return (
    <div
      className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-4 border-t border-white/[0.08] text-xs"
      style={{
        background: 'rgba(255, 255, 255, 0.02)',
        fontFamily: 'var(--font-app)',
      }}
    >
      <div className="text-slate-400 font-medium">
        Showing <span className="text-white font-bold">{totalItems > 0 ? startIndex + 1 : 0}</span> -{' '}
        <span className="text-white font-bold">{endIndex}</span> of{' '}
        <span className="text-white font-bold">{totalItems}</span> transactions
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
            className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
            <span>Prev</span>
          </button>

          <div className="flex items-center gap-1 px-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onPageChange(page)}
                className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-all cursor-pointer ${
                  currentPage === page
                    ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.5)] shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {page}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
            className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>
      )}
    </div>
  )
}
