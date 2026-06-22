import { describe, it, expect } from 'vitest'
import { parseHtmlInvoice } from '../../lib/invoiceParsers/htmlInvoice'

// Trích cấu trúc thật từ hóa đơn eHoaDon (ehoadondientu.com) — header dùng class
// tb-thh/tb-dvt/tb-sl/tb-dg/tb-ts, số kiểu VN "45.000", và nội dung bị mojibake.
const SAMPLE = `<!doctype html><html><head><meta charset="UTF-8"></head><body>
<table class="res-tb"><thead><tr>
<th class="tb-stt">STT</th><th class="tb-stt">TÃ­nh cháº¥t</th>
<th class="tb-stt">Loáº¡i hÃ ng hoÃ¡ Äáº·c trÆ°ng</th>
<th class="tb-thh">TÃªn hÃ ng hÃ³a, dá»‹ch vá»¥</th>
<th class="tb-dvt">ÄÆ¡n vá»‹ tÃ­nh</th><th class="tb-sl">Sá»‘ lÆ°á»£ng</th>
<th class="tb-dg">ÄÆ¡n giÃ¡</th><th class="tb-dg">Chiáº¿t kháº¥u</th>
<th class="tb-ts">Thuáº¿ suáº¥t</th><th class="tb-ttct">ThÃ nh tiá»n chÆ°a cÃ³ thuáº¿ GTGT</th>
</tr></thead><tbody>
<tr><td class="tx-center">1</td><td>HÃ ng hÃ³a</td><td></td><td class="tx-left">Dexasone 100ml</td><td>Chai</td><td>50</td><td>45.000</td><td></td><td><hhdvu>5%</hhdvu></td><td>2.250.000</td></tr>
<tr><td class="tx-center">2</td><td>HÃ ng hÃ³a</td><td></td><td class="tx-left">Selen Super 1kg (10tÃºix100g)</td><td>TÃºi</td><td>30</td><td>183.400</td><td></td><td><hhdvu>5%</hhdvu></td><td>5.502.000</td></tr>
<tr><td class="tx-center">3</td><td>HÃ ng hÃ³a</td><td></td><td class="tx-left">Giáº£m trá»« trÃªn hÃ³a ÄÆ¡n: 823.500 VNÄ</td><td></td><td></td><td></td><td></td><td><hhdvu>5%</hhdvu></td><td>0</td></tr>
</tbody></table>
<table class="res-tb"><thead><tr><th>Thuáº¿ suáº¥t</th><th>Tá»•ng tiá»n chÆ°a thuáº¿</th><th>Tá»•ng tiá»n thuáº¿</th></tr></thead>
<tbody><tr><td>5%</td><td>15.646.500</td><td>782.325</td></tr></tbody></table>
</body></html>`

describe('parseHtmlInvoice (eHoaDon)', () => {
  const res = parseHtmlInvoice(SAMPLE)

  it('bóc đúng 2 dòng hàng (bỏ dòng giảm trừ + bảng tổng)', () => {
    expect(res.lines).toHaveLength(2)
  })

  it('sửa mojibake tên hàng + số kiểu VN + đơn vị', () => {
    expect(res.lines[0]).toMatchObject({ name: 'Dexasone 100ml', qty: 50, price: 45000, unit: 'Chai', vatRate: 5 })
    expect(res.lines[1].name).toBe('Selen Super 1kg (10túix100g)')
    expect(res.lines[1].price).toBe(183400)
  })

  it('xác định thuế suất chung', () => {
    expect(res.vatRate).toBe(5)
  })
})
