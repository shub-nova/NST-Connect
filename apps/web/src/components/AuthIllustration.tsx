/** A friendly desk scene in the Newton School palette (blue, beige, coral). */
export default function AuthIllustration() {
  return (
    <svg viewBox="0 0 460 400" className="h-auto w-full max-w-lg" role="img" aria-label="A student getting help at a desk">
      {/* floor tiles */}
      <polygon points="30,300 130,250 230,300 130,350" fill="#f3f0e2" />
      <polygon points="150,350 300,275 430,340 280,395" fill="#f3f0e2" />
      {/* rug */}
      <polygon points="95,290 255,210 395,280 235,360" fill="#e08b8b" />
      <polygon points="120,290 255,222 372,280 237,346" fill="#e8a0a0" />

      {/* floating code mark */}
      <g fill="#4b8bf0">
        <polygon points="150,40 190,30 205,55 190,80 150,70 168,55" />
        <polygon points="250,45 290,35 320,60 290,95 255,85 275,62" />
        <polygon points="205,38 222,32 192,110 175,116" fill="#6aa6ff" />
      </g>

      {/* desk */}
      <polygon points="150,215 330,130 400,175 220,265" fill="#f2e6a8" />
      <polygon points="220,265 400,175 400,188 220,278" fill="#d9c97a" />
      <polygon points="228,278 238,276 238,345 228,347" fill="#3c4660" />
      <polygon points="385,183 395,178 395,240 385,246" fill="#3c4660" />

      {/* monitor */}
      <polygon points="248,95 322,60 322,150 248,185" fill="#2a3552" />
      <polygon points="256,108 314,80 314,140 256,168" fill="#3a496e" />
      <polygon points="262,122 300,104 300,112 262,130" fill="#8fbaff" />
      <polygon points="262,136 290,123 290,130 262,143" fill="#6aa6ff" />
      <polygon points="270,185 300,171 300,200 270,214" fill="#3c4660" opacity="0.0" />

      {/* books and pencil cup */}
      <polygon points="215,160 250,143 262,150 228,168" fill="#c8e6b4" />
      <polygon points="215,160 228,168 228,176 215,168" fill="#9fcf86" />
      <polygon points="222,148 256,132 266,138 232,155" fill="#e9b97c" />
      <rect x="224" y="118" width="16" height="26" rx="3" fill="#f2a53a" />

      {/* plant */}
      <rect x="372" y="148" width="22" height="30" rx="4" fill="#8dc3ee" />
      <g fill="#4f7c3a">
        <ellipse cx="383" cy="105" rx="9" ry="42" />
        <ellipse cx="372" cy="115" rx="7" ry="32" />
        <ellipse cx="394" cy="120" rx="7" ry="28" />
      </g>
      <g fill="#6aa6ff">
        <ellipse cx="356" cy="104" rx="9" ry="14" transform="rotate(-20 356 104)" />
        <ellipse cx="410" cy="124" rx="8" ry="13" transform="rotate(20 410 124)" />
      </g>

      {/* chair */}
      <polygon points="108,165 150,150 150,255 108,272" fill="#2d2f36" />
      <polygon points="150,215 215,243 215,262 150,236" fill="#2d2f36" />
      <rect x="170" y="258" width="10" height="70" fill="#7ec0e8" transform="rotate(8 170 258)" />
      <ellipse cx="170" cy="334" rx="34" ry="12" fill="#7ec0e8" />

      {/* person */}
      <circle cx="170" cy="130" r="26" fill="#f0b090" />
      <path d="M146 124c2-26 36-34 50-8-14-4-30-2-50 8z" fill="#1f2230" />
      <path d="M140 190c6-30 38-34 54-20l26 40-34 18-30-6z" fill="#4b8bf0" />
      <polygon points="190,196 238,186 242,198 196,214" fill="#4b8bf0" />
      <circle cx="244" cy="193" r="7" fill="#f0b090" />
      <polygon points="168,230 205,244 190,300 160,292" fill="#e9e6f5" />
      <polygon points="190,300 205,304 214,322 196,326" fill="#4b8bf0" />

      {/* cup and bin */}
      <ellipse cx="318" cy="232" rx="14" ry="8" fill="#e8f0ff" />
      <polygon points="306,226 330,226 326,246 310,246" fill="#8fbaff" />
      <polygon points="315,285 345,271 360,300 330,314" fill="#9aa6d8" />
    </svg>
  );
}
