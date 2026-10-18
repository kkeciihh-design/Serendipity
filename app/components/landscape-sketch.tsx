"use client";

import { useId } from "react";

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
};

type PlacedDrawingProps = {
  x: number;
  y: number;
  scale?: number;
};

const ink = "#516b62";
const paper = "#f5f0e5";

/** Original pen-and-wash drawings. All geometry is fixed for stable SSR. */
function Pine({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-3 4 C1-43-6-95 2-163 M3 2 C6-51 1-107 2-163" fill="none" strokeWidth="1.6" />
      <g fill="#8b9f87" fillOpacity=".33" strokeWidth="1.15">
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
              return <path key={leaf} d={`M${leafX} ${leafY} q-9 3-8 12 M${leafX + 1} ${leafY + 5} q8 2 6 10`} stroke="#728873" />;
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
      <path d="M-17-50 q-9-17-5-24 q11 14 5 24 M14-68 q-2-17 5-22 q4 17-5 22 M36-40 q4-12 14-13 q-3 11-14 13 M-12-65 q-7-14-2-21 q8 12 2 21" fill="#8c987d" fillOpacity=".4" />
    </g>
  );
}

function Boat({ x, y, scale = 1 }: PlacedDrawingProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} strokeWidth="1.35">
      <path d="M-65-7 Q-6 5 66-10 L44 7 Q-11 15-52 4Z" fill="#b7a285" fillOpacity=".52" />
      <path d="M-24-4 Q-17-36 10-31 Q33-26 36-5 M-19-6 Q-11-28 10-25 Q26-20 29-5" fill={paper} />
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
      <path d="M-42 0-35-26 35-26 42 0Z" fill="#b5b9a3" />
      {[0, 1, 2, 3, 4].map((level) => {
        const y = -24 - level * 32;
        const width = 37 - level * 4;
        return (
          <g key={level}>
            <path d={`M${-width + 9} ${y} v-23 h${width * 2 - 18} v23Z`} fill={paper} />
            <path d={`M${-width - 7} ${y - 22} Q${-width + 7} ${y - 25} -8 ${y - 34} H8 Q${width - 7} ${y - 25} ${width + 7} ${y - 22} Q0 ${y - 17} ${-width - 7} ${y - 22}Z`} fill="#869082" />
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
      <g fill={paper} strokeWidth="1.4">
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

function KarstCliffs({ distant = false }: { distant?: boolean }) {
  return (
    <g fill={distant ? "#c3cebf" : "#b5c5ac"} fillOpacity={distant ? .48 : .7} strokeWidth="1.5" strokeOpacity={distant ? .4 : .8}>
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
      <path d="M-93 0 V-102 L-66-102-66-125-38-125-38-145 4-158 44-145 44-125 70-125 70-102 98-102 V0Z" fill={paper} />
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
          <g fill="#758a6a" fillOpacity=".6">
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
        <path d="M-145-121 V0 H145 V-122 M-132-119 V-5 M133-119 V-5 M-51-113 V-4 M53-113 V-4" fill={paper} />
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
        <path d="M-39 0-27-184 H25 L40 0Z" fill={paper} />
        <path d="M-31-184 V-216 H29 V-184Z" fill="#d3d6c4" />
        <path d="M-45-217-3-247 44-217Z" fill="#b78769" />
        <path d="M-41-183 H38 M-43-179 H42 M-25-160 H28 M-32-64 H33 M-35-39 H36 M-30-208 H28 M-20-214 V-185 M0-214 V-185 M19-214 V-185" fill="none" />
        <path d="M-8 0 V-31 Q0-41 9-31 V0 M-5-147 H7 V-130 H-5Z M-6-100 H8 V-84 H-6Z" fill="#7c8d80" />
        <path d="M-3-247 V-258 M-53-176 H51 M-50-176 V-190 M-28-176 V-190 M-5-176 V-190 M19-176 V-190 M44-176 V-190" fill="none" />
      </g>
      <g transform="translate(1205 700)" strokeWidth="1.25">
        <path d="M-121 0 V-87 H-13 V0 M-11 0 V-63 H92 V0 M90 0 V-107 H201 V0" fill={paper} />
        <path d="M-136-85-71-133 0-85Z M-26-61 39-105 106-61Z M73-105 145-156 217-105Z" fill="#bd8e70" fillOpacity=".82" />
        <path d="M-121-77 H-14 M-7-56 H90 M91-98 H200 M-102-62 h19 v23 h-19Z M-54-62 h19 v23 h-19Z M16-40 h18 v22 h-18Z M59-40 h18 v22 h-18Z M111-79 h20 v25 h-20Z M160-79 h20 v25 h-20Z" fill="none" />
        <path d="M-134 3 H216 M-142 9 H220 M-80-119-21-85 M-90-111-42-85 M126-142 183-107 M114-133 162-107" fill="none" opacity=".6" />
      </g>
      <g transform="translate(797 748)" strokeWidth="1.5">
        <path d="M-42 7 H46 L28 20 H-25Z" fill="#b2bca9" />
        <path d="M1 5 V-120 M-4-110-40-3 H-4Z" fill={paper} />
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

/** Decorative, responsive artwork; surrounding UI supplies the destination name. */
export function LandscapeSketch({ scene, className }: LandscapeSketchProps) {
  const id = `landscape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const waterId = `${id}-water`;
  const resolvedScene = resolveScene(scene);
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
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-landscape-scene={resolvedScene}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={waterId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#abc6b5" stopOpacity=".45" />
          <stop offset=".68" stopColor="#c1d2ba" stopOpacity=".38" />
          <stop offset="1" stopColor="#e4dfc8" stopOpacity=".7" />
        </linearGradient>
        <radialGradient id={`${id}-paper`} cx=".5" cy=".25" r=".85">
          <stop offset="0" stopColor="#fcf8ef" />
          <stop offset="1" stopColor="#eee8d9" />
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
      <g stroke={ink} strokeLinecap="round" strokeLinejoin="round">
        <g fill="none" opacity=".13" strokeWidth="1.2">
          <path d="M81 243 Q118 234 149 240 Q174 220 207 233 Q240 223 267 241 Q292 236 317 244 M1191 314 Q1220 301 1246 310 Q1275 293 1301 307 Q1334 300 1364 314" />
          <path d="M77 252 Q183 247 283 254 M1180 323 Q1256 317 1356 324" />
        </g>
        <circle cx="1330" cy="243" r="48" fill="#c7ab80" fillOpacity=".1" stroke="none" />
        {drawings[resolvedScene]}
        <g fill="none" strokeWidth="1.4" opacity=".49">
          <path d="M1143 354 q9-8 17 0 q8-10 17-3 M1195 335 q6-6 12 0 q7-8 14-2 M1116 374 q6-5 11 0 q6-7 12-2" />
        </g>
      </g>
      <path d="M0 0H1600V900H0Z" fill={`url(#${id}-grain)`} />
    </svg>
  );
}
