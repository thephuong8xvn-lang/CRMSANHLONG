const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gdotgcrtivjdpkcchrro.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdkb3RnY3J0aXZqZHBrY2NocnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjAyMTQsImV4cCI6MjA5NTAzNjIxNH0._mW_DCZiK_94zHNVEdzUrrBRaAEYohrPfagrdSFiJeU';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log('Signing in...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'admin@sanhlongvetco.vn',
    password: 'Admin@SanhLong2026!'
  });

  if (signInError) {
    console.error('Sign in error:', signInError);
    return;
  }

  const user = signInData.user;
  console.log('Signed in successfully. User ID:', user.id);

  // Fetch pending POs
  console.log('Fetching pending POs...');
  const { data: poData, error: poErr } = await supabase
    .from('purchase_orders')
    .select(`
      id,
      po_code,
      status,
      created_at,
      warehouse_id,
      supplier:suppliers(id, name)
    `)
    .in('status', ['sent', 'partially_received'])
    .limit(1);

  if (poErr) {
    console.error('Error fetching POs:', poErr);
    return;
  }

  if (!poData || poData.length === 0) {
    console.log('No pending/partially received POs found. Fetching any PO...');
    const { data: anyPoData, error: anyPoErr } = await supabase
      .from('purchase_orders')
      .select(`
        id,
        po_code,
        status,
        created_at,
        warehouse_id,
        supplier:suppliers(id, name)
      `)
      .limit(1);
    if (anyPoErr) {
      console.error('Error fetching any PO:', anyPoErr);
      return;
    }
    poData.push(...(anyPoData || []));
  }

  if (poData.length === 0) {
    console.log('No POs found at all in the database.');
    return;
  }

  const selectedPO = poData[0];
  console.log('Selected PO for test:', selectedPO);

  console.log('Fetching PO lines...');
  const { data: linesData, error: linesErr } = await supabase
    .from('purchase_order_lines')
    .select(`
      id,
      product_id,
      quantity,
      unit_price,
      received_qty,
      product:products(
        id, 
        sku, 
        name, 
        is_lot_managed
      )
    `)
    .eq('po_id', selectedPO.id);

  if (linesErr) {
    console.error('Error fetching PO lines:', linesErr);
    return;
  }

  console.log(`Found ${linesData.length} lines:`, JSON.stringify(linesData, null, 2));

  if (linesData.length === 0) {
    console.log('PO has no lines.');
    return;
  }

  // Simulate receipt creation
  const receiptCode = `TEST-GR-${Math.floor(100000 + Math.random() * 900000)}`;
  const totalAmount = linesData.reduce((sum, line) => {
    return sum + ((line.quantity - line.received_qty) * Number(line.unit_price));
  }, 0);

  console.log('Inserting into goods_receipts...');
  const { data: gr, error: grErr } = await supabase
    .from('goods_receipts')
    .insert([{
      receipt_code: receiptCode,
      po_id: selectedPO.id,
      supplier_id: selectedPO.supplier ? selectedPO.supplier.id : null,
      warehouse_id: selectedPO.warehouse_id,
      receipt_date: new Date().toISOString().split('T')[0],
      total_amount: totalAmount,
      received_by: user.id,
      notes: `Test Nhập kho từ PO: ${selectedPO.po_code}`
    }])
    .select()
    .single();

  if (grErr) {
    console.error('Error inserting goods_receipts:', grErr);
    return;
  }

  console.log('Inserted goods_receipt successfully:', gr);

  console.log('Inserting into goods_receipt_lines...');
  const grLinesToInsert = linesData.map(line => {
    return {
      receipt_id: gr.id,
      po_line_id: line.id,
      product_id: line.product_id,
      quantity: Math.max(1, line.quantity - line.received_qty),
      unit_price: Number(line.unit_price),
      lot_number: line.product.is_lot_managed ? `L-${Math.floor(1000 + Math.random() * 9000)}` : null,
      manufacture_date: new Date().toISOString().split('T')[0],
      expiry_date: new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0]
    };
  });

  console.log('Lines to insert:', grLinesToInsert);
  const { data: grLines, error: grLinesErr } = await supabase
    .from('goods_receipt_lines')
    .insert(grLinesToInsert)
    .select();

  if (grLinesErr) {
    console.error('Error inserting goods_receipt_lines:', grLinesErr);
    // Let's clean up receipt since it failed
    console.log('Cleaning up goods_receipt after error...');
    await supabase.from('goods_receipts').delete().eq('id', gr.id);
    return;
  }

  console.log('Inserted goods_receipt_lines successfully:', grLines);
  console.log('SUCCESS! Goods Receipt simulation completed without errors.');
}

run();
