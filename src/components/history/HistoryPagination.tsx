import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ChevronFirst, ChevronLast, ChevronDown } from 'lucide-react'

export interface HistoryPaginationProps {
  totalItems: number
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function HistoryPagination({
  totalItems,
  currentPage,
  totalPages,
  startIndex: _startIndex,
  endIndex: _endIndex,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: HistoryPaginationProps) {
  const [isPageSizeOpen, setIsPageSizeOpen] = useState(false)
  const pageSizeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pageSizeRef.current && !pageSizeRef.current.contains(event.target as Node)) {
        setIsPageSizeOpen(false)
      }
    }
    if (isPageSizeOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isPageSizeOpen])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isPageSizeOpen) {
        setIsPageSizeOpen(false)
      }
    }
    if (isPageSizeOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPageSizeOpen])

  if (totalItems <= 0) return null

  // Ensure current pageSize is in the options list if custom
  const options = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b)

  const safeTotalPages = Math.max(totalPages, 1)

  return (
    <div
      className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3.5 border-t border-white/[0.08] text-xs"
      style={{
        background: 'rgba(255, 255, 255, 0.02)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* Left: Show [ 10 v ] per page */}
      <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <span>Show</span>
        <div className="relative inline-block" ref={pageSizeRef}>
          <button
            type="button"
            onClick={() => setIsPageSizeOpen((prev) => !prev)}
            aria-label="Rows per page"
            aria-haspopup="listbox"
            aria-expanded={isPageSizeOpen}
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/40 hover:bg-black/60 border border-white/10 hover:border-white/20 text-xs font-mono text-white transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
            style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
          >
            <span>{pageSize}</span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${
                isPageSizeOpen ? 'rotate-180 text-[var(--purple-1)]' : ''
              }`}
            />
          </button>

          {isPageSizeOpen && (
            <div
              role="listbox"
              aria-label="Select rows per page"
              className="absolute left-0 bottom-full mb-1.5 z-50 min-w-[70px] rounded-lg p-1 shadow-2xl backdrop-blur-2xl border border-white/10 animate-fade-in"
              style={{
                background: 'rgba(12, 15, 26, 0.98)',
                boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)',
              }}
            >
              {options.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="option"
                  aria-selected={pageSize === size}
                  onClick={() => {
                    onPageSizeChange(size)
                    setIsPageSizeOpen(false)
                  }}
                  className={`w-full px-2.5 py-1 rounded text-left text-xs font-mono transition-colors cursor-pointer flex items-center justify-between ${
                    pageSize === size
                      ? 'bg-[var(--purple-1)]/20 text-white font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.08]'
                  }`}
                  style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
                >
                  <span>{size}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span>per page</span>
      </div>

      {/* Right: [|<] [<] Page X of Y [>] [>|] */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(1)}
          aria-label="First page"
          title="First page"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/10 disabled:hover:text-slate-300"
        >
          <ChevronFirst className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          aria-label="Previous page"
          title="Previous page"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/10 disabled:hover:text-slate-300"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="text-xs text-slate-300 font-medium px-2 select-none whitespace-nowrap">
          Page <span className="text-white font-semibold tabular-nums">{currentPage}</span> of{' '}
          <span className="text-white font-semibold tabular-nums">{safeTotalPages}</span>
        </span>

        <button
          type="button"
          disabled={currentPage >= safeTotalPages}
          onClick={() => onPageChange(Math.min(currentPage + 1, safeTotalPages))}
          aria-label="Next page"
          title="Next page"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/10 disabled:hover:text-slate-300"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          disabled={currentPage >= safeTotalPages}
          onClick={() => onPageChange(safeTotalPages)}
          aria-label="Last page"
          title="Last page"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-white/[0.04] disabled:hover:border-white/10 disabled:hover:text-slate-300"
        >
          <ChevronLast className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

