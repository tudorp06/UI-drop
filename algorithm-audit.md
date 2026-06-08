# UIDrop Algorithm Audit
_Systematic capture across 20–50 sites. Records what the extension got right/wrong and which layer is responsible._

## Scoring Key
- ✅ Correct
- ⚠️ Close but off
- ❌ Wrong (clearly incorrect)
- — Not applicable / not visible on page

---

## Sites

### 1. kriss.ai
**Mode:** Light — dusty mauve/rose background, black "Book Demo" CTA

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · monochrome · modern |
| primary | ✅ | null — CTA is black, monochrome correct |
| accent | ✅ | #000000 |
| surface | ❌ | #FFFFFF — should be dusty mauve ~#C4B5B8. Fails `luminance > 0.82` filter (actual lum ≈ 0.73) |
| elevated | ⚠️ | #F2F2F2 — some white section below fold, plausible |
| text | ✅ | #0F0F0F |
| muted | ✅ | #747474 |
| headingFont | ✅ | Krissai 700 |
| bodyFont | ✅ | Krissai 16px 400 |
| typeScale | ✅ | 60px / 24px / 16px |
| radius | ⚠️ | "0px 3px 3px 0px" — asymmetric, likely accurate for this pill-right button |
| spacing | ✅ | 4 / 8 / 16 / 24 / 32 |
| buttonStyle | ✅ | #0F0F0F bg, white text — matches black Book Demo button |
| cardStyle | — | default fallback, no cards visible |
| inputStyle | — | default fallback |
| shadowScale | — | none visible |
| gradients | ⚠️ | #B29FA3 → #D2CACC — page background colors, mild but not wrong |
| borderColor | — | not reported |

**Score: 14/16 applicable**

**Root causes:**
- `surface` ❌ — `lightNeutrals` filter requires `luminance > 0.82`. Dusty mauve lum ≈ 0.73 → excluded. White from a section below wins instead.
  **Layer:** popup.js `derivePalette()` — threshold too strict

---

### 2. darkroom.app
**Mode:** Dark hero (near-black), red "Get the App" CTA, white section below fold

| Field | Result | Notes |
|---|---|---|
| isDark | ❌ | reports light — body background is white, dark hero is a div |
| vibe | ❌ | "light · vibrant" — cascades from isDark failure |
| primary | ✅ | #C7042E — red, correct |
| accent | ⚠️ | #9F0325 — darker red, no second CTA exists, shift is OK |
| surface | ❌ | #FFFFFF — should be dark ~#111111 |
| elevated | ❌ | #F2F2F2 — wrong for dark mode |
| text | ❌ | #111111 — should be near-white |
| muted | ⚠️ | #505050 — wrong polarity for dark mode |
| headingFont | ❌ | "system 700" — system font stack, no design font found |
| bodyFont | ❌ | "system 14px 400" — same |
| typeScale | ✅ | 50px / 20px / 14px |
| radius | ✅ | 24px buttons — matches the red pill CTA |
| spacing | ✅ | 13 / 16 / 20 / 24 |
| buttonStyle | ✅ | #C7042E bg, white text, 24px radius |
| cardStyle | ⚠️ | missing bg — card found but bg null |
| inputStyle | ⚠️ | no bg/border |
| shadowScale | ✅ | real shadow found |
| gradients | ✅ | #E20058 → #FF6F00, #7631E1 → #A866FF — logo/brand gradient |
| borderColor | — | not reported |

**Score: 8/17 applicable** — dark mode cascade destroys 6 fields

**Root causes:**
- `isDark` ❌ — `body { background: white }`, dark section is a child div. `detectPageIsDark()` trusts body → returns false. **Layer:** content.js `detectPageIsDark()` — needs viewport-coverage fallback
- `headingFont`/`bodyFont` ❌ — site uses system font stack (`-apple-system` etc.), all filtered by SYSTEM_FONTS. No custom font → returns null → "system". **Layer:** content.js `pickIntentFont()` — when all fonts are system, report the best system fallback meaningfully

---

### 3. clerk.com
**Mode:** Light — off-white bg, purple "Start building for free" CTA

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · vibrant · modern |
| primary | ✅ | #6C47FF — purple, correct |
| accent | ⚠️ | #262F40 — dark navy, probably from dark announcement bar; no real second CTA |
| surface | ✅ | #F7F7F8 |
| elevated | ⚠️ | #D9D9DE — a bit dark for elevated |
| text | ✅ | #000000 |
| muted | ✅ | #747686 |
| headingFont | ❌ | "geistNumbers 700" — font family stack has "GeistVariable" or "Geist Numbers" variant name leaking through |
| bodyFont | ❌ | "geistNumbers 16px 400" — same |
| typeScale | ✅ | 64px / 24px / 16px |
| radius | ⚠️ | "8px" only — single value |
| spacing | ⚠️ | 3 / 6 / 12 — very small values, likely from inner padding rather than layout rhythm |
| buttonStyle | ❌ | "#6C47FF text, 6px 0px padding" — scraper picked ghost button (transparent bg, purple text) instead of filled primary CTA |
| cardStyle | ⚠️ | default fallback |
| inputStyle | ⚠️ | default fallback |
| shadowScale | — | none |
| gradients | ⚠️ | #27272D → #373840 is near-black (meaningless); #6C47FF → #5DE3FF is plausible brand gradient |
| borderColor | ✅ | #EEEEF0 |

