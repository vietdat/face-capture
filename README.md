# Chụp mặt nhiều góc

Trang riêng, không nằm trong `dev.sh`. Mở camera trước, tự chụp năm góc (chính diện, trái/phải nhẹ, trái/phải nhiều), rồi gửi một album vào Telegram. Token bot chỉ nằm trong secret của Cloudflare.

## Việc cần làm một lần

1. Tạo bot với [@BotFather](https://t.me/BotFather), lấy token.
2. Nhắn `/start` cho bot (hoặc thêm bot vào nhóm). Mở `https://api.telegram.org/bot<token>/getUpdates` và lấy `chat.id`.
3. Chọn một mã gửi (mật khẩu riêng của trang, không phải token).

## Chạy thử

```bash
cd face-capture
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

Điền ba dòng trong `.dev.vars`, rồi mở địa chỉ `wrangler` in ra. Camera cần HTTPS hoặc localhost.

## Đưa lên Cloudflare

```bash
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put CAPTURE_KEY
npm run deploy
```

`CAPTURE_KEY` chính là mã gửi nhập trên trang.

Yaw ghi trên ảnh là góc của file không lật gương: số dương khi mũi hướng về mép phải. Chữ "trái/phải" là hướng người chụp xoay.
