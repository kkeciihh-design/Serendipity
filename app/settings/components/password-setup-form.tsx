"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

export function PasswordSetupForm({ isLocal }: { isLocal: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({
      tone: "info",
      message: "正在设置个人密码...",
    });

    try {
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "设置个人密码失败。");
      }

      setFeedback({
        tone: "success",
        message: "个人密码已设置。",
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error ? error.message : "设置个人密码失败。",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLocal) {
    return (
      <section className="rounded-lg border border-clay/50 bg-clay-soft p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-charcoal">
          请在本机完成首次设置
        </h2>
        <p className="mt-3 text-base leading-7 text-charcoal">
          首次个人密码只能从本机浏览器设置。完成后再从其他设备访问。
        </p>
      </section>
    );
  }

  return (
    <form
      onSubmit={submitPassword}
      className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
    >
      <h2 className="flex items-center gap-2 text-xl font-semibold text-charcoal">
        <ShieldCheck aria-hidden="true" className="size-5 text-sage" />
        设置个人密码
      </h2>
      <div className="mt-5 space-y-5">
        <div>
          <label htmlFor="settings-password" className="text-base font-semibold text-charcoal">
            个人密码
          </label>
          <input
            id="settings-password"
            name="settings-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
            className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="settings-password-confirmation" className="text-base font-semibold text-charcoal">
            确认个人密码
          </label>
          <input
            id="settings-password-confirmation"
            name="settings-password-confirmation"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
            className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isSubmitting || password !== confirmation || password.length < 8}
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70 sm:w-auto"
      >
        <KeyRound aria-hidden="true" className="size-5" />
        {isSubmitting ? "正在设置..." : "设置密码"}
      </button>
      {feedback ? (
        <p
          aria-live="polite"
          className={`mt-4 rounded-md px-4 py-3 text-base leading-7 ${
            feedback.tone === "error"
              ? "bg-clay-soft text-clay"
              : feedback.tone === "success"
                ? "bg-sage-soft text-sage"
                : "bg-shell text-graphite"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}
