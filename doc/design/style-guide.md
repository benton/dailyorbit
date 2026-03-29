# The Daily Orbit — Front Page Style Guide

Visual design specification for the newspaper-style home page. Reference images are in `doc/design/`.

---

## 1. Design Philosophy

Emulate an **early-1900s broadsheet newspaper** — specifically the era of The Bombay Chronicle (1948), The Echo (1900), and illustrated Victorian commercial publications. The aesthetic is:

- **Dense, multi-column text** with thin rule lines between columns
- **Steel engraving / crosshatch line drawings** — never photographs
- **Warm, aged paper** — not sterile white
- **Ornamental typography** — blackletter masthead, serif body, decorative section headers
- **Vintage display advertising** — patent-medicine-style typographic ads in sidebar slots

The goal is a page that makes you smile before you start reading — and then delivers genuinely useful industry intelligence.

---

## 2. The Masthead / Nameplate

### Concept

"The Daily Orbit" in blackletter, flanked by a **globe-with-orbiting-satellites** emblem — a riff on the classic "Daily Globe" / New York Times masthead globe motif, but with 3-4 stylized satellite arcs circling it. The globe should be rendered as an engraved line drawing, not a photograph.

Below the nameplate:

```
═══════════════════════════════════════════════════════════════
THE DAILY ORBIT
          ☽ Your Window on the Spectrum ☽
Vol. I  ·  No. 247  ·  Washington, D.C.  ·  Tuesday, March 24, 2026  ·  Price: Free (to subscribers)
═══════════════════════════════════════════════════════════════
```

- **Volume number:** Increment yearly from launch
- **Issue number:** Day-of-year (business days only, or calendar days — TBD)
- **Motto/tagline:** Rotatable. Options: "Your Window on the Spectrum," "All the Frequencies Fit to Print," "Serving the Orbital Commons Since 2026"

### Masthead Font

