"use client";

import {
  ClipboardPenLine,
  FileText,
  Info,
  PencilLine,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_DRAFT_LENGTH = 3000;

const exampleRequest = `我想在 11 月中旬去杭州玩两天，从上海出发。
两个人预算 1500 元，喜欢自然风景和老街，不想每天赶太多景点。
第二天下午要返程，最好留出买特产和走到车站的时间。`;

type TripDraft = {
  id: string;
  text: string;
  updatedAt: Date;
};

type FormFeedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const formatDraftTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

const countCharacters = (text: string) => Array.from(text).length;

export function TripDraftForm() {
  const [requestText, setRequestText] = useState("");
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitTimerRef = useRef<number | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (submitTimerRef.current !== null) {
        window.clearTimeout(submitTimerRef.current);
      }
    };
  }, []);

  const characterCount = countCharacters(requestText);
  const isOverLength = characterCount > MAX_DRAFT_LENGTH;

  const submitDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmittingRef.current) {
      setFeedback({
        tone: "error",
        message: "正在提交草稿，请稍候，不要重复点击。",
      });
      return;
    }

    if (requestText.trim().length === 0) {
      setFeedback({
        tone: "error",
        message: "请先写下你的旅行想法。空格和换行不能作为完整输入。",
      });
      textareaRef.current?.focus();
      return;
    }

    if (isOverLength) {
      setFeedback({
        tone: "error",
        message: `内容过长：当前 ${characterCount} 字，最多 ${MAX_DRAFT_LENGTH} 字。请缩短后再提交；已输入内容会保留。`,
      });
      textareaRef.current?.focus();
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFeedback({
      tone: "info",
      message: "正在创建原话草稿...",
    });

    submitTimerRef.current = window.setTimeout(() => {
      const updatedAt = new Date();
      setDraft({
        id: `draft-${updatedAt.getTime().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        text: requestText,
        updatedAt,
      });
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setFeedback({
        tone: "success",
        message: "原话草稿已更新。它暂存在当前页面中，尚未保存到本机，也没有生成行程。",
      });
    }, 250);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    if (event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  const fillExample = () => {
    if (isSubmittingRef.current) {
      return;
    }

    setRequestText(exampleRequest);
    setFeedback({
      tone: "info",
      message: "已填入示例。你可以直接修改内容，再提交为自己的草稿。",
    });
    textareaRef.current?.focus();
  };

  const editDraft = () => {
    if (!draft || isSubmittingRef.current) {
      return;
    }

    setRequestText(draft.text);
    setFeedback({
      tone: "info",
      message: "已把草稿原话放回输入框。修改后再次提交会更新同一版临时草稿。",
    });
    textareaRef.current?.focus();
  };

  return (
    <div className="mt-8 max-w-3xl space-y-5">
      <form
        ref={formRef}
        onSubmit={submitDraft}
        className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label
            htmlFor="trip-request"
            className="text-lg font-semibold text-charcoal"
          >
            旅行想法原话
          </label>
          <button
            type="button"
            onClick={fillExample}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sage-soft px-3 py-2 text-sm font-medium text-sage transition-colors hover:bg-sand/70"
          >
            <ClipboardPenLine aria-hidden="true" className="size-4" />
            填入示例
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-graphite">
          用一句或多句中文描述都可以；按 Enter 提交，按 Shift + Enter 换行。中文输入法选词时的 Enter 不会误提交。
        </p>
        <textarea
          ref={textareaRef}
          id="trip-request"
          name="trip-request"
          value={requestText}
          onChange={(event) => setRequestText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={7}
          aria-describedby="trip-request-hint trip-request-feedback"
          aria-invalid={isOverLength || feedback?.tone === "error"}
          className="mt-4 min-h-36 w-full resize-y rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal placeholder:text-graphite/65 focus:border-sage focus:outline-none"
          placeholder="例如：我想 12 月初从北京去成都玩三天，两个人，预算 3000 元，喜欢美食和轻松的市区路线。"
        />
        <p
          id="trip-request-hint"
          className={`mt-2 text-sm leading-6 ${
            isOverLength ? "text-clay" : "text-graphite"
          }`}
        >
          当前 {characterCount}/{MAX_DRAFT_LENGTH} 字；提交后仅创建原话草稿，不会解析需求或调用 AI。
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-graphite/70"
          >
            <Send aria-hidden="true" className="size-5" />
            {isSubmitting ? "正在提交..." : "创建原话草稿"}
          </button>
          <p className="flex items-center gap-2 text-sm leading-6 text-graphite">
            <Info aria-hidden="true" className="size-4 text-sage" />
            支持多行输入和粘贴
          </p>
        </div>
      </form>

      <div
        id="trip-request-feedback"
        aria-live="polite"
        className={`min-h-11 rounded-md px-4 py-3 text-base leading-7 ${
          feedback?.tone === "error"
            ? "bg-clay-soft text-clay"
            : feedback?.tone === "success"
              ? "bg-sage-soft text-sage"
              : "bg-shell text-graphite"
        }`}
      >
        {feedback?.message ??
          "提交后会在这里显示状态。空白、过长或重复点击都会有明确提示。"}
      </div>

      {draft ? (
        <article className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText aria-hidden="true" className="size-5 text-sage" />
              <h3 className="text-lg font-semibold text-charcoal">
                当前原话草稿
              </h3>
            </div>
            <span className="rounded-md bg-clay-soft px-3 py-2 text-sm font-medium text-clay">
              临时记录
            </span>
          </header>
          <p className="mt-4 whitespace-pre-wrap break-words rounded-md bg-cream px-4 py-3 text-base leading-8 text-charcoal">
            {draft.text}
          </p>
          <dl className="mt-4 grid gap-3 text-sm leading-6 text-graphite sm:grid-cols-2">
            <div>
              <dt className="font-medium text-charcoal">草稿标识</dt>
              <dd className="mt-1 break-all">{draft.id}</dd>
            </div>
            <div>
              <dt className="font-medium text-charcoal">更新时间</dt>
              <dd className="mt-1">{formatDraftTime(draft.updatedAt)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-6 text-graphite">
            它只保留在本次页面会话中，刷新后不会恢复；本阶段尚未保存到本机，也没有生成行程。
          </p>
          <button
            type="button"
            onClick={editDraft}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-sage px-4 py-2 text-base font-medium text-sage transition-colors hover:bg-sage-soft"
          >
            <PencilLine aria-hidden="true" className="size-4" />
            继续修改并重新提交
          </button>
        </article>
      ) : (
        <p className="rounded-lg border border-dashed border-sand bg-white/60 px-5 py-6 text-base leading-7 text-graphite">
          还没有草稿。提交后会原样显示你写下的内容，并保留中文、标点和换行。
        </p>
      )}
    </div>
  );
}
