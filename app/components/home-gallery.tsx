"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Camera, ExternalLink, Feather, MapPin, Settings, Shuffle } from "lucide-react";
import { destinationGallery, samplePhotography } from "@/lib/destination-gallery";
import { sampleTrips } from "@/lib/home-samples";
import { SampleTripCard } from "./sample-trip-card";
import { TripDraftForm, type TripDraftFormHandle } from "./trip-draft-form";
import { LandscapeSketch } from "./landscape-sketch";

export type HomeAesthetic = "photo" | "sketch";
const STORAGE_KEY = "serendipity:home-gallery:v1";
type GalleryPreference = { mode: HomeAesthetic; destinationId: string };
const defaultPreference: GalleryPreference = { mode: "photo", destinationId: "jiuzhaigou" };

export function HomeGallery() {
  // SSR and the first client render must match, even with saved preferences.
  const [preference, setPreference] = useState(defaultPreference);
  const formRef = useRef<TripDraftFormHandle>(null);
  const { mode } = preference;
  const destinationIndex = Math.max(0, destinationGallery.findIndex((place) => place.id === preference.destinationId));
  const destination = destinationGallery[destinationIndex];

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      const candidate = saved as Record<string, unknown>;
      setPreference({
        mode: candidate.mode === "sketch" ? "sketch" : "photo",
        destinationId: destinationGallery.find((place) => place.id === candidate.destinationId)?.id ?? "jiuzhaigou",
      });
    } catch {
      // Private browsing or invalid local data must never prevent planning.
    }
  }, []);

  const choose = (next: GalleryPreference) => {
    setPreference(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Memory-only mode is still fully usable. */ }
  };

  return (
    <main className="editorial-home" data-testid="home-gallery" data-aesthetic={mode} data-destination={destination.id}>
      <section className="home-cover" aria-labelledby="home-title">
        <div className="home-landscape" data-testid="hero-landscape" data-aesthetic={mode} data-destination={destination.id}>
          {mode === "photo" ? (
            <Image key={destination.id} priority fill src={destination.photo.src} alt={destination.photo.alt}
              sizes="100vw" className="home-cover-image" style={{ objectPosition: destination.photo.position }} />
          ) : (
            <LandscapeSketch scene={destination.id} className="home-cover-sketch" />
          )}
        </div>
        <div aria-hidden="true" className="home-cover-shade" />
        <div className="home-cover-content">
          <header className="home-navigation home-container">
            <div className="home-brand">
              <p className="home-wordmark">Serendipity</p>
              <p className="home-brand-caption">个人旅行规划工作室</p>
            </div>
            <nav className="home-navigation-actions" aria-label="主导航">
              <Link href="/trips" className="home-navigation-link">
                我的旅行
                <ArrowUpRight aria-hidden="true" className="home-nav-arrow" />
              </Link>
              <Link href="/runtime" className="home-navigation-link">运行状态</Link>
              <Link href="/settings" title="个人设置" aria-label="个人设置" className="home-settings-link">
                <Settings aria-hidden="true" size={16} strokeWidth={1.5} />
              </Link>
            </nav>
          </header>

          <div className="home-cover-story home-container">
            <p className="home-cover-kicker" aria-hidden="true">
              <span /> A LITTLE WONDER, A JOURNEY OF YOUR OWN <span />
            </p>
            <h1 id="home-title" className="home-cover-title" aria-label="从一句向往出发，把心之所向写成笃定的旅程">
              <span>从一句向往出发</span>
              <span>把心之所向写成笃定的旅程</span>
            </h1>
            <p className="home-cover-description">
              写下你想去的地方、同行的人与偏爱的节奏——路线推演、预算精算与时刻接驳，皆在你的本机妥帖排布。
            </p>
            <TripDraftForm ref={formRef} />
          </div>

          <div className="home-gallery-colophon home-container">
            <aside className="home-nameplate" data-testid="destination-nameplate" aria-label="景点风物志铭牌">
              <div className="home-place-heading" aria-live="polite" aria-atomic="true">
                <p className="home-fieldnote-label"><span>山河风物志</span><span>{String(destinationIndex + 1).padStart(2, "0")} / {String(destinationGallery.length).padStart(2, "0")}</span></p>
                <h2><MapPin aria-hidden="true" size={15} strokeWidth={1.4} />{destination.name}<span>{destination.region} · {destination.season}</span></h2>
                <p className="home-place-note">{destination.note}</p>
              </div>
              <div className="home-place-bottom">
                <button type="button" onClick={() => formRef.current?.fillInspiration(destination.prompt)}>以此地开启规划<ArrowUpRight aria-hidden="true" size={13} /></button>
                <span className="home-place-coordinates">{destination.coordinates}</span>
              </div>
            </aside>
            <a className="home-browse-link" href="#sample-trips">翻阅旅程样本 <ArrowDown aria-hidden="true" size={13} strokeWidth={1.5} /></a>
            <div className="home-gallery-controls">
              <p className="home-gallery-caption">同一份向往，两种画境</p>
              <div className="home-aesthetic-switch" role="group" aria-label="双生画境">
                <button type="button" aria-label="实景画廊模式" aria-pressed={mode === "photo"} onClick={() => choose({ ...preference, mode: "photo" })}><Camera aria-hidden="true" size={14} strokeWidth={1.5} />实景</button>
                <button type="button" aria-label="素描手账模式" aria-pressed={mode === "sketch"} onClick={() => choose({ ...preference, mode: "sketch" })}><Feather aria-hidden="true" size={14} strokeWidth={1.5} />素描</button>
              </div>
              <button className="home-next-landscape" type="button" onClick={() => choose({ ...preference, destinationId: destinationGallery[(destinationIndex + 1) % destinationGallery.length].id })}>
                <Shuffle aria-hidden="true" size={13} strokeWidth={1.5} />偶遇下一处风景<ArrowRight aria-hidden="true" size={13} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="sample-trips" className="home-showcase" aria-labelledby="lookbook-title">
        <div className="home-container">
          <div className="home-section-heading">
            <div>
              <p className="home-section-kicker"><span aria-hidden="true">THE CURATED LOOKBOOK</span><span>精选旅程</span></p>
              <h2 id="lookbook-title" className="home-section-title">一趟好旅行，当有清晰的脉络</h2>
              <p className="home-section-note">
                从每日动线、交通接驳到待核实的门票细节，翻阅三份精选样本，感受旅途如何被井然梳理。
              </p>
            </div>
            <span className="home-section-folio" aria-hidden="true">01 — 03<span>三座城，三种出发的心情</span></span>
          </div>
          <div className="home-sample-grid">
            {sampleTrips.map((trip, index) => (
              <SampleTripCard key={trip.destination} trip={trip} mode={mode} issue={String(index + 1).padStart(2, "0")} />
            ))}
          </div>
          <p className="home-sample-footnote">* 以下为内置精选样本，展示行程结构与核验维度</p>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-container">
          <div className="home-footer-signature" aria-hidden="true">
            <span>Serendipity</span><span>山水之间，自有方向。</span>
          </div>
          <div className="home-footer-colophon">
            <p>{mode === "photo" ? `当前风景：${destination.name} · 摄影 ${destination.photo.author} · ${destination.photo.license}` : `当前画境：${destination.name} · Serendipity 原创东方线描`}</p>
            <a href={destination.photo.source} className="home-license-link">
              查看图片许可<ExternalLink aria-hidden="true" size={12} />
            </a>
          </div>
          <details className="home-gallery-credits">
            <summary>图库来源与创作说明</summary>
            <p>摄影经缩放与格式优化，页面另叠加暗调渐变；原作及其修改版遵循所列许可。素描为独立创作的矢量风景意象，不用于实景导航。铭牌时节为旅行建议。</p>
            <ul>
              {[...destinationGallery.map((place) => ({ name: place.name, photo: place.photo })), ...Object.entries(samplePhotography).map(([name, photo]) => ({ name, photo }))].map(({ name, photo }) => (
                <li key={name}><span>{name} · {photo.author}</span><a href={photo.source}>原作来源</a><a href={photo.licenseUrl}>{photo.license}</a></li>
              ))}
            </ul>
          </details>
        </div>
      </footer>
    </main>
  );
}
