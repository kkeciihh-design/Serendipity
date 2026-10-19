"use client";

import { ExternalLink, Images } from "lucide-react";
import { useState } from "react";
import type { AttractionFact, AttractionImage, AttractionSource } from "@/lib/attraction-catalog";
import type { AttractionCard } from "@/lib/attractions";
import { safeReferenceUrl } from "@/lib/transit-reference";

export function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(parsed);
}

export function Photo({ photo, compact = false }: { photo: AttractionImage | null; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  // The directory only supplies bounded local images associated with this place.
  const available = photo?.displayAllowed && /^\/(?:attractions|restaurants)\/[a-z0-9-]+\.webp$/.test(photo.url) && !failed;
  if (!available || !photo) {
    return null;
  }
  return <img src={photo.url} alt={`${photo.city} · ${photo.entityName}实景`} width={photo.width} height={photo.height}
    loading="lazy" decoding="async" onError={() => setFailed(true)}
    className={compact ? "h-24 w-24 shrink-0 rounded-md object-cover" : "aspect-[4/3] w-full rounded-md object-cover"} />;
}

export function SourceLink({ source }: { source: AttractionSource }) {
  const url = safeReferenceUrl(source.url);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 break-words text-sm font-medium text-sage underline underline-offset-4">
    {source.title}<ExternalLink aria-hidden="true" className="size-4 shrink-0" />
  </a> : <span className="text-sm">{source.title}（链接暂不可用）</span>;
}

export function FactBox({ title, fact, sources, children }: {
  title: string; fact: Omit<AttractionFact, "status"> & { status: "verified" | "pending" | "estimated" }; sources: AttractionSource[]; children?: React.ReactNode;
}) {
  const linkedSources = sources.filter((source) => fact.sourceIds.includes(source.id));
  return <div className="min-w-0 rounded-md border border-sand/80 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="font-semibold text-charcoal">{title}</dt>
      <span className={`rounded-md px-2 py-1 text-sm ${fact.status === "verified" ? "bg-sage-soft text-sage" : "bg-shell text-graphite"}`}>{fact.status === "verified" ? "本字段已核验" : fact.status === "estimated" ? "规则估算" : "建议确认"}</span>
    </div>
    <dd className="mt-2 space-y-2 text-sm leading-6 text-graphite">
      {children}
      <p>{fact.text}</p>
      {fact.notes ? <p>{fact.notes}</p> : null}
      {linkedSources.length ? <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sage underline underline-offset-4">查看{title}来源（{linkedSources.length}）</summary>
        <ul className="space-y-2">{linkedSources.map((source) => <li key={source.id}>
          <SourceLink source={source} />
          <p>{source.publisher} · 查阅于 {dateLabel(source.retrievedAt)}</p>
          {source.quote ? <blockquote className="mt-1 border-l-2 border-sand pl-3">{source.quote}</blockquote> : null}
        </li>)}</ul>
      </details> : <p>暂未取得适用来源。</p>}
    </dd>
  </div>;
}

export function Gallery({ card }: { card: Pick<AttractionCard, "images" | "id" | "name" | "city"> }) {
  const photos = card.images.filter((photo) => photo.entryId === card.id && photo.entityName === card.name && photo.city.replace(/市$/, "") === card.city.replace(/市$/, "") && photo.displayAllowed && /^\/(?:attractions|restaurants)\/[a-z0-9-]+\.webp$/.test(photo.url)).slice(0, 2);
  if (!photos.length) return null;
  return <section aria-label={`${card.name}实景与图片来源`}>
    <div className={`grid gap-3 ${photos.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {photos.map((photo) => <figure key={photo.id} className="min-w-0">
        <Photo photo={photo} />
        <figcaption className="mt-2 text-sm leading-6 text-graphite">{photo.entityName} · 摄影：{photo.author}</figcaption>
        <details className="text-sm text-graphite">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sage"><Images aria-hidden="true" className="size-4" />图片来源与许可</summary>
          <div className="space-y-1 rounded-md bg-white p-3 leading-6">
            <p>许可：{photo.license} · 查阅于 {dateLabel(photo.retrievedAt)}</p>
            <p>{photo.modification} · {photo.exportAllowed ? "允许按许可署名导出" : "仅供页面展示，暂不可导出"}</p>
            <div className="flex flex-wrap gap-x-4">
              {safeReferenceUrl(photo.sourceUrl) ? <a href={safeReferenceUrl(photo.sourceUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sage underline">原始出处<ExternalLink aria-hidden="true" className="ml-1 size-4" /></a> : null}
              {safeReferenceUrl(photo.licenseUrl) ? <a href={safeReferenceUrl(photo.licenseUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sage underline">许可条款</a> : null}
              <a href={photo.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sage underline">查看大图</a>
            </div>
          </div>
        </details>
      </figure>)}
    </div>
  </section>;
}
