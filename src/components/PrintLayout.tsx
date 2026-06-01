import React from 'react';
import { useDisplaySettings } from '../contexts/DisplaySettingsContext';
import { convertVndToWords } from '../utils/numberToWords';
import {
  SalesInvoicePrintData,
  GoodsReceiptPrintData,
  ReturnPrintData,
  StockTransferPrintData,
  CashTransactionPrintData
} from '../types/print.types';

// Pseudo Code128 Barcode component
function BarcodeSVG({ value }: { value: string }) {
  if (!value) return null;
  const cleanVal = value.replace(/[^a-zA-Z0-9-]/g, '');
  
  // Deterministic bar widths pattern based on char codes
  let hash = 0;
  for (let i = 0; i < cleanVal.length; i++) {
    hash = (hash << 5) - hash + cleanVal.charCodeAt(i);
    hash |= 0;
  }
  
  const bars: number[] = [];
  let currentHash = Math.abs(hash);
  for (let i = 0; i < 35; i++) {
    bars.push((currentHash % 3) + 1); // 1, 2, or 3 units wide
    currentHash = Math.floor(currentHash / 1.4) + i;
  }
  
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="150" height="36" viewBox="0 0 150 36" className="max-w-[160px]">
        <g fill="black">
          {bars.reduce((acc, width, idx) => {
            const lastX = acc.length > 0 ? acc[acc.length - 1].x + acc[acc.length - 1].width : 0;
            if (idx % 2 === 0) {
              acc.push({ x: lastX + 1.2, width: width * 1.2 });
            } else {
              acc.push({ x: lastX, width: width * 1.2, isSpace: true });
            }
            return acc;
          }, [] as any[]).map((bar: any, idx: number) => {
            if (bar.isSpace) return null;
            return <rect key={idx} x={bar.x} y="0" width={bar.width} height="36" />;
          })}
        </g>
      </svg>
      <span className="text-[10px] tracking-[0.2em] font-mono mt-1 text-black font-semibold">{value}</span>
    </div>
  );
}


interface PrintLayoutProps {
  docType: 'invoice' | 'receipt' | 'return' | 'transfer' | 'cash_in' | 'cash_out';
  paperSize?: 'A4' | 'A5';
  orientation?: 'portrait' | 'landscape';
  data: any;
}

