"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { inferSceneArchetype, landscapeComposition, landscapePalettes, type LandscapeParameters, type LandscapeScene as LandscapeArchetype } from "@/lib/landscape-template";

type LandscapeScene =
  | "jiuzhaigou"
  | "west-lake"
  | "li-river"
  | "hongcun"
  | "xiapu"
  | "chengdu"
  | "qingdao";

type LandscapeSketchProps = {
  scene: string;
  className?: string;
  parameters?: LandscapeParameters;
  name?: string;
  fit?: "slice" | "meet";
};

type PlacedDrawingProps = {
  x: number;
  y: number;
  scale?: number;
};

const ink = "#516b62";

/** Original pen-and-wash drawings. All geometry is fixed for stable SSR. */
function Pine({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-3 4 C1-43-6-95 2-163 M3 2 C6-51 1-107 2-163" fill="none" strokeWidth="1.6" />
      <g fill="var(--ls-pine, #8b9f87)" fillOpacity=".33" strokeWidth="1.15">
        <path d="M2-162 C-6-147-9-138-19-131 L-9-133-26-119 Q-10-116 0-124 Q12-115 25-118 L12-131 21-129 Q9-143 2-162Z" />
        <path d="M-1-137 Q-11-116-34-99 L-22-100-42-87 Q-15-89 0-103 Q14-89 40-87 L24-101 34-100 Q10-116-1-137Z" />
        <path d="M0-111 Q-13-86-48-65 L-30-68-54-52 Q-23-54-1-73 Q23-54 53-55 L32-70 46-66 Q13-90 0-111Z" />
        <path d="M0-84 Q-21-57-59-36 L-36-40-65-24 Q-29-29-1-48 Q28-30 63-27 L42-42 57-39 Q22-61 0-84Z" />
      </g>
      <g fill="none" strokeWidth=".9" opacity=".7">
        <path d="M0-130-14-124 M2-129 14-122 M-1-111-27-94 M2-110 27-93 M-1-81-36-61 M3-80 37-61 M-1-56-46-33 M3-55 46-33" />
        <path d="M-8-3-15 2 M-4-1-20 7 M3-2 13 4 M4 0 22 6" />
      </g>
    </g>
  );
}

function Willow({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none">
      <path d="M-9 3 Q12-67-6-128 Q-12-160 0-198 M2 3 Q23-73 5-132 Q-4-170 7-198 M-3-135 Q-45-192-111-183 M4-153 Q52-216 109-186" strokeWidth="3" />
      <path d="M-109-184 Q-41-230 9-196 Q58-229 115-186" strokeWidth="1.4" />
      {Array.from({ length: 15 }, (_, index) => {
        const start = -116 + index * 16;
        const top = -182 - (index % 4) * 7;
        const drop = 87 + ((index * 31) % 77);
        const sway = index % 2 === 0 ? -17 : 19;
        return (
          <g key={index} strokeWidth="1" opacity=".73">
            <path d={`M${start} ${top} Q${start + sway} ${top + drop / 2} ${start + sway / 2} ${top + drop}`} />
            {Array.from({ length: 7 }, (_, leaf) => {
              const leafY = top + 12 + leaf * (drop / 9);
              const leafX = start + sway * (leaf / 12);
              return <path key={leaf} d={`M${leafX} ${leafY} q-9 3-8 12 M${leafX + 1} ${leafY + 5} q8 2 6 10`} stroke="var(--ls-pine, #728873)" />;
            })}
          </g>
        );
      })}
      <path d="M-26 9 Q-9-4 7 4 L26 12" strokeWidth="1.4" />
    </g>
  );
}

function Reeds({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" strokeWidth="1.1" opacity=".8">
      <path d="M0 0 Q-5-34-17-50 M3 0 Q3-47 14-68 M7 0 Q20-34 36-40 M-3 0 Q-20-18-35-21 M10 0 Q29-12 41-10 M-5 0 Q-16-36-12-65" />
      <path d="M-17-50 q-9-17-5-24 q11 14 5 24 M14-68 q-2-17 5-22 q4 17-5 22 M36-40 q4-12 14-13 q-3 11-14 13 M-12-65 q-7-14-2-21 q8 12 2 21" fill="var(--ls-pine, #8c987d)" fillOpacity=".4" />
    </g>
  );
}

function Boat({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} strokeWidth="1.35">
      <path d="M-65-7 Q-6 5 66-10 L44 7 Q-11 15-52 4Z" fill="var(--ls-wood, #b7a285)" fillOpacity=".52" />
      <path d="M-24-4 Q-17-36 10-31 Q33-26 36-5 M-19-6 Q-11-28 10-25 Q26-20 29-5" fill="var(--ls-paper, #f5f0e5)" />
      <path d="M-9-27-7-4 M5-30 7-4 M19-26 21-4 M-68 15 Q-8 22 71 10 M-45 24 41 23" fill="none" opacity=".65" />
      <path d="M44-9 42-30 M39-29 49-29 M45-28 63-19 M49-25 80 14" fill="none" />
      <circle cx="42" cy="-36" r="5" fill={ink} stroke="none" />
    </g>
  );
}

function WaterLines({ tidal = false }: { tidal?: boolean }) {
  return (
    <g fill="none" strokeWidth="1" opacity=".27">
      {Array.from({ length: tidal ? 17 : 25 }, (_, index) => {
        const x = 42 + ((index * 167) % 1430);
        const y = 641 + ((index * 29) % 235);
        const length = 54 + ((index * 43) % 149);
        return <path key={index} d={`M${x} ${y} q${length / 2} ${index % 2 === 0 ? -4 : 3} ${length} -1`} />;
      })}
    </g>
  );
}

function MountainHatching({ side = "left" }: { side?: "left" | "right" }) {
  return (
    <g transform={side === "right" ? "translate(1600 8) scale(-1 1)" : undefined} fill="none" strokeWidth="1" opacity=".3">
      <path d="M83 381 Q100 410 100 443 T120 503 M94 390 Q114 426 109 452 T132 523 M106 405 Q122 442 120 464 T145 534 M125 432 Q144 462 142 489 T166 548 M147 468 Q165 495 165 519 T183 553" />
      <path d="M216 422 Q231 452 233 481 T258 552 M227 437 Q245 470 244 496 T268 560 M246 470 Q260 495 262 526 T280 567 M286 511 Q298 534 301 558" />
      <path d="M9 483 Q35 508 30 538 T51 593 M20 492 Q46 521 42 548 T65 606 M38 518 Q62 539 57 563 T77 614 M67 548 Q91 571 83 598" />
    </g>
  );
}

function AlpineValley({ waterId }: { waterId: string }) {
  return (
    <>
      <g strokeOpacity=".37" strokeWidth="1.25">
        <path d="M0 486 Q36 436 75 415 Q118 377 157 414 Q190 451 226 454 Q274 432 299 475 Q327 498 351 509 Q394 489 425 530 Q457 539 492 578 L0 650Z" fill="#aabcae" fillOpacity=".26" />
        <path d="M1027 573 Q1062 543 1099 551 Q1144 488 1188 495 Q1227 464 1260 436 Q1297 391 1333 424 Q1370 386 1404 365 Q1435 348 1472 396 Q1516 416 1558 441 L1600 462 1600 650Z" fill="#aabcae" fillOpacity=".27" />
      </g>
      <path d="M0 634 L0 396 Q23 364 48 380 Q70 356 80 321 Q87 294 103 309 Q128 321 143 356 Q160 369 174 397 Q191 387 209 396 Q228 376 237 391 Q252 424 267 435 Q291 448 310 477 Q327 502 350 508 Q383 539 404 562 Q438 578 480 617 L542 650Z" fill="#c3cdb8" fillOpacity=".7" strokeWidth="1.65" />
      <path d="M1600 639 L1600 379 Q1580 357 1558 374 Q1534 357 1525 324 Q1516 302 1502 327 Q1481 342 1461 378 Q1440 393 1429 418 Q1405 397 1389 417 Q1371 447 1353 453 Q1327 463 1310 499 Q1289 520 1264 532 Q1247 559 1220 573 Q1179 610 1149 642Z" fill="#bbcbb8" fillOpacity=".68" strokeWidth="1.6" />
      <MountainHatching />
      <MountainHatching side="right" />
      <path d="M0 645 Q274 595 552 641 Q791 664 1042 638 Q1330 605 1600 646 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <g opacity=".13" transform="translate(0 1264) scale(1 -.9)">
        <path d="M0 624 Q56 471 100 451 Q169 543 236 493 Q340 583 485 642 L0 684Z M1157 641 Q1298 565 1377 482 Q1456 553 1520 411 L1600 488 1600 684Z" fill="#779780" stroke="none" />
      </g>
      <path d="M0 659 Q143 626 264 638 Q402 628 540 653 M1051 652 Q1207 624 1387 646 Q1503 629 1600 650" fill="none" strokeWidth="2" opacity=".8" />
      {[25, 74, 115, 155, 201, 239, 277, 322, 365, 406, 447].map((x, index) => (
        <Pine key={x} x={x} y={643 + (index % 3) * 5} scale={.45 + ((index * 7) % 8) * .055} />
      ))}
      {[1210, 1255, 1299, 1351, 1394, 1438, 1495, 1545, 1590].map((x, index) => (
        <Pine key={x} x={x} y={649 - (index % 3) * 6} scale={.5 + ((index * 3) % 7) * .07} />
      ))}
      <path d="M0 787 Q44 769 91 783 Q141 764 197 800 Q255 807 288 839 L337 900 0 900Z" fill="#d9d6bf" strokeWidth="1.3" />
      <path d="M0 799 Q100 782 165 812 Q223 815 279 860 M17 818 Q80 807 123 827 M32 829 94 824 M159 840 221 852" fill="none" opacity=".5" />
      <Pine x={51} y={818} scale={1.28} />
      <Pine x={161} y={818} scale={.94} />
      <Reeds x={265} y={863} />
      <WaterLines />
    </>
  );
}

function Pagoda({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} strokeWidth="1.3">
      <path d="M-42 0-35-26 35-26 42 0Z" fill="var(--ls-wash, #b5b9a3)" />
      {[0, 1, 2, 3, 4].map((level) => {
        const y = -24 - level * 32;
        const width = 37 - level * 4;
        return (
          <g key={level}>
            <path d={`M${-width + 9} ${y} v-23 h${width * 2 - 18} v23Z`} fill="var(--ls-paper, #f5f0e5)" />
            <path d={`M${-width - 7} ${y - 22} Q${-width + 7} ${y - 25} -8 ${y - 34} H8 Q${width - 7} ${y - 25} ${width + 7} ${y - 22} Q0 ${y - 17} ${-width - 7} ${y - 22}Z`} fill="var(--ls-ink, #869082)" />
            <path d={`M-8 ${y - 2} v-13 h16 v13 M${-width + 15} ${y - 19} v17 M${width - 15} ${y - 19} v17`} fill="none" opacity=".7" />
          </g>
        );
      })}
      <path d="M-11-185 0-207 11-185 M0-207 v-14" fill="none" />
      <circle cy="-212" r="3" fill="#b09a75" />
    </g>
  );
}

