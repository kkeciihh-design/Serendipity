import Link from "next/link";
import { cookies, headers } from "next/headers";
import { isLocalHeaders } from "@/lib/request-security";
import { verifySessionToken } from "@/lib/security";
import { getSafeSettings, isPasswordConfigured } from "@/lib/settings";
import { PasswordSetupForm } from "./components/password-setup-form";
import { SettingsLoginForm } from "./components/settings-login-form";
import { SettingsWorkspace } from "./components/settings-workspace";
import { SettingsGallery } from "@/app/components/gallery-studio";
import { activeCoverPhoto } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [cookieStore, headerStore] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const passwordConfigured = await isPasswordConfigured();
  const isLocal = isLocalHeaders(headerStore);
  const sessionToken = cookieStore.get("serendipity_session")?.value;
  const authenticated = verifySessionToken(sessionToken);
  const csrfToken = cookieStore.get("serendipity_csrf")?.value ?? "";
  const safeSettings = authenticated ? await getSafeSettings() : null;

  let pageContent;
  if (!passwordConfigured) {
    pageContent = <PasswordSetupForm isLocal={isLocal} />;
  } else if (!authenticated) {
    pageContent = <SettingsLoginForm />;
  } else {
    pageContent = (
      <SettingsWorkspace
        initialSettings={safeSettings!}
        csrfToken={csrfToken}
      />
    );
  }

  return (
    <main className="settings-page">
      {/* The same photographic cover band as /trips and /runtime: the masthead
          row and the heading share one landscape, and the warm-white workspace
          begins on a flat edge below it. The page keeps its 1440px column. */}
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
        title="AI 服务与旅行工作台"
        note="配置模型、地图与天气源，并管理本机旅行数据"
        tags={[
          "● 本机工作台",
          safeSettings?.ai.connectionStatus === "connected" ? "AI 已连接" : authenticated ? "AI 待配置" : "设置受密码保护",
        ]}
        actions={<Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/runtime">运行状态 ↗</Link>}
      />
      <div className="settings-container">
        <div className="settings-layout"><aside className="settings-sidebar"><p className="studio-eyebrow">WORKSPACE INDEX</p><nav aria-label="设置分类"><a className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-[#1E2B24]" href="#ai-service"><span>01</span>AI 模型服务</a><a className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-[#1E2B24]" href="#sources"><span>02</span>地图与天气源</a><a className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-[#1E2B24]" href="#gallery"><span>03</span>山河壁纸画廊</a><a className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-[#1E2B24]" href="#data-management"><span>04</span>数据备份与运行状态</a></nav><div className="settings-health"><span className="health-dot"/>旅行工作台<p className="text-[13px] leading-6">数据保存在本机<br/>{authenticated ? "设置会话已解锁" : "解锁后配置模型与数据服务"}</p><Link className="text-[13px]" href="/trips">回到我的旅行 ↗</Link></div></aside><div className="settings-main">{authenticated ? pageContent : <><div id="ai-service" className="settings-auth">{pageContent}</div>{isLocal && <SettingsGallery/>}</>}</div></div>
      </div>
    </main>
  );
}
