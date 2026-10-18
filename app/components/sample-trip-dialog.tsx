"use client";

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, BedDouble, Check, ChevronRight, Coffee, MapPin, Route, TrainFront, Wallet, X } from "lucide-react";
import { samplePhotography } from "@/lib/destination-gallery";
import type { SampleTrip } from "@/lib/home-samples";
import { LandscapeSketch } from "./landscape-sketch";
import styles from "./sample-trip-dialog.module.css";

const sections = ["每日行程", "交通与住宿", "预算与准备"] as const;

const TripIntroduction = memo(function TripIntroduction({ trip, mode, titleId }: {
  trip: SampleTrip;
  mode: "photo" | "sketch";
  titleId: string;
}) {
  const photo = samplePhotography[trip.destination as keyof typeof samplePhotography];

  return <>
    <div className={styles.cover} data-testid="sample-trip-cover" data-aesthetic={mode}>
      <div className={styles.landscape} aria-hidden="true">
        {mode === "photo" && photo ? <Image src={photo.src} alt="" fill sizes="(max-width: 800px) 100vw, 1040px" className={styles.photo} style={{ objectPosition: photo.position }} /> : <LandscapeSketch scene={trip.destinationLatin.toLowerCase()} className={styles.sketch} />}
      </div>
      <div className={styles.coverText}>
        <p className={styles.eyebrow}>{trip.destinationLatin}<span> / {trip.duration}</span></p>
        <h2 id={titleId}>{trip.title}</h2>
        <p className={styles.subtitle}>{trip.style}</p>
      </div>
      <span className={styles.coverSeal} aria-hidden="true">慢慢走<br />好好看</span>
    </div>

    <dl className={styles.overview}>
      {trip.overview.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl>
  </>;
});

function moveTabFocus(event: KeyboardEvent<HTMLDivElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowRight": case "ArrowDown": next = (current + 1) % tabs.length; break;
    case "ArrowLeft": case "ArrowUp": next = (current - 1 + tabs.length) % tabs.length; break;
    case "Home": next = 0; break;
    case "End": next = tabs.length - 1; break;
    default: return;
  }
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

function keepFocusInDialog(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]'))
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = targets[0];
  const last = targets[targets.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function SampleTripDialog({ trip, issue, mode, onClose }: {
  trip: SampleTrip;
  issue?: string;
  mode: "photo" | "sketch";
  onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  const [section, setSection] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const day = trip.days[dayIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  function scrollToContent() {
    if (scrollRef.current && contentRef.current) {
      scrollRef.current.scrollTo({ top: contentRef.current.offsetTop - (tabsRef.current?.offsetHeight ?? 0), behavior: "instant" });
    }
  }

  function chooseSection(index: number) {
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus({ preventScroll: true });
    setSection(index);
    scrollToContent();
  }

  function isOutsideCard(event: { clientX: number; clientY: number }) {
    const bounds = dialogRef.current?.getBoundingClientRect();
    return bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-note`}
      data-testid="sample-trip-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={keepFocusInDialog}
      onPointerDown={(event) => { backdropPressed.current = Boolean(isOutsideCard(event)); }}
      onClick={(event) => {
        if (backdropPressed.current && isOutsideCard(event)) onClose();
        backdropPressed.current = false;
      }}
    >
      <header className={styles.windowHeader}>
        <p><span className={styles.folio}>NO. {issue ?? "01"}</span><span className={styles.headerDivider} />精选旅程<span className={styles.headerLatin}> / THE TRAVEL NOTES</span></p>
        <button type="button" className={styles.close} aria-label="关闭完整规划" onClick={onClose}><X size={20} strokeWidth={1.5} aria-hidden="true" /></button>
      </header>

      <div ref={scrollRef} className={styles.scrollArea}>
        <TripIntroduction trip={trip} mode={mode} titleId={`${id}-title`} />

        <div ref={tabsRef} className={styles.sectionTabs} role="tablist" aria-label="规划内容" onKeyDown={moveTabFocus}>
          {sections.map((label, index) => {
            const Icon = [Route, BedDouble, Wallet][index];
            return <button key={label} type="button" role="tab" id={`${id}-section-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={section === index} tabIndex={section === index ? 0 : -1} onClick={() => chooseSection(index)}><Icon size={15} strokeWidth={1.5} aria-hidden="true" />{label}</button>;
          })}
          <span className={styles.referenceLabel}>一份可以慢慢读的旅行提案</span>
        </div>

        <div ref={contentRef} className={styles.content} data-testid="sample-trip-details">
          {/* Keep tab targets mounted, but only build the currently visible content. */}
          <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-section-0`} hidden={section !== 0} tabIndex={0}>
            {section === 0 ? <>
            <div className={styles.dayTabs} role="tablist" aria-label="选择行程日期" onKeyDown={moveTabFocus}>
              {trip.days.map((item, index) => <button key={item.day} type="button" role="tab" id={`${id}-day-${index}`} aria-controls={`${id}-day-panel-${index}`} aria-label={`${item.day} ${item.title}`} aria-selected={dayIndex === index} tabIndex={dayIndex === index ? 0 : -1} onClick={() => setDayIndex(index)}>{item.day}<span>{String(index + 1).padStart(2, "0")}</span></button>)}
            </div>
            {trip.days.map((item, index) => <div key={item.day} role="tabpanel" id={`${id}-day-panel-${index}`} aria-labelledby={`${id}-day-${index}`} hidden={dayIndex !== index} tabIndex={0}>
              {dayIndex === index ? <>
              <div className={styles.dayIntro}>
                <div><p className={styles.smallLabel}>THE ITINERARY / {item.day.toUpperCase()}</p><h3>{item.title}</h3></div>
                <span className={styles.dayCount}>{String(index + 1).padStart(2, "0")}<small> / {String(trip.days.length).padStart(2, "0")}</small></span>
              </div>
              <p className={styles.route}><MapPin size={15} aria-hidden="true" />{item.route}</p>
              <p className={styles.rhythm}>{item.rhythm}</p>
              <ol className={styles.timeline} aria-label={`${trip.destination}${item.day}分时安排`}>
                {item.stops.map((stop) => <li key={`${stop.time}-${stop.title}`}>
                  <span className={styles.time}>{stop.time}</span>
                  <div className={styles.stop}><h4>{stop.title}</h4><p>{stop.detail}</p>{stop.transfer ? <p className={styles.transfer}><ArrowRight size={12} aria-hidden="true" />{stop.transfer}</p> : null}</div>
                </li>)}
              </ol>
              <div className={styles.dayNotes}>
                <div><Coffee size={17} strokeWidth={1.5} aria-hidden="true" /><div><h4>好好吃饭</h4><p>{item.meals}</p></div></div>
                <div><BedDouble size={17} strokeWidth={1.5} aria-hidden="true" /><div><h4>{index === trip.days.length - 1 ? "行李与返程" : "今晚住哪里"}</h4><p>{item.stay}</p></div></div>
              </div>
              </> : null}
            </div>)}
            <div className={styles.dayFooter}>
              <span>{day.day} · 留一点时间，给计划之外的相遇</span>
              <button type="button" onClick={() => { if (dayIndex < trip.days.length - 1) { setDayIndex(dayIndex + 1); scrollToContent(); } else chooseSection(1); }}>{dayIndex < trip.days.length - 1 ? `下一天 · ${trip.days[dayIndex + 1].day}` : "看看交通与住宿"}<ChevronRight size={15} aria-hidden="true" /></button>
            </div>
            </> : null}
          </div>

          <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-section-1`} hidden={section !== 1} tabIndex={0}>
            {section === 1 ? <>
            <p className={styles.smallLabel}>GETTING THERE & STAYING</p>
            <h3 className={styles.sectionTitle}>让每一段衔接，都从容一点</h3>
            <div className={styles.logisticsGrid}>
              <section className={styles.infoCard}><TrainFront size={20} strokeWidth={1.4} aria-hidden="true" /><h4>抵达建议</h4><p>{trip.arrival}</p></section>
              <section className={styles.infoCard}><Route size={20} strokeWidth={1.4} aria-hidden="true" /><h4>交通接驳</h4><p>{trip.transport}</p></section>
              <section className={styles.infoCard}><BedDouble size={20} strokeWidth={1.4} aria-hidden="true" /><h4>住宿建议</h4><strong>{trip.stay.area}</strong><p>{trip.stay.reason}</p><p className={styles.secondary}>{trip.stay.tip}</p></section>
              <section className={styles.infoCard}><ArrowUpRight size={20} strokeWidth={1.4} aria-hidden="true" /><h4>返程安排</h4><p>{trip.departure}</p></section>
            </div>
            <section className={styles.ticketNote}><p className={styles.smallLabel}>BEFORE YOU GO</p><h4>门票核验</h4><p>{trip.tickets}</p></section>
            </> : null}
          </div>

          <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-section-2`} hidden={section !== 2} tabIndex={0}>
            {section === 2 ? <>
            <section aria-labelledby={`${id}-budget`}>
              <div className={styles.budgetHeading}><div><p className={styles.smallLabel}>A LITTLE PLANNING, A LOT OF EASE</p><h3 id={`${id}-budget`} className={styles.sectionTitle}>预算参考</h3></div><p className={styles.budgetTotal}>{trip.budget.total}<span> / 人</span></p></div>
              <p className={styles.budgetBasis}>{trip.budget.basis}</p>
              <dl className={styles.budgetList}>{trip.budget.items.map((item) => <div key={item.label}><dt>{item.label}<span>{item.note}</span></dt><dd>{item.amount}</dd></div>)}</dl>
            </section>
            <div className={styles.preparationGrid}>
              <section><h3 className={styles.sectionTitle}>行前清单</h3><ul className={styles.packing}>{trip.packing.map((item) => <li key={item}><Check size={14} aria-hidden="true" /><span>{item}</span></li>)}</ul></section>
              <section><h3 className={styles.sectionTitle}>天气与备选</h3><div className={styles.alternatives}>{trip.alternatives.map((item) => <div key={item.title}><h4>{item.title}</h4><p>{item.detail}</p></div>)}</div></section>
            </div>
            </> : null}
          </div>
          <p id={`${id}-note`} className={styles.sampleNote}>内置参考样本 · 时段、交通耗时与费用均为规划估算；请按实际出发日期确认开放、预约、票价与班次。</p>
        </div>
      </div>
    </dialog>
  );
}
