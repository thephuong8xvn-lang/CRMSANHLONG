import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import PrintLayout from '../../components/PrintLayout';
import { useDisplaySettings } from '../../contexts/DisplaySettingsContext';
import {
  Printer,
  ArrowLeft,
  Maximize2,
  Layers,
  RefreshCw,
  AlertCircle,
  FileText,
  FileSpreadsheet
} from 'lucide-react';

export default function PrintPreviewPage() {
  const [searchParams] = useSearchParams();

  const docTypeParam = searchParams.get('type') as any || 'invoice';
  const idParam = searchParams.get('id');
  const paperParam = searchParams.get('paper') as any || 'A4';
  const layoutParam = searchParams.get('layout') as any || 'portrait';

  // State configurations
  const [docType, setDocType] = useState<'invoice' | 'receipt' | 'return' | 'transfer' | 'cash_in' | 'cash_out'>(docTypeParam);
  const [paperSize, setPaperSize] = useState<'A4' | 'A5'>(paperParam);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(layoutParam);
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | 'excel' | 'pdf'>(null);

  // Cấu hình header công ty (tên/địa chỉ/MST...) dùng chung cho bản in & file xuất.
  const { printConfig } = useDisplaySettings();

  // Xuất Excel — thư viện exceljs nạp động trong exporter.
  const handleExportExcel = async () => {
    if (!data || exporting) return;
    setExporting('excel');
    try {
      const { generateDocumentXlsx } = await import('../../lib/exporters/documentXlsx');
      await generateDocumentXlsx(docType, data, printConfig);
    } catch (err: any) {
      console.error('Export Excel error:', err);
      setError(`Không xuất được file Excel: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  // Xuất PDF — @react-pdf/renderer + font nạp động trong exporter.
  const handleExportPdf = async () => {
    if (!data || exporting) return;
    setExporting('pdf');
    try {
      const { generateDocumentPdf } = await import('../../lib/exporters/documentPdf');
      await generateDocumentPdf(docType, data, printConfig, { paperSize, orientation });
    } catch (err: any) {
      console.error('Export PDF error:', err);
      setError(`Không xuất được file PDF: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  // Sync params if they change
  useEffect(() => {
    if (docTypeParam) setDocType(docTypeParam);
    if (paperParam) setPaperSize(paperParam);
    if (layoutParam) setOrientation(layoutParam);
  }, [docTypeParam, paperParam, layoutParam]);

  // Load data based on params — CHỈ dùng dữ liệu thật từ database, không có dữ liệu mẫu.
  useEffect(() => {
    if (idParam && idParam !== 'mock') {
      fetchRealData(idParam);
    } else {
      // Không có mã chứng từ → không thể in. Hiển thị trạng thái lỗi rõ ràng.
      setData(null);
      setLoading(false);
      setError('Thiếu mã chứng từ. Trang in chỉ hoạt động khi mở từ một chứng từ thực tế (hóa đơn, phiếu thu/chi, phiếu nhập...).');
    }
  }, [docType, idParam]);

  // 1. Fetch Real Data from Supabase
  const fetchRealData = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      if (docType === 'invoice') {
        // Fetch Order & Lines
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .select(`
            id,
            order_code,
            created_at,
            status,
            payment_status,
            payment_method,
            subtotal,
            discount_total,
            grand_total,
            paid_amount,
            debt_amount,
            delivery_address,
            notes,
            customer_id,
            warehouse_id,
            customers:customers(farm_name, address, customer_contacts(phone, is_primary)),
            owner:profiles!orders_owner_user_id_fkey(full_name),
            warehouses:warehouses(name)
          `)
          .eq('id', id)
          .single();

        if (orderErr) throw orderErr;

        // Join with products table because product_snapshot is not a column
        const { data: linesData, error: linesErr } = await supabase
          .from('order_lines')
          .select(`
            id,
            product_id,
            quantity,
            unit_price,
            discount,
            line_total,
            products:products(name, sku, unit)
          `)
          .eq('order_id', id);

        if (linesErr) throw linesErr;

        // Map relation products back to product_snapshot for backward compatibility
        const lines = (linesData || []).map((line: any) => ({
          ...line,
          product_snapshot: line.products ? {
            name: line.products.name,
            sku: line.products.sku,
            unit: line.products.unit
          } : undefined
        }));

        // Resolve allocations to find lot details (Batch/Lot number and Expiry Date)
        const allocationsMap: Record<string, { lot_number: string; expiry_date: string }> = {};
        if (lines && lines.length > 0) {
          const lineIds = lines.map((l: any) => l.id);
          const { data: allocData } = await supabase
            .from('order_line_allocations')
            .select(`
              order_line_id,
              stock_lots:stock_lots(lot_number, expiry_date)
            `)
            .in('order_line_id', lineIds);

          if (allocData) {
            allocData.forEach((a: any) => {
              if (a.stock_lots) {
                allocationsMap[a.order_line_id] = {
                  lot_number: a.stock_lots.lot_number,
                  expiry_date: a.stock_lots.expiry_date
                };
              }
            });
          }
        }

        // Map to standard sales invoice print interface
        const printData = {
          docNumber: order.order_code,
          createdAt: order.created_at,
          createdBy: order.owner?.full_name || 'Hệ thống',
          notes: order.notes,
          customerName: order.customers?.farm_name || 'Khách vãng lai',
          customerPhone: order.customers?.customer_contacts?.find((c: any) => c.is_primary)?.phone 
            || order.customers?.customer_contacts?.[0]?.phone 
            || '',
          customerAddress: order.customers?.address,
          deliveryAddress: order.delivery_address,
          paymentMethod: order.payment_method,
          warehouseName: order.warehouses?.name,
          subtotal: Number(order.subtotal),
          discountTotal: Number(order.discount_total),
          taxRate: 0, // Fallback
          taxAmount: 0,
          grandTotal: Number(order.grand_total),
          amountInWords: '',
          lines: lines.map((line: any) => ({
            productId: line.product_id,
            productCode: line.product_snapshot?.sku || 'SP',
            productName: line.product_snapshot?.name || 'Sản phẩm',
            unit: line.product_snapshot?.unit || 'lọ',
            quantity: line.quantity,
            unitPrice: Number(line.unit_price),
            discount: Number(line.discount),
            totalAmount: Number(line.line_total),
            lotNumber: allocationsMap[line.id]?.lot_number,
            expiryDate: allocationsMap[line.id]?.expiry_date
          }))
        };

        setData(printData);
      } else if (docType === 'receipt') {
        // Fetch Goods Receipt & Lines
        const { data: receipt, error: rErr } = await supabase
          .from('goods_receipts')
          .select(`
            id,
            receipt_code,
            receipt_date,
            total_amount,
            notes,
            po_id,
            purchase_orders:purchase_orders(po_code),
            suppliers:suppliers(name, phone, address),
            warehouses:warehouses(name),
            profiles:profiles(full_name)
          `)
          .eq('id', id)
          .single();

        if (rErr) throw rErr;

        const { data: lines, error: linesErr } = await supabase
          .from('goods_receipt_lines')
          .select(`
            id,
            product_id,
            quantity,
            unit_price,
            line_total,
            lot_number,
            expiry_date,
            products:products(name, code, base_unit)
          `)
          .eq('receipt_id', id);

        if (linesErr) throw linesErr;

        const printData = {
          docNumber: receipt.receipt_code,
          createdAt: receipt.receipt_date,
          createdBy: receipt.profiles?.full_name || 'Thủ kho',
          notes: receipt.notes,
          supplierName: receipt.suppliers?.name || 'NCC',
          supplierPhone: receipt.suppliers?.phone,
          supplierAddress: receipt.suppliers?.address,
          receiptReason: 'Nhập mua hàng hóa vật tư',
          warehouseName: receipt.warehouses?.name || 'Kho nhận',
          poNumber: receipt.purchase_orders?.po_code,
          totalAmount: Number(receipt.total_amount),
          lines: lines.map((line: any) => ({
            productId: line.product_id,
            productCode: line.products?.code || 'SP',
            productName: line.products?.name || 'Sản phẩm',
            unit: line.products?.base_unit || 'đơn vị',
            quantityReceived: line.quantity,
            unitPrice: Number(line.unit_price),
            totalAmount: Number(line.line_total),
            lotNumber: line.lot_number,
            expiryDate: line.expiry_date
          }))
        };
        setData(printData);
      } else if (docType === 'return') {
        // Fetch Sales Return & Lines
        const { data: retDoc, error: retErr } = await supabase
          .from('sales_returns')
          .select(`
            id,
            return_code,
            reason,
            total_amount,
            refund_method,
            created_at,
            orders:orders(order_code, customers(farm_name, address, customer_contacts(phone, is_primary)), warehouses(name)),
            profiles:profiles(full_name)
          `)
          .eq('id', id)
          .single();

        if (retErr) throw retErr;

        const { data: lines, error: linesErr } = await supabase
          .from('sales_return_lines')
          .select(`
            id,
            product_id,
            quantity,
            unit_price,
            line_total,
            products:products(name, code, base_unit),
            stock_lots(lot_number, expiry_date)
          `)
          .eq('return_id', id);

        if (linesErr) throw linesErr;

        const printData = {
          docNumber: retDoc.return_code,
          createdAt: retDoc.created_at,
          createdBy: retDoc.profiles?.full_name || 'Nhân viên',
          notes: retDoc.reason,
          partnerType: 'customer',
          partnerName: retDoc.orders?.customers?.farm_name || 'Khách hàng',
          partnerPhone: retDoc.orders?.customers?.customer_contacts?.find((c: any) => c.is_primary)?.phone 
            || retDoc.orders?.customers?.customer_contacts?.[0]?.phone 
            || '',
          partnerAddress: retDoc.orders?.customers?.address,
          returnReason: retDoc.reason,
          refundMethod: retDoc.refund_method,
          warehouseName: retDoc.orders?.warehouses?.name || 'Kho Tổng',
          totalAmount: Number(retDoc.total_amount),
          lines: lines.map((line: any) => ({
            productId: line.product_id,
            productCode: line.products?.code || 'SP',
            productName: line.products?.name || 'Sản phẩm',
            unit: line.products?.base_unit || 'đơn vị',
            quantityReturned: line.quantity,
            unitPrice: Number(line.unit_price),
            totalAmount: Number(line.line_total),
            lotNumber: line.stock_lots?.lot_number,
            expiryDate: line.stock_lots?.expiry_date
          }))
        };
        setData(printData);
      } else if (docType === 'transfer') {
        // Fetch Stock Transfer & Lines
        const { data: transfer, error: tfErr } = await supabase
          .from('stock_transfers')
          .select(`
            id,
            transfer_code,
            transfer_date,
            notes,
            from_wh:warehouses!stock_transfers_from_warehouse_fkey(name),
            to_wh:warehouses!stock_transfers_to_warehouse_fkey(name),
            profiles:profiles(full_name)
          `)
          .eq('id', id)
          .single();

        if (tfErr) throw tfErr;

        const { data: lines, error: linesErr } = await supabase
          .from('stock_transfer_lines')
          .select(`
            id,
            product_id,
            quantity,
            products:products(name, code, base_unit),
            stock_lots(lot_number, expiry_date)
          `)
          .eq('transfer_id', id);

        if (linesErr) throw linesErr;

        const printData = {
          docNumber: transfer.transfer_code,
          createdAt: transfer.transfer_date,
          createdBy: transfer.profiles?.full_name || 'Thủ kho',
          notes: transfer.notes,
          fromWarehouse: transfer.from_wh?.name || 'Kho xuất',
          toWarehouse: transfer.to_wh?.name || 'Kho nhận',
          transferReason: 'Điều chuyển hàng hóa giữa các kho nội bộ',
          lines: lines.map((line: any) => ({
            productId: line.product_id,
            productCode: line.products?.code || 'SP',
            productName: line.products?.name || 'Sản phẩm',
            unit: line.products?.base_unit || 'đơn vị',
            quantityRequested: line.quantity,
            quantityActual: line.quantity,
            lotNumber: line.stock_lots?.lot_number,
            expiryDate: line.stock_lots?.expiry_date
          }))
        };
        setData(printData);
      } else if (docType === 'cash_in' || docType === 'cash_out') {
        // Fetch Cash transaction
        const { data: tx, error: txErr } = await supabase
          .from('cashbook_transactions')
          .select(`
            id,
            transaction_code,
            flow_type,
            amount,
            transaction_date,
            description,
            reference_no,
            cash_fund_id,
            bank_account_id,
            customers:customers(farm_name, address, customer_contacts(phone, is_primary)),
            suppliers:suppliers(name, phone, address),
            employee:profiles!cashbook_transactions_employee_id_fkey(full_name, phone, address),
            created_by_profile:profiles!cashbook_transactions_created_by_fkey(full_name),
            cash_fund:cash_funds(name, code),
            bank_account:bank_accounts(bank_name, account_name, account_no)
          `)
          .eq('id', id)
          .single();

        if (txErr) throw txErr;

        // Resolve partner name
        let partnerName = 'Đối tác vãng lai';
        let partnerPhone = '';
        let partnerAddress = '';
        
        if (tx.customers) {
          partnerName = tx.customers.farm_name;
          partnerPhone = tx.customers.customer_contacts?.find((c: any) => c.is_primary)?.phone 
            || tx.customers.customer_contacts?.[0]?.phone 
            || '';
          partnerAddress = tx.customers.address || '';
        } else if (tx.suppliers) {
          partnerName = tx.suppliers.name;
          partnerPhone = tx.suppliers.phone || '';
          partnerAddress = tx.suppliers.address || '';
        } else if (tx.employee) {
          partnerName = tx.employee.full_name;
          partnerPhone = tx.employee.phone || '';
        }

        const printData = {
          docNumber: tx.transaction_code,
          createdAt: tx.transaction_date,
          createdBy: tx.created_by_profile?.full_name || 'Kế toán',
          notes: tx.description,
          transactionType: tx.flow_type,
          partnerName,
          partnerPhone,
          partnerAddress,
          reason: tx.description,
          fundAccount: tx.cash_fund
            ? `${tx.cash_fund.name}${tx.cash_fund.code ? ` (${tx.cash_fund.code})` : ''}`
            : tx.bank_account
              ? `${tx.bank_account.bank_name} - ${tx.bank_account.account_no}`
              : 'Không xác định',
          amount: Number(tx.amount),
          amountInWords: '',
          originalDocRef: tx.reference_no
        };
        setData(printData);
      }
    } catch (err: any) {
      console.error('Error fetching print data:', err);
      // KHÔNG fallback dữ liệu mẫu — tránh in nhầm chứng từ giả. Hiển thị lỗi để người dùng xử lý.
      setData(null);
      setError(`Không tải được dữ liệu chứng từ từ hệ thống: ${err.message}. Vui lòng thử lại hoặc kiểm tra quyền truy cập.`);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col font-sans print:block print:min-h-0 print:bg-white">
      
      {/* Dynamic Top bar (no-print) */}
      <div className="no-print bg-slate-900 text-slate-100 h-16 px-4 md:px-8 flex items-center justify-between border-b border-slate-800 shadow-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="Quay lại"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="h-6 w-px bg-slate-800"></span>
          <FileText className="text-blue-400" size={20} />
          <h2 className="text-sm md:text-body-md font-bold tracking-tight">
            Xem trước bản in: <span className="text-blue-400 font-mono text-[12px] ml-1">{data?.docNumber || 'Đang tải...'}</span>
          </h2>
        </div>

        {/* Configurations Controls */}
        <div className="flex items-center gap-2 md:gap-4 text-xs">
          {/* Paper Size selector */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            <button
              onClick={() => setPaperSize('A4')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                paperSize === 'A4' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              A4
            </button>
            <button
              onClick={() => setPaperSize('A5')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                paperSize === 'A5' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              A5
            </button>
          </div>

          {/* Orientation selector */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            <button
              onClick={() => setOrientation('portrait')}
              className={`px-2.5 py-1.5 rounded-md font-bold transition-all ${
                orientation === 'portrait' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Xoay dọc"
            >
              Dọc
            </button>
            <button
              onClick={() => setOrientation('landscape')}
              className={`px-2.5 py-1.5 rounded-md font-bold transition-all ${
                orientation === 'landscape' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Xoay ngang"
            >
              Ngang
            </button>
          </div>

          {/* Export Excel — chỉ bật khi đã có dữ liệu thật */}
          <button
            onClick={handleExportExcel}
            disabled={!data || loading || exporting !== null}
            className="h-9 px-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-emerald-300 font-bold rounded-lg transition-all border border-slate-700 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            title={!data ? 'Chưa có dữ liệu chứng từ' : 'Xuất file Excel (.xlsx)'}
          >
            {exporting === 'excel'
              ? <RefreshCw size={16} className="animate-spin" />
              : <FileSpreadsheet size={16} />}
            <span className="hidden md:inline">Excel</span>
          </button>

          {/* Export PDF */}
          <button
            onClick={handleExportPdf}
            disabled={!data || loading || exporting !== null}
            className="h-9 px-3 bg-slate-800 hover:bg-slate-700 active:scale-95 text-rose-300 font-bold rounded-lg transition-all border border-slate-700 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            title={!data ? 'Chưa có dữ liệu chứng từ' : 'Xuất file PDF'}
          >
            {exporting === 'pdf'
              ? <RefreshCw size={16} className="animate-spin" />
              : <FileText size={16} />}
            <span className="hidden md:inline">PDF</span>
          </button>

          {/* Print button — chỉ bật khi đã có dữ liệu thật */}
          <button
            onClick={() => window.print()}
            disabled={!data || loading}
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg transition-all shadow-md flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            title={!data ? 'Chưa có dữ liệu chứng từ để in' : 'In chứng từ'}
          >
            <Printer size={16} />
            <span className="hidden sm:inline">In chứng từ</span>
          </button>
        </div>
      </div>

      {/* Warning banner (no-print) */}
      {error && (
        <div className="no-print bg-amber-50 border-b border-amber-200 p-3 px-8 text-amber-800 flex items-center gap-3 text-xs md:text-sm">
          <AlertCircle size={16} className="text-amber-500 shrink-0" />
          <span>{error}</span>
          <button 
            onClick={() => setError(null)} 
            className="ml-auto font-bold text-amber-900 hover:underline"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Main printable sheet backdrop (no-print for surrounding layout, print-layout is printed) */}
      <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center items-start print:p-0 print:overflow-visible print:block">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-3">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-slate-500 text-sm font-semibold">Đang chuẩn bị dữ liệu trang in...</p>
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4 bg-white rounded-xl border border-slate-200 shadow-sm max-w-lg w-full mt-8">
            <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
              <AlertCircle size={28} className="text-amber-500" />
            </div>
            <p className="text-slate-700 text-base font-bold">Không có dữ liệu chứng từ để in</p>
            <p className="text-slate-500 text-sm text-center max-w-md">
              {error || 'Hệ thống chưa lấy được dữ liệu từ cơ sở dữ liệu. Trang in chỉ hiển thị chứng từ thực tế, không sử dụng dữ liệu mẫu.'}
            </p>
            <div className="flex items-center gap-3 mt-2">
              {idParam && idParam !== 'mock' && (
                <button
                  onClick={() => fetchRealData(idParam)}
                  className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors"
                >
                  <RefreshCw size={15} />
                  Thử lại
                </button>
              )}
              <button
                onClick={() => window.history.back()}
                className="h-9 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold rounded-lg flex items-center gap-2 transition-colors"
              >
                <ArrowLeft size={15} />
                Quay lại
              </button>
            </div>
          </div>
        ) : (
          <div className="transform scale-[0.85] origin-top md:scale-100 transition-all duration-300 print:transform-none print:scale-100">
            <PrintLayout
              docType={docType}
              paperSize={paperSize}
              orientation={orientation}
              data={data}
            />
          </div>
        )}
      </div>

      {/* Float helper instructions footer (no-print) */}
      <div className="no-print bg-slate-800 text-slate-400 py-3 text-center text-tiny border-t border-slate-700">
        💡 <strong>Mẹo in:</strong> Nhấn nút <strong className="text-white">In chứng từ</strong> hoặc phím tắt <kbd className="bg-slate-900 px-1.5 py-0.5 rounded text-white border border-slate-700">Ctrl + P</kbd>. Trong hộp thoại hệ thống, chọn <strong>Destination: Save as PDF</strong> hoặc máy in Laser. Đảm bảo cấu hình Margins = <strong>Default</strong> hoặc <strong>None</strong>.
      </div>
    </div>
  );
}
