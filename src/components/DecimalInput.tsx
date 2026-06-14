import { useEffect, useRef, useState } from 'react'
import { parseQtyInput } from '../lib/parseQty'

interface DecimalInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  /** Hiển thị ô trống khi value = 0 (thay vì "0"). */
  blankZero?: boolean
  className?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * Ô nhập số lượng hỗ trợ thập phân, chấp nhận cả dấu phẩy "18,5" và dấu chấm "18.5".
 *
 * Giữ chuỗi nháp nội bộ trong lúc gõ để không "nuốt" dấu phân tách thập phân
 * (vấn đề kinh điển của controlled numeric input). Chỉ đồng bộ lại từ prop `value`
 * khi giá trị bên ngoài thay đổi khác với những gì đang gõ (nút +/-, điền nhanh...).
 */
export default function DecimalInput({
  value,
  onChange,
  min = 0,
  max,
  blankZero = false,
  className,
  placeholder,
  disabled
}: DecimalInputProps) {
  const display = (v: number) => (blankZero && v === 0 ? '' : String(v))
  const [text, setText] = useState<string>(() => display(value))
  const editingRef = useRef(false)

  // Đồng bộ từ prop khi value đổi bởi nguồn ngoài (không phải do người dùng đang gõ ô này).
  useEffect(() => {
    if (parseQtyInput(text, { min, max }) !== value) {
      setText(display(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handleChange = (raw: string) => {
    editingRef.current = true
    setText(raw)
    onChange(parseQtyInput(raw, { min, max }))
  }

  const handleBlur = () => {
    editingRef.current = false
    // Chuẩn hóa lại hiển thị (vd "18," -> "18", "" -> "0").
    setText(display(parseQtyInput(text, { min, max })))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  )
}
