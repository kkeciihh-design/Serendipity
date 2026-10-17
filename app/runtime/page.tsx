import Link from "next/link";
import { ArrowLeft, CircleCheck, FolderHeart, Laptop, Smartphone } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { getRuntimeInfo } from "@/lib/runtime-info";

export const dynamic = "force-dynamic";

export default async function RuntimePage() {
  await requirePageAppAccess();
  const info = getRuntimeInfo();
  return (
    <main className="min-h-dvh bg-cream px-5 py-8 text-charcoal sm:px-10 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-graphite"><ArrowLeft className="size-4" aria-hidden="true" />返回首页</Link>
        <p className="mt-6 text-sm font-medium text-sage">Serendipity · 日常使用</p>
        <h1 className="mt-2 text-3xl font-bold">运行状态与数据</h1>
        <section className="mt-7 rounded-2xl border border-sage/25 bg-white p-5 sm:p-7" aria-label="当前运行状态">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><CircleCheck className="size-5 text-sage" aria-hidden="true" />{info.restoreActive ? "应用运行中 · 恢复处理中" : "应用运行正常"}</h2>
          <p className="mt-3 leading-7 text-graphite">{info.localOnly ? "当前为本机实例，只允许这台电脑访问。" : "当前为手动配置的实例，访问范围由维护者设置。"}{info.managed ? "由桌面启动入口管理，关闭浏览器后仍会在后台运行。" : "当前未由桌面启动入口管理。"}</p>
          {info.restoreActive && <p className="mt-3 leading-7 text-clay">旅行写入暂时暂停，请进入数据管理查看恢复进度或接续处理。</p>}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
            <dt className="text-graphite">本次访问地址</dt><dd className="break-all">{info.localOnly ? `http://127.0.0.1:${info.port}` : "使用维护者提供的当前地址"}</dd>
            <dt className="text-graphite">启动时间</dt><dd>{info.startedAt ? new Date(info.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）" : "手动启动，未记录"}</dd>
          </dl>
          <a href="/runtime" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-sage/30 px-4 font-medium text-sage">刷新状态</a>
        </section>
        <section className="mt-5 rounded-2xl bg-white p-5 sm:p-7">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FolderHeart className="size-5 text-sage" aria-hidden="true" />旅行保存在这台电脑</h2>
          <p className="mt-3 leading-7 text-graphite">停止应用、关闭浏览器或重启电脑都不会清空旅行。数据与应用文件分开保存，启动失败时不会自动切换到空白数据库。</p>
          <p className="mt-4 text-sm font-medium">实际数据目录</p><p className="mt-2 select-all break-all rounded-lg bg-cream p-3 text-sm">{info.dataDirectory}</p>
          <p className="mt-3 break-all text-sm leading-6 text-graphite">旅行数据库：{info.databasePath}</p>
          <Link href="/settings#data-management" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-sage px-4 font-medium text-white">备份与恢复旅行</Link>
          <p className="mt-3 text-sm leading-6 text-graphite">换电脑前下载 JSON 旅行备份，并另外妥善保存。新电脑通过备份恢复搬迁，服务凭据在设置页重新配置；两个实例不会自动同步。</p>
        </section>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl bg-white p-5 sm:p-7">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Laptop className="size-5 text-sage" aria-hidden="true" />每天怎样打开</h2>
            <ol className="mt-3 list-decimal space-y-3 pl-5 leading-7 text-graphite"><li>在桌面打开“Serendipity 日常使用”，双击“启动旅行助手”，等待网页打开。</li><li>重复点击会复用已运行的应用；端口被占时会自动选择空闲地址。</li><li>先保存正在编辑的内容，再双击“停止旅行助手”。重启电脑后再次点击启动即可，无需命令。</li></ol>
            <p className="mt-4 text-sm leading-6 text-graphite">打不开时，点击同一文件夹的“运行状态”查看原因和数据位置。电脑重启后不会自动启动后台服务。</p>
          </section>
          <section className="rounded-2xl bg-white p-5 sm:p-7">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Smartphone className="size-5 text-sage" aria-hidden="true" />带到手机上使用</h2>
            <p className="mt-3 leading-7 text-graphite">出发前将文字、长图或 PDF 保存到手机。离线资料保留导出时的内容，不会实时更新地图、天气或 AI 规划。</p>
            <p className="mt-3 leading-7 text-graphite">当前没有部署个人外网地址。电脑关闭、休眠或人在外面时，手机不能连接这个本机应用进行在线重规划。</p>
            <p className="mt-4 text-sm leading-6 text-graphite">手机一页版 HTML 的 Android / iOS 真机打开方式仍待核验。以后如需在线使用，应另行部署带 HTTPS、个人密码和持久数据的单实例。</p>
          </section>
        </div>
        <details className="mt-5 rounded-2xl border border-sage/20 p-5 text-sm text-graphite"><summary className="cursor-pointer py-2">维护信息</summary><p className="mt-3 break-all">运行版本：{info.buildDirectory} · 进程：{info.pid}</p><p className="mt-2">状态为打开此页时的检查结果。应用停止后，请用桌面入口重新启动。</p></details>
      </div>
    </main>
  );
}