function WestLake({ waterId }: { waterId: string }) {
  return (
    <>
      <path d="M0 579 Q59 529 116 541 Q196 464 257 496 Q311 499 366 538 Q412 519 470 561 Q523 551 585 592 L0 606Z M951 583 Q1013 547 1079 561 Q1145 508 1207 521 Q1289 469 1337 497 Q1441 434 1500 488 Q1560 480 1600 516 L1600 614Z" fill="#bdcabc" fillOpacity=".36" strokeOpacity=".38" strokeWidth="1.4" />
      <path d="M0 640 Q299 610 622 643 Q1003 618 1600 639 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <path d="M989 647 Q1106 616 1256 624 Q1420 612 1600 634 L1600 662 Q1378 644 1200 651Z" fill="#b9c4ab" strokeWidth="1.2" />
      <Pagoda x={1380} y={624} scale={.89} />
      <Pine x={1274} y={630} scale={.5} />
      <Pine x={1503} y={634} scale={.62} />
      <g fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.4">
        <path d="M635 683 Q710 634 798 630 Q889 630 959 679 L959 689 Q877 643 798 643 Q713 647 635 693Z" />
        <path d="M629 678 Q712 625 797 621 Q888 622 964 674 M638 675 638 687 M666 659 666 675 M698 643 698 657 M731 632 731 647 M765 626 765 641 M800 624 800 640 M835 629 835 644 M869 639 869 653 M902 651 902 666 M934 666 934 680" fill="none" />
      </g>
      <path d="M0 754 Q95 721 219 766 Q273 774 335 818 L399 900 0 900Z" fill="#d8d7bd" strokeWidth="1.4" />
      <path d="M0 771 Q113 738 224 783 Q288 815 319 843 M18 796 Q86 782 143 798 M80 816 187 824 M239 812 279 835" fill="none" opacity=".5" />
      <Willow x={127} y={777} scale={1.48} />
      <Reeds x={311} y={840} scale={1.1} />
      <Boat x={1099} y={762} scale={.69} />
      <WaterLines />
    </>
  );
}

function KarstCliffs({ distant = false, fill }: { distant?: boolean; fill?: string }) {
  return (
    <g fill={fill ?? (distant ? "#c3cebf" : "#b5c5ac")} fillOpacity={distant ? .48 : .7} strokeWidth="1.5" strokeOpacity={distant ? .4 : .8}>
      <path d="M-30 683 C-9 620-13 561 7 536 C21 515 6 454 27 425 C38 407 41 358 67 352 C97 344 100 391 119 406 C132 417 130 459 143 476 C162 497 159 551 178 573 C185 549 183 497 202 477 C216 455 209 386 233 366 C249 347 244 310 267 300 C292 289 311 319 313 344 C321 372 337 378 339 414 C341 451 353 464 360 490 C371 525 362 574 382 601 C403 622 421 653 426 683Z" />
      <path d="M1178 685 C1190 650 1217 630 1220 587 C1221 552 1248 539 1245 497 C1241 464 1257 447 1271 456 C1288 463 1287 501 1301 516 C1317 489 1306 438 1326 416 C1341 402 1335 366 1359 353 C1380 340 1395 367 1399 394 C1403 417 1426 427 1425 460 C1421 508 1442 526 1451 546 C1466 515 1457 488 1475 473 C1491 458 1481 407 1507 388 C1531 372 1552 397 1557 430 C1568 457 1580 469 1581 507 C1579 543 1599 567 1618 589 L1621 685Z" />
      {!distant ? (
        <g fill="none" opacity=".43" strokeWidth="1">
          <path d="M64 375 Q78 407 67 441 T77 522 T80 591 M77 392 Q89 421 81 456 T91 540 M42 426 Q52 450 45 481 T55 572 M104 443 Q117 475 111 507 T126 595 M257 329 Q273 366 261 406 T271 493 T266 576 M276 332 Q290 365 283 404 T295 487 T293 590 M244 387 Q250 410 244 446 T245 537 M309 410 Q324 439 316 478 T326 575 M220 475 Q227 504 217 533 T222 604" />
          <path d="M1361 375 Q1375 407 1363 444 T1371 533 T1364 597 M1377 393 Q1386 426 1380 462 T1391 536 M1340 432 Q1352 461 1339 505 T1347 592 M1514 413 Q1529 447 1518 483 T1530 565 M1533 435 Q1547 469 1538 504 T1550 602 M1265 479 Q1275 508 1264 546 T1270 613" />
        </g>
      ) : null}
    </g>
  );
}

function LiRiver({ waterId }: { waterId: string }) {
  return (
    <>
      <g transform="translate(271 193) scale(.67)"><KarstCliffs distant /></g>
      <KarstCliffs />
      <path d="M0 686 Q406 636 763 675 Q1083 655 1600 688 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <path d="M0 709 Q132 664 292 680 Q354 676 422 704 M1190 692 Q1364 663 1600 701" fill="none" strokeWidth="1.7" />
      <path d="M0 817 Q124 785 224 813 Q272 832 301 866 L320 900 0 900Z" fill="#d2d6bd" />
      <Reeds x={194} y={835} scale={1.12} />
      <Reeds x={65} y={819} scale={.8} />
      <g transform="translate(989 772)" strokeWidth="1.5">
        <path d="M-87 8 Q-19 13 69 3 M-76 12 60 8 M-61 15 41 13" fill="none" />
        <path d="M9 5 3-34-7-34-16 4 M-3-34 3-59 M-13-44 3-52 22-34 M23-34 47 21" fill="none" />
        <path d="M-8-66 2-79 16-64Z" fill="#b39b77" />
        <circle cx="3" cy="-61" r="5" fill={ink} />
        <path d="M-59 2 Q-54-11-42-9 Q-32-9-29-2 M-46-9-45-16-37-18" fill="none" />
      </g>
      <WaterLines />
    </>
  );
}

function VillageHouse({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} strokeWidth="1.4">
      <path d="M-93 0 V-102 L-66-102-66-125-38-125-38-145 4-158 44-145 44-125 70-125 70-102 98-102 V0Z" fill="var(--ls-paper, #f5f0e5)" />
      <path d="M-97-103 H-69 V-128 H-41 V-148 L4-162 47-148 V-128 H73 V-105 H102 M-97-109 H-75 V-134 H-46 V-153 L4-168 53-153 V-134 H79 V-111 H102" fill="none" strokeWidth="2.6" />
      <path d="M-93-83 4-112 98-84 M-93-78 4-106 98-79 M-89-73 4-98 94-74" fill="none" />
      <path d="M-71-83-61-75 M-57-87-46-79 M-40-92-29-83 M-23-97-12-89 M-7-102 5-94 M14-101 24-93 M33-95 42-87 M52-90 61-82 M71-85 79-77" opacity=".6" />
      <path d="M-15 0 V-43 Q4-58 23-43 V0 M-62-48 h21 v26 h-21Z M48-48 h21 v26 h-21Z" fill="#718075" fillOpacity=".55" />
      <path d="M-51-46 v23 M-60-34 h17 M59-46 v23 M50-34 h17 M-11 0 V-40 M18 0 V-40 M-90-7 H96" fill="none" />
      <path d="M-83-59 v39 M83-64 v19 M-74-16 h16 M31-66 h13 M70-12 h18" fill="none" opacity=".33" />
    </g>
  );
}

function Hongcun({ waterId }: { waterId: string }) {
  return (
    <>
      <path d="M0 588 Q39 555 87 560 Q161 493 212 523 Q249 492 290 518 Q349 556 397 548 Q459 574 522 604 L0 687Z M968 599 Q1041 551 1087 561 Q1146 510 1197 527 Q1275 461 1327 492 Q1380 471 1437 518 Q1506 499 1600 550 L1600 687Z" fill="#bac7b5" fillOpacity=".48" strokeOpacity=".42" strokeWidth="1.4" />
      <path d="M0 715 Q759 669 1600 714 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <g opacity=".18" transform="translate(0 1404) scale(1 -1)">
        <VillageHouse x={268} y={700} scale={.81} />
        <VillageHouse x={435} y={700} scale={1} />
        <VillageHouse x={1224} y={701} scale={1.04} />
        <VillageHouse x={1398} y={701} scale={.79} />
      </g>
      <VillageHouse x={113} y={704} scale={.78} />
      <VillageHouse x={269} y={704} scale={.93} />
      <VillageHouse x={437} y={704} scale={1.05} />
      <VillageHouse x={615} y={705} scale={.77} />
      <VillageHouse x={1040} y={706} scale={.76} />
      <VillageHouse x={1224} y={704} scale={1.04} />
      <VillageHouse x={1410} y={704} scale={.89} />
      <path d="M0 704 Q392 713 711 704 M893 706 Q1259 712 1600 704 M0 712 H710 M894 714 H1600" fill="none" strokeWidth="1.8" />
      <path d="M657 716 Q771 638 922 714 L922 728 Q774 666 657 730Z" fill="#d7d2bf" />
      <path d="M660 721 Q779 654 918 720 M685 711 690 719 M711 698 716 707 M739 688 742 699 M770 686 770 696 M799 687 797 698 M830 694 826 704 M857 703 853 713 M884 712 880 722" fill="none" opacity=".7" />
      <Willow x={1556} y={742} scale={1.03} />
      <Reeds x={78} y={862} scale={1.2} />
      <WaterLines />
    </>
  );
}

function Xiapu({ waterId }: { waterId: string }) {
  return (
    <>
      <path d="M0 592 Q63 551 132 574 Q221 543 301 581 Q367 572 437 603 L0 615Z M1194 601 Q1267 566 1321 579 Q1376 541 1437 563 Q1529 551 1600 595 L1600 615Z" fill="#c1ccbd" fillOpacity=".46" strokeOpacity=".4" />
      <path d="M0 632 Q817 599 1600 638 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <g fill="#c6b493" fillOpacity=".39" strokeWidth="1.4" strokeOpacity=".65">
        <path d="M0 695 Q279 621 540 686 Q727 732 987 663 Q1271 612 1600 677 L1600 704 Q1289 642 998 690 Q702 766 474 712 Q217 660 0 737Z" />
        <path d="M0 792 Q264 708 525 771 Q752 827 1040 744 Q1332 675 1600 761 L1600 792 Q1335 716 1048 779 Q787 863 516 806 Q213 751 0 839Z" />
        <path d="M232 900 Q389 835 615 872 Q821 908 1104 831 Q1372 771 1600 853 L1600 900Z" />
      </g>
      <g fill="none" strokeWidth="1" opacity=".34">
        <path d="M0 713 Q263 650 486 700 M49 801 Q267 740 484 783 M1173 670 Q1381 646 1564 690 M1048 758 Q1272 696 1502 750 M734 843 Q893 830 1024 789" />
      </g>
      {Array.from({ length: 23 }, (_, index) => {
        const x = 146 + index * 60;
        const y = 687 + ((index * 41) % 139);
        const height = 50 + ((index * 13) % 46);
        return (
          <g key={index} fill="none" strokeWidth={index % 3 === 0 ? 1.7 : 1.1}>
            <path d={`M${x} ${y} l${index % 2 === 0 ? 5 : -4} -${height}`} />
            <path d={`M${x} ${y + 5} l-3 ${height * .32}`} opacity=".2" />
          </g>
        );
      })}
      <g fill="#9fae94" fillOpacity=".2" strokeWidth="1.3">
        <path d="M156 629 Q299 659 396 629 L393 685 Q273 667 149 699Z" />
        <path d="M1171 689 Q1269 722 1383 686 L1381 757 Q1269 724 1168 760Z" />
      </g>
      <Boat x={856} y={783} scale={.71} />
      <WaterLines tidal />
    </>
  );
}

