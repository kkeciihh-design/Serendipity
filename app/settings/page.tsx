import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";
import { cookies, headers } from "next/headers";
import { isLoopbackHost } from "@/lib/request-security";
import { verifySessionToken } from "@/lib/security";
import { getSafeSettings, isPasswordConfigured } from "@/lib/settings";
import { PasswordSetupForm } from "./components/password-setup-form";
import { SettingsLoginForm } from "./components/settings-login-form";
import { SettingsWorkspace } from "./components/settings-workspace";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [cookieStore, headerStore] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const passwordConfigured = await isPasswordConfigured();
  const isLocal = isLoopbackHost(headerStore.get("host"));
  const sessionToken = cookieStore.get("serendipity_session")?.value;
  const authenticated = verifySessionToken(sessionToken);
  const csrfToken = cookieStore.get("serendipity_csrf")?.value ?? "";

  let pageContent;
  if (!passwordConfigured) {
    pageContent = <PasswordSetupForm isLocal={isLocal} />;
  } else if (!authenticated) {
    pageContent = <SettingsLoginForm />;
  } else {
    pageContent = (
      <SettingsWorkspace
        initialSettings={await getSafeSettings()}
        csrfToken={csrfToken}
      />
    );
  }

  return (
    <main className="min-h-dvh bg-cream px-5 py-8 sm:px-10 sm:py-12 lg:px-16">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-graphite transition-colors hover:text-sage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          返回首页
        </Link>
        <header className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-sage">
              <Settings aria-hidden="true" className="size-4" />
              个人设置
            </p>
            <h1 className="mt-2 text-3xl font-bold leading-9 text-charcoal">
              AI 服务连接
            </h1>
          </div>
        </header>
        <div className="mt-6">{pageContent}</div>
      </div>
    </main>
  );
}
