import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export interface SmartSearchOption {
  value: string
  label: string
  desc?: string
  disabled?: boolean
}

interface SmartSearchSelectProps {
  options: SmartSearchOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  required?: boolean
  disabled?: boolean
  icon?: React.ReactNode
}

// Accent stripping helper for Vietnamese characters
export function removeVietnameseTones(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

export default function SmartSearchSelect({
  options,
  value,
  onChange,
  placeholder = '-- Chọn --',
  searchPlaceholder = 'Tìm kiếm...',
  className = '',
  required = false,
  disabled = false,
  icon
}: SmartSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Find currently selected option
  const selectedOption = useMemo(() => {
    return options.find(opt => opt.value === value)
  }, [options, value])

  // Filter options based on query
  const filteredOptions = useMemo(() => {
    const normQuery = removeVietnameseTones(searchQuery.trim().toLowerCase())
    if (!normQuery) return options
    return options.filter(opt => {
      const normLabel = removeVietnameseTones(opt.label.toLowerCase())
      const normDesc = opt.desc ? removeVietnameseTones(opt.desc.toLowerCase()) : ''
      return normLabel.includes(normQuery) || normDesc.includes(normQuery)
    })
  }, [options, searchQuery])

  // Limit matching list size to prevent DOM lag on massive datasets
  const limit = 100
  const displayedOptions = useMemo(() => {
    return filteredOptions.slice(0, limit)
  }, [filteredOptions])

  const hasMore = filteredOptions.length > limit

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
  }, [isOpen])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Clear query on dropdown close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

  const handleSelect = (val: string) => {
    onChange(val)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <div className="relative w-full">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10">
            {icon}
          </div>
        )}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`w-full h-10 border border-gray-200 rounded-lg text-body-md bg-white focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all flex items-center justify-between text-left ${
            icon ? 'pl-10' : 'pl-3'
          } pr-3 ${disabled ? 'bg-gray-50 cursor-not-allowed opacity-60' : 'cursor-pointer'} ${className}`}
          disabled={disabled}
        >
          <span className={`truncate ${!selectedOption ? 'text-gray-400' : 'text-gray-900'}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown size={18} className="text-gray-400 flex-shrink-0 ml-2" />
        </button>
      </div>

      {/* Hidden input for HTML form validation if required */}
      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required
          className="absolute inset-x-0 bottom-0 h-0 w-full opacity-0 pointer-events-none"
        />
      )}

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-72 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Search Box */}
          <div className="p-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50 shrink-0">
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent border-none text-body-sm focus:outline-none focus:ring-0 p-0 text-gray-900 placeholder-gray-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="overflow-y-auto max-h-56 divide-y divide-gray-50 flex-grow">
            {displayedOptions.length === 0 ? (
              <div className="p-4 text-center text-body-sm text-gray-450 italic">
                Không tìm thấy kết quả
              </div>
            ) : (
              displayedOptions.map(opt => {
                const isSelected = opt.value === value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 text-body-sm flex items-center justify-between transition-colors ${
                      opt.disabled
                        ? 'bg-gray-50 text-gray-400 cursor-not-allowed opacity-50'
                        : isSelected
                        ? 'bg-blue-50 text-blue-900 font-semibold'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="truncate">{opt.label}</span>
                      {opt.desc && (
                        <span className="text-tiny text-gray-400 font-normal mt-0.5">{opt.desc}</span>
                      )}
                    </div>
                    {isSelected && <Check size={16} className="text-blue-600 flex-shrink-0" />}
                  </button>
                )
              })
            )}
            {hasMore && (
              <div className="p-2 text-center text-[10px] text-gray-400 bg-gray-50 border-t border-gray-100 italic shrink-0">
                Hiển thị 100 kết quả phù hợp nhất...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
