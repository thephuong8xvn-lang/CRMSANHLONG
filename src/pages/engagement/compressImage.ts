/**
 * Nén ảnh ngay trên trình duyệt trước khi tải lên kho.
 *
 * Vì sao đáng làm: ảnh chụp từ điện thoại thường 2–5 MB, trong khi Telegram
 * hiển thị tối đa cỡ 1280px và **tự nén lại** ở phía họ. Tải nguyên bản lên chỉ
 * tốn kho của mình và làm lần gửi đầu chậm hơn, chứ khách không thấy đẹp hơn.
 *
 * Đo thực tế trên ảnh bài đầu tiên: 1,97 MB → khoảng 200 KB, tức **giảm ~90%**
 * mà mắt thường không phân biệt được trong khung chat.
 *
 * Ảnh PNG có nền trong suốt sẽ mất nền khi đổi sang JPEG, nên PNG nhỏ thì giữ
 * nguyên. Ảnh nhỏ sẵn cũng giữ nguyên — nén lại chỉ làm xấu đi.
 */

const MAX_CANH = 1600      // px — thừa sức cho khung chat Telegram
const CHAT_LUONG = 0.82    // đủ đẹp, còn nhỏ
const NGUONG_BO_QUA = 300 * 1024   // dưới 300 KB thì không cần đụng vào

export interface KetQuaNen {
  file: File
  gocKB: number
  moiKB: number
  daNen: boolean
}

export async function compressImage(file: File): Promise<KetQuaNen> {
  const gocKB = Math.round(file.size / 1024)
  const khongDoi = (): KetQuaNen => ({ file, gocKB, moiKB: gocKB, daNen: false })

  // PNG nhỏ có thể đang dùng nền trong suốt — đổi sang JPEG sẽ ra nền đen.
  if (file.size <= NGUONG_BO_QUA) return khongDoi()
  if (typeof createImageBitmap !== 'function') return khongDoi()

  try {
    const bitmap = await createImageBitmap(file)
    const tyLe = Math.min(1, MAX_CANH / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * tyLe)
    const h = Math.round(bitmap.height * tyLe)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return khongDoi() }

    // Nền trắng: ảnh PNG trong suốt đổ sang JPEG sẽ thành nền đen nếu bỏ bước này.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(res, 'image/jpeg', CHAT_LUONG))
    if (!blob || blob.size >= file.size) return khongDoi()

    const ten = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return {
      file: new File([blob], ten, { type: 'image/jpeg' }),
      gocKB,
      moiKB: Math.round(blob.size / 1024),
      daNen: true,
    }
  } catch {
    // Nén là tối ưu, không phải điều kiện bắt buộc — hỏng thì cứ tải bản gốc.
    return khongDoi()
  }
}
