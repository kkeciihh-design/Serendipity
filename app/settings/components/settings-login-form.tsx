"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LockKeyhole } from "lucide-react";

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

export function SettingsLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({
      tone: "info",
      message: "正在验证个人密码...",
    });

    try {
      const response = await fetch("/api/settings/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "验证个人密码失败。");
      }

      setFeedback({
        tone: "success",
        message: "已进入个人设置。",
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error ? error.message : "验证个人密码失败。",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={login}
      className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
    >
      <h2 className="flex items-center gap-2 text-xl font-semibold text-charcoal">
        <LockKeyhole aria-hidden="true" className="size-5 text-sage" />
        验证个人密码
      </h2>
      <label
        htmlFor="settings-login-password"
        className="mt-5 block text-base font-semibold text-charcoal"
      >
        个人密码
      </label>
      <input
        id="settings-login-password"
        name="settings-login-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        minLength={8}
        maxLength={128}
        autoComplete="current-password"
        required
        className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
      />
      <button
        type="submit"
        disabled={isSubmitting || password.length === 0}
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70 sm:w-auto"
      >
        <LogIn aria-hidden="true" className="size-5" />
        {isSubmitting ? "正在验证..." : "进入设置"}
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
