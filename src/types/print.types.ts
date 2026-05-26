/**
 * TS Interfaces cho các mẫu in chứng từ chuyên nghiệp (Print Layout)
 * Hệ thống CRM/ERP Sanh Long Vetco
 */

export interface PrintHeaderConfig {
  logoUrl?: string;
  companyName: string;
  address: string;
  phone: string;
  email?: string;
  mst?: string;
  website?: string;
}

export interface BasePrintDocument {
  docNumber: string;         // Số chứng từ (mã vạch/QR)
  createdAt: string | Date;  // Ngày lập
  createdBy: string;         // Người lập (Họ tên nhân viên)
  notes?: string;            // Ghi chú chứng từ
  headerConfig?: PrintHeaderConfig;
}

// 1. HÓA ĐƠN BÁN HÀNG
export interface InvoicePrintLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;          // Chiết khấu dòng (VND)
  totalAmount: number;       // Thành tiền (Đã trừ chiết khấu)
  lotNumber?: string;        // Số lô sản xuất (Bắt buộc cho Thuốc thú y)
  expiryDate?: string | Date;// Hạn sử dụng (Bắt buộc cho Thuốc thú y)
}

export interface SalesInvoicePrintData extends BasePrintDocument {
  customerName: string;      // Tên khách hàng / Trang trại
  customerPhone?: string;
  customerAddress?: string;
  deliveryAddress?: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'credit' | string; // Hình thức thanh toán
  warehouseName?: string;    // Kho xuất hàng
  lines: InvoicePrintLine[];
  subtotal: number;          // Cộng tiền hàng (chưa trừ CK đơn, chưa thuế)
  discountTotal: number;     // Chiết khấu đơn hàng (VND)
  taxRate?: number;          // Thuế suất (%) (ví dụ: 0, 5, 8, 10)
  taxAmount?: number;        // Tiền thuế VAT
  grandTotal: number;        // Tổng cộng thanh toán
  amountInWords: string;     // Số tiền bằng chữ
}

// 2. PHIẾU NHẬP HÀNG
export interface GoodsReceiptPrintLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantityOrdered?: number;  // Số lượng theo chứng từ
  quantityReceived: number;  // Số lượng thực nhập
  unitPrice: number;
  totalAmount: number;
  lotNumber?: string;        // Số lô sản xuất
  expiryDate?: string | Date;// Hạn sử dụng
  isColdChain?: boolean;     // Cảnh báo chuỗi lạnh (nếu là vaccine)
}

export interface GoodsReceiptPrintData extends BasePrintDocument {
  supplierName: string;      // Nhà cung cấp
  supplierPhone?: string;
  supplierAddress?: string;
  receiptReason: string;     // Lý do nhập (Nhập mua hàng, Nhập chuyển kho, v.v.)
  warehouseName: string;     // Kho nhận hàng
  poNumber?: string;         // Số đơn đặt hàng PO liên kết
  lines: GoodsReceiptPrintLine[];
  totalAmount: number;       // Tổng giá trị nhập kho
  amountInWords?: string;
}

// 3. PHIẾU TRẢ HÀNG
export interface ReturnPrintLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantityReturned: number;  // Số lượng trả
  unitPrice: number;
  totalAmount: number;
  lotNumber?: string;        // Số lô hàng trả
  expiryDate?: string | Date;
}

export interface ReturnPrintData extends BasePrintDocument {
  partnerType: 'customer' | 'supplier'; // Khách hàng trả lại hoặc Trả hàng cho NCC
  partnerName: string;       // Tên đối tác (KH hoặc NCC)
  partnerPhone?: string;
  partnerAddress?: string;
  returnReason: string;      // Lý do trả hàng
  refundMethod: 'cash' | 'bank_transfer' | 'credit_note' | string; // Hình thức hoàn tiền / bù trừ
  warehouseName: string;     // Kho nhận hàng trả lại
  lines: ReturnPrintLine[];
  totalAmount: number;       // Tổng tiền hoàn trả
  amountInWords: string;
}

// 4. PHIẾU XUẤT KHO
export interface StockTransferPrintLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantityRequested: number; // Số lượng yêu cầu
  quantityActual: number;    // Số lượng thực xuất
  lotNumber?: string;
  expiryDate?: string | Date;
}

export interface StockTransferPrintData extends BasePrintDocument {
  fromWarehouse: string;     // Kho xuất
  toWarehouse: string;       // Kho nhận (hoặc đối tượng nhận)
  transferReason: string;    // Lý do xuất (Xuất chuyển kho, Xuất hủy hỏng, Xuất test...)
  receiverName?: string;     // Người nhận hàng
  lines: StockTransferPrintLine[];
}

// 5. PHIẾU THU & 6. PHIẾU CHI
export interface CashTransactionPrintData extends BasePrintDocument {
  transactionType: 'cash_in' | 'cash_out'; // Thu hay Chi
  partnerName: string;       // Người nộp / Người nhận (Khách hàng/NCC/Nhân viên)
  partnerPhone?: string;
  partnerAddress?: string;
  reason: string;            // Lý do thu/chi
  fundAccount: string;       // Quỹ/Tài khoản nộp hoặc rút (Tiền mặt, Ngân hàng ACB...)
  amount: number;            // Số tiền
  amountInWords: string;     // Số tiền bằng chữ
  originalDocRef?: string;   // Chứng từ gốc kèm theo (ví dụ: Hóa đơn #HD-01)
}

// Hợp nhất các loại dữ liệu cho component
export type PrintDocumentData =
  | { docType: 'invoice'; data: SalesInvoicePrintData }
  | { docType: 'receipt'; data: GoodsReceiptPrintData }
  | { docType: 'return'; data: ReturnPrintData }
  | { docType: 'transfer'; data: StockTransferPrintData }
  | { docType: 'cash_in' | 'cash_out'; data: CashTransactionPrintData };
