import { describe, it, expect } from 'vitest'
import { normalizeSearch, smartIncludes, smartFilter } from '../../lib/smartSearch'

const products = [
  { sku: 'THU-00292', name: 'MKV-Doxflor Oral 15ml' },
  { sku: 'PROD-01007', name: 'MKV-Doxy 50% kg (10x100g)' },
  { sku: 'SP-4427010-A', name: 'MKV-Doxy 20% kg (10x100g)' },
  { sku: 'THU-00011', name: 'MKV-Amoxgen 100ml' },
  { sku: 'THU-00500', name: 'Thuốc bổ gan thận Sanh Long' }
]
const fields = (p: { sku: string; name: string }) => [p.sku, p.name]
const names = (q: string) => smartFilter(products, q, fields).map(p => p.name)

describe('normalizeSearch', () => {
  it('bỏ dấu tiếng Việt và ký tự ngăn cách', () => {
    expect(normalizeSearch('MKV-Doxy 50% kg')).toBe('mkv doxy 50 kg')
    expect(normalizeSearch('Thuốc bổ gan thận')).toBe('thuoc bo gan than')
  })
})

describe('smartIncludes', () => {
  it('khớp qua dấu gạch nối — lỗi gốc: gõ "MKV Doxy" không ra "MKV-Doxy"', () => {
    expect(smartIncludes('MKV Doxy', 'PROD-01007', 'MKV-Doxy 50% kg (10x100g)')).toBe(true)
  })
  it('không cần đúng thứ tự từ', () => {
    expect(smartIncludes('doxy mkv', 'PROD-01007', 'MKV-Doxy 50% kg (10x100g)')).toBe(true)
  })
  it('gõ dính không khoảng trắng', () => {
    expect(smartIncludes('mkvdoxy', 'PROD-01007', 'MKV-Doxy 50% kg (10x100g)')).toBe(true)
  })
  it('bỏ dấu tiếng Việt', () => {
    expect(smartIncludes('thuoc bo gan', 'THU-00500', 'Thuốc bổ gan thận Sanh Long')).toBe(true)
  })
  it('mọi token phải khớp — không nới lỏng thành OR', () => {
    expect(smartIncludes('mkv doxy zzz', 'PROD-01007', 'MKV-Doxy 50% kg')).toBe(false)
  })
})

describe('smartFilter', () => {
  it('"mkv doxy" ra đúng 2 SP Doxy, không lẫn Doxflor/Amoxgen', () => {
    expect(names('mkv doxy')).toEqual(['MKV-Doxy 50% kg (10x100g)', 'MKV-Doxy 20% kg (10x100g)'])
  })
  it('lọc thêm bằng nồng độ: "doxy 50"', () => {
    expect(names('doxy 50')).toEqual(['MKV-Doxy 50% kg (10x100g)'])
  })
  it('SKU khớp chính xác được xếp lên đầu', () => {
    expect(names('THU-00011')[0]).toBe('MKV-Amoxgen 100ml')
  })
  it('gõ sai 1 ký tự vẫn ra (chỉ khi không có kết quả khớp chính xác)', () => {
    expect(names('doxi')).toEqual(['MKV-Doxy 50% kg (10x100g)', 'MKV-Doxy 20% kg (10x100g)'])
  })
  it('không khớp gì thì trả rỗng', () => {
    expect(names('xyz123')).toEqual([])
  })
  it('câu tìm rỗng giữ nguyên danh sách', () => {
    expect(smartFilter(products, '  ', fields)).toHaveLength(products.length)
  })
})
