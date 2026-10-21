/**
 * The editorial cover header shared by /trips, /trips/[id], /runtime and
 * /settings.
 *
 * Server-safe on purpose: this component renders a static photograph, real
 * text and at most a link -- it owns no state and no event handler, so it
 * carries no "use client". Whatever interactive chrome a page needs (an
 * optimistic delete button, a refresh link) is passed in as `nav`/`actions`
 * from that page, which stays a server component as well.
 *
 * Layout contract (see app/cover-header.css):
 *   .editorial-cover          the 220-260px band, square bottom edge
 *     .editorial-cover-media  the next/image, absolutely positioned
 *     .editorial-cover-scrim  the frosted dark gradient, aria-hidden
 *     .editorial-cover-inner  nav + heading, sits on the page's own gutter
 */
import Image from "next/image";
import type { ReactNode } from "react";
import type { GalleryPhoto } from "@/lib/destination-gallery";

export type EditorialCoverProps = {
  /** The page masthead row (brand + actions). Rendered inside the band. */
  nav?: ReactNode;
  /** The small overline above the title, e.g. "YOUR PERSONAL ATLAS · 旅程收藏". */
  kicker?: ReactNode;
  /** The page heading. Always real text. Render as <h1> unless the page already
   *  owns the document's h1, in which case it stays visually identical but is
   *  demoted so the page never carries two top-level headings. */
  title: ReactNode;
  /** Set when the page renders its own <h1> elsewhere (e.g. /trips keeps the
   *  focusable `#trips-title` heading its tests drive). The cover then shows the
   *  title as a <p> with the same styling instead of a second <h1>. */
  titleIsNotHeading?: boolean;
  /** One supporting sentence under the title. */
  note?: ReactNode;
  /** An optional serif pull quote, shown on one ellipsised line. */
  quote?: string;
  /** Attribution for `quote`. */
  quoteLabel?: string;
  /** Short label pills along the bottom of the cover. */
  tags?: string[];
  /** A quiet secondary link/button row under the title. */
  actions?: ReactNode;
  /** Overrides the cover photograph. Defaults to the active landscape. */
  photo?: GalleryPhoto;
};

export function EditorialCover({
  nav,
  kicker,
  title,
  titleIsNotHeading = false,
  note,
  quote,
  quoteLabel,
  tags,
  actions,
  photo,
}: EditorialCoverProps) {
  const TitleTag = titleIsNotHeading ? "p" : "h1";
  return (
    <header className="editorial-cover relative w-full overflow-hidden bg-[#14231C] text-white">
      {photo ? (
        <div className="absolute inset-0" aria-hidden="true">
          <Image fill preload sizes="100vw" src={photo.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: photo.position }} />
        </div>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-[#14231C]/88 via-[#14231C]/72 to-[#14231C]/55" aria-hidden="true" />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 md:py-10">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/15 pb-4">
          <div className="flex min-w-0 items-center gap-4">{nav}</div>
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        </div>

        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="min-w-0">
            <TitleTag className="font-serif text-3xl font-semibold tracking-tight text-white md:text-4xl">
              {title}
            </TitleTag>
            {note ? <p className="mt-2 text-[15px] leading-7 text-white/85">{note}</p> : null}
            {quote ? (
              <p className="mt-2 font-serif text-[15px] leading-7 text-white/85">
                {quote}
                {quoteLabel ? <span className="ml-2 text-[13px] text-white/70">{quoteLabel}</span> : null}
              </p>
            ) : null}
          </div>

          {tags?.length ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