function Bamboo({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none">
      <path d="M0 0 Q15-121-6-272 M28 0 Q17-91 55-221 M-28 0 Q-12-99-58-194" strokeWidth="3" />
      <path d="M1-46 8-46 M3-95 11-95 M2-146 10-146 M-1-194 8-194 M-6-237 2-237 M29-55 36-54 M35-113 42-112 M45-169 52-167 M-23-49-16-52 M-25-95-18-98 M-39-144-33-149" strokeWidth="2" />
      {[-1, 1].map((direction) => (
        <g key={direction} transform={`scale(${direction} 1)`} strokeWidth="1">
          <path d="M2-103 Q42-159 103-163 M1-176 Q31-207 93-206 M-5-226 Q29-251 66-242" />
          <g fill="var(--ls-pine, #758a6a)" fillOpacity=".6">
            <path d="M26-134 Q33-167 47-174 Q43-150 26-134 M43-147 Q70-156 82-144 Q61-144 43-147 M61-157 Q66-183 80-190 Q77-169 61-157 M78-161 Q107-175 118-167 Q102-158 78-161 M24-193 Q29-219 44-226 Q39-204 24-193 M43-201 Q65-212 79-197 Q63-195 43-201 M60-205 Q78-228 92-228 Q84-211 60-205 M15-239 Q18-263 32-270 Q29-250 15-239 M39-245 Q57-257 73-247 Q57-238 39-245" />
          </g>
        </g>
      ))}
    </g>
  );
}

function Chengdu({ waterId }: { waterId: string }) {
  return (
    <>
      <path d="M0 591 Q90 535 173 559 Q252 520 328 559 Q406 543 505 596 L0 638Z M1025 601 Q1123 550 1206 560 Q1298 497 1385 545 Q1497 520 1600 576 L1600 641Z" fill="#c6cfb8" fillOpacity=".49" strokeOpacity=".3" />
      <path d="M0 706 Q650 675 1600 706 L1600 900 0 900Z" fill={`url(#${waterId})`} opacity=".65" stroke="none" />
      <g transform="translate(1180 700)" strokeWidth="1.6">
        <path d="M-171-130 Q-123-142-93-177 Q-3-158 99-178 Q134-142 178-132 Q9-107-171-130Z" fill="#7e8d77" fillOpacity=".65" />
        <path d="M-145-121 V0 H145 V-122 M-132-119 V-5 M133-119 V-5 M-51-113 V-4 M53-113 V-4" fill="var(--ls-paper, #f5f0e5)" />
        <path d="M-172-135 Q-123-150-93-183 Q-2-164 99-184 Q137-149 179-137 M-133-145 Q1-127 137-146 M-119-155 Q0-140 124-155" fill="none" />
        <path d="M-126-95 H-65 V-29 H-126Z M67-96 H126 V-29 H67Z" fill="#cbd0b8" fillOpacity=".62" />
        <path d="M-111-93 V-31 M-96-93 V-31 M-81-93 V-31 M-124-73 H-67 M-124-51 H-67 M82-94 V-31 M97-94 V-31 M112-94 V-31 M69-74 H124 M69-51 H124" fill="none" />
        <path d="M-158 1 H158 M-174 9 H177 M-43-28 H45 M-29-28-36-3 M32-28 39-3" fill="none" />
        <path d="M-10-32 V-39 H9 V-32 M-15-42 Q0-49 15-42 M-2-52 Q-9-58 0-64" fill="none" strokeWidth="1.1" />
      </g>
      <path d="M0 739 Q98 700 217 732 Q279 755 333 789 M957 742 Q1192 712 1481 741 Q1549 758 1600 761" fill="none" strokeWidth="1.6" />
      <Bamboo x={117} y={757} scale={1.42} />
      <Bamboo x={283} y={758} scale={1} />
      <Bamboo x={1515} y={746} scale={1.13} />
      <g fill="none" strokeWidth="1.35" transform="translate(498 780)">
        <ellipse cx="0" cy="-34" rx="42" ry="10" fill="#dacfb8" />
        <path d="M-26-27-32 4 M26-27 32 4 M-18-29-12 4 M18-29 12 4 M-75-51 V0 M-54-50 V1 M-80-26 H-49 M-79-52 H-51 M57-51 V0 M77-52 V0 M51-26 H82 M54-52 H80" />
        <path d="M-9-41 V-51 H7 V-42 M-14-52 Q-1-60 12-52 M-2-63 Q-9-68-1-77" />
      </g>
      <WaterLines />
    </>
  );
}

function Qingdao({ waterId }: { waterId: string }) {
  return (
    <>
      <path d="M0 663 Q172 622 297 643 Q362 614 455 654 L0 677Z M1110 652 Q1219 599 1310 620 Q1423 569 1600 633 L1600 677Z" fill="#c5cfbf" fillOpacity=".46" strokeOpacity=".35" />
      <path d="M0 683 Q774 638 1600 683 L1600 900 0 900Z" fill={`url(#${waterId})`} stroke="none" />
      <path d="M0 777 Q77 730 160 744 Q218 705 288 734 Q378 730 437 785 Q491 812 520 862 L550 900 0 900Z" fill="#c4ccb3" strokeWidth="1.5" />
      <g transform="translate(244 745)" strokeWidth="1.6">
        <path d="M-39 0-27-184 H25 L40 0Z" fill="var(--ls-paper, #f5f0e5)" />
        <path d="M-31-184 V-216 H29 V-184Z" fill="#d3d6c4" />
        <path d="M-45-217-3-247 44-217Z" fill="#b78769" />
        <path d="M-41-183 H38 M-43-179 H42 M-25-160 H28 M-32-64 H33 M-35-39 H36 M-30-208 H28 M-20-214 V-185 M0-214 V-185 M19-214 V-185" fill="none" />
        <path d="M-8 0 V-31 Q0-41 9-31 V0 M-5-147 H7 V-130 H-5Z M-6-100 H8 V-84 H-6Z" fill="#7c8d80" />
        <path d="M-3-247 V-258 M-53-176 H51 M-50-176 V-190 M-28-176 V-190 M-5-176 V-190 M19-176 V-190 M44-176 V-190" fill="none" />
      </g>
      <g transform="translate(1205 700)" strokeWidth="1.25">
        <path d="M-121 0 V-87 H-13 V0 M-11 0 V-63 H92 V0 M90 0 V-107 H201 V0" fill="var(--ls-paper, #f5f0e5)" />
        <path d="M-136-85-71-133 0-85Z M-26-61 39-105 106-61Z M73-105 145-156 217-105Z" fill="#bd8e70" fillOpacity=".82" />
        <path d="M-121-77 H-14 M-7-56 H90 M91-98 H200 M-102-62 h19 v23 h-19Z M-54-62 h19 v23 h-19Z M16-40 h18 v22 h-18Z M59-40 h18 v22 h-18Z M111-79 h20 v25 h-20Z M160-79 h20 v25 h-20Z" fill="none" />
        <path d="M-134 3 H216 M-142 9 H220 M-80-119-21-85 M-90-111-42-85 M126-142 183-107 M114-133 162-107" fill="none" opacity=".6" />
      </g>
      <g transform="translate(797 748)" strokeWidth="1.5">
        <path d="M-42 7 H46 L28 20 H-25Z" fill="#b2bca9" />
        <path d="M1 5 V-120 M-4-110-40-3 H-4Z" fill="var(--ls-paper, #f5f0e5)" />
        <path d="M7-96 42-4 H7Z" fill="#dfd4bc" />
      </g>
      <path d="M21 804 Q96 766 173 788 Q229 755 301 785 M68 832 124 812 171 822 M183 846 221 817 265 833 M290 806 336 801 379 827" fill="none" opacity=".58" />
      <Reeds x={428} y={845} scale={1.2} />
      <WaterLines />
    </>
  );
}

function resolveScene(scene: string): LandscapeScene {
  if (scene === "hangzhou") return "west-lake";
  if (["west-lake", "li-river", "hongcun", "xiapu", "chengdu", "qingdao"].includes(scene)) {
    return scene as LandscapeScene;
  }
  return "jiuzhaigou";
}

