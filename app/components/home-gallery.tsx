"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Camera, ExternalLink, Feather, MapPin, Settings, Shuffle } from "lucide-react";
import { destinationGallery, mergeGallery, nextGalleryDestination, samplePhotography, type GalleryDestination, type GalleryOverride } from "@/lib/destination-gallery";
import { GalleryStudio, GALLERY_EVENT } from "./gallery-studio";
import { sampleTrips } from "@/lib/home-samples";
import { SampleTripCard } from "./sample-trip-card";
import { TripDraftForm, type TripDraftFormHandle } from "./trip-draft-form";
import { LandscapeSketch } from "./landscape-sketch";

export type HomeAesthetic = "photo" | "sketch";
const STORAGE_KEY = "serendipity:home-gallery:v1";
type GalleryPreference = { mode: HomeAesthetic; destinationId: string };
type GalleryResponse = { places?: GalleryDestination[]; overrides?: Record<string, GalleryOverride> };
const defaultPreference: GalleryPreference = { mode: "photo", destinationId: "jiuzhaigou" };
const ROTATION_KEY = "serendipity:gallery-rotation:v1";
const ROTATION_INTERVALS = [30000, 60000, 300000] as const;
const ROTATION_INTERVAL_LABELS: Record<number, string> = {
  30000: "30秒",
  60000: "1分钟",
  300000: "5分钟",
};

