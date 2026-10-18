"use client";
import { businessFetch } from "@/lib/business-fetch";

import { ClipboardPenLine, Info, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import styles from "./trip-draft-form.module.css";

const MAX_DRAFT_LENGTH = 3000;

const exampleRequest = `我想在 11 月中旬去杭州玩两天，从上海出发。
两个人预算 1500 元，喜欢自然风景和老街，不想每天赶太多景点。
第二天下午要返程，最好留出买特产和走到车站的时间。`;

type FormFeedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const countCharacters = (text: string) => Array.from(text).length;

const readApiError = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  return (
    payload?.error ??
    `保存失败（HTTP ${response.status}）。你输入的内容没有丢，请稍后重试。`
  );
};

export function TripDraftForm() {
  const router = useRouter();
  const [requestText, setRequestText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSavingRef = useRef(false);

  const characterCount = countCharacters(requestText);
  const isOverLength = characterCount > MAX_DRAFT_LENGTH;

  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSavingRef.current) {
      setFeedback({
        tone: "error",
        message: "正在保存旅行，请稍候，不要重复点击。",
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
        message: `内容过长：当前 ${characterCount} 字，最多 ${MAX_DRAFT_LENGTH} 字。请缩短后再保存；已输入内容会保留。`,
      });
      textareaRef.current?.focus();
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setFeedback({
      tone: "info",
      message: "正在保存到本机数据库...",
    });

    try {
      const response = await businessFetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalRequest: requestText,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setFeedback({
        tone: "success",
        message: "旅行草稿已保存到本机。正在进入我的旅行列表...",
      });
      router.push("/trips");
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存失败。你输入的内容没有丢，请稍后重试。",
      });
      textareaRef.current?.focus();
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
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
    if (isSavingRef.current) {
      return;
    }

    setRequestText(exampleRequest);
    setFeedback({
      tone: "info",
      message: "已填入示例。你可以直接修改内容，再保存为自己的旅行草稿。",
    });
    textareaRef.current?.focus();
  };

  return (
    <div className={styles.card}>
      <form
        ref={formRef}
        onSubmit={submitDraft}
        className={styles.form}
      >
        <div className={styles.content}>
          <div className={styles.header}>
            <label htmlFor="trip-request" className={styles.label}>
              旅行想法原话
            </label>
            <button
              type="button"
              onClick={fillExample}
              className={styles.exampleButton}
            >
              <ClipboardPenLine aria-hidden="true" className="size-4" />
              填入示例
            </button>
          </div>
          <div className={styles.writingSurface}>
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
              className={styles.textarea}
              placeholder="例如：我想 12 月初从北京去成都玩三天，两个人，预算 3000 元，喜欢美食和轻松的市区路线。"
            />
          </div>
          <div className={styles.actions}>
            <button
              type="submit"
              disabled={isSaving}
              className={styles.saveButton}
            >
              <Send aria-hidden="true" className="size-4" />
              {isSaving ? "正在保存..." : "保存旅行草稿"}
            </button>
            <span className={styles.pageMark} aria-hidden="true">FIELD NOTES / 01</span>
          </div>
        </div>

        <div className={styles.statusFooter} tabIndex={0} role="region" aria-label="输入与保存说明">
          <div className={styles.marginNotes}>
            <p className={styles.keyboardHint}>
              用一句或多句中文描述都可以；按 Enter 保存，按 Shift + Enter 换行。中文输入法选词时的 Enter 不会误提交。
            </p>
            <span className={styles.separator} aria-hidden="true"> | </span>
            <p
              id="trip-request-hint"
              className={`${styles.characterHint} ${
                isOverLength ? styles.error : ""
              }`}
            >
              当前 <span className={styles.counter}>{characterCount}/{MAX_DRAFT_LENGTH}</span> 字；保存后仅创建原话草稿，不会解析需求或调用 AI。
            </p>
            <span className={styles.separator} aria-hidden="true"> | </span>
            <p className={styles.inputBadge}>
              <Info aria-hidden="true" className="size-3.5" />
              支持多行输入和粘贴
            </p>
            <span className={styles.separator} aria-hidden="true"> | </span>
            <div
              id="trip-request-feedback"
              aria-live="polite"
              className={`${styles.feedback} ${feedback ? styles.activeFeedback : ""} ${
                feedback?.tone === "error"
                  ? styles.error
                  : feedback?.tone === "success"
                    ? styles.success
                    : styles.info
              }`}
            >
              {feedback?.message ??
                "保存后会在这里显示状态。空白、过长、重复点击或数据库写入失败都会有明确提示。"}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
