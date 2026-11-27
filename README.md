# Sổ Tạp Hoá — bản thử nghiệm 0.1

Web app bán hàng cho tiệm tạp hoá, chạy offline trên điện thoại (PWA).

## Có gì
- Bán hàng: lưới món hay bán, tìm không dấu, quét mã vạch bằng camera, nói để bán ("2 gói mì hảo hảo, 1 chai nước mắm"), bán nhanh theo số tiền
- Thanh toán: tiền mặt (tính tiền thối), chuyển khoản (tự tạo mã VietQR có sẵn số tiền), ghi nợ
- Hàng hoá: giá bán, giá vốn, mã vạch, tồn kho, báo sắp hết, ~50 món mẫu (giá gợi ý)
- Nhập hàng: cộng kho, giá vốn bình quân, ghi nợ nhà cung cấp
- Sổ nợ: khách nợ tiệm / tiệm nợ nhà cung cấp, thu tiền, tin nhắn nhắc nợ, QR trả nợ
- Báo cáo: doanh thu, tiền lời, tiền mặt/chuyển khoản/nợ, bán chạy, sổ doanh thu năm so với ngưỡng thuế, xuất CSV
- Sao lưu / khôi phục bằng file JSON; huỷ đơn bán nhầm

## Chạy
Thư mục `dist/` là app hoàn chỉnh. Đưa lên bất kỳ hosting HTTPS tĩnh nào (GitHub Pages, Netlify, Cloudflare Pages).
Mở bằng Chrome trên Android → menu ⋮ → "Thêm vào màn hình chính".

## Sửa code
Sửa trong `src/`, rồi `npm install && node build.js` để tạo lại `dist/index.html`.

## Giới hạn hiện tại
- Dữ liệu chỉ nằm trên một máy, chưa đồng bộ lên máy chủ — cần sao lưu thường xuyên
- Chưa tự xác nhận tiền chuyển khoản về (cần máy chủ + dịch vụ báo biến động số dư)
- Chưa xuất hoá đơn điện tử