**Score: 11/18 applicable**

**Root causes:**
- `headingFont` ❌ — "geistNumbers" leaks through. Font stack variant suffixes (Numbers, Variable, Display, Text) not stripped. **Layer:** content.js `pickIntentFont()` / `NOT_FONT_WORDS`
- `buttonStyle` ❌ — Ghost button (transparent bg, purple text) ranked higher than filled button by `sat * area`. The ghost button is wider (has a dropdown arrow), so area wins. **Layer:** content.js `scrapePreferredButton()` — bg-saturated buttons must always beat text-saturated buttons
- `gradients` ⚠️ — Near-black gradient (#27272D → #373840) passes `gradientHasMeaningfulSpread` (colorDistance > 30) but is not a brand moment. **Layer:** content.js `gradientHasMeaningfulSpread()` — should also require at least one stop with meaningful saturation or luminance > 0.15

---

### 4. basement.studio
**Mode:** Dark — pure black bg, white wireframe 3D art, orange active nav link only

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | dark — correct |
| vibe | ✅ | dark · monochrome · modern |
| primary | ✅ | null — no chromatic CTA, correct |
| accent | ✅ | #FFFFFF — correct for dark monochrome |
| surface | ✅ | #000000 |
| elevated | ✅ | #141414 |
| text | ✅ | #E6E6E6 |
| muted | ✅ | #858585 |
| headingFont | ✅ | Geist 700 |
| bodyFont | ✅ | Geist 16px 400, 1.33 |
| typeScale | ✅ | 98px / 38px / 16px |
| radius | ⚠️ | 8px — can't verify from screenshot alone |
| spacing | ⚠️ | 2 / 4 / 8 — very tight; may be from small component padding |
| buttonStyle | ⚠️ | #FFFFFF text only — Contact Us is likely a styled link, no filled button |
| cardStyle | ❌ | default — no cards on page, fallback used |
| inputStyle | ⚠️ | 4px padding only — odd value |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | ✅ | #1A1A1A |

**Score: 14/17 applicable** — best result so far

**Root causes:**
- `cardStyle` ❌ — default fallback when no real card exists. Acceptable, but could note "no card component detected" instead of a misleading default. **Layer:** popup.js `formatCard()`

---

### 5. windsurf.com
**Mode:** Dark navy — bg ~#071135, teal "DOWNLOAD" CTA, gradient wave illustration

| Field | Result | Notes |
|---|---|---|
| isDark | ❌ | reports light — same body-white / dark-div issue as darkroom |
| vibe | ❌ | "light · vibrant" — cascades from isDark failure |
| primary | ✅ | #34E8BB — teal, correct |
| accent | ⚠️ | #FB9CE5 — pink from hero wave illustration, not a CTA color; came through gradient stop on some interactive element |
| surface | ❌ | #FFFFFF — should be ~#071135 dark navy |
| elevated | ❌ | #F9F3E9 — warm white, wrong |
| text | ❌ | #2C2F31 — should be near-white |
| muted | ⚠️ | #858688 |
| headingFont | ⚠️ | "tomatoGrotesk 700" — Tomato Grotesk is a real font, plausible |
| bodyFont | ✅ | DM Sans 16px 400 |
| typeScale | ✅ | 96px / 48px / 16px |
| radius | ⚠️ | 2px buttons — Download button looks more like 4-6px |
| spacing | ⚠️ | 20 / 24 — sparse |
| buttonStyle | ✅ | #34E8BB bg, #0B100F text — correct |
| cardStyle | ⚠️ | #43045E bg — dark purple, may be a real panel |
| inputStyle | ✅ | #FFFFFF bg, 1px solid #C1C1C1 |
| shadowScale | — | none |
| gradients | ⚠️ | #011C42 → #14376E — both dark navy, not a brand moment |
| borderColor | ❌ | #FFFFFF — picking up white text or elements as border |

**Score: 8/17 applicable** — dark mode cascade again

**Root causes:**
- `isDark` ❌ — same as darkroom: body white, dark navy is on child div. **Layer:** content.js `detectPageIsDark()`
- `accent` ⚠️ — #FB9CE5 pink likely from a gradient CTA or nav element bg-image. Possibly legitimate but unverified
- `gradients` ⚠️ — All-dark gradient (#011C42 → #14376E) not filtered. **Layer:** content.js `gradientHasMeaningfulSpread()`
- `borderColor` ❌ — #FFFFFF as dominant border is wrong. scrapeDominantBorderColor should exclude near-white colors (luminance > 0.95) from border candidates. **Layer:** content.js `scrapeDominantBorderColor()`

---

## Cross-Site Bug Summary

| Bug | Sites affected | Severity | Layer |
|---|---|---|---|
| **Dark mode: white body / dark section** | darkroom, windsurf | 🔴 Critical — cascades into 6 fields | content.js `detectPageIsDark()` |
| **Surface too strict: lum > 0.82** | kriss.ai | 🟠 High — main bg wrong | popup.js `derivePalette()` |
| **Font variant name leaks** (geistNumbers, Variable) | clerk | 🟠 High | content.js `NOT_FONT_WORDS` |
| **Ghost button beats filled button** | clerk | 🟠 High | content.js `scrapePreferredButton()` |
| **All-dark gradients not filtered** | clerk, windsurf | 🟡 Medium | content.js `gradientHasMeaningfulSpread()` |
| **borderColor picks up near-white** | windsurf | 🟡 Medium | content.js `scrapeDominantBorderColor()` |
| **formatCard/formatInput default string** | multiple | 🟢 Low — misleading fallback | popup.js formatters |

---

---

### 6. lusion.co
**Mode:** Light — soft lavender bg (#F0F1FA), dark pill "LET'S TALK" button, giant 3D art in rounded card

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · monochrome · rounded |
| primary | ✅ | null — no chromatic CTA |
| accent | ✅ | #000000 |
| surface | ❌ | #FFFFFF — should be #F0F1FA (lavender page bg). White card elements outweigh body bg in `lightNeutrals` frequency ordering |
| elevated | ⚠️ | #F0F1FA — this IS the page bg, but placed in elevated slot |
| text | ✅ | #000000 |
| muted | ✅ | #6B6B6B |
| headingFont | ✅ | Aeonik 700 |
| bodyFont | ✅ | Aeonik 19px 400, 1.15 |
| typeScale | ✅ | 192px / 57px / 19px |
| radius | ✅ | 100px buttons — pill correct |
| spacing | ✅ | 15 / 30 |
| buttonStyle | ❌ | #FFFFFF bg, #000000 text — "LET'S TALK" is clearly dark bg (#1A1A1A or similar) with white text. Dark button bg not captured |
| cardStyle | ❌ | default fallback — large 3D art card exists but doesn't match selector/filter |
| inputStyle | ⚠️ | 15px 30px padding only |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | — | not reported |

**Score: 11/16 applicable**

**Root causes:**
- `surface/elevated swapped` ❌ — white card elements appear more frequently than the lavender body bg. Body bg (#F0F1FA) lands in `elevated` slot. Fix: prefer body bg color explicitly as surface before frequency ordering. **Layer:** popup.js + content.js (need to expose `pageBg`)
- `buttonStyle` ❌ — dark monochrome button (low saturation bg) falls through saturated-bg rank AND text-color rank (white text not saturated). Picks first candidate → might land on a different element. **Layer:** content.js `scrapePreferredButton()`

---

### 7. turso.tech
**Mode:** Dark — near-black bg, teal "Start for free now" pill CTA, teal hero text headings, teal top banner

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly dark |
| vibe | ✅ | dark · vibrant · rounded |
| primary | ❌ | #D946EF (magenta) — should be #4FF7D1 (teal). Primary and accent are swapped |
| accent | ⚠️ | #4FF7D1 — this IS the brand teal, but it's in the accent slot |
| surface | ✅ | #000000 |
| elevated | ✅ | #141414 |
| text | ✅ | #FFFFFF |
| muted | ✅ | #949494 |
| headingFont | ❌ | "__Inter_f367f3 700" — Next.js mangled font hash leaking through. Real font is Inter |
| bodyFont | ❌ | "__Inter_f367f3 16px 400" — same |
| typeScale | ✅ | 72px / 48px / 16px |
| radius | ✅ | 9999px buttons — pill |
| spacing | ⚠️ | 10 / 14 — very sparse, only button padding |
| buttonStyle | ❌ | #D946EF bg — button bg wrong for same reason as primary |
| cardStyle | ❌ | "white bg" default — dark site, completely wrong polarity |
| inputStyle | ❌ | "white bg" default — wrong for dark site |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | — | not reported |

**Score: 8/16 applicable**

**Root causes:**
- `primary wrong` ❌ — #D946EF beats the teal CTA. Turso site likely has a magenta/purple element (animated gradient, nav element, or hero decoration) that resolves as an interactive element with a higher bumpInteractive weight than the teal button. Or: the teal button's bg is set via CSS variable that doesn't resolve cleanly in getComputedStyle. **Layer:** content.js `scrapeInteractiveColors()`
- `headingFont/bodyFont` ❌ — Next.js generates font-family strings like `__Inter_f367f3, __Inter_Fallback_f367f3`. The `__` prefix pattern must be detected and stripped, leaving "Inter". **Layer:** content.js `pickIntentFont()` — need to filter `__Name_hash` patterns
- `cardStyle/inputStyle default wrong polarity` ❌ — `formatCard`/`formatInput` in popup.js hardcode "white bg" in the fallback string. In dark mode this is always wrong. **Layer:** popup.js `formatCard()`, `formatInput()`

---

### 8. planetscale.com
**Mode:** Light — white/off-white bg, orange "Get in touch" CTA, blue inline links everywhere, code/monospace aesthetic, logo grid with partner logos

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · vibrant · modern |
| primary | ❌ | #0B6EC5 (blue) — should be #F35815 (orange CTA). Blue text-links beat the orange button in interactiveColors |
| accent | ✅ | #F35815 — this IS the orange CTA, but stuck in accent slot |
| surface | ✅ | #FAFAFA |
| elevated | ✅ | #EEEEEE |
| text | ✅ | #000000 |
| muted | ✅ | #414141 |
| headingFont | ⚠️ | SFMono-Regular 700 — monospace system font. Intentional design choice for this site (code aesthetic), so technically correct, but unusual |
| bodyFont | ⚠️ | SFMono-Regular 16px 400 — same |
| typeScale | ❌ | "16px" only — single value. All text at similar size due to monospace-everywhere aesthetic; hero cluster not distinguishable |
| radius | ⚠️ | 8px only |
| spacing | ✅ | 4 / 8 / 16 / 24 / 32 |
| buttonStyle | ✅ | #F35815 bg, #FFFFFF text — correct orange button |
| cardStyle | ❌ | default fallback — logo grid table not matched as card |
| inputStyle | ❌ | default fallback |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | ⚠️ | #414141 — too dark (near-black), the logo table borders are light gray |

**Score: 10/17 applicable**

**Root causes:**
- `primary/accent swapped` ❌ — Many blue `a[href]` links in body text pass the 60×28 size gate and contribute text color #0B6EC5 at weight/2 each. `bumpInteractive` uses max not sum, but if ONE large blue link/nav element is bigger than the orange "Get in touch" button (which is small, top-right corner), blue wins. This is a text-link signal contaminating the primary slot. **Layer:** content.js — text color weight for links may need additional reduction or the link selector `a[href]` should be deprioritised vs `button` elements
- `typeScale single value` ❌ — Monospace font used everywhere makes all clusters merge into one size band. Clustering algorithm finds no distinct hero/mid step. **Layer:** content.js `deriveTypeScale()` — acceptable edge case, but could fall back to sampling h1/h2 directly
- `borderColor near-black` ⚠️ — Logo table uses dark borders or text near borders pollutes the count. Need luminance filter on both ends (exclude near-white AND near-black). **Layer:** content.js `scrapeDominantBorderColor()`

---

---

### 12. pika.art
**Mode:** Light — warm cream bg, yellow/amber "Sign Up" CTA, black "Generate" button in hero search form

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · balanced · soft |
| primary | ⚠️ | #FFD184 — yellow from Sign Up button, plausible but inconsistent with button output |
| accent | ❌ | #5C0002 (dark maroon) — from video thumbnail image wrapper `a[href]`. Illustration bleed |
| surface | ⚠️ | #FFFFFF — page bg is warm cream, elevated #FCFAF7 is actually the real bg (swapped again) |
| elevated | ⚠️ | #FCFAF7 — this IS the warm page bg, in wrong slot |
| text | ✅ | #222222 |
| muted | ✅ | #7F7F7F |
| headingFont | ✅ | telkaExtended 700 — real custom font |
| bodyFont | ✅ | telka 14px 400 |
| typeScale | ✅ | 48px / 32px / 14px |
| radius | ✅ | 18px buttons |
| spacing | ⚠️ | 8 / 12 — sparse |
| buttonStyle | ⚠️ | #000000 bg — picked Generate (black) not Sign Up (yellow). Primary=#FFD184 but button=#000000 → inconsistency |
| cardStyle | ❌ | default fallback |
| inputStyle | ⚠️ | 12px padding only |
| shadowScale | — | none |
| gradients | ⚠️ | #1D1D1F → #907048 → #A88858 — near-black to warm gold; first stop is too dark to be a brand moment |
| borderColor | ⚠️ | #0D0D0D — near-black, from search input border, plausible |

**Score: 10/17**

**Root causes:**
- `accent from thumbnail image` ❌ — video thumbnail `<a href>` wrappers have image-derived bg-colors or SVG fills that register as interactive colors. **Layer:** content.js — thumbnail/media `a[href]` wrappers with image backgrounds should be excluded (detect: bg via background-image, not background-color)
- `surface/elevated swap` ⚠️ — 4th occurrence of this bug. White card/panel elements outcount body bg in frequency. **Layer:** same as prior sites
- `link #FFFFFF wrong` ❌ — `scrapeComponent` picks largest `a` by area; large thumbnail `<a>` elements with white overlay text win. Fix: link scraper should require element has non-zero text length AND parent is not a card/media container
- `gradient first stop near-black` ⚠️ — partial all-dark gradient still slipping through

---

### 13. family.co
**Mode:** Light — warm cream bg (#F6F4EF), black "Download on iOS" CTA, colorful illustrated characters filling the page

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · vibrant · soft |
| primary | ❌ | #1A88F8 (blue) — from illustrated blue character, not any CTA. Both CTAs are black (sat=0) |
| accent | ❌ | #156DC6 — another blue from same illustration. Both primary and accent from art, not brand |
| surface | ⚠️ | #FFFFFF — actual page bg #F6F4EF is in elevated slot (swapped, 4th occurrence) |
| elevated | ⚠️ | #F6F4EF — this is the real page bg, in wrong slot |
| text | ✅ | #282624 |
| muted | ✅ | #474645 |
| headingFont | ✅ | Family 700 — company's own typeface |
| bodyFont | ✅ | Inter 16px 400, 1.43 |
| typeScale | ✅ | 68px / 44px / 16px |
| radius | ⚠️ | 12px cards only — no button radius captured |
| spacing | ✅ | 4 / 8 / 16 / 24 / 32 |
| buttonStyle | ❌ | "#474645 text, 500 weight" — missing bg. Black CTAs (sat=0) fail saturated-bg rank, text-color rank, fall to DOM-order candidate |
| cardStyle | ⚠️ | #030101 bg — picking the dark "Send" UI mockup panel, not a real card |
| inputStyle | ✅ | white bg, 1px border |
| shadowScale | ❌ | medium shadow: `color(display-p3 0.949 0.941 0.929)` — P3 wide-gamut CSS color format, not hex/rgb. Passed through raw, malformed |
| gradients | — | none |
| borderColor | — | not reported |

**Score: 8/17**

**Root causes:**
- `primary/accent from illustration` ❌ — illustrated characters are wrapped in `<a>` or positioned over interactive divs. Largest clickable element by area could be a character illustration. Confirms pattern from liveblocks and pika. **Fix:** exclude interactive elements where background comes from `background-image` (image/gradient) rather than `background-color`. **Layer:** content.js `scrapeInteractiveColors()`
- `surface/elevated swap` ⚠️ — 4th confirmed occurrence. Needs dedicated fix.
- `P3 color in elevation` ❌ — `color(display-p3 ...)` format returned by browsers for wide-gamut displays. `rgbToHex` doesn't handle it; neither does the shadow filter. **Fix:** detect `color(display-p3 ...)` in shadow strings and skip them, or convert P3 to sRGB. **Layer:** content.js `scrapeShadowScale()`
- `black CTA button missing` ❌ — monochromatic black CTAs (saturation ≈ 0) fall through both ranked passes. `scrapePreferredButton` should have a final fallback that at least captures the largest visible button by area regardless of saturation. **Layer:** content.js `scrapePreferredButton()`

---

---

### 14. a3icp (a3.icp.xyz)
**Mode:** Dark — pure black bg, centered login card, white "Sign in" CTA, dark inputs, blue/purple dot-grid decoration

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly dark |
| vibe | ✅ | dark · monochrome · soft |
| primary | ✅ | null — Sign In is white, monochrome correct |
| accent | ✅ | #FFFFFF |
| surface | ✅ | #080808 |
| elevated | ⚠️ | #000000 — DARKER than surface #080808. Inverted. Elevated should be lighter than surface in dark mode |
| text | ✅ | #FFFFFF |
| muted | ✅ | #949494 |
| headingFont | ✅ | Geist 700 |
| bodyFont | ✅ | Geist 13px 400, 1.55 |
| typeScale | ✅ | 28px / 19px / 13px |
| radius | ✅ | 14px buttons, 11px inputs |
| spacing | ✅ | 12 / 14 / 30 / 34 |
| buttonStyle | ✅ | #FFFFFF bg, #080808 text, 14px radius — correct |
| cardStyle | ✅ | #000000 bg, correct padding |
| inputStyle | ✅ | #0C0C0C bg, 1px solid #21252F, 11px radius — excellent |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | ❌ | #FFFFFF — near-white picked up from dot-grid decoration. Should filter luminance > 0.90 |

**Score: 15/17** — one of the best results

**Root causes:**
- `elevated darker than surface` ⚠️ — #000000 (elevated) < #080808 (surface) in luminance. In dark mode, `darkNeutrals` sorted by frequency puts pure black first (most common), then #080808. Elevated should always be > surface luminance. **Fix:** in dark mode, if `elevated` luminance ≤ surface luminance, swap them or synthesize. **Layer:** popup.js `derivePalette()`
- `borderColor #FFFFFF` ❌ — dot-grid particle/decoration elements on right side registered as border. Already planned luminance filter fix.

---

### 15. zentry.com
**Mode:** Dark — pure black bg, massive white condensed heading text, 3D iridescent flower sculpture (blue/purple/cyan), pill nav buttons

| Field | Result | Notes |
|---|---|---|
| isDark | ❌ | reports light — 3rd occurrence of white-body/dark-div failure |
| vibe | ❌ | "light · monochrome" — cascades from isDark |
| primary | ✅ | null — no chromatic CTA, correct |
| accent | ❌ | #000000 — in light mode interpretation, darkest = accent. Should be #FFFFFF |
| surface | ❌ | #DFDFF2 (lavender) — wrong. Halo/glow from 3D sculpture leaks into surface. Should be near-black |
| elevated | ❌ | #D4D4E6 — also lavender, wrong |
| text | ❌ | #000000 — inverted, should be white |
| muted | ⚠️ | #6B6B6B — wrong polarity for dark mode |
| headingFont | ⚠️ | Roboto Mono 700 — Zentry uses an extra-bold condensed display font; Roboto Mono may be used for some elements but not the giant hero text |
| bodyFont | ⚠️ | Roboto Mono 19px 400 — same concern |
| typeScale | ✅ | 168px / 76px / 19px — hero scale is massive, correctly captured |
| radius | ⚠️ | 9.6px cards — nav buttons are pill-shaped, card radius different |
| spacing | ⚠️ | 10 / 19 / 38 |
| buttonStyle | ❌ | "#000000 text, 700 weight" — cascades from mode failure |
| cardStyle | ⚠️ | #5542FF bg — purple from nav button or interactive element |
| inputStyle | ❌ | default "white bg" wrong for dark |
| shadowScale | — | none |
| gradients | ✅ | #5542FF → #B28EF2 — purple to lavender, visible in 3D sculpture gradient |
| borderColor | ❌ | #DFDFF2 — lavender from sculpture glow, not a real border |

**Score: 5/17** — 3rd catastrophic dark mode cascade

**Root causes:**
- `isDark ❌` — body transparent/white, dark bg is on child div. Identical to darkroom + windsurf. This is confirmed as the most impactful single fix. **Layer:** content.js `detectPageIsDark()`
- `surface lavender` ❌ — once isDark is wrong (light mode assumed), the iridescent sculpture halo creates lavender-tinted elements that win as surface. Secondary bug exposed by primary failure.

---

### 16. lantr.app
**Mode:** Dark — very dark wine-red bg, crimson red "Join Waitlist" pill CTA, gold hero text, Lantr app mockup

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly dark |
| vibe | ✅ | dark · vibrant · rounded |
| primary | ✅ | #B01433 — crimson, matches Join Waitlist button |
| accent | ⚠️ | #C0435C — rose-red, reasonable shift of primary (only 1 CTA color) |
| surface | ✅ | #0D0D0E |
| elevated | ✅ | #202021 |
| text | ✅ | #F5F5F5 |
| muted | ✅ | #8E8E8E |
| headingFont | ✅ | Inter 700 |
| bodyFont | ✅ | Inter 16px 400, 1.6 |
| typeScale | ✅ | 59px / 32px / 16px |
| radius | ✅ | 999px buttons, 26px cards — pill CTA and rounded app card |
| spacing | ✅ | 13 / 22 / 24 / 30 |
| buttonStyle | ✅ | #B01433 bg, #F5F5F5 text, 999px radius, 13px 30px padding — essentially perfect |
| cardStyle | ✅ | #0D0D0E bg, 26px radius — dark app mockup card, correct |
| inputStyle | ⚠️ | "white bg" default — no real input visible on page |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | — | not reported |

**Score: 15/17** — tied for best result (with a3icp and basement.studio)

**Root causes:**
- Nothing structurally wrong — the site has a clear, unambiguous design with a prominent colored CTA on a pure dark bg. Best-case scenario for the algorithm.
- `inputStyle default` — acceptable, no input visible on landing page.

---

---

### 17. alistairshepherd.uk
**Mode:** Mixed — warm golden/sunset illustration hero (light), transitions to dark maroon (#21040A) body

| Field | Result | Notes |
|---|---|---|
| isDark | ⚠️ | reports dark — body bg IS dark maroon, technically correct but "dark · vibrant" misses the warm golden character |
| vibe | ⚠️ | "dark · vibrant · modern" — the sunset illustration is the dominant visual impression, feels warm not dark |
| primary | ✅ | #FFBC5C — golden amber, correct |
| accent | ⚠️ | #480C1C — very dark maroon, from the body bg area |
| surface | ✅ | #21040A — dark maroon body |
| elevated | ✅ | #33181E |
| text | ✅ | #FFFFFF |
| muted | ✅ | #949494 |
| headingFont | ✅ | Red Hat Display 700 |
| bodyFont | ✅ | Literata 21px 400, 1.5 |
| typeScale | ✅ | 42px / 28px / 21px |
| radius | ✅ | 4px buttons |
| spacing | ✅ | 8 / 28 / 32 |
| buttonStyle | ✅ | #FFBC5C bg, #21040A text — golden button, correct |
| cardStyle | ❌ | "28.32px 0px 156.8px 0px padding" — decimal values + 156.8px vertical = a large layout container was matched, not a card component |
| inputStyle | ⚠️ | white bg default |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | — | not reported |

**Score: 13/16**

**Root causes:**
- `cardStyle decimal/huge padding` ❌ — `scrapeComponent` matched a large layout section (possibly the hero container) with viewport-computed padding. `156.8px` is clearly a section, not a card. **Fix:** in card filter, reject elements where `paddingTop > 60px || paddingBottom > 60px`. **Layer:** content.js card filter in `scrapeDesignTokens()`

---

### 18. itsnicethat.com
**Mode:** Light — warm cream bg, editorial magazine, standard blue hyperlinks throughout, purple pill "Search" CTA button

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · vibrant · rounded |
| primary | ❌ | #0000EE (browser blue) — from text hyperlinks. Purple CTA (#8147FF) is correctly in buttonStyle but loses to blue links in interactiveColors |
| accent | ⚠️ | #FFD519 — yellow from banner, plausible |
| surface | ✅ | #F4F4F4 |
| elevated | ✅ | #E8E8E8 |
| text | ✅ | #2B2B2B |
| muted | ✅ | #848484 |
| headingFont | ✅ | Labil 700 — real display font |
| bodyFont | ✅ | Bradford 11px 400 — editorial serif |
| typeScale | ⚠️ | 20px / 15px / 11px — small but plausible for content-dense editorial |
| radius | ✅ | 75px buttons — pill search button |
| spacing | ✅ | 15 / 16 / 20 |
| buttonStyle | ✅ | #8147FF bg — purple, correct! But inconsistent with primary |
| cardStyle | ❌ | default fallback |
| inputStyle | ⚠️ | #FFFFFF bg, padding |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | ✅ | #2B2B2B |

**Score: 11/17** — primary wrong, button correct = clearest primary/accent swap case yet

**Root causes:**
- `primary #0000EE wrong` ❌ — Standard browser blue text links are numerous and large on this editorial site. They pass the 60×28 size gate and contribute text color at weight/2 via many article links. `bumpInteractive(#0000EE, weight)` accumulates a high max-weight. Purple CTA button is one element; blue links are everywhere. Confirms text-link beats CTA problem. **Layer:** content.js
- `link #2B2B2B wrong` ❌ — Link component picks largest `a` by area, landing on a dark section wrapper not an actual hyperlink. Should be #0000EE. **Layer:** content.js `scrapeComponent()` link filter

---

### 19. ssense.com
**Mode:** Light — pure white bg, extreme minimalism, monochrome luxury fashion editorial, huge display type

| Field | Result | Notes |
|---|---|---|
| isDark | ✅ | correctly light |
| vibe | ✅ | light · monochrome · modern — SSENSE is intentionally monochrome |
| primary | ✅ | null — no chromatic CTA |
| accent | ✅ | #000000 |
| surface | ✅ | #FFFFFF |
| elevated | ✅ | #F2F2F2 |
| text | ✅ | #333333 |
| muted | ✅ | #888888 |
| headingFont | ⚠️ | "JHA Times Now 700" — plausible editorial serif font name |
| bodyFont | ❌ | "Favorit SSENSE Inter 20px 400" — "Favorit SSENSE Inter" is multiple font-family entries concatenated into one name. SSENSE uses "Favorit SSENSE" as their typeface. "Inter" is the fallback, leaked in. |
| typeScale | ✅ | 100px / 28px / 20px — the SALE headline IS 100px+ |
| radius | ⚠️ | 8px — can't verify |
| spacing | ✅ | 8 / 15 / 30 |
| buttonStyle | ❌ | "null bg, white text" — transparent bg + white text on white site = invisible button. Scraper picked a ghost/outline button |
| cardStyle | ⚠️ | 1px solid #979797 border — plausible grid card |
| inputStyle | ✅ | 1px solid #CCCCCC — minimal input border |
| shadowScale | — | none |
| gradients | — | none |
| borderColor | ✅ | #979797 |

**Score: 13/17** — good for a monochrome site

**Root causes:**
- `bodyFont concatenated` ❌ — CSS: `font-family: "Favorit SSENSE", Inter, sans-serif` OR the font-family string is literally `FavoritSSENSE Inter` (no quotes, no comma = one entry). If it's one CSS entry, `pickIntentFont` takes it whole, returning "Favorit SSENSE Inter". NOT_FONT_WORDS doesn't include "Inter" (it's not obviously a non-font word). **Fix:** add detection for known system/generic font names WITHIN a picked font name (if the picked name contains "Inter", "Mono", "Sans", "Serif" etc. as trailing words, strip them). **Layer:** content.js `pickIntentFont()` / `stripNonFontWords()`
- `button null bg` ❌ — Saturated-bg rank finds nothing (no chromatic buttons). Text-saturated rank finds nothing (SSENSE has no colored button text). Falls to DOM-order first `button` — which may be a nav/hamburger ghost element with transparent bg and white text (invisible on white page). **Fix:** in `scrapePreferredButton`, when both ranks yield nothing, use the largest button by area that has ANY non-transparent bg OR any non-transparent border. **Layer:** content.js `scrapePreferredButton()`

---

## Cross-Site Bug Summary (19 sites)

| Bug | Sites affected | Severity | Layer |
|---|---|---|---|
| **Dark mode: white body / dark section** | darkroom, windsurf, zentry | 🔴 Critical — cascades into 6+ fields on 3 sites | content.js `detectPageIsDark()` |
| **Illustration/mockup bleeds into primary** | family, liveblocks, pika, turso | 🔴 Critical — wrong brand color on 4 sites | content.js `scrapeInteractiveColors()` |
| **Text-link beats CTA button → primary/accent swap** | planetscale, itsnicethat | 🔴 Critical — 2 confirmed | content.js `scrapeInteractiveColors()` |
| **Next.js `__Font_hash` leaks into font name** | turso | 🔴 Critical | content.js `pickIntentFont()` |
| **text/muted resolve to wrong dark color** | oxide | 🔴 Critical — no light neutrals fallback | popup.js `derivePalette()` |
| **Surface/elevated swapped — body bg loses to white cards** | kriss, lusion, pika, family | 🟠 High — 4 sites | content.js (expose pageBg) + popup.js |
| **Font multi-entry concatenation** (Favorit SSENSE Inter, geistNumbers, Variable) | clerk, indieappcircle, ssense | 🟠 High — 3 sites | content.js `pickIntentFont()` + `NOT_FONT_WORDS` |
| **Black/neutral/ghost CTA button has no bg captured** | family, liveblocks, clerk, ssense | 🟠 High — 4 sites | content.js `scrapePreferredButton()` |
| **Dark site card/input defaults hardcode "white bg"** | turso, oxide, liveblocks | 🟠 High | popup.js `formatCard()` `formatInput()` |
| **Card selector matches large layout containers** | alistair | 🟠 High — 156px padding is not a card | content.js card filter |
| **Malformed 7-char hex output** | oxide | 🟠 High | content.js `rgbToHex()` — `#` shortcut path |
| **P3 wide-gamut color format not handled** | family | 🟠 High — raw `color(display-p3...)` in output | content.js `scrapeShadowScale()` |
| **Elevated darker than surface in dark mode** | a3icp | 🟡 Medium | popup.js `derivePalette()` — swap if inverted |
| **Link component picks large wrappers not real links** | pika, itsnicethat | 🟡 Medium — link color wrong | content.js `scrapeComponent()` link filter |
| **All-dark/near-dark gradient stops not filtered** | clerk, windsurf, pika | 🟡 Medium | content.js `gradientHasMeaningfulSpread()` |
| **Near-identical gradient stops not filtered** | indieappcircle | 🟡 Medium | content.js `gradientHasMeaningfulSpread()` |
| **Component shadow zero not filtered at component level** | indieappcircle | 🟡 Medium | content.js `scrapeComponent()` |
| **Button bg null → no fallback to primary** | liveblocks | 🟡 Medium | popup.js `formatButton()` |
| **borderColor picks up near-white OR near-black** | windsurf, planetscale, a3icp | 🟡 Medium — 3 sites | content.js `scrapeDominantBorderColor()` |
| **typeScale single value on mono-font sites** | planetscale | 🟡 Medium | content.js `deriveTypeScale()` |

---

## Planned Fixes

### Fix A — Dark mode viewport-coverage fallback (CRITICAL)
When html and body both return transparent/light, scan major structural elements for viewport overlap. If dark-bg elements cover > 40% of viewport, page is dark.

### Fix B — Surface luminance threshold broadened
In light mode, if no color passes `luminance > 0.82`, fall back to most-used neutral with `luminance > 0.55`. Also explicitly use `pageBg` field if content.js exposes it.

### Fix C — Font variant words stripped
Add to `NOT_FONT_WORDS`: variable, numbers, display, text, caption, mono, condensed, expanded.
Also add to SYSTEM_FONTS: anything starting with `-apple-system` variants already handled, but ensure "system" alone triggers a meaningful fallback display.

### Fix D — Filled button always beats ghost button  
In `scrapePreferredButton()`, give filled (saturated bg) buttons absolute priority over text-color-only buttons regardless of area.

### Fix E — All-dark gradients filtered
In `gradientHasMeaningfulSpread()`, also require at least one stop with luminance > 0.15 OR saturation > 0.20. Pure dark-to-dark gradients fail this.

### Fix F — borderColor excludes near-white
In `scrapeDominantBorderColor()`, add `&& luminance(hex) < 0.92` to filter. White elements misidentified as borders.

### Fix G — formatCard/formatInput null-safe  
When no component found, omit the field from the brief rather than emitting a misleading "white bg, 1px subtle border" default.
