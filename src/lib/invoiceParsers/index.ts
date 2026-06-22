// Dispatcher: nhận File hóa đơn → ParsedInvoice (XML/HTML/PDF).
import type { ParsedInvoice } from './types'
import { parseXmlInvoice } from './xmlInvoice'
import { parseHtmlInvoice } from './htmlInvoice'

export type { ParsedInvoice, ParsedInvoiceLine } from './types'

export async function parseInvoiceFile(file: File): Promise<ParsedInvoice> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xml') || file.type === 'application/xml' || file.type === 'text/xml') {
    return parseXmlInvoice(await file.text())
  }
  if (name.endsWith('.html') || name.endsWith('.htm') || file.type === 'text/html') {
    return parseHtmlInvoice(await file.text())
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    // pdfjs-dist nặng → lazy import (tách bundle)
    const { parsePdfInvoice } = await import('./pdfInvoice')
    return parsePdfInvoice(await file.arrayBuffer())
  }
  return { lines: [], warnings: ['Định dạng không hỗ trợ. Chỉ nhận .xml, .html, .pdf.'], format: 'xml' }
}
