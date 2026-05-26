/**
 * Tiện ích chuyển đổi số tiền thành chữ bằng Tiếng Việt
 * Hỗ trợ định dạng VND chuẩn cho hóa đơn, phiếu thu, phiếu chi
 */

const mangSo = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function docBlock(so: number, đầyĐủ: boolean): string {
  let chuoi = '';
  const tram = Math.floor(so / 100);
  const chuc = Math.floor((so % 100) / 10);
  const donvi = so % 10;

  if (tram > 0 || đầyĐủ) {
    chuoi += mangSo[tram] + ' trăm ';
    chuoi += docChuc(chuc, donvi);
  } else {
    chuoi += docChuc(chuc, donvi);
  }
  return chuoi;
}

function docChuc(chuc: number, donvi: number): string {
  let chuoi = '';
  if (chuc > 1) {
    chuoi += 'mươi ' + mangSo[donvi] === 'một' ? 'mốt' : mangSo[donvi];
    if (donvi === 1) chuoi = chuoi.replace('mươi một', 'mươi mốt');
    if (donvi === 5) chuoi = chuoi.replace('mươi năm', 'mươi lăm');
    if (donvi === 4) chuoi = chuoi.replace('mươi bốn', 'mươi tư');
  } else if (chuc === 1) {
    chuoi += 'mười ';
    if (donvi === 1) chuoi += 'một';
    else if (donvi === 5) chuoi += 'lăm';
    else if (donvi === 4) chuoi += 'bốn'; // Hoặc mười tư tùy vùng, thông thường mười bốn
    else if (donvi === 0) chuoi += '';
    else chuoi += mangSo[donvi];
  } else if (chuc === 0 && donvi > 0) {
    chuoi += 'lẻ ' + mangSo[donvi];
    if (donvi === 5) chuoi = chuoi.replace('lẻ năm', 'lẻ lăm'); // Hoặc lẻ năm (thường miền Nam dùng lẻ năm, miền Bắc dùng linh năm)
  }
  return chuoi;
}

export function convertVndToWords(amount: number): string {
  if (amount === 0) return 'Không đồng';
  if (isNaN(amount) || amount < 0) return 'Số tiền không hợp lệ';

  // Làm tròn số tiền
  let cleanAmount = Math.round(amount);
  
  let stringAmount = cleanAmount.toString();
  
  // Tách nhóm 3 chữ số từ phải qua trái
  const groups: string[] = [];
  while (stringAmount.length > 0) {
    groups.push(stringAmount.slice(-3));
    stringAmount = stringAmount.slice(0, -3);
  }

  // Đọc từng nhóm từ trái qua phải
  let result = '';
  const donViTinh = ['', 'ngàn', 'triệu', 'tỷ', 'ngàn tỷ', 'triệu tỷ'];

  for (let i = groups.length - 1; i >= 0; i--) {
    const num = parseInt(groups[i], 10);
    if (num > 0) {
      const groupWords = docBlock(num, i < groups.length - 1);
      result += groupWords + ' ' + donViTinh[i] + ' ';
    }
  }

  // Làm sạch chuỗi
  result = result.trim();
  if (result.startsWith('lẻ')) {
    result = result.substring(2).trim();
  }
  
  // Viết hoa chữ cái đầu và thêm hậu tố
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
    // Thay thế khoảng trắng thừa
    result = result.replace(/\s+/g, ' ');
    // Thêm hậu tố "đồng"
    return `${result} đồng chẵn.`;
  }

  return 'Không đồng';
}
