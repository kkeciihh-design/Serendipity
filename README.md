# Serendipity

本机运行的 AI 旅行规划工具。输入一段旅行需求后，应用会整理需求、生成可编辑的每日行程，并管理计划版本、预算、地图、交通票据、住宿、清单、执行进度和导出文件。

## 环境要求

- Node.js 24+
- npm 10+
- Windows、macOS 或 Linux
- 可选：Microsoft Edge 或 Chromium，用于浏览器端长图/PDF 渲染

## 安装与启动

```bash
npm ci
npm run dev
```

打开 <http://127.0.0.1:3000>。

生产模式：

```bash
npm run build
npm run start -- -p 3003
```

`dev` 和 `start` 会先执行数据库迁移，再启动 Next.js。默认只监听 `127.0.0.1`，不对外网开放。

## 数据目录

默认数据目录：

- Windows：`%LOCALAPPDATA%\Serendipity`
- 其他系统：建议显式设置 `SERENDIPITY_DATA_DIR`

自定义数据目录：

```powershell
$env:SERENDIPITY_DATA_DIR = "D:\SerendipityData"
npm run dev
```

```bash
SERENDIPITY_DATA_DIR=/path/to/serendipity-data npm run dev
```

数据库位于 `<数据目录>/data/serendipity.db`。首次启动会自动创建数据库并执行 Prisma 迁移；设置密码和 AI 密钥后，密钥材料保存在 `<数据目录>/security.key`。

## 首次配置

1. 打开 <http://127.0.0.1:3000/settings>。
2. 设置本机访问密码。
3. 配置 AI 服务：Provider、Base URL、模型名称和 API Key，并执行连接测试。
4. 根据需要配置地图、天气、搜索来源。
5. 回到首页创建旅行，或在设置页的“数据管理”中恢复备份。

API Key 只保存在本机数据库，并使用本机 `security.key` 加密；不会写入仓库。

## 备份与导出

- 设置页“数据管理”支持 JSON 旅行备份与恢复。
- 行程详情页支持文字、Markdown、手机一页版 HTML、长图和 PDF 导出。
- 导出文件和备份默认保存在本机数据目录或浏览器下载目录，不会自动提交到 Git。

## 开发验证

```bash
npm test
npm run typecheck
npm run lint
npm run test:e2e
```

端到端测试需要 Playwright 浏览器：

```bash
npx playwright install chromium
```

## 仓库约定

- `.env`、`security.key`、数据库、备份、测试输出和本地数据目录均已加入 `.gitignore`。
- `public/**/ATTRIBUTION.md` 是图片和地点资料的许可署名，发布或再分发时请保留。
- 本项目仅用于本机个人使用；远程部署、多用户和公网访问不在当前支持范围内。
