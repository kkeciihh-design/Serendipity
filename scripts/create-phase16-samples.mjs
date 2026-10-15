import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Invented, anonymous samples only. No personal ticket is read or retained.
const directory = path.resolve("test-data", "phase16-samples");
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 950 }, deviceScaleFactor: 1 });
const samples = {
  normal: { date: "2026年10月29日", start: "06:30", arrival: "2026年10月29日 07:30", seat: "05车08A", fare: "票价：243.00元", kind: "已购车票" },
  missing: { date: "10月29日", start: "06:30", arrival: "", seat: "", fare: "", kind: "已购车票" },
  overnight: { date: "2026年10月29日", start: "23:30", arrival: "次日 01:20", seat: "05车08B", fare: "票价：243.00元", kind: "已购车票" },
  refund: { date: "2026年10月29日", start: "06:30", arrival: "2026年10月29日 07:30", seat: "05车08A", fare: "退款金额：220.00元", kind: "退票成功" },
  change: { date: "2026年10月29日", start: "08:30", arrival: "2026年10月29日 09:30", seat: "06车09A", fare: "票价：253.00元", kind: "改签成功" },
};
for (const [name, data] of Object.entries(samples)) {
  await page.setContent(`<html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#f0f3f6;font-family:'Microsoft YaHei',sans-serif;color:#14283d}.ticket{margin:35px;padding:36px;background:white;border:2px solid #a4b5c6;border-radius:16px}h1{font-size:32px;margin:0 0 35px}p{font-size:30px;margin:25px 0}.route{font-size:44px;font-weight:bold;display:flex;justify-content:space-between}.small{font-size:21px;color:#566}</style><div class="ticket"><h1>${data.kind}</h1><div class="route"><span>深圳北</span><span>G6012</span><span>长沙南</span></div><p>出发：${data.date} ${data.start}</p>${data.arrival ? `<p>到达：${data.arrival}</p>` : ""}<p>${data.seat} 二等座</p><p>${data.fare}</p><p class="small">合成识别样本 · 非实际班次或购票凭证</p></div></html>`);
  await page.locator(".ticket").screenshot({ path: path.join(directory, `${name}.png`) });
}
await browser.close();
await sharp(path.join(directory, "normal.png")).rotate(90).toFile(path.join(directory, "rotated.png"));
await sharp(path.join(directory, "normal.png")).blur(2.2).toFile(path.join(directory, "blurred.png"));
await sharp(path.join(directory, "normal.png")).jpeg().toFile(path.join(directory, "normal.jpg"));
await sharp(path.join(directory, "normal.png")).webp().toFile(path.join(directory, "normal.webp"));
console.log(`Created ${Object.keys(samples).length + 4} anonymous OCR samples in ${directory}`);