function unit(seed: number, salt: number) {
  const value = Math.sin(seed * 0.017 + salt * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function CloudBands({ seed, count = 3, baseY = 520, opacity = .56 }: { seed: number; count?: number; baseY?: number; opacity?: number }) {
  return <g>
    {Array.from({ length: count }, (_, index) => {
      const y = baseY + index * 52;
      const offset = unit(seed, index + 3) * 180;
      const drift = unit(seed, index + 19) * 110;
      return <g key={index}>
        <path d={`M${-180 + offset} ${y} Q300 ${y - 34} 690 ${y + 4} T1500 ${y - 9} T1760 ${y + 7} V${y + 46} Q1180 ${y + 70} ${-180 + offset} ${y + 42}Z`} fill="var(--ls-mist, #fbf7ee)" fillOpacity={opacity} stroke="none" />
        <path d={`M${-120 + offset} ${y + 23} Q330 ${y - 2} 710 ${y + 27} T1660 ${y + 17}`} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity={opacity * .21} strokeWidth="1.1" />
        <path d={`M${-160 + offset + drift} ${y + 39} Q260 ${y + 48} 620 ${y + 34} T1640 ${y + 48} L1640 ${y + 62} Q980 ${y + 82} ${-160 + offset + drift} ${y + 66}Z`} fill="var(--ls-ink, #516b62)" fillOpacity=".032" stroke="none" />
        <path d={`M${430 + offset * .35} ${y - 11} Q660 ${y - 30} 880 ${y - 9} M${1030 - offset * .2} ${y + 3} Q1220 ${y - 15} 1450 ${y + 2}`} fill="none" stroke="var(--ls-paper, #f5f0e5)" strokeOpacity={opacity * 1.02} strokeWidth="2.4" />
      </g>;
    })}
  </g>;
}

function CliffPine({ x, y, scale = 1 }: PlacedDrawingProps) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="var(--ls-ink, #516b62)" fill="none" strokeLinecap="round">
    <path d="M12 32Q-8-4-48-28T-145-84M7 34Q-24 5-58-8T-180-36" strokeWidth="4.5" />
    <path d="M-54-28Q-62-70-112-106M-96-58Q-140-45-186-68M-138-82Q-160-122-218-130M-48-8Q-106 12-154-12" strokeWidth="2.2" />
    {[[ -218, -130 ], [ -112, -106 ], [ -186, -68 ], [ -154, -12 ], [ -66, -56 ]].map(([px, py], index) => <g key={index}>
      <path d={`M${px - 42} ${py + 8}q12-19 30-12q12-21 29-5q25-9 39 13q-45 20-98 4Z`} fill="var(--ls-pine, #7f987b)" fillOpacity=".48" strokeWidth="1.1" />
      <path d={`M${px - 32} ${py + 5}l12-11m8 14 2-20m12 19 13-14m-39 9-6-10`} strokeWidth=".9" opacity=".68" />
    </g>)}
  </g>;
}

function StonePillar({ x, base, top, width, lean = 0, seed = 1, snow = false, opacity = 1 }: { x: number; base: number; top: number; width: number; lean?: number; seed?: number; snow?: boolean; opacity?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rockId = `${uid}-rock`;
  const clipId = `${uid}-clip`;
  const left = x - width / 2, right = x + width / 2;
  const crownL = x - width * .16 + lean, crownR = x + width * .16 + lean;
  const path = `M${left} ${base}C${left + width * .04} ${base - 110} ${left + width * .05} ${base - 200} ${left + width * .09} ${base - 282}C${left + width * .105} ${base - 360} ${left + width * .145} ${top + 186} ${left + width * .17} ${top + 132}C${left + width * .19} ${top + 102} ${left + width * .19} ${top + 72} ${left + width * .23} ${top + 54}L${left + width * .27} ${top + 40}L${left + width * .29} ${top + 22}L${crownL} ${top}L${x - width * .11 + lean} ${top + 17}L${x - width * .055 + lean} ${top + 7}L${x - width * .01 + lean} ${top + 27}L${crownR} ${top + 11}L${x + width * .22 + lean} ${top + 43}L${x + width * .26 + lean} ${top + 60}C${right - width * .2} ${top + 92} ${right - width * .17} ${top + 142} ${right - width * .15} ${top + 186}C${right - width * .105} ${base - 330} ${right - width * .055} ${base - 196} ${right - width * .025} ${base - 96}C${right - width * .01} ${base - 50} ${right} ${base - 20} ${right} ${base}Z`;
  const shadow = `M${x + width * .035 + lean} ${top + 22}L${crownR} ${top + 11}L${x + width * .26 + lean} ${top + 60}C${right - width * .2} ${top + 92} ${right - width * .17} ${top + 142} ${right - width * .15} ${top + 186}L${right} ${base}L${x + width * .12} ${base}L${x + width * .105 + lean} ${top + 200}Z`;
  const lit = `M${left} ${base}C${left + width * .04} ${base - 110} ${left + width * .05} ${base - 200} ${left + width * .09} ${base - 282}C${left + width * .125} ${base - 372} ${left + width * .18} ${top + 168} ${left + width * .21} ${top + 92}L${left + width * .29} ${top + 22}L${crownL} ${top}L${x - width * .04 + lean} ${top + 44}L${x + width * .03} ${base}Z`;
  const strata = Array.from({ length: 5 }, (_, index) => {
    const ratio = .2 + index * .15;
    const y = base - 74 - ratio * (base - top - 150);
    const start = left + width * (.1 + (index % 2) * .05);
    return `M${start} ${y} Q${x - width * .04} ${y - 15 - unit(seed, index + 4) * 8} ${x + width * .1} ${y - 4}T${right - width * .08} ${y + 9}`;
  }).join(" ");
  return <g opacity={opacity}>
    <defs>
      <linearGradient id={rockId} x1="0" y1="0" x2=".25" y2="1">
        <stop offset="0" stopColor="var(--ls-paper, #f5f0e5)" stopOpacity=".28" />
        <stop offset=".24" stopColor="var(--ls-wash, #a9c1aa)" stopOpacity=".95" />
        <stop offset=".66" stopColor="var(--ls-wash, #a9c1aa)" stopOpacity="1" />
        <stop offset="1" stopColor="var(--ls-ink, #516b62)" stopOpacity=".46" />
      </linearGradient>
      <clipPath id={clipId}><path d={path} /></clipPath>
    </defs>
    <path d={path} fill={`url(#${rockId})`} fillOpacity={.56 + unit(seed, 4) * .16} stroke="var(--ls-ink, #516b62)" strokeOpacity=".76" strokeWidth="1.7" />
    <path d={lit} fill="var(--ls-paper, #f5f0e5)" fillOpacity=".16" stroke="none" />
    <path d={shadow} fill="var(--ls-ink, #516b62)" fillOpacity=".13" stroke="none" />
    <g clipPath={`url(#${clipId})`}>
      <path d={Array.from({ length: 7 }, (_, index) => {
        const hx = left + width * (.18 + index * .105);
        return `M${hx} ${base - 22} Q${hx + lean * .3} ${base - 300} ${hx + width * (unit(seed, index + 27) - .5) * .07 + lean} ${top + 78 + unit(seed, index + 9) * 62}`;
      }).join(" ")} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".33" strokeWidth=".95" />
      <path d={Array.from({ length: 24 }, (_, index) => {
        const hx = left + width * (.12 + unit(seed, index + 44) * .76);
        const hy = top + 74 + unit(seed, index + 61) * (base - top - 150);
        const slope = unit(seed, index + 77) > .5 ? 1 : -1;
        return `M${hx} ${hy}l${slope * (2 + unit(seed, index + 90) * 5)} ${4 + unit(seed, index + 31) * 8}`;
      }).join(" ")} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".14" strokeWidth=".7" />
    </g>
    <path d={strata} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".18" strokeWidth="1.05" />
    <path d={`M${x - width * .12 + lean} ${top + 64} l${width * .045} ${34} l${-width * .03} ${24} M${x + width * .07 + lean} ${top + 90} l${-width * .02} ${38}`} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".36" strokeWidth="1.2" />
    {width > 46 && <><Pine x={x + width * .06 + lean} y={top + 74} scale={.2 + width / 520} /><Pine x={right - width * .2} y={base - 262} scale={.34 + width / 420} /></>}
    {snow && <path d={`M${crownL} ${top} L${x - width * .06 + lean} ${top + 18} L${x - width * .01 + lean} ${top + 27} L${crownR} ${top + 11} L${x + width * .1 + lean} ${top + 34} L${x - width * .02 + lean} ${top + 46}Z`} fill="var(--ls-paper, #f5f0e5)" stroke="var(--ls-ink, #516b62)" strokeOpacity=".3" />}
  </g>;
}

function GranitePeak({ x, base, top, width, seed, opacity = .52 }: { x: number; base: number; top: number; width: number; seed: number; opacity?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rockId = `${uid}-rock`;
  const clipId = `${uid}-clip`;
  const left = x - width / 2, right = x + width / 2;
  const offset = (unit(seed, 7) - .5) * width * .035;
  const crest = x + offset;
  const path = `M${left} ${base}C${left + width * .015} ${base - 95} ${left + width * .035} ${base - 190} ${left + width * .055} ${base - 286}C${left + width * .075} ${base - 378} ${left + width * .105} ${top + 196} ${left + width * .135} ${top + 142}C${left + width * .155} ${top + 104} ${left + width * .19} ${top + 78} ${left + width * .225} ${top + 60}C${left + width * .255} ${top + 45} ${left + width * .29} ${top + 38} ${left + width * .33} ${top + 38}L${left + width * .375} ${top + 52}L${left + width * .405} ${top + 25}L${left + width * .445} ${top + 36}L${crest - width * .02} ${top}L${crest + width * .025} ${top + 24}L${crest + width * .06} ${top + 14}L${crest + width * .095} ${top + 46}L${crest + width * .135} ${top + 30}L${crest + width * .18} ${top + 54}C${right - width * .25} ${top + 68} ${right - width * .21} ${top + 104} ${right - width * .18} ${top + 146}C${right - width * .14} ${base - 355} ${right - width * .09} ${base - 235} ${right - width * .055} ${base - 120}C${right - width * .03} ${base - 62} ${right - width * .012} ${base - 26} ${right} ${base}Z`;
  const shadow = `M${crest + width * .025} ${top + 24}L${crest + width * .095} ${top + 46}L${crest + width * .18} ${top + 54}C${right - width * .25} ${top + 68} ${right - width * .21} ${top + 104} ${right - width * .18} ${top + 146}C${right - width * .14} ${base - 355} ${right - width * .09} ${base - 235} ${right - width * .055} ${base - 120}L${right} ${base}L${x + width * .12} ${base}L${crest + width * .045} ${top + 166}Z`;
  const lit = `M${left} ${base}C${left + width * .035} ${base - 190} ${left + width * .055} ${base - 286} ${left + width * .075} ${base - 378}C${left + width * .105} ${top + 196} ${left + width * .155} ${top + 104} ${left + width * .225} ${top + 60}L${left + width * .33} ${top + 38}L${left + width * .375} ${top + 52}L${left + width * .405} ${top + 25}L${left + width * .445} ${top + 36}L${crest - width * .02} ${top}L${x + width * .02} ${base}Z`;
  const fissures = Array.from({ length: 13 }, (_, index) => {
    const start = left + width * (.08 + index * .072);
    const bend = (unit(seed, index + 31) - .5) * width * .075;
    const endY = top + 58 + unit(seed, index + 13) * (width > 340 ? 290 : 230);
    return `M${start} ${base - 22}Q${start + bend} ${base - 330} ${start + bend * .35} ${endY}`;
  }).join(" ");
  const strata = Array.from({ length: 6 }, (_, index) => {
    const y = base - 128 - index * (width > 340 ? 94 : 76);
    return `M${left + width * (.06 + unit(seed, index) * .07)} ${y}Q${x - width * .09} ${y - 24} ${x + width * .1} ${y - 9}T${right - width * .06} ${y + 14}`;
  }).join(" ");
  return <g>
    <defs>
      <linearGradient id={rockId} x1="0" y1="0" x2=".28" y2="1">
        <stop offset="0" stopColor="var(--ls-paper, #f5f0e5)" stopOpacity=".3" />
        <stop offset=".22" stopColor="var(--ls-wash, #a9c1aa)" stopOpacity=".95" />
        <stop offset=".63" stopColor="var(--ls-wash, #a9c1aa)" stopOpacity="1" />
        <stop offset="1" stopColor="var(--ls-ink, #516b62)" stopOpacity=".5" />
      </linearGradient>
      <clipPath id={clipId}><path d={path} /></clipPath>
    </defs>
    <path d={path} fill={`url(#${rockId})`} fillOpacity={opacity * 1.18} stroke="var(--ls-ink, #516b62)" strokeOpacity=".72" strokeWidth="1.8" />
    <path d={lit} fill="var(--ls-paper, #f5f0e5)" fillOpacity=".2" stroke="none" />
    <path d={shadow} fill="var(--ls-ink, #516b62)" fillOpacity=".15" stroke="none" />
    <g clipPath={`url(#${clipId})`}>
      <path d={fissures} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".35" strokeWidth=".95" />
      <path d={strata} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".21" strokeWidth="1.05" />
      <path d={Array.from({ length: 34 }, (_, index) => {
        const hx = left + width * (.04 + unit(seed, index + 44) * .9);
        const hy = top + 40 + unit(seed, index + 61) * (base - top - 100);
        const slope = unit(seed, index + 77) > .5 ? 1 : -1;
        return `M${hx} ${hy}l${slope * (2 + unit(seed, index + 90) * 6)} ${4 + unit(seed, index + 31) * 10}`;
      }).join(" ")} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".13" strokeWidth=".7" />
    </g>
    <path d={`M${crest - width * .08} ${top + 88}l${width * .025} 38 ${-width * .015} 26M${crest + width * .1} ${top + 114}l${-width * .025} 46`} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".38" strokeWidth="1.3" />
    {width > 300 && <>
      <Pine x={left + width * .17} y={base - 292} scale={.3} />
      <Pine x={right - width * .12} y={base - 214} scale={.24} />
      <Pine x={crest + width * .02} y={top + 118} scale={.22} />
    </>}
  </g>;
}

function SnowRange({ seed, count = 11, baseY = 690, height = 280 }: { seed: number; count?: number; baseY?: number; height?: number }) {
  const peaks = Array.from({ length: count }, (_, index) => {
    const x = 40 + index * (1520 / (count - 1));
    const peak = baseY - height * (.45 + unit(seed, index + 2) * .55);
    return { x, peak, baseY, width: 80 + unit(seed, index + 8) * 75 };
  });
  return <g>
    <path d={`M0 ${baseY} ${peaks.map(({ x, peak }) => `L${x} ${peak}`).join(" ")} L1600 ${baseY}Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".56" stroke="var(--ls-ink, #516b62)" strokeOpacity=".58" strokeWidth="1.8" />
    {peaks.map(({ x, peak, width }, index) => <path key={index} d={`M${x - width * .34} ${peak + 50} L${x} ${peak} L${x + width * .36} ${peak + 48} L${x + width * .12} ${peak + 36} L${x + width * .02} ${peak + 62} L${x - width * .11} ${peak + 30}Z`} fill="var(--ls-paper, #f5f0e5)" stroke="var(--ls-ink, #516b62)" strokeOpacity=".24" />)}
    <path d={peaks.map(({ x, peak }) => `M${x + 2} ${peak + 16} q${unit(seed, x) > .5 ? 14 : -12} ${height * .25} ${unit(seed, x + 1) > .5 ? 7 : -9} ${height * .48}`).join(" ")} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".22" strokeWidth="1" />
  </g>;
}

function Conifer({ x, y, scale = 1 }: PlacedDrawingProps) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="var(--ls-pine, #7f987b)" fillOpacity=".76" stroke="var(--ls-ink, #516b62)" strokeWidth="1">
    <path d="M0 0V-110 M-2-30-26-4 M2-30 26-4 M0-58-38-25 M0-58 38-25 M0-86-28-58 M0-86 28-58 M0-110 0-122" />
    <path d="M0-58-38-25 38-25Z M0-86-31-55 31-55Z M0-110-23-82 23-82Z" fillOpacity=".34" />
  </g>;
}

function Lighthouse({ x, y, scale = 1 }: PlacedDrawingProps) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="var(--ls-ink, #516b62)" strokeWidth="1.5">
    <path d="M-34 0-24-210H24L34 0Z" fill="var(--ls-paper, #f5f0e5)" />
    <path d="M-28-210V-240H28V-210Z" fill="var(--ls-accent, #b18f62)" />
    <path d="M-36-240-2-262 36-240Z" fill="var(--ls-accent, #b18f62)" />
    <path d="M-17-174H17M-20-134H20M-23-92H23M-26-50H26" fill="none" opacity=".55" />
    <path d="M-7-210H7V-190H-7Z" fill="var(--ls-ink, #516b62)" fillOpacity=".35" />
    <path d="M0-262V-276" fill="none" />
  </g>;
}

function Palm({ x, y, scale = 1 }: PlacedDrawingProps) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" strokeWidth="1.6">
    <path d="M-3 0Q9-76-6-155Q-11-188 4-214" />
    <path d="M4-212Q-51-239-92-210 M4-212Q42-257 91-229 M4-212Q-34-267-4-305 M4-212Q61-252 116-249 M4-212Q-76-218-112-174" />
    <g fill="var(--ls-pine, #7f987b)" fillOpacity=".45">
      <path d="M4-212Q-49-241-92-210Q-45-220 0-200Z" /><path d="M4-212Q45-262 92-230Q48-239 2-202Z" />
      <path d="M4-212Q-45-270-4-307Q6-264 11-208Z" /><path d="M4-212Q65-254 116-249Q67-237 10-204Z" />
    </g>
  </g>;
}

function Camel({ x, y, scale = 1 }: PlacedDrawingProps) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" strokeWidth="1.6" opacity=".55">
    <path d="M-42 0Q-50-31-27-39Q-5-50 9-35Q24-49 42-35Q58-28 51 0 M-39-40Q-32-63-11-61Q3-59 10-40 M-13-58Q-19-68-8-70Q4-70 8-58 M-24-39V3M-11-39V2M24-39V3M37-37V1" />
    <path d="M-42-33Q-58-42-64-25 M52-35Q72-37 80-17" />
  </g>;
}

function bridgePath(x: number) {
  return `M${x - 235} 746 Q${x} 560 ${x + 235} 746 L${x + 235} 764 Q${x} 606 ${x - 235} 764Z`;
}

function PeaksScene({ parameters: p, seed, name, waterId }: { parameters: LandscapeParameters; seed: number; name: string; waterId: string }) {
  const sanqing = /三清/.test(name), huang = /黄山/.test(name), zhang = /张家界/.test(name);
  if (huang) return <>
    <path d={`M0 672Q180 ${512 + p.ridge * 1.1} 364 596Q544 518 716 588T1058 590Q1270 ${504 + p.ridge} 1600 610V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".11" />
    <path d={`M0 720Q214 ${604 + p.ridge * .8} 430 660Q604 586 790 648T1140 650Q1352 582 1600 664V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".15" />
    <CloudBands seed={seed} count={3} baseY={592} opacity={.68} />
    <GranitePeak x={286} base={840} top={472} width={300} seed={seed + 2} opacity={.3} />
    <GranitePeak x={566} base={846} top={354} width={344} seed={seed + 5} opacity={.43} />
    <GranitePeak x={864} base={848} top={438} width={292} seed={seed + 8} opacity={.37} />
    <GranitePeak x={1132} base={842} top={286} width={382} seed={seed + 11} opacity={.54} />
    <GranitePeak x={1402} base={848} top={408} width={272} seed={seed + 14} opacity={.35} />
    <path d="M1108 620Q1188 576 1268 608Q1352 642 1398 724" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".3" strokeWidth="1.1" />
    <CloudBands seed={seed + 13} count={1} baseY={782} opacity={.34} />
    <path d="M0 816Q112 776 218 804Q288 826 326 878L362 900H0Z" fill="var(--ls-paper, #f5f0e5)" fillOpacity=".74" stroke="var(--ls-ink, #516b62)" strokeOpacity=".34" strokeWidth="1.3" />
    <path d="M0 832Q100 792 200 818Q270 842 304 884" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".24" strokeWidth="1.05" />
    <Pine x={132} y={834} scale={1.08} />
    <Pine x={234} y={842} scale={.64} />
    <Pine x={712} y={690} scale={.42} />
    <CliffPine x={1044} y={632} scale={.72} />
    <Pine x={1230} y={694} scale={.56} />
    <Pine x={1404} y={756} scale={.44} />
    <path d="M1600 900V706Q1512 668 1424 700Q1342 732 1304 804L1274 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".28" stroke="var(--ls-ink, #516b62)" strokeOpacity=".36" strokeWidth="1.3" />
    {p.motif === "pavilion" && <g transform="translate(1428 696) scale(.4)"><PavilionDrawing /></g>}
    <path d="M0 870Q420 844 824 868T1600 860" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".2" strokeWidth="1.1" />
  </>;
  if (sanqing) return <>
    <path d={`M0 682Q186 ${534 + p.ridge * 1.1} 368 612Q536 542 698 610T1058 618Q1268 540 1600 638V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".12" />
    <path d="M0 732Q232 650 452 704Q628 620 810 700T1160 704Q1370 630 1600 706V900H0Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".1" />
    <CloudBands seed={seed} count={2} baseY={566} opacity={.62} />
    <StonePillar x={238} base={808} top={368} width={68} lean={-4} seed={seed + 1} />
    <StonePillar x={352} base={798} top={212} width={82} lean={5} seed={seed + 2} />
    <StonePillar x={538} base={812} top={356} width={58} lean={-2} seed={seed + 3} opacity={.58} />
    <StonePillar x={792} base={804} top={248} width={94} lean={-6} seed={seed + 4} />
    <StonePillar x={944} base={812} top={338} width={62} lean={3} seed={seed + 5} opacity={.66} />
    <StonePillar x={1148} base={800} top={174} width={78} lean={7} seed={seed + 6} />
    <StonePillar x={1322} base={810} top={318} width={64} lean={-3} seed={seed + 7} />
    <StonePillar x={1440} base={806} top={254} width={74} lean={4} seed={seed + 8} opacity={.82} />
    <CloudBands seed={seed + 9} count={1} baseY={666} opacity={.44} />
    <CloudBands seed={seed + 17} count={1} baseY={788} opacity={.32} />
    <path d="M0 822Q116 784 224 812Q290 836 322 884L360 900H0Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".68" stroke="var(--ls-ink, #516b62)" strokeOpacity=".6" strokeWidth="1.4" />
    <Pine x={68} y={846} scale={1.16} />
    <Pine x={168} y={858} scale={.66} />
    <Pine x={776} y={690} scale={.38} />
    <Pine x={1130} y={632} scale={.42} />
    {p.motif === "pavilion" && <g transform="translate(1012 620) scale(.42)"><PavilionDrawing /></g>}
    <path d="M0 866Q372 846 734 866T1600 858" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".24" strokeWidth="1.05" />
    <path d={`M0 860Q374 842 734 860T1600 854`} fill="none" stroke={`url(#${waterId})`} strokeWidth="1.7" opacity=".52" />
  </>;
  return <>
    <path d={`M0 690 Q220 ${330 + p.ridge * 2} 410 610 T820 470 T1220 620 T1600 520V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".18" />
    {Array.from({ length: zhang ? 12 : 6 }, (_, index) => {
      const x = zhang ? 90 + index * 128 : 120 + index * 218;
      const width = zhang ? 34 + unit(seed, index) * 24 : 136 + unit(seed, index + 6) * 64;
      const top = zhang ? 266 + unit(seed, index + 8) * 112 : 248 + unit(seed, index + 8) * 98;
      return <StonePillar key={index} x={x} base={790 - (index % 2) * 24} top={top} width={width} lean={(unit(seed, index) - .5) * 24} seed={seed + index} />;
    })}
    {zhang && Array.from({ length: 7 }, (_, index) => <Conifer key={index} x={124 + index * 218} y={318 + unit(seed, index + 60) * 80} scale={.22} />)}
    <CloudBands seed={seed} count={3} baseY={518} />
    <CloudBands seed={seed + 9} count={2} baseY={714} />
    <path d="M0 814 Q106 786 194 810 Q252 833 278 879 L318 900 0 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".7" stroke="var(--ls-ink, #516b62)" strokeWidth="1.5" />
    <Pine x={58} y={842} scale={1.22} />
    <Pine x={151} y={856} scale={.75} />
    {p.motif === "pavilion" && <g transform="translate(1040 546) scale(.62)"><PavilionDrawing /></g>}
    <path d="M0 865Q370 846 730 865T1600 858" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".3" strokeWidth="1.1" />
    <path d={`M0 858Q374 840 734 858T1600 852`} fill="none" stroke={`url(#${waterId})`} strokeWidth="2" opacity=".7" />
  </>;
}

function PavilionDrawing() {
  return <g fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.5">
    <path d="M-70 0H70M-56-8V-92M56-8V-92M-15-8V-92M15-8V-92M-85-90Q-27-110 0-138Q30-111 85-90Z" />
    <path d="M-76-88Q0-78 76-88M-62 0V-15H62V0M0-138V-149" fill="none" />
  </g>;
}

function CliffScene({ parameters: p, seed, name, waterId }: { parameters: LandscapeParameters; seed: number; name: string; waterId: string }) {
  const hua = /华山/.test(name), tai = /泰山/.test(name), heng = /恒山/.test(name), fan = /梵净/.test(name);
  const ridgeTop = 250 + (100 - p.ridge) * .8;
  const stair = [[834, 868], [900, 810], [874, 776], [940, 718], [914, 686], [978, 630], [954, 600], [990, 544], [960, 516], [980, 460], [948, 434], [946, 350], [928, 314]];
  const stairPath = stair.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("");
  const stairTicks = stair.slice(0, -1).map(([x1, y1], index) => {
    const [x2, y2] = stair[index + 1];
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    return Array.from({ length: 4 }, (_, step) => {
      const t = (step + .5) / 4;
      const x = x1 + dx * t, y = y1 + dy * t;
      const nx = -dy / length * 5, ny = dx / length * 5;
      return `M${x - nx} ${y - ny}L${x + nx} ${y + ny}`;
    }).join("");
  }).join("");
  return <>
    {tai && <>
      <path d="M-40 900Q110 580 342 446Q480 358 610 320Q760 272 906 302Q1100 342 1210 500L1290 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".68" stroke="var(--ls-ink, #516b62)" strokeWidth="2" />
      <path d={`M780 850 L${900} 640 L${845} 618 L${968} 430 L${930} 410 L${1032} ${ridgeTop + 34} L${1000} ${ridgeTop + 18} L${1064} ${ridgeTop - 8}`} fill="none" strokeWidth="4.2" />
      {Array.from({ length: 26 }, (_, index) => { const t = index / 25; const x = 780 + (1064 - 780) * t + Math.sin(t * 12) * 8; const y = 850 - (850 - ridgeTop) * t; return <path key={index} d={`M${x - 8} ${y}H${x + 8}`} strokeWidth="1.2" opacity=".55" />; })}
      <g transform={`translate(1078 ${ridgeTop - 24}) scale(.62)`}><PavilionDrawing /></g>
      <Pine x={1130} y={532} scale={.68} />
    </>}
    {hua && <g transform="translate(0 -198) scale(1 1.22)">
      <path d={`M0 674Q168 ${538 + p.ridge * 1.2} 338 606Q500 530 664 598T1020 594Q1238 ${520 + p.ridge} 1600 618V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".1" />
      <path d={`M0 730Q196 ${640 + p.ridge * .7} 390 682Q552 612 726 672T1078 668Q1300 596 1600 690V900H0Z`} fill="var(--ls-wash, #a9c1aa)" fillOpacity=".12" />
      <CloudBands seed={seed} count={2} baseY={650} opacity={.5} />
      <path d="M0 900V704C48 684 92 656 146 666L188 630L232 654L276 618L320 646L366 614L414 648L468 618L516 676L548 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".36" stroke="var(--ls-ink, #516b62)" strokeOpacity=".64" strokeWidth="1.7" />
      <path d="M0 900V752C76 730 152 704 232 676L312 650L396 682L474 660L516 690V900Z" fill="var(--ls-ink, #516b62)" fillOpacity=".08" stroke="none" />
      {Array.from({ length: 11 }, (_, index) => { const x = 18 + index * 46; return <path key={index} d={`M${x} 892Q${x + 6} 760 ${x + 14} ${650 + (index % 3) * 22}`} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".24" strokeWidth=".95" />; })}
      <path d="M18 850Q180 818 330 844M48 798Q196 772 316 796M102 736Q230 714 352 732" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".19" strokeWidth="1.05" />
      <path d="M800 900C806 814 812 730 820 660C828 588 838 518 850 458C858 418 866 384 878 348L892 366L902 332L918 350L928 310L944 346L958 318L972 358L986 330L998 372C1010 406 1022 450 1032 500C1044 566 1056 690 1068 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".55" stroke="var(--ls-ink, #516b62)" strokeOpacity=".78" strokeWidth="1.9" />
      <path d="M998 372C1010 406 1022 450 1032 500C1044 566 1056 690 1068 900L992 900L988 760C984 646 982 512 978 404L986 330Z" fill="var(--ls-ink, #516b62)" fillOpacity=".14" stroke="none" />
      <path d="M800 900C806 814 812 730 820 660C828 588 838 518 850 458C858 418 866 384 878 348L892 366L902 332L918 350L928 310L944 346L958 318L972 358L986 330L978 448C970 584 958 738 944 900Z" fill="var(--ls-paper, #f5f0e5)" fillOpacity=".12" stroke="none" />
      <path d="M1058 900C1062 826 1067 758 1074 700C1084 618 1098 574 1120 548L1140 574L1162 544L1186 586C1196 692 1206 798 1218 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".34" stroke="var(--ls-ink, #516b62)" strokeOpacity=".48" strokeWidth="1.5" />
      {Array.from({ length: 18 }, (_, index) => { const start = 818 + index * 12; const end = 898 + unit(seed, index + 5) * 140; return <path key={index} d={`M${start} 890Q${start + 3} 682 ${end} ${342 + unit(seed, index + 20) * 314}`} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".28" strokeWidth=".9" />; })}
      <path d="M824 764Q908 740 1002 766M822 688Q912 662 1008 690M834 606Q920 584 1014 612M868 518Q948 498 1022 528M898 430Q958 414 1000 438M1084 788Q1132 774 1188 798M1094 700Q1148 686 1194 704" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".3" strokeWidth="1.1" />
      <path d="M848 680l32 22-18 28M922 548l34 24-20 30M962 438l26 22-16 26M1092 620l28 18-16 26" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".38" strokeWidth="1.2" />
      <path d={stairPath} fill="none" stroke="var(--ls-paper, #f5f0e5)" strokeOpacity=".9" strokeWidth="3.4" />
      <path d={stairPath} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".72" strokeWidth="1.25" />
      <path d={stairTicks} fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".64" strokeWidth="1" />
      <g transform="translate(928 308) scale(.36)"><PavilionDrawing /></g>
      <g transform="translate(998 512) scale(.36)"><path d="M-9 0V-29M9 0V-29M-12-25H12M0-29V-38" fill="none" strokeWidth="1.4" /><circle cy="-47" r="5" fill="var(--ls-ink, #516b62)" stroke="none" /></g>
      <path d="M1226 900L1244 774C1260 700 1286 652 1320 624L1348 650L1374 618L1402 662C1430 728 1450 814 1468 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".27" stroke="var(--ls-ink, #516b62)" strokeOpacity=".42" strokeWidth="1.45" />
      <path d="M1278 900Q1302 720 1352 638M1380 900Q1398 734 1438 664" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".2" strokeWidth=".95" />
      <Pine x={844} y={820} scale={.64} />
      <Pine x={1012} y={712} scale={.4} />
      <Pine x={878} y={604} scale={.3} />
      <Pine x={1146} y={780} scale={.54} />
      <Pine x={1330} y={704} scale={.5} />
      <Pine x={476} y={680} scale={.52} />
      <CloudBands seed={seed + 7} count={1} baseY={800} opacity={.34} />
      <CloudBands seed={seed + 15} count={1} baseY={850} opacity={.24} />
      <path d="M0 876Q238 844 498 868T978 870" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".3" strokeWidth="1.15" />
    </g>}
    {heng && <>
      <path d="M0 880Q62 490 222 338Q390 180 640 190Q826 200 960 390Q1070 548 1110 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".74" stroke="var(--ls-ink, #516b62)" strokeWidth="2.2" />
      <path d="M465 420Q642 386 790 444 L784 520Q636 470 470 500Z" fill="var(--ls-ink, #516b62)" fillOpacity=".2" strokeWidth="1.2" />
      <g transform="translate(626 452) scale(.62)">
        <path d="M-76 0H76M-58-4V-68M58-4V-68M-24-4V-68M24-4V-68M-92-66Q-30-84 0-104Q32-84 92-66Z" fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.6" />
        <path d="M-74 0V28M74 0V28M-40 0V30M40 0V30M-92-66Q0-54 92-66" fill="none" />
      </g>
      <Pine x={300} y={590} scale={.75} />
    </>}
    {fan && <>
      <path d="M510 900Q534 558 616 300Q664 146 738 184Q786 210 786 366Q790 584 888 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".74" stroke="var(--ls-ink, #516b62)" strokeWidth="2" />
      <path d="M976 900Q998 600 1060 384Q1100 250 1162 286Q1214 320 1218 492Q1220 650 1310 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".66" stroke="var(--ls-ink, #516b62)" strokeWidth="2" />
      <g transform="translate(740 188) scale(.43)"><PavilionDrawing /></g>
      <path d="M745 226H945" strokeWidth="2.2" opacity=".6" />
    </>}
    {!hua && !tai && !heng && !fan && <>
      <path d="M820 900Q826 574 954 352Q1014 252 1114 250Q1300 250 1450 540Q1550 738 1586 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".72" stroke="var(--ls-ink, #516b62)" strokeWidth="2.2" />
      <path d="M1000 470Q1080 350 1142 280 M1060 540Q1144 420 1204 342 M1140 660Q1226 512 1290 420" fill="none" strokeWidth="1.1" opacity=".3" />
      <path d="M900 872L956 760L938 740L1008 620L984 602L1054 482L1030 460L1114 250" fill="none" strokeWidth="2" opacity=".7" />
      {Array.from({ length: 32 }, (_, index) => <path key={index} d={`M${906 + index * 6.4} ${856 - index * 18.2}l12 4`} fill="none" strokeWidth="1.1" opacity=".55" />)}
      <g transform="translate(1114 250) scale(.45)"><PavilionDrawing /></g>
    </>}
    {!hua && <CloudBands seed={seed} count={3} baseY={640} />}
    {!hua && <CloudBands seed={seed + 7} count={1} baseY={760} />}
    <path d="M0 862Q260 828 508 858T940 860" fill="none" strokeWidth="1.2" opacity=".34" />
    <Pine x={74} y={878} scale={1.1} />
    <Pine x={176} y={886} scale={.68} />
    <path d={`M0 858Q400 842 800 858T1600 852`} fill="none" stroke={`url(#${waterId})`} strokeWidth="3" opacity=".6" />
  </>;
}

function TianchiScene({ parameters: p, seed, name, waterId }: { parameters: LandscapeParameters; seed: number; name: string; waterId: string }) {
  const sayram = /赛里木/.test(name), tianshan = /天山/.test(name), changbai = /长白/.test(name);
  if (changbai || (!sayram && !tianshan)) return <>
    <defs><clipPath id={`${waterId}-crater`}><ellipse cx="820" cy="702" rx="614" ry="126" /></clipPath></defs>
    <SnowRange seed={seed} count={12} baseY={650} height={305} />
    <path d="M0 710L0 512L100 438L158 482L238 350L288 390L354 310L424 366L502 332L580 420L642 438L668 618Q362 600 0 754Z" fill="var(--ls-wash, #aec6ce)" fillOpacity=".75" strokeWidth="1.8" />
    <path d="M1600 714V494L1500 426L1438 476L1360 342L1312 386L1244 306L1174 364L1094 330L1016 416L952 440L926 618Q1250 596 1600 752Z" fill="var(--ls-wash, #aec6ce)" fillOpacity=".68" strokeWidth="1.8" />
    <path d="M174 450L238 350L288 390L354 310L424 366L502 332L556 394L506 374L476 392L444 386L422 404L352 344L322 396L286 422L252 394Z M1042 396L1094 330L1174 364L1244 306L1312 386L1360 342L1438 476L1374 408L1354 382L1312 426L1284 376L1248 344L1212 406L1174 392L1110 370Z" fill="var(--ls-paper, #f1f6f6)" strokeOpacity=".25" />
    <ellipse cx="820" cy="702" rx="614" ry="126" fill={`url(#${waterId})`} strokeWidth="1.4" strokeOpacity=".45" />
    <g clipPath={`url(#${waterId}-crater)`} opacity=".15" transform="translate(0 1260) scale(1 -.9)"><SnowRange seed={seed} count={12} baseY={650} height={305} /></g>
    <path d="M246 684Q530 608 838 632Q1140 616 1392 680M368 712Q700 678 1054 704M488 752Q788 732 1172 750" fill="none" strokeOpacity=".32" strokeWidth="1.2" />
    <path d="M0 760Q158 718 294 776Q500 864 810 852Q1168 856 1350 776Q1488 720 1600 752V900H0Z" fill="var(--ls-wash, #aec6ce)" fillOpacity=".7" strokeWidth="1.6" />
    <path d="M0 790Q160 744 296 802M1272 818Q1440 742 1600 780" fill="none" strokeOpacity=".35" strokeWidth="1.2" />
    <CloudBands seed={seed} count={1} baseY={584} opacity={.24} />
    {[42, 106, 188, 268, 1368, 1448, 1534].map((x, index) => <Conifer key={x} x={x} y={856 + (index % 3) * 10} scale={.48 + unit(seed, index) * .24} />)}
    {p.motif === "boat" && <Boat x={1040} y={728} scale={.55} />}
  </>;
  return <>
    <SnowRange seed={seed} count={sayram ? 8 : tianshan ? 10 : 12} baseY={sayram ? 610 : 660} height={sayram ? 210 : 310} />
    <path d={`M0 ${sayram ? 678 : 700} Q360 624 760 674 T1600 668 L1600 900 0 900Z`} fill={`url(#${waterId})`} stroke="none" />
    <path d="M122 708Q480 672 900 708T1530 700" fill="none" stroke="var(--ls-ink, #516b62)" strokeOpacity=".28" strokeWidth="1.6" />
    {tianshan && <g opacity=".8">{Array.from({ length: 7 }, (_, index) => <Conifer key={index} x={120 + index * 235} y={850 + (index % 3) * 13} scale={.72 + (index % 3) * .12} />)}</g>}
    {sayram && <path d="M0 790Q300 748 620 786T1180 780T1600 790V900H0Z" fill="var(--ls-pine, #7f987b)" fillOpacity=".28" />}
    {!sayram && Array.from({ length: 5 }, (_, index) => <Conifer key={index} x={120 + index * 110} y={884} scale={.9 + (index % 2) * .2} />)}
    {p.motif === "boat" && <Boat x={1140} y={790} scale={.8} />}
    <CloudBands seed={seed + 11} count={1} baseY={780} />
  </>;
}

function KarstScene({ parameters: p, seed, waterId }: { parameters: LandscapeParameters; seed: number; waterId: string }) {
  return <>
    <g transform="translate(220 150) scale(.64)"><KarstCliffs distant fill="var(--ls-wash, #a9c1aa)" /></g>
    <KarstCliffs fill="var(--ls-wash, #a9c1aa)" />
    <path d={`M0 698Q412 650 780 686T1600 690V900H0Z`} fill={`url(#${waterId})`} stroke="none" />
    <CloudBands seed={seed} count={2} baseY={570} />
    <Boat x={1110} y={780} scale={.82} />
    <Reeds x={250} y={850} scale={1.15} />
    <Pine x={70} y={850} scale={.9} />
    {p.motif === "pagoda" && <Pagoda x={1360} y={692} scale={.6} />}
  </>;
}

function JiangnanScene({ parameters: p, seed, waterId }: { parameters: LandscapeParameters; seed: number; waterId: string }) {
  const bridgeX = 620 + Math.round(unit(seed, 5) * 520);
  return <>
    <path d="M0 594Q210 526 410 566Q560 506 710 552T1080 542Q1290 490 1600 548V680H0Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".28" />
    <path d={`M0 660Q380 622 720 654T1600 650V900H0Z`} fill={`url(#${waterId})`} stroke="none" />
    <CloudBands seed={seed} count={2} baseY={520} />
    <g fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.8">
      <path d={bridgePath(bridgeX)} />
      <path d={`M${bridgeX - 227} 742Q${bridgeX} 578 ${bridgeX + 227} 742`} fill="none" />
      {Array.from({ length: 8 }, (_, index) => <path key={index} d={`M${bridgeX - 196 + index * 56} ${704 - Math.sin(index / 7 * Math.PI) * 108}v24`} />)}
    </g>
    <VillageHouse x={190} y={700} scale={.64} />
    <VillageHouse x={366} y={696} scale={.48} />
    <VillageHouse x={1380} y={694} scale={.58} />
    <Pagoda x={1450} y={686} scale={.66} />
    <Willow x={240} y={790} scale={1.18} />
    <Willow x={1250} y={760} scale={.94} />
    <Boat x={1120} y={790} scale={.78} />
    <Reeds x={500} y={858} scale={.88} />
    {p.motif === "pavilion" && <g transform="translate(880 690) scale(.55)"><PavilionDrawing /></g>}
    <WaterLines />
  </>;
}

function HuizhouScene({ parameters: p, seed, waterId }: { parameters: LandscapeParameters; seed: number; waterId: string }) {
  const houses = [140, 300, 462, 1050, 1210, 1380];
  return <>
    <path d="M0 596Q180 520 350 558Q500 490 660 540T1010 536Q1260 478 1600 548V700H0Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".36" />
    <path d={`M0 716Q380 680 760 708T1600 710V900H0Z`} fill={`url(#${waterId})`} stroke="none" />
    <g opacity=".16" transform="translate(0 1420) scale(1 -1)">{houses.map((x, index) => <VillageHouse key={x} x={x} y={704} scale={.65 + (index % 3) * .12} />)}</g>
    {houses.map((x, index) => <VillageHouse key={x} x={x} y={704} scale={.65 + (index % 3) * .12} />)}
    <path d="M0 706Q380 714 760 706T1600 706" fill="none" strokeWidth="1.5" />
    <path d="M690 718Q810 640 950 716V734Q812 664 690 738Z" fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.4" />
    <Willow x={1510} y={752} scale={.92} />
    <Reeds x={86} y={862} scale={1.1} />
    {p.motif === "pagoda" && <Pagoda x={820} y={672} scale={.48} />}
    <CloudBands seed={seed} count={1} baseY={560} />
    <WaterLines />
  </>;
}

function DesertScene({ parameters: p, seed, waterId }: { parameters: LandscapeParameters; seed: number; waterId: string }) {
  return <>
    <g fill="var(--ls-wash, #c49f6a)" stroke="var(--ls-ink, #6b5036)" strokeOpacity=".34" strokeWidth="1.2">
      <path d="M0 606Q250 452 520 564Q730 646 940 572Q1220 458 1600 594V900H0Z" fillOpacity=".5" />
      <path d="M0 702Q290 540 600 660Q850 758 1090 664Q1330 570 1600 682V900H0Z" fillOpacity=".66" />
      <path d="M0 798Q280 648 560 752Q840 862 1120 744Q1370 640 1600 760V900H0Z" fillOpacity=".78" />
    </g>
    <path d={`M760 790Q920 664 1080 778Q1010 742 940 806Q880 772 820 816Q786 804 760 790Z`} fill={`url(#${waterId})`} stroke="var(--ls-ink, #6b5036)" strokeOpacity=".35" strokeWidth="1.4" />
    <path d="M0 822Q400 798 800 822T1600 818" fill="none" stroke="var(--ls-ink, #6b5036)" strokeOpacity=".24" strokeWidth="1.2" />
    <g transform="translate(1260 756) scale(.62)"><PavilionDrawing /></g>
    <Camel x={430} y={808} scale={1.05} />
    <CloudBands seed={seed} count={1} baseY={560} />
    {p.motif === "pagoda" && <Pagoda x={1450} y={760} scale={.5} />}
  </>;
}

function CoastScene({ parameters: p, seed, name, waterId }: { parameters: LandscapeParameters; seed: number; name: string; waterId: string }) {
  const xiapu = /霞浦/.test(name), south = /三亚|涠洲/.test(name);
  return <>
    <path d="M0 640Q420 620 900 642T1600 636V900H0Z" fill={`url(#${waterId})`} stroke="none" />
    <path d="M0 666Q310 654 630 664T1180 660T1600 666" fill="none" strokeWidth="1.2" opacity=".3" />
    {xiapu ? <>
      <g fill="var(--ls-accent, #b18f62)" fillOpacity=".36" stroke="var(--ls-ink, #516b62)" strokeOpacity=".4" strokeWidth="1.1">
        <path d="M0 720Q240 662 460 706Q690 760 940 690Q1210 636 1600 716V748Q1250 674 960 728Q690 798 430 742Q210 700 0 756Z" />
        <path d="M0 824Q300 754 560 802Q820 858 1120 774Q1370 710 1600 786V826Q1330 750 1080 812Q820 892 530 838Q260 790 0 858Z" />
      </g>
      {Array.from({ length: 18 }, (_, index) => <path key={index} d={`M${150 + index * 78} ${730 + (index * 47) % 118}l${index % 2 ? 6 : -5}-${54 + (index * 21) % 52}`} fill="none" strokeWidth="1.2" />)}
      <Boat x={1040} y={800} scale={.75} />
    </> : <>
      <path d="M0 790Q120 710 280 756Q410 700 520 792Q590 840 640 900L0 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".82" stroke="var(--ls-ink, #516b62)" strokeWidth="1.5" />
      <Lighthouse x={1330} y={708} scale={.78} />
      <VillageHouse x={1010} y={760} scale={.52} />
      <VillageHouse x={1120} y={742} scale={.4} />
      <Boat x={720} y={790} scale={.7} />
      {south && <><Palm x={200} y={790} scale={.88} /><Palm x={330} y={800} scale={.7} /></>}
    </>}
    <Reeds x={500} y={864} scale={.78} />
    <g fill="none" strokeWidth="1.1" opacity=".5">
      <path d="M1180 380q9-8 17 0q8-10 17-3 M1232 356q6-6 12 0q7-8 14-2" />
    </g>
    <CloudBands seed={seed} count={1} baseY={560} />
    {p.motif === "pine" && <Pine x={120} y={840} scale={.9} />}
  </>;
}

function GorgeScene({ parameters: p, seed, waterId }: { parameters: LandscapeParameters; seed: number; waterId: string }) {
  return <>
    <path d="M0 900V382Q96 300 208 384Q300 438 386 358Q458 302 548 420Q620 512 626 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".7" stroke="var(--ls-ink, #516b62)" strokeWidth="2" />
    <path d="M1600 900V344Q1514 274 1408 360Q1320 430 1238 344Q1158 278 1074 402Q992 512 982 900Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".66" stroke="var(--ls-ink, #516b62)" strokeWidth="2" />
    <path d={`M560 900Q700 762 790 668T936 668Q1000 700 1040 900Z`} fill={`url(#${waterId})`} stroke="none" />
    <g data-landscape-feature="double-waterfall">
      <path d="M756 388Q788 366 832 386L816 566Q784 594 748 566Q772 488 756 388Z" fill="var(--ls-paper, #f5f0e5)" fillOpacity=".9" strokeOpacity=".4" strokeWidth="1.3" />
      <path d="M748 566Q792 554 844 574L868 610Q816 630 766 612Z" fill="var(--ls-wash, #a9c1aa)" fillOpacity=".65" strokeWidth="1.5" />
      <path d="M776 610Q814 598 846 614Q848 716 808 766L762 764Q792 694 776 610Z" fill="var(--ls-paper, #f5f0e5)" fillOpacity=".93" strokeOpacity=".35" strokeWidth="1.2" />
      <path d="M778 404Q800 472 774 550M806 400Q824 466 796 558M800 626Q812 686 780 748M828 624Q836 696 804 752" fill="none" stroke="var(--ls-water, #aec8b6)" strokeWidth="3.2" />
      <path d="M724 776Q786 748 860 772M750 790Q810 772 884 788" fill="none" strokeWidth="1.2" opacity=".38" />
    </g>
    <CloudBands seed={seed} count={2} baseY={540} />
    <path d="M870 616Q940 566 1016 610" fill="none" strokeWidth="2.2" />
    <path d="M892 610V646M976 608V648M920 592V628M950 582V620" fill="none" strokeWidth="1.2" />
    <Pine x={130} y={790} scale={.88} />
    <Pine x={1460} y={780} scale={.78} />
    <Reeds x={600} y={862} scale={.9} />
    {p.motif === "boat" && <Boat x={880} y={790} scale={.68} />}
    <WaterLines />
  </>;
}

function ParametricLandscape({ parameters: p, waterId, name = "" }: { parameters: LandscapeParameters; waterId: string; name?: string }) {
  const { seed, scene: archetype } = landscapeComposition(p, name);
  const scene: Record<LandscapeArchetype, ReactNode> = {
    peaks: <PeaksScene parameters={p} seed={seed} name={name} waterId={waterId} />,
    cliff: <CliffScene parameters={p} seed={seed} name={name} waterId={waterId} />,
    tianchi: <TianchiScene parameters={p} seed={seed} name={name} waterId={waterId} />,
    karst: <KarstScene parameters={p} seed={seed} waterId={waterId} />,
    jiangnan: <JiangnanScene parameters={p} seed={seed} waterId={waterId} />,
    huizhou: <HuizhouScene parameters={p} seed={seed} waterId={waterId} />,
    desert: <DesertScene parameters={p} seed={seed} waterId={waterId} />,
    coast: <CoastScene parameters={p} seed={seed} name={name} waterId={waterId} />,
    gorge: <GorgeScene parameters={p} seed={seed} waterId={waterId} />,
  };
  const height = .92 + p.ridge * .0016;
  return <g data-landscape-engine={archetype} data-landscape-seed={seed} transform={`translate(0 ${900 * (1 - height)}) scale(1 ${height})`}>
    {scene[archetype]}
    {p.motif === "pine" && archetype !== "coast" ? <CliffPine x={350} y={850} scale={.68} /> : null}
    {p.motif === "snowpeak" && archetype !== "tianchi" ? <g opacity=".5"><SnowRange seed={seed} baseY={570} height={190} count={6} /></g> : null}
    {p.motif === "lighthouse" && archetype !== "coast" ? <Lighthouse x={1370} y={830} scale={.5} /> : null}
    {p.motif === "village" && !["jiangnan", "huizhou", "coast"].includes(archetype) ? <VillageHouse x={1360} y={840} scale={.55} /> : null}
    {p.motif === "pagoda" && !["jiangnan", "huizhou", "desert", "karst"].includes(archetype) ? <Pagoda x={1370} y={830} scale={.5} /> : null}
    {p.motif === "boat" && ["peaks", "cliff", "huizhou", "desert"].includes(archetype) ? <Boat x={1080} y={848} scale={.65} /> : null}
    {p.motif === "bridge" && !["jiangnan", "huizhou"].includes(archetype) ? <path d={bridgePath(1080)} fill="var(--ls-paper, #f5f0e5)" strokeWidth="1.5" /> : null}
    {p.motif === "pavilion" && ["tianchi", "karst", "coast", "gorge"].includes(archetype) ? <g transform="translate(1320 820) scale(.5)"><PavilionDrawing /></g> : null}
  </g>;
}

export function LandscapeSketch({ scene, className, parameters, name = "", fit = "slice" }: LandscapeSketchProps) {
  const id = `landscape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const waterId = `${id}-water`;
  const resolvedScene = resolveScene(scene);
  const palette = parameters ? landscapePalettes[parameters.palette] : null;
  const paletteStyle = palette ? ({
    "--ls-ink": palette.ink,
    "--ls-wash": palette.wash,
    "--ls-paper": palette.paper,
    "--ls-pine": palette.pine,
    "--ls-accent": palette.accent,
    "--ls-water": palette.water,
    "--ls-mist": palette.mist,
  } as CSSProperties) : undefined;
  const drawings = {
    jiuzhaigou: <AlpineValley waterId={waterId} />,
    "west-lake": <WestLake waterId={waterId} />,
    "li-river": <LiRiver waterId={waterId} />,
    hongcun: <Hongcun waterId={waterId} />,
    xiapu: <Xiapu waterId={waterId} />,
    chengdu: <Chengdu waterId={waterId} />,
    qingdao: <Qingdao waterId={waterId} />,
  };

  return (
    <svg
      className={className}
      viewBox="0 0 1600 900"
      width="100%"
      height="100%"
      preserveAspectRatio={`xMidYMid ${fit}`}
      aria-hidden="true"
      focusable="false"
      data-landscape-scene={parameters ? scene : resolvedScene}
      data-landscape-archetype={parameters ? inferSceneArchetype(name, parameters) : resolvedScene}
      data-landscape-celestial={parameters?.celestial ?? "sun"}
      xmlns="http://www.w3.org/2000/svg"
      style={paletteStyle}
    >
      <defs>
        <linearGradient id={waterId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette ? palette.wash : "#abc6b5"} stopOpacity=".45" />
          <stop offset=".68" stopColor={palette ? palette.water : "#c1d2ba"} stopOpacity=".38" />
          <stop offset="1" stopColor={palette ? palette.mist : "#e4dfc8"} stopOpacity=".7" />
        </linearGradient>
        <radialGradient id={`${id}-paper`} cx=".5" cy=".25" r=".85">
          <stop offset="0" stopColor={palette ? palette.paper : "#fcf8ef"} />
          <stop offset="1" stopColor={palette ? palette.paper : "#eee8d9"} />
        </radialGradient>
        <pattern id={`${id}-grain`} width="109" height="83" patternUnits="userSpaceOnUse">
          <g fill="#8e8167" opacity=".095">
            <circle cx="6" cy="17" r=".7" /><circle cx="34" cy="53" r=".6" />
            <circle cx="77" cy="13" r=".65" /><circle cx="97" cy="71" r=".7" />
            <ellipse cx="56" cy="36" rx="1.4" ry=".35" />
            <ellipse cx="16" cy="77" rx="1.3" ry=".35" />
          </g>
          <path d="M23 23 l6-1 M71 63 l9 1 M98 39 l5-1" stroke="#a79b83" strokeWidth=".5" opacity=".13" />
        </pattern>
      </defs>
      <path d="M0 0H1600V900H0Z" fill={`url(#${id}-paper)`} />
      <g stroke={palette ? palette.ink : ink} strokeLinecap="round" strokeLinejoin="round">
        <g fill="none" opacity=".13" strokeWidth="1.2">
          <path d="M81 243 Q118 234 149 240 Q174 220 207 233 Q240 223 267 241 Q292 236 317 244 M1191 314 Q1220 301 1246 310 Q1275 293 1301 307 Q1334 300 1364 314" />
          <path d="M77 252 Q183 247 283 254 M1180 323 Q1256 317 1356 324" />
        </g>
        {parameters?.celestial === "cloud" ? <CloudBands seed={landscapeComposition(parameters, name).seed} count={3} baseY={210} opacity={.65}/> : <circle cx={parameters?.sunX ?? 1330} cy="243" r="48" fill={parameters?.celestial === "moon" ? "#fffdf7" : palette?.sun ?? "#c7ab80"} fillOpacity={parameters?.celestial === "moon" ? .85 : .14} stroke="none" />}
        {parameters ? <ParametricLandscape parameters={parameters} waterId={waterId} name={name} /> : drawings[resolvedScene]}
        <g fill="none" strokeWidth="1.4" opacity=".49">
          <path d="M1143 354 q9-8 17 0 q8-10 17-3 M1195 335 q6-6 12 0 q7-8 14-2 M1116 374 q6-5 11 0 q6-7 12-2" />
        </g>
      </g>
      <path d="M0 0H1600V900H0Z" fill={`url(#${id}-grain)`} />
    </svg>
  );
}