export default function PrintLayout({
  docType,
  paperSize = 'A4',
  orientation = 'portrait',
  data
}: PrintLayoutProps) {
  const { formatCurrency, formatDate, formatDateTime, formatQuantity, printConfig } = useDisplaySettings();

  if (!data) {
    return (
      <div className="p-8 text-center text-red-500 font-bold border border-red-200 bg-red-50 rounded-xl">
        Không có dữ liệu chứng từ để in.
      </div>
    );
  }

  // Lấy cấu hình header — ưu tiên override từ data, fallback về cấu hình admin
  const header = data.headerConfig || printConfig;

  // Lớp CSS định dạng khổ giấy
  const paperClass = {
    'A4-portrait': 'w-[210mm] min-h-[296mm] p-[15mm]',
    'A4-landscape': 'w-[297mm] min-h-[209mm] p-[15mm]',
    'A5-portrait': 'w-[148mm] min-h-[209mm] p-[10mm]',
    'A5-landscape': 'w-[209mm] min-h-[147mm] p-[10mm]',
  }[`${paperSize}-${orientation}`] || 'w-[210mm] min-h-[296mm] p-[15mm]';

  // Định nghĩa các hằng số in ấn
  const isA5 = paperSize === 'A5';

  // Chuyển tiền thành chữ
  const getAmountInWords = (amount: number) => {
    return convertVndToWords(amount);
  };

  // Render Header của chứng từ
  const renderHeader = (title: string) => (
    <div className="flex justify-between items-start border-b border-black pb-4 mb-6 text-black font-sans">
      <div className="flex-1 pr-4">
        {/* Logo Text / Image */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-8 h-8 bg-black text-white rounded flex items-center justify-center font-bold text-lg">
            SL
          </div>
          <span className="font-extrabold text-[14px] leading-tight tracking-wider text-black">
            {header.companyName}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-black">
          <strong>Địa chỉ:</strong> {header.address}
        </p>
        <p className="text-[11px] leading-relaxed text-black">
          <strong>Điện thoại:</strong> {header.phone} {header.email && <>| <strong>Email:</strong> {header.email}</>}
        </p>
        {header.mst && (
          <p className="text-[11px] leading-relaxed text-black">
            <strong>Mã số thuế:</strong> {header.mst} {header.website && <>| <strong>Website:</strong> {header.website}</>}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end justify-center text-right shrink-0">
        <h1 className="text-xl font-black tracking-tight text-black mb-2 uppercase">
          {title}
        </h1>
        <BarcodeSVG value={data.docNumber} />
      </div>
    </div>
  );

  // Render signatures section
  const renderSignatures = (roles: string[]) => (
    <div className="mt-8 page-break-inside-avoid text-black font-sans">
      <div className="grid grid-cols-5 gap-2 text-center text-[11px]">
        {roles.map((role, idx) => (
          <div key={idx} className="flex flex-col justify-between min-h-[100px]">
            <div>
              <p className="font-bold uppercase">{role}</p>
              <p className="text-[10px] text-gray-500 italic font-normal">(Ký, ghi rõ họ tên)</p>
            </div>
            {/* Chừa chỗ cho chữ ký */}
            <div className="h-12"></div>
            <div>
              {idx === 0 ? (
                <p className="font-semibold text-black">{data.createdBy}</p>
              ) : (
                <p className="border-b border-dashed border-gray-300 w-24 mx-auto"></p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Hóa đơn bán hàng
  const renderInvoice = () => {
    const invData = data as SalesInvoicePrintData;
    // Chỉ in đúng số dòng thực tế — không chèn dòng trống để chứng từ gọn 1 trang.
    const filledLines = invData.lines;

    return (
      <div className="text-black font-sans">
        {renderHeader('HÓA ĐƠN BÁN HÀNG')}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] mb-6 border-b border-dashed border-gray-300 pb-4">
          <p><strong>Khách hàng:</strong> {invData.customerName}</p>
          <p><strong>Số điện thoại:</strong> {invData.customerPhone || '-'}</p>
          <p className="col-span-2"><strong>Địa chỉ:</strong> {invData.customerAddress || '-'}</p>
          {invData.deliveryAddress && (
            <p className="col-span-2"><strong>Địa chỉ giao hàng:</strong> {invData.deliveryAddress}</p>
          )}
          <p><strong>Ngày lập:</strong> {formatDateTime(invData.createdAt)}</p>
          <p><strong>Hình thức thanh toán:</strong> <span className="capitalize">{
            invData.paymentMethod === 'cash' ? 'Tiền mặt' : 
            invData.paymentMethod === 'bank_transfer' ? 'Chuyển khoản' :
            invData.paymentMethod === 'credit' ? 'Ghi nợ công nợ' : invData.paymentMethod
          }</span></p>
          <p><strong>Kho xuất:</strong> {invData.warehouseName || '-'}</p>
          <p><strong>Người lập:</strong> {invData.createdBy}</p>
        </div>

        {/* Product Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-gray-100 border-b border-black text-center font-bold">
                <th className="border border-black px-2 py-1.5 w-8">STT</th>
                <th className="border border-black px-2 py-1.5 w-24">Mã hàng</th>
                <th className="border border-black px-2 py-1.5">Tên sản phẩm / hoạt chất</th>
                <th className="border border-black px-2 py-1.5 w-14">ĐVT</th>
                <th className="border border-black px-2 py-1.5 w-14 text-center">SL</th>
                <th className="border border-black px-2 py-1.5 w-20 text-right">Đơn giá</th>
                <th className="border border-black px-2 py-1.5 w-16 text-right">CK (dòng)</th>
                <th className="border border-black px-2 py-1.5 w-24 text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {filledLines.map((line, idx) => (
                  <tr key={line.productId} className="page-break-inside-avoid">
                    <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">{line.productCode}</td>
                    <td className="border border-black px-2 py-1">
                      <div className="font-semibold">{line.productName}</div>
                      {(line.lotNumber || line.expiryDate) && (
                        <div className="text-[9px] text-gray-600 font-mono mt-0.5">
                          {line.lotNumber && <span>Lô: {line.lotNumber}</span>}
                          {line.expiryDate && <span className="ml-3">HSD: {formatDate(line.expiryDate)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="border border-black px-2 py-1 text-center">{line.unit}</td>
                    <td className="border border-black px-2 py-1 text-center font-bold">
                      {formatQuantity(line.quantity, '')}
                    </td>
                    <td className="border border-black px-2 py-1 text-right">
                      {formatCurrency(line.unitPrice)}
                    </td>
                    <td className="border border-black px-2 py-1 text-right text-red-600">
                      {line.discount > 0 ? formatCurrency(line.discount) : '-'}
                    </td>
                    <td className="border border-black px-2 py-1 text-right font-bold">
                      {formatCurrency(line.totalAmount)}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Footer */}
        <div className="mt-4 grid grid-cols-12 gap-2 text-[12px] page-break-inside-avoid">
          <div className="col-span-7 pr-4">
            {invData.notes && (
              <p className="text-[11px] italic mb-2">
                <strong>Ghi chú:</strong> {invData.notes}
              </p>
            )}
            <p className="italic font-medium text-black">
              <strong>Bằng chữ:</strong> {invData.amountInWords || getAmountInWords(invData.grandTotal)}
            </p>
          </div>
          <div className="col-span-5 space-y-1.5 text-right font-semibold">
            <div className="flex justify-between">
              <span>Cộng tiền hàng:</span>
              <span>{formatCurrency(invData.subtotal)}</span>
            </div>
            {invData.discountTotal > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Chiết khấu đơn:</span>
                <span>-{formatCurrency(invData.discountTotal)}</span>
              </div>
            )}
            {invData.taxAmount !== undefined && invData.taxAmount > 0 && (
              <div className="flex justify-between">
                <span>VAT ({invData.taxRate}%):</span>
                <span>{formatCurrency(invData.taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-black pt-1.5 text-[14px] font-black">
              <span>TỔNG CỘNG:</span>
              <span>{formatCurrency(invData.grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Chữ ký */}
        {renderSignatures(['Người lập phiếu', 'Khách hàng', 'Người giao hàng', 'Thủ kho', 'Giám đốc'])}
      </div>
    );
  };

  // Phiếu nhập kho
  const renderReceipt = () => {
    const rcData = data as GoodsReceiptPrintData;
    const filledLines = rcData.lines;

    return (
      <div className="text-black font-sans">
        {renderHeader('PHIẾU NHẬP KHO HÀNG')}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] mb-6 border-b border-dashed border-gray-300 pb-4">
          <p><strong>Nhà cung cấp:</strong> {rcData.supplierName}</p>
          <p><strong>Số điện thoại:</strong> {rcData.supplierPhone || '-'}</p>
          <p className="col-span-2"><strong>Địa chỉ:</strong> {rcData.supplierAddress || '-'}</p>
          <p><strong>Lý do nhập:</strong> {rcData.receiptReason}</p>
          <p><strong>Kho nhận hàng:</strong> {rcData.warehouseName}</p>
          <p><strong>Ngày lập:</strong> {formatDateTime(rcData.createdAt)}</p>
          <p><strong>Số PO liên kết:</strong> {rcData.poNumber || '-'}</p>
          <p><strong>Người lập:</strong> {rcData.createdBy}</p>
        </div>

        {/* Product Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-gray-100 border-b border-black text-center font-bold">
                <th className="border border-black px-2 py-1.5 w-8">STT</th>
                <th className="border border-black px-2 py-1.5 w-24">Mã hàng</th>
                <th className="border border-black px-2 py-1.5">Tên sản phẩm / Hoạt chất</th>
                <th className="border border-black px-2 py-1.5 w-14">ĐVT</th>
                <th className="border border-black px-2 py-1.5 w-16 text-center">SL Yêu cầu</th>
                <th className="border border-black px-2 py-1.5 w-16 text-center">SL Thực nhập</th>
                <th className="border border-black px-2 py-1.5 w-20 text-right">Đơn giá vốn</th>
                <th className="border border-black px-2 py-1.5 w-24 text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {filledLines.map((line, idx) => (
                  <tr key={line.productId} className="page-break-inside-avoid">
                    <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">{line.productCode}</td>
                    <td className="border border-black px-2 py-1">
                      <div className="font-semibold">
                        {line.productName}
                        {line.isColdChain && (
                          <span className="ml-2 text-[9px] px-1 bg-blue-100 text-blue-800 font-bold border border-blue-200 rounded uppercase">
                            Chuỗi Lạnh
                          </span>
                        )}
                      </div>
                      {(line.lotNumber || line.expiryDate) && (
                        <div className="text-[9px] text-gray-600 font-mono mt-0.5">
                          {line.lotNumber && <span>Lô: {line.lotNumber}</span>}
                          {line.expiryDate && <span className="ml-3">HSD: {formatDate(line.expiryDate)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="border border-black px-2 py-1 text-center">{line.unit}</td>
                    <td className="border border-black px-2 py-1 text-center text-gray-500">
                      {line.quantityOrdered !== undefined ? formatQuantity(line.quantityOrdered, '') : '-'}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-bold">
                      {formatQuantity(line.quantityReceived, '')}
                    </td>
                    <td className="border border-black px-2 py-1 text-right">
                      {formatCurrency(line.unitPrice)}
                    </td>
                    <td className="border border-black px-2 py-1 text-right font-bold">
                      {formatCurrency(line.totalAmount)}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Footer */}
        <div className="mt-4 grid grid-cols-12 gap-2 text-[12px] page-break-inside-avoid">
          <div className="col-span-7 pr-4">
            {rcData.notes && (
              <p className="text-[11px] italic mb-2">
                <strong>Ghi chú:</strong> {rcData.notes}
              </p>
            )}
            <p className="italic font-medium text-black">
              <strong>Bằng chữ:</strong> {rcData.amountInWords || getAmountInWords(rcData.totalAmount)}
            </p>
          </div>
          <div className="col-span-5 space-y-1.5 text-right font-semibold">
            <div className="flex justify-between border-t border-black pt-1.5 text-[13px] font-black">
              <span>TỔNG GIÁ TRỊ NHẬP:</span>
              <span>{formatCurrency(rcData.totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Chữ ký */}
        {renderSignatures(['Người lập phiếu', 'Người giao hàng', 'Thủ kho nhận', 'Kế toán trưởng', 'Giám đốc'])}
      </div>
    );
  };

  // Phiếu trả hàng
  const renderReturn = () => {
    const rtData = data as ReturnPrintData;
    const filledLines = rtData.lines;

    const partnerTitle = rtData.partnerType === 'customer' ? 'Khách hàng' : 'Nhà cung cấp';

    return (
      <div className="text-black font-sans">
        {renderHeader(rtData.partnerType === 'customer' ? 'PHIẾU KHÁCH TRẢ HÀNG' : 'PHIẾU TRẢ HÀNG NCC')}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] mb-6 border-b border-dashed border-gray-300 pb-4">
          <p><strong>{partnerTitle}:</strong> {rtData.partnerName}</p>
          <p><strong>Số điện thoại:</strong> {rtData.partnerPhone || '-'}</p>
          <p className="col-span-2"><strong>Địa chỉ:</strong> {rtData.partnerAddress || '-'}</p>
          <p><strong>Lý do trả hàng:</strong> {rtData.returnReason}</p>
          <p><strong>Kho nhận trả:</strong> {rtData.warehouseName}</p>
          <p><strong>Ngày lập:</strong> {formatDateTime(rtData.createdAt)}</p>
          <p><strong>Hình thức hoàn tiền:</strong> <span className="capitalize">{
            rtData.refundMethod === 'cash' ? 'Tiền mặt' : 
            rtData.refundMethod === 'bank_transfer' ? 'Chuyển khoản' :
            rtData.refundMethod === 'credit_note' ? 'Bù trừ công nợ' : rtData.refundMethod
          }</span></p>
          <p><strong>Người lập:</strong> {rtData.createdBy}</p>
        </div>

        {/* Product Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-gray-100 border-b border-black text-center font-bold">
                <th className="border border-black px-2 py-1.5 w-8">STT</th>
                <th className="border border-black px-2 py-1.5 w-24">Mã hàng</th>
                <th className="border border-black px-2 py-1.5">Tên sản phẩm / Hoạt chất</th>
                <th className="border border-black px-2 py-1.5 w-14">ĐVT</th>
                <th className="border border-black px-2 py-1.5 w-16 text-center">SL Trả</th>
                <th className="border border-black px-2 py-1.5 w-20 text-right">Đơn giá hoàn</th>
                <th className="border border-black px-2 py-1.5 w-24 text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {filledLines.map((line, idx) => (
                  <tr key={line.productId} className="page-break-inside-avoid">
                    <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">{line.productCode}</td>
                    <td className="border border-black px-2 py-1">
                      <div className="font-semibold">{line.productName}</div>
                      {(line.lotNumber || line.expiryDate) && (
                        <div className="text-[9px] text-gray-600 font-mono mt-0.5">
                          {line.lotNumber && <span>Lô: {line.lotNumber}</span>}
                          {line.expiryDate && <span className="ml-3">HSD: {formatDate(line.expiryDate)}</span>}
                        </div>
                      )}
                    </td>
                    <td className="border border-black px-2 py-1 text-center">{line.unit}</td>
                    <td className="border border-black px-2 py-1 text-center font-bold">
                      {formatQuantity(line.quantityReturned, '')}
                    </td>
                    <td className="border border-black px-2 py-1 text-right">
                      {formatCurrency(line.unitPrice)}
                    </td>
                    <td className="border border-black px-2 py-1 text-right font-bold">
                      {formatCurrency(line.totalAmount)}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Footer */}
        <div className="mt-4 grid grid-cols-12 gap-2 text-[12px] page-break-inside-avoid">
          <div className="col-span-7 pr-4">
            {rtData.notes && (
              <p className="text-[11px] italic mb-2">
                <strong>Ghi chú:</strong> {rtData.notes}
              </p>
            )}
            <p className="italic font-medium text-black">
              <strong>Bằng chữ:</strong> {rtData.amountInWords || getAmountInWords(rtData.totalAmount)}
            </p>
          </div>
          <div className="col-span-5 space-y-1.5 text-right font-semibold">
            <div className="flex justify-between border-t border-black pt-1.5 text-[13px] font-black">
              <span>TỔNG TIỀN HOÀN TRẢ:</span>
              <span>{formatCurrency(rtData.totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Chữ ký */}
        {renderSignatures(['Người lập phiếu', partnerTitle, 'Thủ kho nhận', 'Kế toán trưởng', 'Giám đốc'])}
      </div>
    );
  };

  // Phiếu xuất kho / chuyển kho
  const renderTransfer = () => {
    const tfData = data as StockTransferPrintData;
    const filledLines = tfData.lines;

    return (
      <div className="text-black font-sans">
        {renderHeader('PHIẾU XUẤT KHO HÀNG')}

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] mb-6 border-b border-dashed border-gray-300 pb-4">
          <p><strong>Kho xuất:</strong> {tfData.fromWarehouse}</p>
          <p><strong>Nơi nhận hàng:</strong> {tfData.toWarehouse}</p>
          <p className="col-span-2"><strong>Lý do xuất:</strong> {tfData.transferReason}</p>
          {tfData.receiverName && <p><strong>Người nhận hàng:</strong> {tfData.receiverName}</p>}
          <p><strong>Ngày lập:</strong> {formatDateTime(tfData.createdAt)}</p>
          <p><strong>Người lập phiếu:</strong> {tfData.createdBy}</p>
        </div>

        {/* Product Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-gray-100 border-b border-black text-center font-bold">
                <th className="border border-black px-2 py-1.5 w-8">STT</th>
                <th className="border border-black px-2 py-1.5 w-24">Mã hàng</th>
                <th className="border border-black px-2 py-1.5">Tên sản phẩm / Vật tư thiết bị</th>
                <th className="border border-black px-2 py-1.5 w-14">ĐVT</th>
                <th className="border border-black px-2 py-1.5 w-20 text-center">SL Yêu cầu</th>
                <th className="border border-black px-2 py-1.5 w-20 text-center">SL Thực xuất</th>
                <th className="border border-black px-2 py-1.5 w-28">Số lô sản xuất</th>
                <th className="border border-black px-2 py-1.5 w-28">Hạn sử dụng</th>
              </tr>
            </thead>
            <tbody>
              {filledLines.map((line, idx) => (
                  <tr key={line.productId} className="page-break-inside-avoid">
                    <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-black px-2 py-1 font-mono">{line.productCode}</td>
                    <td className="border border-black px-2 py-1 font-semibold">{line.productName}</td>
                    <td className="border border-black px-2 py-1 text-center">{line.unit}</td>
                    <td className="border border-black px-2 py-1 text-center text-gray-500">
                      {formatQuantity(line.quantityRequested, '')}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-bold">
                      {formatQuantity(line.quantityActual, '')}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-mono">
                      {line.lotNumber || '-'}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-mono">
                      {line.expiryDate ? formatDate(line.expiryDate) : '-'}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tfData.notes && (
          <p className="text-[11px] italic mt-4 page-break-inside-avoid text-black">
            <strong>Ghi chú:</strong> {tfData.notes}
          </p>
        )}

        {/* Chữ ký */}
        {renderSignatures(['Người lập phiếu', 'Người nhận hàng', 'Người giao hàng', 'Thủ kho xuất', 'Thủ kho nhận / GĐ'])}
      </div>
    );
  };

  // Phiếu thu & Phiếu chi
  const renderCashTransaction = () => {
    const cashData = data as CashTransactionPrintData;
    const isReceipt = cashData.transactionType === 'cash_in';

    return (
      <div className="text-black font-sans leading-relaxed">
        {renderHeader(isReceipt ? 'PHIẾU THU TIỀN' : 'PHIẾU CHI TIỀN')}

        {/* Main box content */}
        <div className="border border-black p-6 rounded space-y-4 text-[13px] mb-8 bg-white text-black">
          <div className="grid grid-cols-12 gap-y-3">
            <span className="col-span-3 font-semibold">{isReceipt ? 'Người nộp tiền:' : 'Người nhận tiền:'}</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5 font-bold text-[14px]">
              {cashData.partnerName}
            </span>

            {cashData.partnerPhone && (
              <>
                <span className="col-span-3 font-semibold">Số điện thoại:</span>
                <span className="col-span-9 border-b border-dashed border-black pb-0.5">
                  {cashData.partnerPhone}
                </span>
              </>
            )}

            <span className="col-span-3 font-semibold">Địa chỉ:</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5">
              {cashData.partnerAddress || '-'}
            </span>

            <span className="col-span-3 font-semibold">Lý do {isReceipt ? 'thu' : 'chi'}:</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5">
              {cashData.reason}
            </span>

            <span className="col-span-3 font-semibold">Số tiền {isReceipt ? 'thu' : 'chi'}:</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5 font-extrabold text-[16px]">
              {formatCurrency(cashData.amount)}
            </span>

            <span className="col-span-3 font-semibold">Bằng chữ:</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5 italic font-medium">
              {cashData.amountInWords || getAmountInWords(cashData.amount)}
            </span>

            <span className="col-span-3 font-semibold">Quỹ / Tài khoản:</span>
            <span className="col-span-9 border-b border-dashed border-black pb-0.5 font-medium">
              {cashData.fundAccount}
            </span>

            {cashData.originalDocRef && (
              <>
                <span className="col-span-3 font-semibold">Kèm theo chứng từ:</span>
                <span className="col-span-9 border-b border-dashed border-black pb-0.5 font-mono">
                  {cashData.originalDocRef}
                </span>
              </>
            )}

            {cashData.notes && (
              <>
                <span className="col-span-3 font-semibold">Ghi chú thêm:</span>
                <span className="col-span-9 border-b border-dashed border-black pb-0.5 italic">
                  {cashData.notes}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Chữ ký */}
        {renderSignatures([
          'Người lập biểu',
          isReceipt ? 'Người nộp tiền' : 'Người nhận tiền',
          'Thủ quỹ',
          'Kế toán trưởng',
          'Giám đốc'
        ])}
      </div>
    );
  };

  // Chọn view thích hợp
  const getRenderContent = () => {
    switch (docType) {
      case 'invoice':
        return renderInvoice();
      case 'receipt':
        return renderReceipt();
      case 'return':
        return renderReturn();
      case 'transfer':
        return renderTransfer();
      case 'cash_in':
      case 'cash_out':
        return renderCashTransaction();
      default:
        return <div>Loại chứng từ không hợp lệ</div>;
    }
  };

  return (
    <div className="print-layout-container flex justify-center bg-transparent">
      {/* Dynamic CSS rules injected based on props for window.print() configuration */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            @page {
              size: ${paperSize.toLowerCase()} ${orientation.toLowerCase()};
              margin: ${isA5 ? '10mm' : '15mm'} 10mm ${isA5 ? '10mm' : '15mm'} 10mm;
            }
            body {
              background: white !important;
              color: black !important;
            }
            /* Bỏ chiều rộng mm cố định + padding của phần tử để tránh "lề kép"
               (lề vật lý đã do @page lo) gây tràn ngang & sang trang thừa. */
            .print-layout-container { display: block !important; }
            .print-page {
              width: 100% !important;
              max-width: none !important;
              min-height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              border: none !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              background: transparent !important;
              overflow: visible !important;
            }
          }
        `
      }} />

      {/* Render actual paper wrapper */}
      <div className={`print-page bg-white text-black shadow-lg border border-gray-200 rounded-sm box-border ${paperClass}`}>
        {getRenderContent()}
      </div>
    </div>
  );
}
