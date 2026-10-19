"use client";

import { AlertCircle, ArrowRight, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { businessFetch } from "@/lib/business-fetch";
import { AUTO_PLANNING_STAGES, AutoPlanningError, autoPlanningRecoveryUrl, createTripWithPlan, type AutoPlanningStage } from "@/lib/trip-auto-planning";
import styles from "./trip-draft-form.module.css";

const MAX_DRAFT_LENGTH = 3000;
const exampleRequest = `我想在 11 月中旬去杭州玩两天，从上海出发。
两个人预算 1500 元，喜欢自然风景和老街，不想每天赶太多景点。
第二天下午要返程，最好留出买特产和走到车站的时间。`;
const quickPrompts = [
  "12月初去成都玩三天，两个人，预算3000元",
  "周末去杭州住一晚，想绕西湖安静走走",
  "青岛三天两晚看海，喜欢老建筑和海鲜",
];

export type TripDraftFormHandle = { fillInspiration: (text: string) => void };

export function TripDraftForm({ ref }: { ref?: Ref<TripDraftFormHandle> }) {
  const router = useRouter();
  const [requestText, setRequestText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [planningStage, setPlanningStage] = useState<AutoPlanningStage>("saving");
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  const savedOriginalRef = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSavingRef = useRef(false);
  const isComposingRef = useRef(false);
  const characterCount = Array.from(requestText).length;
  const isOverLength = characterCount > MAX_DRAFT_LENGTH;
  const stageIndex = AUTO_PLANNING_STAGES.findIndex((stage) => stage.id === planningStage);

  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingRef.current) return;
    if (!requestText.trim()) {
      setErrorMessage("请先写下你的旅行想法。空格和换行不能作为完整输入。");
      textareaRef.current?.focus();
      return;
    }
    if (isOverLength) {
      setErrorMessage(
        `内容过长：当前 ${characterCount} 字，最多 ${MAX_DRAFT_LENGTH} 字。请缩短后再保存；已输入内容会保留。`,
      );
      textareaRef.current?.focus();
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const tripId = await createTripWithPlan({
        originalRequest: requestText,
        fetcher: businessFetch,
        onStage: setPlanningStage,
        existingTripId: savedOriginalRef.current === requestText ? savedTripId ?? undefined : undefined,
      });
      // Keep the submission locked until navigation completes.
      router.push(`/trips/${tripId}`);
    } catch (error) {
      if (error instanceof AutoPlanningError && error.tripId) {
        setSavedTripId(error.tripId);
        savedOriginalRef.current = requestText;
        if (error.recoverInWorkspace) {
          router.push(autoPlanningRecoveryUrl(error.tripId, error.message));
          return;
        }
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "保存失败。你输入的内容没有丢，请稍后重试。",
      );
      isSavingRef.current = false;
      setIsSaving(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Some IMEs clear isComposing on the final Enter but still report 229.
    if (isComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  const fillInspiration = (text: string) => {
    if (isSavingRef.current) return;
    setRequestText(text);
    setErrorMessage(null);
    textareaRef.current?.focus();
  };

  // Gallery prompts share the same validation reset and save lock as the
  // existing inspiration buttons. Changing scenery never remounts this form.
  useImperativeHandle(ref, () => ({ fillInspiration }));

  return (
    <div id="trip-input" className={styles.studio}>
      <form ref={formRef} onSubmit={submitDraft} className={styles.card} data-testid="hero-composer" aria-label="开始一段新旅程" aria-busy={isSaving}>
        <div className={styles.inner}>
          <div className={styles.header}>
            <label htmlFor="trip-request" className={styles.label}>
              <span aria-hidden="true">✦</span> 开始一段新旅程
            </label>
            <button type="button" onClick={() => fillInspiration(exampleRequest)} disabled={isSaving} className={styles.exampleButton}>
              填入灵感示例
            </button>
          </div>
          <textarea
            ref={textareaRef}
            id="trip-request"
            name="trip-request"
            data-testid="trip-request-input"
            value={requestText}
            onChange={(event) => { setRequestText(event.target.value); setErrorMessage(null); }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            readOnly={isSaving}
            rows={2}
            aria-describedby={`trip-request-hint${isSaving ? " trip-planning-progress" : ""}${errorMessage ? " trip-request-feedback" : ""}`}
            aria-invalid={isOverLength || Boolean(errorMessage)}
            className={styles.textarea}
            placeholder="想去哪里走走？比如：和伴侣去成都三天，预算 3000 元，吃地道小馆，慢慢逛。"
          />
          <div className={styles.actions}>
            <p id="trip-request-hint" className={styles.keyboardHint}>
              <span>Enter 开启规划 · Shift + Enter 换行</span><span> · 100% 本机私密存储</span>
            </p>
            <span className={`${styles.counter} ${isOverLength ? styles.overLength : ""}`} data-testid="trip-character-count" aria-label={`已输入 ${characterCount} 字，最多 ${MAX_DRAFT_LENGTH} 字`}>
              {characterCount} / {MAX_DRAFT_LENGTH}
            </span>
            <button type="submit" disabled={isSaving} className={styles.saveButton} data-testid="create-trip-submit">
              {isSaving ? <><LoaderCircle aria-hidden="true" size={16} className={styles.spinner} />正在规划…</> : <>{savedTripId && savedOriginalRef.current === requestText ? "继续生成行程" : "开启旅程规划"}<ArrowRight aria-hidden="true" size={16} /></>}
            </button>
          </div>
          {isSaving ? (
            <div id="trip-planning-progress" className={styles.planningProgress} role="status" aria-live="polite" data-testid="trip-planning-progress" data-stage={planningStage}>
              <div><span>{AUTO_PLANNING_STAGES[stageIndex].label}</span><span>{stageIndex + 1} / {AUTO_PLANNING_STAGES.length}</span></div>
              <div className={styles.progressTrack} aria-hidden="true">{AUTO_PLANNING_STAGES.map((stage, index) => <span key={stage.id} data-active={index <= stageIndex} />)}</div>
              <p>将自动生成完整行程，日期与偏好稍后都可以调整。</p>
            </div>
          ) : null}
        </div>
      </form>

      <div className={styles.quickPrompts} role="group" aria-label="一键灵感">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" disabled={isSaving} onClick={() => fillInspiration(prompt)} className={styles.prompt} data-testid="quick-prompt">
            <span aria-hidden="true">✦</span>{prompt}
          </button>
        ))}
      </div>

      {errorMessage ? createPortal(
        <div id="trip-request-feedback" role="alert" data-testid="trip-request-feedback" className={styles.feedback}>
          <AlertCircle aria-hidden="true" size={18} />
          <p>{errorMessage}{savedTripId ? <> <Link href={`/trips/${savedTripId}`}>打开已保存旅行</Link></> : null}</p>
          <button type="button" aria-label="关闭提示" onClick={() => setErrorMessage(null)}><X aria-hidden="true" size={16} /></button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
