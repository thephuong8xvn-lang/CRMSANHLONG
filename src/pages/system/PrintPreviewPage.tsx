import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import PrintLayout from '../../components/PrintLayout';
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
  const navigate = useNavigate();
  const { profile } = useAuth();

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

  // Sync params if they change
  useEffect(() => {
    if (docTypeParam) setDocType(docTypeParam);
    if (paperParam) setPaperSize(paperParam);
    if (layoutParam) setOrientation(layoutParam);
  }, [docTypeParam, paperParam, layoutParam]);

  // Load data based on params
  useEffect(() => {
    if (idParam && idParam !== 'mock') {
      fetchRealData(idParam);
    } else {
      loadMockData();
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
            customers:customers(farm_name, phone, address),
            owner:profiles!orders_owner_user_id_fkey(full_name),
            warehouses:warehouses(name)
          `)
          .eq('id', id)
          .single();

        if (orderErr) throw orderErr;

        const { data: lines, error: linesErr } = await supabase
          .from('order_lines')
          .select('id, product_id, quantity, unit_price, discount, line_total, product_snapshot')
          .eq('order_id', id);

        if (linesErr) throw linesErr;

        // Resolve allocations to find lot details (Batch/Lot number and Expiry Date)
        let allocationsMap: Record<string, { lot_number: string; expiry_date: string }> = {};
        if (lines && lines.length > 0) {
          const lineIds = lines.map(l => l.id);
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
          customerPhone: order.customers?.phone,
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
          lines: lines.map(line => ({
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
          lines: lines.map(line => ({
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
            orders:orders(order_code, customers(farm_name, phone, address), warehouses(name)),
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
          partnerPhone: retDoc.orders?.customers?.phone,
          partnerAddress: retDoc.orders?.customers?.address,
          returnReason: retDoc.reason,
          refundMethod: retDoc.refund_method,
          warehouseName: retDoc.orders?.warehouses?.name || 'Kho Tổng',
          totalAmount: Number(retDoc.total_amount),
          lines: lines.map(line => ({
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
          lines: lines.map(line => ({
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
            customers:customers(farm_name, phone, address),
            suppliers:suppliers(name, phone, address),
            employee:profiles!cashbook_transactions_employee_id_fkey(full_name, phone, address),
            created_by_profile:profiles!cashbook_transactions_created_by_fkey(full_name)
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
          partnerPhone = tx.customers.phone || '';
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
          fundAccount: tx.cash_fund_id ? 'Quỹ tiền mặt chi nhánh' : 'Tài khoản ngân hàng ACB',
          amount: Number(tx.amount),
          amountInWords: '',
          originalDocRef: tx.reference_no
        };
        setData(printData);
      }
    } catch (err: any) {
      console.error('Error fetching print data:', err);
      setError(`Lỗi truy vấn dữ liệu Supabase: ${err.message}. Hệ thống sẽ chuyển sang chế độ Xem trước với dữ liệu mẫu.`);
      loadMockData(); // Fallback to mock data on error so it does not crash
    } finally {
      setLoading(false);
    }
  };

  // 2. Load Mock Data for Previews
  const loadMockData = () => {
    const today = new Date();
    const docPrefix = docType === 'invoice' ? 'HD' : 
                      docType === 'receipt' ? 'PN' : 
                      docType === 'return' ? 'PT' : 
                      docType === 'transfer' ? 'PX' : 
                      docType === 'cash_in' ? 'PTT' : 'PCT';
    const docNum = `${docPrefix}-2026-${Math.floor(10000 + Math.random() * 90000)}`;

    const currentUserName = profile?.full_name || 'Đặng Thế Phương';

    switch (docType) {
      case 'invoice':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Khách mua thuốc thú y phòng dịch tả heo châu Phi. Giao hàng trước 17h.',
          customerName: 'Trang Trại Heo Giống Minh Phát',
          customerPhone: '0912.456.789',
          customerAddress: 'Ấp 4, Xã Hoài An, Huyện Hoài Nhơn, Tỉnh Bình Định',
          deliveryAddress: 'Giao trực tiếp tại chuồng nuôi số 3 - Minh Phát',
          paymentMethod: 'bank_transfer',
          warehouseName: 'Kho Lạnh Hoài An (Chuỗi vắc-xin)',
          subtotal: 13580000,
          discountTotal: 580000,
          taxRate: 5,
          taxAmount: 650000,
          grandTotal: 13650000,
          amountInWords: '',
          lines: [
            {
              productId: 'p1',
              productCode: 'VAC-0012',
              productName: 'Vaccine Dịch Tả Heo Lơ-cô-gen (Cologen 20ml)',
              unit: 'lọ',
              quantity: 20,
              unitPrice: 350000,
              discount: 10000,
              totalAmount: 6800000,
              lotNumber: 'LOT-CGL2026A',
              expiryDate: '2026-11-20'
            },
            {
              productId: 'p2',
              productCode: 'MED-0442',
              productName: 'Amoxycillin 15% LA (Đặc trị viêm phổi heo - 100ml)',
              unit: 'chai',
              quantity: 15,
              unitPrice: 280000,
              discount: 0,
              totalAmount: 4200000,
              lotNumber: 'LOT-AMX884',
              expiryDate: '2027-03-15'
            },
            {
              productId: 'p3',
              productCode: 'NUT-0199',
              productName: 'Điện giải Gluco-KC thảo dược nâng cao đề kháng',
              unit: 'gói',
              quantity: 50,
              unitPrice: 520000,
              discount: 100000,
              totalAmount: 2580000,
              lotNumber: 'LOT-GKC-995',
              expiryDate: '2028-01-10'
            }
          ]
        });
        break;
      case 'receipt':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Nhập kho lô hàng vắc-xin bảo quản lạnh khẩn cấp từ nhà phân phối Mavin.',
          supplierName: 'Công ty Cổ phần Tập đoàn Thủy sản Mavin',
          supplierPhone: '024.3218.1516',
          supplierAddress: 'Tầng 8, Tòa nhà HL, Số 82 Ngõ 84, Phố Chùa Láng, Hà Nội',
          receiptReason: 'Nhập mua hàng hóa thương mại',
          warehouseName: 'Kho Lạnh Tổng Sài Gòn (Nhiệt độ 2-8°C)',
          poNumber: 'PO-2026-8841',
          totalAmount: 45000000,
          lines: [
            {
              productId: 'p1',
              productCode: 'VAC-0044',
              productName: 'Vắc-xin Tai Xanh PRRS JXA1-R (Nhập khẩu)',
              unit: 'lọ',
              quantityOrdered: 100,
              quantityReceived: 100,
              unitPrice: 320000,
              totalAmount: 32000000,
              lotNumber: 'LOT-PRRS26-01',
              expiryDate: '2026-12-10',
              isColdChain: true
            },
            {
              productId: 'p2',
              productCode: 'VAC-0089',
              productName: 'Vắc-xin Lở Mồm Long Móng Aftogen Oleo',
              unit: 'lọ',
              quantityOrdered: 50,
              quantityReceived: 50,
              unitPrice: 260000,
              totalAmount: 13000000,
              lotNumber: 'LOT-LMLM-ABC',
              expiryDate: '2027-02-28',
              isColdChain: true
            }
          ]
        });
        break;
      case 'return':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Khách trả lại do đổi phác đồ điều trị của trạm thú y xã.',
          partnerType: 'customer',
          partnerName: 'Hộ chăn nuôi gà Lê Văn Tám',
          partnerPhone: '0977.889.911',
          partnerAddress: 'Thôn Trung Thuận, Xã Hoài Đức, Huyện Hoài Nhơn, Bình Định',
          returnReason: 'Đổi phác đồ điều trị, sản phẩm chưa khui tem bảo quản',
          refundMethod: 'credit_note',
          warehouseName: 'Kho Tổng Sanh Long',
          totalAmount: 1560000,
          lines: [
            {
              productId: 'p1',
              productCode: 'PAR-0056',
              productName: 'Tylosin Tartrate 20% (Thuốc trị hô hấp gà - 50ml)',
              unit: 'lọ',
              quantityReturned: 6,
              unitPrice: 260000,
              totalAmount: 1560000,
              lotNumber: 'LOT-TYLO-25',
              expiryDate: '2027-08-01'
            }
          ]
        });
        break;
      case 'transfer':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Xuất kho điều chuyển thiết bị và kim tiêm y tế cho trạm dịch tễ chi nhánh Phù Mỹ.',
          fromWarehouse: 'Kho Tổng Miền Trung (Bình Định)',
          toWarehouse: 'Kho Dụng Cụ Chi Nhánh Phù Mỹ',
          transferReason: 'Cấp phát dụng cụ dịch tễ mùa tiêm phòng vaccine',
          receiverName: 'BSTY. Nguyễn Văn Nam (Chi nhánh Phù Mỹ)',
          lines: [
            {
              productId: 'p1',
              productCode: 'EQU-0112',
              productName: 'Xy-lanh tự động cao cấp Socorex Thụy Sĩ (2ml)',
              unit: 'cái',
              quantityRequested: 10,
              quantityActual: 10,
              lotNumber: 'LOT-SOC-2025',
              expiryDate: '2030-12-31'
            },
            {
              productId: 'p2',
              productCode: 'EQU-0881',
              productName: 'Kim tiêm thú y siêu cứng inox 18G (Hộp 100 kim)',
              unit: 'hộp',
              quantityRequested: 20,
              quantityActual: 20,
              lotNumber: 'LOT-KIM-18G',
              expiryDate: '2029-05-20'
            }
          ]
        });
        break;
      case 'cash_in':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Khách hàng Minh Phát nộp tiền cọc hợp đồng cung ứng vaccine đợt 2.',
          transactionType: 'cash_in',
          partnerName: 'Trang Trại Heo Giống Minh Phát (Đại diện: A. Minh)',
          partnerPhone: '0912.456.789',
          partnerAddress: 'Ấp 4, Xã Hoài An, Huyện Hoài Nhơn, Tỉnh Bình Định',
          reason: 'Thu tiền đặt cọc hợp đồng cung cấp vắc-xin Cogen đợt 2 năm 2026',
          fundAccount: 'Quỹ tiền mặt văn phòng Sanh Long',
          amount: 50000000,
          amountInWords: '',
          originalDocRef: 'HD-2026-99521'
        });
        break;
      case 'cash_out':
        setData({
          docNumber: docNum,
          createdAt: today,
          createdBy: currentUserName,
          notes: 'Chi tiền điện, nước và internet văn phòng chi nhánh Hoài An tháng 5/2026.',
          transactionType: 'cash_out',
          partnerName: 'Công ty Điện lực Hoài Nhơn (VNPT + EVN)',
          partnerPhone: '1900 1006',
          partnerAddress: 'Thị trấn Bồng Sơn, Hoài Nhơn, Bình Định',
          reason: 'Thanh toán tiền điện, nước văn phòng chi nhánh Hoài An tháng 5/2026',
          fundAccount: 'Tài khoản công ty BIDV (Số: 1420546944)',
          amount: 4325000,
          amountInWords: '',
          originalDocRef: 'Hóa đơn điện số EVN-8941445'
        });
        break;
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col font-sans">
      
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
          {/* Doc Type Selector (Demo purpose only when id = mock) */}
          {(!idParam || idParam === 'mock') && (
            <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1.5 rounded-lg border border-slate-700">
              <span className="text-slate-400">Loại:</span>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as any)}
                className="bg-transparent text-white font-semibold outline-none cursor-pointer text-xs"
              >
                <option value="invoice" className="bg-slate-900">Hóa đơn</option>
                <option value="receipt" className="bg-slate-900">Phiếu nhập</option>
                <option value="return" className="bg-slate-900">Phiếu trả</option>
                <option value="transfer" className="bg-slate-900">Phiếu xuất</option>
                <option value="cash_in" className="bg-slate-900">Phiếu thu</option>
                <option value="cash_out" className="bg-slate-900">Phiếu chi</option>
              </select>
            </div>
          )}

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

          {/* Print button */}
          <button
            onClick={() => window.print()}
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg transition-all shadow-md flex items-center gap-2"
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
      <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center items-start">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-3">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-slate-500 text-sm font-semibold">Đang chuẩn bị dữ liệu trang in...</p>
          </div>
        ) : (
          <div className="transform scale-[0.85] origin-top md:scale-100 transition-all duration-300">
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
