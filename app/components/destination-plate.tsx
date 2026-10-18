import { useId } from "react";

export const destinationCaptions: Record<string, { name: string; coordinates: string }> = {
  杭州: { name: "WEST LAKE · HANGZHOU", coordinates: "30°15'N 120°09'E" },
  成都: { name: "TEA & BAMBOO · CHENGDU", coordinates: "30°39'N 104°04'E" },
  青岛: { name: "COASTLINE · QINGDAO", coordinates: "36°04'N 120°23'E" },
};

/** Small engraved landscapes, printed directly into the destination folio. */
export function DestinationPlate({ destination }: { destination: string }) {
  const id = useId().replace(/:/g, "");
  const isHangzhou = destination === "杭州";
  const isChengdu = destination === "成都";
  const palette = isHangzhou
    ? ["#2C4438", "#526D5E"]
    : isChengdu
      ? ["#3A382B", "#6E5D47"]
      : ["#233947", "#4A6B7C"];

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 420 156" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-ground`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={palette[0]} />
          <stop offset="1" stopColor={palette[1]} />
        </linearGradient>
        <linearGradient id={`${id}-mist`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#e4ddc4" stopOpacity="0.24" />
          <stop offset="1" stopColor="#e4ddc4" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.72" cy="0.3" r="0.65">
          <stop stopColor="#e7dfc4" stopOpacity="0.13" />
          <stop offset="1" stopColor="#e7dfc4" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-grain`} width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 1h1M3 4h1" stroke="#fff" strokeOpacity="0.045" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="420" height="156" fill={`url(#${id}-ground)`} />
      <rect width="420" height="156" fill={`url(#${id}-glow)`} />
      {isHangzhou ? (
        <g aria-hidden="true">
          <circle cx="319" cy="42" r="22" fill="#dbd9b9" opacity="0.15" />
          <circle cx="319" cy="42" r="27" fill="none" stroke="#e2ddbe" strokeWidth="0.6" opacity="0.2" />
          <path d="M0 81C20 82 32 59 51 60C66 60 81 30 96 38C112 45 117 66 139 69C160 72 171 51 188 58C205 66 205 74 225 76C244 78 260 53 278 62C295 70 305 51 322 58C350 69 358 44 379 45C395 46 406 65 420 67V111H0Z" fill="#9aa78d" opacity="0.23" />
          <path d="M0 93C33 87 47 60 66 67C89 76 97 90 119 87C144 83 144 69 164 76C184 83 190 66 208 66C226 68 232 94 255 90C277 86 296 74 313 83C347 101 369 67 390 73C407 79 412 82 420 80V116H0Z" fill={`url(#${id}-mist)`} />
          <path d="M0 101C29 98 51 97 75 101S119 109 155 104S223 97 254 103S318 111 352 105S392 98 420 102" fill="none" stroke="#d6d9ba" strokeOpacity="0.24" strokeWidth="0.7" />
          <path d="M-12 110C47 97 100 117 160 108S270 104 308 111S388 104 436 109M-4 118C37 113 65 122 98 119M126 118C156 113 176 118 202 119M247 120C286 118 305 123 346 119M365 117l58 1" fill="none" stroke="#d6d9ba" strokeOpacity="0.22" strokeWidth="0.6" />
          <path d="M67 103C84 84 108 80 132 81C153 82 166 91 183 103" fill="none" stroke="#d7d6b7" strokeWidth="1" opacity="0.75" />
          <path d="M65 106C83 90 106 85 132 86C153 87 168 96 184 106M74 97v6M84 90v5M96 85v5M109 82v5M121 81v5M133 81v5M146 84v5M158 89v5M170 95v5" fill="none" stroke="#d7d6b7" strokeWidth="0.65" opacity="0.55" />
          <path d="M-5 113C7 108 18 113 28 109C36 106 43 106 49 106H63M184 107C197 103 207 109 219 109" fill="none" stroke="#d7d6b7" strokeOpacity="0.45" strokeWidth="0.7" />
          <g fill="none" stroke="#dbd7b9" strokeWidth="0.75" opacity="0.68">
            <path d="M242 93h37M247 93v17M274 93v17M245 111h31M245 89c7-1 11-5 15-10 5 5 9 9 16 10M241 93c9-1 15-4 19-8 5 4 11 7 20 8M260 75v4M251 95h19M251 96v12M270 96v12" />
          </g>
          <path d="M362 120C361 85 359 59 367 18M365 53c-7-10-17-14-28-16M363 65c9-15 21-20 33-21M363 82c-9-10-21-13-34-13M367 33c10-7 18-9 26-8" fill="none" stroke="#1b3027" strokeWidth="1.2" opacity="0.5" />
          <path d="M338 39c-4 18-4 33-1 47M346 42c-4 14-4 26-2 38M352 46c-2 12-1 19 0 25M385 47c-2 12-1 24 3 34M393 45c1 10 4 19 8 25M331 70c-2 11-1 22 1 31M340 72c-1 12 2 20 5 28" fill="none" stroke="#adc0a0" strokeWidth="0.6" opacity="0.35" />
        </g>
      ) : isChengdu ? (
        <g aria-hidden="true">
          <circle cx="271" cy="41" r="26" fill="#decc9f" opacity="0.09" />
          <path d="M0 100C41 89 65 101 106 90C152 78 176 104 212 88C250 73 267 75 301 88C345 105 370 73 420 88V156H0Z" fill="#192e27" opacity="0.3" />
          <path d="M0 112C44 106 82 118 130 108C177 97 220 119 269 106C324 91 375 108 420 100" fill="none" stroke="#e0d4b3" strokeWidth="0.7" opacity="0.22" />
          <g fill="none" stroke="#d1c49f" strokeWidth="0.75" opacity="0.62">
            <path d="M228 94h136M241 94v20M350 94v21M235 88c21 0 41-9 61-23 16 13 34 22 63 23M229 94c24-1 47-10 67-25 19 15 40 24 67 25M265 87h63M250 96v17M261 96v17M331 96v17M342 96v17M267 113V97h58v16M279 98v14M292 98v14M305 98v14M318 98v14M236 116h120" />
            <path d="M204 94c5-12 11-15 18-9M367 104c5-16 13-19 20-6M208 110V87M378 115V92" opacity="0.4" />
          </g>
          <g fill="none" strokeLinecap="round">
            <path d="M60 144C65 96 64 54 55-8M95 151C90 104 98 48 117-6M33 154C39 113 35 69 22 28" stroke="#1c3128" strokeWidth="3.5" opacity="0.54" />
            <path d="M63 104l-8 1M65 70l-8 1M61 33l-8 1M95 114l-9-1M98 75l-8-2M107 35l-8-3M36 97l-7 1M31 65l-7 2" stroke="#c9cbab" strokeWidth="0.8" opacity="0.44" />
            <path d="M64 70C49 58 36 53 14 54M99 72c17-18 34-21 54-22M104 45c-14-14-20-20-41-25M93 114c20-18 40-20 59-18M38 94c12-17 24-19 42-21" stroke="#a2ae83" strokeWidth="0.7" opacity="0.53" />
          </g>
          <g fill="#a5b28a" opacity="0.45">
            <path d="M51 62c-3-14-11-23-17-27 1 12 6 22 17 27ZM39 58C28 46 17 42 8 44c9 6 18 10 31 14ZM112 62c5-17 13-25 23-29-5 14-10 21-23 29ZM126 56c17-10 27-11 40-5-15 3-27 5-40 5ZM90 36C84 20 74 12 63 10c5 11 13 20 27 26ZM118 101c11-13 23-18 34-17-10 9-20 15-34 17ZM137 98c16-4 26-3 36 6-14 0-24-2-36-6ZM53 80c4-13 10-19 20-24-3 11-10 19-20 24Z" />
          </g>
          <g fill="none" stroke="#e0d2ae" strokeWidth="0.8" opacity="0.72">
            <ellipse cx="183" cy="106" rx="23" ry="4.5" />
            <path d="M161 106c3 14 10 20 22 20s20-8 23-20M172 125l-2 3h26l-2-3M153 131c13 4 46 4 60 0M180 95c-7-6 7-9 0-15M188 94c-5-7 7-10 1-16M161 100c12-6 32-6 44 0M178 97l-1-3h13l-1 3" />
          </g>
          <path d="M219 119h58M295 123h46M362 118h39" fill="none" stroke="#cbbf9e" strokeWidth="0.6" opacity="0.23" />
        </g>
      ) : (
        <g aria-hidden="true">
          <circle cx="305" cy="39" r="22" fill="#e4d4b3" opacity="0.18" />
          <path d="M0 82C56 70 91 76 132 85C173 94 209 79 251 81C312 84 360 73 420 82V156H0Z" fill="#748e98" opacity="0.17" />
          <g fill="none" stroke="#c7d8d6" strokeWidth="0.65" opacity="0.35">
            <path d="M-5 97C35 82 70 89 106 98S174 115 213 99S281 86 319 98S385 110 426 95M-4 103C32 91 64 95 99 104S173 121 215 107S280 93 316 104S385 116 426 103M-7 112C31 103 61 105 97 114S174 129 216 116S279 103 316 112S385 125 426 115M-9 123C36 115 63 117 96 124S173 139 220 126S282 114 318 122S386 135 426 127" />
          </g>
          <path d="M250 130c10-8 12-21 27-24 11-2 15 8 29 5 13-2 11-9 25-7 13 2 13 12 24 14 12 2 19-1 25 12" fill="#1e3540" />
          <path d="M268 124l9-13 16 7 14-3 8 7M333 109l-7 11 21-1" fill="none" stroke="#9bb4b9" strokeWidth="0.6" opacity="0.35" />
          <path d="M291 108l6-54h14l6 54Z" fill="#d6d3bd" opacity="0.73" />
          <path d="M297 56h14M294 86h20M293 95h22M292 105h24" fill="none" stroke="#344f5b" strokeWidth="0.7" />
          <path d="M294 52h20v4h-20ZM297 51V40h14v11M295 39l9-9 10 9Z" fill="none" stroke="#ded8bd" strokeWidth="0.9" />
          <path d="M297 39h14l-7-8Z" fill="#a8583b" />
          <path d="M304 40v10M300 64h7v8h-7M302 92h5v13" fill="none" stroke="#2b4551" strokeWidth="0.8" />
          <path d="M284 111h41M288 114h39" fill="none" stroke="#d6d3bd" strokeWidth="0.7" opacity="0.5" />
          <path d="M0 114l18-18 19 7 18-24 17 12 17-12 13 17 16-7 20 14 10-8 29 22V156H0Z" fill="#293d46" />
          <g stroke="#d6c5af" strokeWidth="0.65" opacity="0.77">
            <path d="M10 111V94h19v16M34 113V99h13v16M50 112V88h24v29M80 119V96h28v24M116 120v-17h20v18" fill="none" />
            <path d="M6 94l14-11 14 11M45 88l17-14 17 14M77 96l17-14 17 14M113 103l13-9 13 9" fill="#a8583b" stroke="#b7795d" />
            <path d="M86 87V65h14v21M84 65l9-24 9 24Z" fill="#a8583b" />
            <path d="M90 66v13M96 66v13M93 41v-7M59 93v6M67 93v6M57 106h10M88 103v7M98 103v7M15 99v6M24 99v6M122 108v7M131 108v7" fill="none" />
          </g>
          <path d="M175 38l5-3 5 2M188 31l4-2 4 2M345 67l5-3 5 2" fill="none" stroke="#d0d9cf" strokeWidth="0.7" opacity="0.55" />
        </g>
      )}
      <rect width="420" height="156" fill={`url(#${id}-grain)`} />
      <path d="M13 26V13h13M394 13h13v13M13 131v12h13M394 143h13v-12" fill="none" stroke="#e7e1cd" strokeOpacity="0.24" strokeWidth="0.6" />
    </svg>
  );
}
