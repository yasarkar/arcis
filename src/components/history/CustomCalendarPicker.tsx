import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export interface CalendarPickerProps {
  initialDateStr?: string
  onApply: (dateIsoStr: string) => void
  onClear: () => void
  onClose: () => void
}

export function CustomCalendarPicker({ initialDateStr, onApply, onClear, onClose }: CalendarPickerProps) {
  const initialDate = initialDateStr ? new Date(initialDateStr) : new Date()
  const validInitial = !isNaN(initialDate.getTime()) ? initialDate : new Date()

  const [viewYear, setViewYear] = useState(validInitial.getFullYear())
  const [viewMonth, setViewMonth] = useState(validInitial.getMonth())
  const [selectedDay, setSelectedDay] = useState(validInitial.getDate())

  const pad = (n: number) => n.toString().padStart(2, '0')
  const [timeStr, setTimeStr] = useState(
    `${pad(validInitial.getHours())}:${pad(validInitial.getMinutes())}:${pad(validInitial.getSeconds())}`
  )

  const dateInputStr = `${pad(viewMonth + 1)}/${pad(selectedDay)}/${viewYear}`

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(prev => prev - 1)
    } else {
      setViewMonth(prev => prev - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(prev => prev + 1)
    } else {
      setViewMonth(prev => prev + 1)
    }
  }

  // Generate calendar grid
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay()
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate()

  const gridDays: Array<{ day: number; isCurrentMonth: boolean; monthOffset: number }> = []

  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    gridDays.push({ day: prevMonthDays - i, isCurrentMonth: false, monthOffset: -1 })
  }
  for (let i = 1; i <= daysInMonth; i++) {
    gridDays.push({ day: i, isCurrentMonth: true, monthOffset: 0 })
  }
  const remaining = (gridDays.length > 35 ? 42 : 35) - gridDays.length
  for (let i = 1; i <= remaining; i++) {
    gridDays.push({ day: i, isCurrentMonth: false, monthOffset: 1 })
  }

  const handleDayClick = (dayObj: { day: number; isCurrentMonth: boolean; monthOffset: number }) => {
    if (dayObj.isCurrentMonth) {
      setSelectedDay(dayObj.day)
    } else {
      if (dayObj.monthOffset === -1) {
        handlePrevMonth()
        setSelectedDay(dayObj.day)
      } else if (dayObj.monthOffset === 1) {
        handleNextMonth()
        setSelectedDay(dayObj.day)
      }
    }
  }

  const handleApplyClick = () => {
    const formattedIso = `${viewYear}-${pad(viewMonth + 1)}-${pad(selectedDay)}T${timeStr.slice(0, 5)}`
    onApply(formattedIso)
  }

  const today = new Date()
  const isToday = (day: number, isCurrentMonth: boolean) =>
    isCurrentMonth && day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()

  return (
    <div
      className="w-76 rounded-2xl p-4 shadow-2xl space-y-3 font-sans text-left normal-case tracking-normal backdrop-blur-2xl"
      style={{
        background: 'rgba(15, 18, 32, 0.98)',
        border: '1px solid rgba(152, 150, 255, 0.25)',
        boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* Top Header Inputs: MM/dd/yyyy and HH:mm:ss */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-app)' }}>
            MM/dd/yyyy
          </label>
          <div
            className="rounded-xl px-2.5 py-1.5 text-center text-xs font-mono text-white"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {dateInputStr}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-app)' }}>
            HH:mm:ss
          </label>
          <input
            type="text"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            placeholder="00:00:00"
            className="w-full rounded-xl px-2.5 py-1.5 text-center text-xs font-mono text-white focus:outline-none transition-all"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>
      </div>

      {/* Month / Year Bar */}
      <div className="flex items-center justify-between px-1 pt-1">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={name} value={idx} className="bg-[#0f1220] text-white">
                {name}
              </option>
            ))}
          </select>

          <select
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
            className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer"
          >
            {Array.from({ length: 15 }, (_, i) => 2020 + i).map(y => (
              <option key={y} value={y} className="bg-[#0f1220] text-white">
                {y}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-colors cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_HEADERS.map(d => (
          <span key={d} className="text-[11px] font-medium text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
            {d}
          </span>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {gridDays.map((dObj, idx) => {
          const isSelected = dObj.isCurrentMonth && dObj.day === selectedDay
          const isTodayDay = isToday(dObj.day, dObj.isCurrentMonth)

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleDayClick(dObj)}
              className={`h-7 w-7 mx-auto flex items-center justify-center text-xs rounded-full font-mono transition-all cursor-pointer ${isSelected
                  ? 'bg-[rgba(152,150,255,0.25)] text-white font-bold border border-[rgba(152,150,255,0.5)] shadow-sm'
                  : isTodayDay
                    ? 'bg-white/[0.08] text-white border border-white/[0.2] font-bold'
                    : dObj.isCurrentMonth
                      ? 'text-slate-200 hover:bg-white/[0.08]'
                      : 'text-slate-600 hover:text-slate-400'
                }`}
            >
              {dObj.day}
            </button>
          )
        })}
      </div>

      {/* Bottom Actions: Clear & Apply */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            onClear()
            onClose()
          }}
          className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleApplyClick}
          className="ub-action-btn ub-action-btn-primary rounded-full px-4 py-1 text-xs font-semibold"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