export function HomeGallery() {
  // SSR and the first client render must match, even with saved preferences.
  const [preference, setPreference] = useState(defaultPreference);
  const [places, setPlaces] = useState<readonly GalleryDestination[]>(destinationGallery);
  const [rotation, setRotation] = useState({ enabled: true, interval: 30000 });
  const [deterministic, setDeterministic] = useState(true);
  const [studioOpen, setStudioOpen] = useState(false);
  const [previous, setPrevious] = useState<GalleryDestination | null>(null);
  const interacted = useRef(false);
  const formRef = useRef<TripDraftFormHandle>(null);
  const { mode } = preference;
  const destinationIndex = Math.max(0, places.findIndex((place) => place.id === preference.destinationId && (mode !== "photo" || place.photoKind !== "atmosphere")));
  const destination = places[destinationIndex];

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fixed = navigator.webdriver || query.has("gallery") || query.get("rotation") === "off" || query.has("test");
    setDeterministic(fixed);
    let selected = defaultPreference;
    let auto = { enabled: true, interval: 30000 };
    try {
      const savedRotation = JSON.parse(localStorage.getItem(ROTATION_KEY) ?? "null");
      if (savedRotation) auto = { enabled: savedRotation.enabled !== false, interval: ROTATION_INTERVALS.includes(savedRotation.interval) ? savedRotation.interval : 30000 };
      setRotation(auto);
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      const candidate = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
      selected = {
        mode: candidate.mode === "sketch" ? "sketch" : "photo",
        destinationId: typeof candidate.destinationId === "string" ? candidate.destinationId : "jiuzhaigou",
      };
    } catch {
      // Private browsing or invalid local data must never prevent planning.
    }
    let active = true;
    const restore = (data: GalleryResponse | null) => {
      if (!active) return;
      const all = mergeGallery(data?.places ?? [], data?.overrides); setPlaces(all);
      if (interacted.current) return;
      const queryMode = query.get("mode");
      const mode = queryMode === "sketch" || queryMode === "photo" ? queryMode : selected.mode;
      const initialId = query.get("gallery") ?? (mode === "photo" ? "jiuzhaigou" : selected.destinationId);
      const index = Math.max(0, all.findIndex(place => place.id === initialId && (mode !== "photo" || place.photoKind !== "atmosphere")));
      const next = { ...selected, mode, destinationId: all[index].id }; setPreference(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Preference remains available in memory. */ }
    };
    void fetch("/api/gallery").then(r=>r.ok ? r.json() : null).then(restore).catch(()=>restore(null));
    return ()=>{ active = false; };
  }, []);

  const refreshGallery = () => { void fetch("/api/gallery").then(r=>r.ok ? r.json() : null).then((data: GalleryResponse | null)=>{ if(data) setPlaces(mergeGallery(data.places ?? [], data.overrides)); }).catch(()=>{}); };
  useEffect(()=>{ window.addEventListener(GALLERY_EVENT, refreshGallery); return ()=>window.removeEventListener(GALLERY_EVENT, refreshGallery); }, []);
  useEffect(()=>{ if (!previous) return; const timer = setTimeout(()=>setPrevious(null), 1100); return ()=>clearTimeout(timer); }, [previous]);

  const choose = (next: GalleryPreference) => {
    interacted.current = true;
    if (next.mode === "photo" && (mode !== "photo" || places.find(place => place.id === next.destinationId)?.photoKind === "atmosphere")) next = { ...next, destinationId: defaultPreference.destinationId };
    if (next.mode !== mode) setPrevious(null);
    else if (next.destinationId !== destination.id) setPrevious(destination);
    setPreference(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Memory-only mode is still fully usable. */ }
  };
  useEffect(() => {
    if (!rotation.enabled || deterministic || studioOpen) return;
    const timer = setInterval(() => {
      if (document.hidden || document.querySelector("dialog[open]") || document.activeElement?.matches("input, textarea, select")) return;
      const index = Math.max(0, places.findIndex(place=>place.id === preference.destinationId));
      setPrevious(places[index]);
      const next = { ...preference, destinationId: nextGalleryDestination(places, preference.destinationId, mode === "photo").id };
      setPreference(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Preference remains available in memory. */ }
    }, rotation.interval);
    return ()=>clearInterval(timer);
  }, [rotation, deterministic, studioOpen, places, preference]);
  const updateRotation = (next: typeof rotation) => { setRotation(next); try { localStorage.setItem(ROTATION_KEY, JSON.stringify(next)); } catch { /* Preference remains available in memory. */ } };
  const rotationInterval = ROTATION_INTERVALS.includes(rotation.interval as typeof ROTATION_INTERVALS[number])
    ? rotation.interval
    : 30000;

  return (
    <main className="editorial-home" data-testid="home-gallery" data-aesthetic={mode} data-destination={destination.id}>
      <section className="home-cover" aria-labelledby="home-title">
        {previous && <div className="home-landscape home-landscape-previous" aria-hidden="true">{mode === "photo" ? <Image fill unoptimized src={previous.photo.src} alt="" sizes="100vw" className="home-cover-image"/> : <LandscapeSketch scene={previous.id} parameters={previous.visual} name={previous.name} className="home-cover-sketch"/>}</div>}
        <div className="home-landscape" data-testid="hero-landscape" data-aesthetic={mode} data-destination={destination.id}>
          {mode === "photo" ? (
            <Image key={destination.id} preload fill unoptimized={destination.custom || destination.photo.src.startsWith("/api/gallery/")} src={destination.photo.src} alt={destination.photo.alt}
              sizes="100vw" className="home-cover-image" style={{ objectPosition: destination.photo.position }} />
          ) : (
            <LandscapeSketch key={destination.id} scene={destination.id} parameters={destination.visual} name={destination.name} className="home-cover-sketch" />
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
                <p className="home-fieldnote-label"><span>山河风物志{destination.photoKind === "atmosphere" && mode === "photo" ? " · 光影意象" : ""}</span><span>{String(destinationIndex + 1).padStart(2, "0")} / {String(places.length).padStart(2, "0")}</span></p>
                <h2 className="text-xl"><MapPin aria-hidden="true" size={15} strokeWidth={1.4} />{destination.name}<span>{destination.region} · {destination.season}</span></h2>
                <p className="home-place-note text-[14px] leading-relaxed">{destination.note}</p>
              </div>
              <div className="home-place-bottom">
                <button type="button" className="text-[13px]" onClick={() => formRef.current?.fillInspiration(destination.prompt)}>以此地开启规划<ArrowUpRight aria-hidden="true" size={13} /></button>
                <span className="home-place-coordinates text-[13px]">{destination.coordinates}</span>
              </div>
            </aside>
            <a className={`home-browse-link px-3.5 py-1.5 rounded-full backdrop-blur-sm ${mode === "sketch" ? "bg-white/75 text-[#2C3831] border border-[#18221D]/10" : "bg-black/35 text-white/90"}`} href="#sample-trips">翻阅旅程样本 <ArrowDown aria-hidden="true" size={13} strokeWidth={1.5} /></a>
            {/* One compact horizontal row pinned to the bottom-right edge. Every
                label is a short word so the dock stays narrow and the bamboo
                raft in the middle of the sketch is never covered. */}
            <div className="home-gallery-dock">
              <div className="home-aesthetic-switch" role="group" aria-label="双生画境">
                <button type="button" aria-label="实景画廊模式" aria-pressed={mode === "photo"} onClick={() => choose({ ...preference, mode: "photo" })}><Camera aria-hidden="true" size={13} strokeWidth={1.5} />实景</button>
                <button type="button" aria-label="素描手账模式" aria-pressed={mode === "sketch"} onClick={() => choose({ ...preference, mode: "sketch" })}><Feather aria-hidden="true" size={13} strokeWidth={1.5} />素描</button>
              </div>
              <button className="home-next-landscape" type="button" aria-label="换一处风景" title="换一处风景" onClick={() => choose({ ...preference, destinationId: nextGalleryDestination(places, destination.id, mode === "photo").id })}>
                <Shuffle aria-hidden="true" size={13} strokeWidth={1.5} />换景
              </button>
              <div className="home-rotation">
                <button type="button" role="switch" aria-label={rotation.enabled ? "自动轮换已开启" : "自动轮换已暂停"} title={rotation.enabled ? "自动轮换已开启" : "自动轮换已暂停"} aria-checked={rotation.enabled} onClick={()=>updateRotation({ ...rotation, enabled: !rotation.enabled })}>{rotation.enabled ? "●" : "○"} 自动轮换</button>
                <button type="button" className="home-rotation-interval" aria-label="切换轮换间隔" title="点击切换轮换间隔" onClick={() => {
                  const index = ROTATION_INTERVALS.indexOf(rotationInterval as typeof ROTATION_INTERVALS[number]);
                  const next = ROTATION_INTERVALS[(index + 1) % ROTATION_INTERVALS.length];
                  updateRotation({ ...rotation, interval: next });
                }}>
                  {ROTATION_INTERVAL_LABELS[rotationInterval]}
                </button>
                <select className="sr-only" aria-label="轮换间隔" title="轮换间隔" tabIndex={-1} value={rotationInterval} onChange={e=>updateRotation({ ...rotation, interval: Number(e.target.value) })} onClick={e=>e.stopPropagation()}>
                  <option value={30000}>30秒</option>
                  <option value={60000}>1分钟</option>
                  <option value={300000}>5分钟</option>
                </select>
              </div>
              <GalleryStudio places={places} onChanged={refreshGallery} onOpenChange={setStudioOpen} onApply={(place, mode)=>{ setPlaces(current=>current.some(p=>p.id===place.id) ? current : [...current, place]); choose({ ...preference, mode, destinationId: place.id }); }}/>
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
              <SampleTripCard key={trip.destination} trip={trip} mode={mode} issue={String(index + 1).padStart(2, "0")} onStartPlanning={() => formRef.current?.fillInspiration(trip.planningRequest)} />
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
              {[...places.map((place) => ({ name: place.name, photo: place.photo })), ...Object.entries(samplePhotography).map(([name, photo]) => ({ name, photo }))].map(({ name, photo }, index) => (
                <li key={`${name}-${index}`}><span>{name} · {photo.author}</span><a href={photo.source}>原作来源</a><a href={photo.licenseUrl}>{photo.license}</a></li>
              ))}
            </ul>
          </details>
        </div>
      </footer>
    </main>
  );
}