**Primary:** [UnifrakturCook](https://fonts.google.com/specimen/UnifrakturCook) (Google Fonts, free, blackletter) or a self-hosted alternative like Chomsky (OFL-licensed blackletter designed specifically for newspaper mastheads).

**Fallback chain:** `'UnifrakturCook', 'Chomsky', 'Old English Text MT', serif`

### Globe Emblem

AI-generated once as a static SVG or high-res PNG. Style: steel-engraved globe with latitude/longitude lines, 3-4 elliptical orbital arcs with small satellite silhouettes. Positioned centered above or between the nameplate words, similar to The Daily Chronicle reference image's central emblem.

---

## 3. Typography

### Font Stack

| Role                  | Font                      | Source                     | Fallback                        |
| --------------------- | ------------------------- | -------------------------- | ------------------------------- |
| Masthead              | UnifrakturCook or Chomsky | Google Fonts / self-hosted | Old English Text MT, serif      |
| Headlines (H1-H2)     | Abril Fatface             | Google Fonts               | Georgia, serif                  |
| Subheads (H3-H4)      | Libre Baskerville Bold    | Google Fonts               | Georgia, serif                  |
| Body text             | Libre Baskerville         | Google Fonts               | Georgia, Times New Roman, serif |
| Captions & bylines    | Libre Baskerville Italic  | Google Fonts               | Georgia, serif                  |
| Data tables / tickers | IBM Plex Mono             | Google Fonts               | Courier New, monospace          |
| Ads / classifieds     | Josefin Slab              | Google Fonts               | Courier New, serif              |

### Type Scale

- **Masthead:** 48-72px (wide) / 32-48px (narrow)
- **Lead headline:** 28-36px (wide) / 22-28px (narrow)
- **Section headlines:** 20-24px
- **Body:** 15-16px, line-height 1.5-1.6
- **Captions:** 12-13px italic
- **Bylines:** 11-12px small caps

### Text Treatment

- **Justified alignment** for body text (with `hyphens: auto` to avoid rivers)
- **First paragraph drop caps** on lead articles (CSS `::first-letter`)
- **Small caps** for bylines and datelines
- **Em dashes** (—) not hyphens for editorial punctuation
- **Column rules:** 1px solid `#8b7355` between columns

---

## 4. Color Palette

The palette is deliberately restrained — newsprint, ink, and aged paper.

| Name            | Hex       | Usage                                        |
| --------------- | --------- | -------------------------------------------- |
| Ink Black       | `#1a1a1a` | Body text, headlines                         |
| Charcoal        | `#3a3a3a` | Subheads, secondary text                     |
| Sepia Dark      | `#5c4a32` | Rule lines, borders, ornaments               |
| Sepia Medium    | `#8b7355` | Column rules, lighter borders                |
| Sepia Light     | `#b8a88a` | Muted captions, datelines                    |
| Parchment       | `#f4edd3` | Page background                              |
| Parchment Light | `#f9f4e8` | Article card backgrounds (if used)           |
| Aged White      | `#faf7f0` | Highlight areas, ad backgrounds              |
| Accent Red      | `#8b2500` | "EXTRA" banners, breaking/late edition flags |
| Accent Blue     | `#2b4570` | Hyperlinks (subtle, not glowing)             |

### Dark Mode

For users who toggle dark mode, invert the paper/ink relationship but keep the warmth:

| Name           | Hex (dark) | Usage                |
| -------------- | ---------- | -------------------- |
| Dark Paper     | `#2a2520`  | Page background      |
| Dark Parchment | `#352f28`  | Article backgrounds  |
| Light Ink      | `#e8dcc8`  | Body text            |
| Gold Accent    | `#c4a46c`  | Headlines, ornaments |

---

## 5. Background & Texture

### Paper Texture

A subtle, repeating paper texture overlay on `#f4edd3`. Options:

1. **CSS-only:** Very subtle `background-image` noise pattern via SVG data URI — no external file needed, ~200 bytes
2. **Lightweight image:** A 200×200 tileable aged-paper texture at <10KB, applied with `background-repeat: repeat` at low opacity (~0.3)
3. **Hybrid:** Solid color + CSS `filter: contrast(1.02) brightness(0.98)` for a hint of grain

Recommendation: **Option 1 (CSS-only)** for performance; the color palette does most of the work.

### Borders & Rules

- **Column dividers:** 1px solid `#8b7355`
- **Section dividers:** Ornamental — a thin double rule (`border-style: double`) or a decorative SVG divider (pre-generated, static asset)
- **Article borders:** None by default; rely on column rules and whitespace. Exception: ads and special features get a 2px ornamental border

---

## 6. Layout — Wide View (Broadsheet)

### Dimensions

The wide layout targets a **fixed-aspect broadsheet** centered in the viewport — not full-bleed.

- **Max width:** 1200px (or up to 1400px on very wide screens)
- **Aspect ratio:** Approximately 3:4 (portrait broadsheet) — but since it scrolls, this is really about the _column grid_ width, not a hard frame
- **Centered** with warm background (`#2a2520` or subtle pattern) visible as margins
- **Padding:** 40-60px on each side within the "paper"

### Grid Structure

CSS Grid with named areas. The wide layout is a **5-column grid** (echoing traditional broadsheet column counts):

```
┌─────────────────────────────────────────────────────┐
│                    MASTHEAD                          │
│         The Daily Orbit · Date · Vol/No             │
├────────┬──────────┬──────────┬──────────┬───────────┤
│  AD    │  LEAD HEADLINE (spans 3 cols)  │  WEATHER  │
│ slot 1 │  "3 Miles Up" + hero image     │  + space  │
│        │                                │  weather  │
├────────┼──────────┬──────────┼──────────┼───────────┤
│ TODAY  │ THE WIRE │ DOCKET   │ EDITORIAL│   AD      │
│ FILINGS│ (news)   │ (yester- │ or weekly│  slot 2   │
│ (live) │          │  day's   │ column   │           │
│        │          │  filings)│          │           │
├────────┴──────────┼──────────┼──────────┴───────────┤
│  MARKET TICKER    │ ON THIS  │  CLASSIFIEDS         │
│  (stock prices)   │   DAY    │  (fake ads)          │
├───────────────────┴──────────┴──────────────────────┤
│              BELOW THE FOLD                          │
│  Company Spotlight · Orbital Forecast · Crossword   │
└─────────────────────────────────────────────────────┘
```

Key principles:

- **Lead story spans 3 of 5 columns** — dominant visual weight, includes hero engraving
- **Ads occupy corner positions** — top-left and right sidebar, like The Echo and Bombay Chronicle
- **Live data (Today's Filings) gets a dedicated narrow column** — always visible, always current
- **"Below the fold"** content is visible on scroll — weekly features, deeper analysis
- **Column rules** between every column via `column-rule` or `border-right` on grid cells

### CSS Grid Skeleton (conceptual)

```css
.broadsheet {
  display: grid;
  grid-template-columns: 180px 1fr 1fr 1fr 200px;
  grid-template-rows: auto auto 1fr auto;
  column-gap: 0; /* rules handled by borders */
  max-width: 1200px;
  margin: 0 auto;
  background: #f4edd3;
  padding: 2rem 3rem;
}

.broadsheet > * {
  border-right: 1px solid #8b7355;
  padding: 0.75rem 1rem;
}

.broadsheet > *:last-child {
  border-right: none;
}
```

---

## 7. Layout — Narrow View (Tabloid)

### Dimensions

The narrow layout is a **single-column flow** that reads like a **tabloid or gazette** — still vintage, but vertically stacked.

- **Max width:** 680px
- **No column rules** — replaced by horizontal section dividers
- **Generous vertical spacing** between sections

### Structure

```
┌───────────────────────┐
│      MASTHEAD          │
│  (compact, smaller)    │
├───────────────────────┤
│  LEAD: "3 Miles Up"   │
│  + hero engraving      │
├───────────────────────┤
│  TODAY'S FILINGS       │
│  (compact list)        │
├───────────────────────┤
│  THE WIRE (news)       │
├───────────────────────┤
│  THE DOCKET            │
│  (yesterday's filings) │
├───────────────────────┤
│  AD (full-width)       │
├───────────────────────┤
│  WEATHER · ON THIS DAY │
│  (side by side, 2-col) │
├───────────────────────┤
│  EDITORIAL / COLUMN    │
├───────────────────────┤
│  MARKET TICKER         │
├───────────────────────┤
│  CLASSIFIEDS           │
└───────────────────────┘
```

Key differences from wide:

- **Ads go full-width between sections** — like real tabloid ad placement
- **Weather + On This Day share a 2-column mini-grid** — the only multi-column element
- **Sections separated by ornamental horizontal rules** instead of vertical column rules
- **Masthead is compact** — smaller nameplate, no flanking elements

### Breakpoint

Switch from wide to narrow at **`max-width: 900px`** (or wherever the 5-column grid would compress below readable column widths ~180px each).

---

## 8. Imagery Style Guide

All images use a consistent **steel engraving / crosshatch** aesthetic. See `doc/design/ThisIsNotElonMusk.jpg` for the target portrait style; see `doc/design/REgularColumnHeading.jpg` for the section-header ornamental style.

### Image Generation Prompts (Titan / Stable Diffusion style guidance)

**For the daily hero engraving:**

> Steel engraving illustration, black ink crosshatch on white background, [scene description from daily summary]. Style of 19th century newspaper illustration, fine parallel lines for shading, no color, high contrast.

**For "(not) portraits":**

> Steel engraving portrait bust, black ink crosshatch on white background, [varied demographic description], formal attire circa 1900, looking slightly to the left, oval vignette frame. Style of Victorian newspaper portrait illustration.

**For section headers:**

> Ornamental banner with decorative border, black ink engraving style, central vignette of [satellite dish / radio tower / globe / gavel], flanked by scrollwork and floral ornaments. Style of 19th century newspaper column heading.

**For editorial cartoons:**

> Single-panel editorial cartoon, black ink crosshatch style, [scene description]. Style of Punch magazine illustration circa 1900, satirical, with caption space below.

### Image Specifications

| Type              | Resolution         | Format                       | Transparency             |
| ----------------- | ------------------ | ---------------------------- | ------------------------ |
| Hero engraving    | 1024×768           | WebP                         | No (parchment bg)        |
| (not) Portraits   | 256×320            | WebP                         | Yes (composited on page) |
| Section headers   | 800×200            | SVG preferred, WebP fallback | Yes                      |
| Editorial cartoon | 512×512            | WebP                         | No                       |
| Fake ads          | 300×250 or 180×400 | WebP or pure CSS             | Varies                   |

### Image generation models available in AWS Bedrock:

#### Amazon Models

**Amazon Nova Canvas**
Amazon Nova Canvas is described as a state-of-the-art image generation model, with built-in controls for safe and responsible AI use like watermarking and content moderation. It supports text-to-image, inpainting, outpainting, background removal, and color-guided generation.

**Amazon Titan Image Generator G1 (v1 & v2)**
Titan Image Generator G1 allows users to generate and edit images from natural language prompts, edit existing images with or without masks, perform outpainting and inpainting, and generate variations of an image. It also adds an invisible watermark to all generated images.

#### Stability AI Models

Three models from Stability AI are available in Bedrock, each targeting different use cases: **Stable Image Ultra** produces the highest quality photorealistic outputs for professional print media; **Stable Diffusion 3 Large** balances speed and quality for high-volume digital assets; and **Stable Image Core** is optimized for fast, affordable generation ideal for rapid concept iteration.

**Stable Diffusion 3.5 Large** is also available — Stability AI's most advanced text-to-image model — capable of rendering images across a wide range of styles like 3D, photography, painting, and line art.

Additionally, Stability AI Image Services offers thirteen specialized image editing tools covering editing (remove background, erase object, search and replace, inpaint/outpaint), upscaling (fast, conservative, and creative upscale), and control tools (structure, sketch, style guide, style transfer).

#### Summary Table

| Model                          | Provider     | Key Strength                                 |
| ------------------------------ | ------------ | -------------------------------------------- |
| Nova Canvas                    | Amazon       | General-purpose, editing, content moderation |
| Titan Image Generator G1 v1/v2 | Amazon       | Cost-effective, watermarking                 |
| Stable Image Ultra             | Stability AI | Highest quality / photorealism               |
| Stable Diffusion 3 Large       | Stability AI | Speed + quality balance                      |
| Stable Image Core              | Stability AI | Fast & affordable                            |
| Stable Diffusion 3.5 Large     | Stability AI | Most advanced SD model                       |

---

## 9. Advertising Style

Fake ads should mimic **real turn-of-the-century display advertising** (see corner ads in Bombay Chronicle and The Echo references):

### Typographic Ads (preferred — zero image cost)

Styled entirely with CSS: ornamental borders, mixed font sizes, generous use of Josefin Slab and small caps.

```
╔══════════════════════════╗
║   ACME SATELLITE CO.     ║
║  ─────────────────────   ║
║  Purveyors of the Finest ║
║   Ka-Band Transponders   ║
║                          ║
║  "Reliable as the Stars  ║
║     Themselves"          ║
║                          ║
║  Est. 2026 · Washington  ║
╚══════════════════════════╝
```

### Ad Content Sources

- Generated weekly by LLM from real company names and filing types in the database
- Tone: affectionate parody, never mean-spirited
- Rotate one ad per day from the weekly batch
- Mix "product" ads (transponders, orbital slots) with "service" ads (law firms, consulting)

---

## 10. Interactive Elements

Even though the page looks vintage, it is still a modern web app:

- **Links** are `#2b4570` (muted blue), underlined on hover only — they should not scream "WEB PAGE"
- **Today's Filings** section auto-refreshes (polling or SSE) — new items slide in at the top with a brief fade
- **Tooltips** on filing rows show summaries (already implemented)
- **Collapsible sections** below the fold use a subtle `▸` / `▾` toggle, styled as "[+] Read on..." in small caps
- **Wide/narrow toggle** preserved from the current UI, but framed as "Broadsheet Edition / Gazette Edition"

---

## 11. Logo Generation Brief

For the AI-generated masthead emblem:

**Subject:** A globe (Earth) viewed from a slight angle, with 3-4 elliptical orbital arcs circling it at different inclinations. Each arc has a small, stylized satellite silhouette. The globe shows simplified continent outlines. Below the globe, subtle radio waves emanate downward.

**Style:** Steel engraving, fine crosshatch shading, black ink on transparent background. The overall shape fits within a circle or oval suitable for centering in a masthead banner. Think: the globe atop the old New York Times building, reimagined for the space age and rendered as a Victorian engraving.

**Dimensions:** 400×400px master, scalable down to 80×80 for favicon use.

**Format:** SVG if achievable, otherwise high-res PNG with transparency.

---

## 12. Reference Resources

### CSS Techniques

- [CSS-Tricks: Newspaper Layout with CSS Grid](https://css-tricks.com/techniques-for-a-newspaper-layout-with-css-grid-and-border-lines-between-elements/) — grid + column rules
- [CodePen: CSS Grid Newspaper Layout](https://codepen.io/oliviale/full/BaoXOOP) — working demo
- [Responsive Grid Magazine Layout in 20 Lines](https://css-tricks.com/responsive-grid-magazine-layout-in-just-20-lines-of-css/) — minimal grid approach

### Typography

- [Google Fonts: UnifrakturCook](https://fonts.google.com/specimen/UnifrakturCook) — blackletter masthead
- [Google Fonts: Abril Fatface](https://fonts.google.com/specimen/Abril+Fatface) — 19th-century-inspired display serif
- [Google Fonts: Libre Baskerville](https://fonts.google.com/specimen/Libre+Baskerville) — readable body serif
- [Google Fonts: Josefin Slab](https://fonts.google.com/specimen/Josefin+Slab) — 1920s geometric slab for ads
