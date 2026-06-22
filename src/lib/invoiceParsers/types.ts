// Kiểu dữ liệu chung cho bóc tách hóa đơn upload (XML/HTML/PDF).
// Kết quả được chuyển về cùng cấu trúc dòng của lưới nhập từ Drive.

export interface ParsedInvoiceLine {
  name: string
  qty: number
  price: number       // đơn giá
  unit?: string
  lot?: string        // số lô (thường KHÔNG có trên hóa đơn → nhập tay)
  mfg?: string        // NSX dạng ISO yyyy-mm-dd (thường không có)
  exp?: string        // HSD dạng ISO yyyy-mm-dd (thường không có)
  vatRate?: number    // % thuế suất theo dòng nếu bóc được
}

export interface ParsedInvoice {
  lines: ParsedInvoiceLine[]
  invoiceNo?: string
  supplierName?: string
  supplierTaxCode?: string
  vatRate?: number     // % thuế suất chung nếu xác định được
  warnings: string[]   // cảnh báo (vd thiếu lô/HSD, PDF scan…)
  format: 'xml' | 'html' | 'pdf'
}
