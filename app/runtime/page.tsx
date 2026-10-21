import Link from "next/link";
import { CircleCheck, HardDrive, Laptop, RefreshCw, Smartphone } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { getRuntimeInfo } from "@/lib/runtime-info";
import { activeCoverPhoto } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";

export const dynamic = "force-dynamic";

const CARD = "runtime-card";
const CARD_HEAD = "runtime-card-head";
const ROW = "runtime-row";

export default async function RuntimePage() {
  await requirePageAppAccess();
  const info = getRuntimeInfo();
  const address = info.localOnly ? `http://127.0.0.1:${info.port}` : "维护者提供的当前地址";
  const startedAt = info.startedAt
    ? new Date(info.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    : "手动启动，未记录";
  const health = [
    { label: "运行状态", value: info.restoreActive ? "恢复处理中" : "运行正常", tone: info.restoreActive ? "warn" : "ok" },
    { label: "访问范围", value: info.localOnly ? "仅本机可访问" : "外部地址", tone: "ok" },
    { label: "启动方式", value: info.managed ? "桌面入口托管" : "手动启动", tone: info.managed ? "ok" : "warn" },
    { label: "数据写入", value: info.restoreActive ? "暂时暂停" : "正常写入", tone: info.restoreActive ? "warn" : "ok" },
  ];
  return (
    <main className="runtime-page">
      {/* The same 220-260px photographic cover the other inner pages open with:
          the masthead row and the heading live inside the band, and its bottom
          edge meets the warm-white work surface flat. */}
      <EditorialCover
        photo={activeCoverPhoto()}
        nav={
          <>
            <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/">
              ← 返回首页
            </Link>
            <span className="font-serif text-sm tracking-wide text-white/75">Serendipity · 个人旅行规划工作室</span>
          </>
        }
        title="运行状态与数据"
        note="这台电脑的旅行工作台 · 数据只保存在本机"
        tags={[`● ${info.localOnly ? "本机实例" : "外网实例"}`, info.restoreActive ? "恢复处理中" : "运行正常"]}
        actions={<Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/settings">个人设置 ↗</Link>}
      />

      <div className="runtime-container runtime-shell">
        <div className={`${ROW} ${ROW}-top`}>
          <section className={CARD} aria-label="实例运行状态">
            <div className={CARD_HEAD}>
              <h2><CircleCheck aria-hidden="true" className="size-5" />实例运行状态</h2>
              <a href="/runtime" className="runtime-refresh"><RefreshCw aria-hidden="true" className="size-3.5" />刷新状态</a>
            </div>
            <p className="runtime-lead">
              {info.restoreActive ? "应用正在接续恢复，旅行写入暂时暂停。" : "应用运行正常，可以在本机继续规划旅行。"}
              停止应用、关闭浏览器或重启电脑都不会清空旅行。
            </p>
            <ul className="runtime-health">
              {health.map((item) => (
                <li key={item.label} data-tone={item.tone}>
                  <span className="runtime-health-dot" aria-hidden="true" />
                  <span className="runtime-health-label">{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
            <dl className="runtime-facts">
              <dt>本次访问地址</dt><dd className="select-all break-all">{address}</dd>
              <dt>启动时间</dt><dd>{startedAt}{info.startedAt ? "（北京时间）" : ""}</dd>
            </dl>
            {info.restoreActive ? <p className="runtime-note">旅行写入暂时暂停，请进入数据管理查看恢复进度或接续处理。</p> : null}
          </section>

          <section className={CARD} aria-label="数据存储路径与备份">
            <div className={CARD_HEAD}>
              <h2><HardDrive aria-hidden="true" className="size-5" />数据存储路径与备份</h2>
              <Link href="/settings#data-management" className="runtime-refresh">备份与恢复 ↗</Link>
            </div>
            <p className="runtime-lead">数据与应用文件分开保存，启动失败时不会自动切换到空白数据库。</p>
            <dl className="runtime-facts">
              <dt>实际数据目录</dt><dd className="select-all break-all">{info.dataDirectory}</dd>
              <dt>旅行数据库</dt><dd className="select-all break-all">{info.databasePath}</dd>
            </dl>
            <p className="runtime-note">换电脑前下载 JSON 旅行备份并另行妥善保存。新电脑通过备份恢复搬迁，服务凭据在设置页重新配置；两个实例不会自动同步。</p>
          </section>
        </div>

        <div className={`${ROW} ${ROW}-bottom`}>
          <section className={CARD}>
            <div className={CARD_HEAD}><h2><Laptop aria-hidden="true" className="size-5" />桌面启动指南</h2></div>
            <ol className="runtime-steps">
              <li>在桌面打开“Serendipity 日常使用”，双击“启动旅行助手”，等待网页打开。</li>
              <li>重复点击会复用已运行的应用；端口被占时会自动选择空闲地址。</li>
              <li>先保存正在编辑的内容，再双击“停止旅行助手”。重启电脑后再次点击启动即可，无需命令。</li>
            </ol>
            <p className="runtime-note">打不开时，点击同一文件夹的“运行状态”查看原因和数据位置。电脑重启后不会自动启动后台服务。</p>
          </section>

          <section className={CARD}>
            <div className={CARD_HEAD}><h2><Smartphone aria-hidden="true" className="size-5" />手机随身使用指南</h2></div>
            <ol className="runtime-steps">
              <li>出发前将文字、长图或 PDF 保存到手机，离线资料保留导出时的内容。</li>
              <li>离线资料不会实时更新地图、天气或 AI 规划。</li>
              <li>当前没有部署个人外网地址，电脑关闭或人在外面时手机无法连接本机应用。</li>
            </ol>
            <p className="runtime-note">手机一页版 HTML 的 Android / iOS 真机打开方式仍待核验。以后如需在线使用，应另行部署带 HTTPS、个人密码和持久数据的单实例。</p>
          </section>
        </div>

        <details className="runtime-maintenance">
          <summary>维护信息</summary>
          <p>运行版本：{info.buildDirectory} · 进程：{info.pid}</p>
          <p>状态为打开此页时的检查结果。应用停止后，请用桌面入口重新启动。</p>
        </details>

        <footer className="runtime-footer"><span>Serendipity</span><span>山水之间，自有方向。</span></footer>
      </div>
    </main>
  );
}
