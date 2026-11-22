# Paydirt design system: size, type, spacing, overlays

This is the measuring system for the "Survey sheet" redesign (direction A, see `docs/design.md`). It does not change
the palette. It replaces the 26 font sizes, 18 gap values and 7 corner radii that grew in `public/styles.css`
through its override layers ("Design pass 2", "Pass 2b", map bar, feedback) with a small set of tokens, and gives every
dialog, panel and popover the same frame.

Audit date: 2026-11-21, against `public/` at commit `7bb8a0b` and the Survey sheet mockups
(canvas "Paydirt design pass 3 mockups": Main, EditCriterion, Property boards).

> **One grid, one edge.** Everything is a multiple of 4. Every overlay has a 24px inner edge that its title, its rules,
> its body text and its buttons all share.

---

## 1. Tokens (drop-in `:root` block)

```css
:root {
  /* Type: Inter Tight for everything you read, IBM Plex Mono for labels */
  --font-text: "Inter Tight", "Helvetica Neue", Arial, sans-serif;
  --font-label: "IBM Plex Mono", ui-monospace, Menlo, monospace;

  --fs-label: 11px;   /* mono, uppercase, +0.06em */
  --fs-small: 12px;
  --fs-body: 14px;
  --fs-lead: 16px;
  --fs-h3: 20px;
  --fs-h2: 28px;
  --fs-h1: 40px;
  --fs-display: 64px;
  --fs-key: 96px;

  --lh-tight: 0.9;    /* key, display, h1 */
  --lh-head: 1.05;    /* h2, h3 */
  --lh-ui: 1.25;      /* lead, labels, buttons, chips, row titles */
  --lh-body: 1.5;     /* running text and notes */

  --track-key: -0.055em;    /* 64, 96 */
  --track-title: -0.045em;  /* 28, 40 */
  --track-snug: -0.02em;    /* 16, 20 */
  --track-body: -0.005em;   /* 12, 14 */
  --track-label: 0.06em;    /* mono 11 */

  /* Spacing: 4px base */
  --sp-0: 0; --sp-half: 2px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* Control heights */
  --h-sm: 32px;   /* chips, overlay-header actions, toggles, checkbox rows */
  --h-md: 40px;   /* buttons, inputs, selects, tabs, popover triggers */
  --h-lg: 48px;   /* the one primary action in a dialog or hero; big number inputs */
  --score: 48px;  /* score block in every list row and the property header */
  --score-sm: 24px; /* inline score in tables */

  /* Frame */
  --nav-w: 168px;      /* left rail */
  --panel-w: 400px;    /* list panel on the map, and the parcel side panel */
  --bar: 56px;         /* project header bar; also --head */
  --critbar: 48px;     /* Must / Nice chip bar */
  --head: 56px;        /* overlay header */
  --head-lg: 80px;     /* overlay header that holds a score block */
  --foot: 72px;        /* overlay footer: 16 + 40 + 16 */

  /* Overlay widths */
  --pop-w: 280px;      /* menus: More filters, Layers, Sort */
  --pop-w-lg: 520px;   /* criterion editor (anchored to its chip) */
  --dlg-s: 400px;      /* sign-in, confirm */
  --dlg-m: 560px;      /* feedback, new project, short forms */
  --dlg-l: 880px;      /* criteria from a brief / interview, version history */
  --dlg-inset: 32px;   /* full dialog keeps this much of the page around it */
  --dlg-full-max-w: 1376px; --dlg-full-max-h: 864px;

  /* Lines */
  --rule: 2px;         /* section rules, list tops, overlay edges */
  --mark: 4px;         /* selected row, current nav item, Nice underline */
  --r: 0;              /* nothing is round */
}
```

`--bg`, `--fg`, the brand palette and the role colors stay exactly as they are in `styles.css` lines 3–49.
Two Survey-sheet fills the mockups use should become role tokens rather than literals:
`--fill: #E6DCCB` (inputs, paper buttons, selected row; dark `#3A2818`) and `--band: #EBE3D4` (the chip bar; dark `#221811`).

---

## 2. Type scale

Nine steps on a roughly 1.4 ratio, four weights. **Retired:** 10.5, 11.5, 12.5, 13, 13.5, 14.5, 15, 15.5, 18, 19, 22, 24, 26,
30, 32, 34, 36, 44, 88, 120px, and weight 600.

| Token | Size / line | Weight | Tracking | Used for |
|---|---|---|---|---|
| `--fs-key` | 96 / 0.9 | 800 | −0.055em | The key number: saved count on home cards and project hero. Always the largest thing on its screen. |
| `--fs-display` | 64 / 0.9 | 800 | −0.055em | Project hero name (project page). 40 under 760px. |
| `--fs-h1` | 40 / 0.9 | 800 | −0.045em | Page and section titles, lowercase, with the 8° gold chip ("projects", "saved", "new project"); map panel project title; sign-in wordmark. |
| `--fs-h2` | 28 / 1.05 | 800 | −0.045em | Dialog and side-panel titles (parcel name, "feedback", "size of the site"); project name in the map header bar; home card project name; wordmark in the rail. |
| `--fs-h3` | 20 / 1.05 | 800 | −0.02em | Section heads inside a page or overlay ("best matches", "why it scores 86", "the land"); stat values; score number in a 48 block; empty-state headline. |
| `--fs-lead` | 16 / 1.25 | 700 | −0.02em | Row titles (parcel name in every list and table), nav links, option titles in the criterion editor, the question line. |
| `--fs-body` | 14 / 1.5 | 400 (700 on buttons and chips) | −0.005em | Running text, inputs, selects, buttons, chips, `dl` values, legend text. |
| `--fs-small` | 12 / 1.4 | 400 (700 on tags) | −0.005em | Notes under a section ("County assessed values…"), the "why" line in a row, tag text, table secondary lines, link-style toggles. |
| `--fs-label` | 11 / 1.25 | 500, IBM Plex Mono, uppercase | +0.06em | Every label: `.lbl`, `.lblish`, `dt`, table `th`, the row meta line (`26.3 AC · IL · RENTON`), MUST/NICE group labels, theme switch, unit suffixes, save state "SAVED · V4". |

Weights: **400** text, **500** mono labels only, **700** UI (buttons, chips, row titles, nav), **800** titles and numbers.

Rules:
1. Numbers are `font-variant-numeric: tabular-nums` everywhere (already on `body`); number columns right-align.
2. Titles at h1 and above are lowercase. h2/h3 inside overlays are lowercase too when they are section names
   ("the land"), but a parcel name keeps its own case.
3. Mono is only for labels and codes. Never set a sentence in mono.
4. Max running-text measure 72ch (`.lede`, `.brief`, notes).

---

## 3. Spacing scale

4px base. Eight steps plus a 2px half-step that is only for tag padding and the focus-ring offset.
**Retired:** 1, 3, 5, 6, 7, 9, 10, 11, 14, 18, 20, 22, 26, 28, 36, 40, 56, 72px.

| Token | px | Role (use the role, not the number) |
|---|---|---|
| `--sp-half` | 2 | Tag vertical padding; focus outline offset |
| `--sp-1` | 4 | Inline: icon to text, between tags in a row, label line to its value line |
| `--sp-2` | 8 | Control gap: between buttons, between chips, label to its input, header actions |
| `--sp-3` | 12 | Stack: fields in a form, items in a popover, rows' vertical padding, score block to row text |
| `--sp-4` | 16 | Popover padding; footer padding; map overlay inset from map edge; chip-bar group gap |
| `--sp-5` | 24 | **Overlay edge** (every dialog, panel, popover-lg side padding); gap between sections inside an overlay |
| `--sp-6` | 32 | Hero padding; gap between a title and its section body on pages; dialog-full inset |
| `--sp-7` | 48 | Page gutter (desktop) |
| `--sp-8` | 64 | Gap between page blocks |

Mobile (≤ 900px): page gutter 16, page blocks 48, overlay edge stays 24 (16 under 480px).

---

## 4. Overlays: sizes and frame

Every overlay is the same object at different widths: a flat paper sheet, 0 radius, no shadow, a header strip,
a scrolling body and an optional footer. The sheet is separated from the page by a scrim (dialogs) or a 2px brown
outline (popovers, side panel edge). Nothing floats with a gap and a drop shadow.

| Overlay | Width | Height | Header | Body padding | Footer | Separation |
|---|---|---|---|---|---|---|
| Popover (More filters, Layers, Sort, map parcel popup) | `--pop-w` 280 | content, max 60vh | none (trigger is the header) | 16 | none | 2px `--fg` outline; flush to trigger (0 offset), left edge = trigger left edge (right-aligned triggers: right = right) |
| Criterion editor (anchored to its chip) | `--pop-w-lg` 520 | content | none; h2 title is first line | 24 | 72, 2px rule above | 2px outline + page dimmed to 55% |
| Dialog S (sign-in, confirm) | `--dlg-s` 400 | content | 56 | 24 | 72 | scrim `rgba(23,17,12,.62)` |
| Dialog M (feedback, new project) | `--dlg-m` 560 | content, max `100vh − 64` | 56 | 24 | 72 | scrim |
| Dialog L (criteria from brief/interview, history) | `--dlg-l` 880 | max `100vh − 64` | 56 | 24 | 72 | scrim |
| Dialog Full (property pop-out) | `100vw − 64`, max 1376 | `100vh − 64`, max 864 | `--head-lg` 80 (has score) | 24 | none | scrim |
| Side panel (parcel details `#detail`) | `--panel-w` 400 | map height, docked to the right edge, no inset | 56, sticky | 24 | none | 2px `--fg` left edge; no gap from top bar or map edge |
| Map panel (left list `#panel`) | `--panel-w` 400 | full | — | 24 | — | 2px `--fg` right edge |

Viewport margin: dialogs keep at least 32px of page around them (`--dlg-inset`); under 900px Full and L become
full-screen and S/M keep 16px.

### Header, body, footer

- **Header** is `--head` 56px (or `--head-lg` 80px when it holds a 48px score block): `padding: 0 24px`,
  `display: flex; align-items: center; gap: 12px`. On paper overlays a 2px `--fg` rule sits under it; the property
  pop-out header is a brown `--field` band instead.
- **Header actions** sit last, right edge on the 24px line, `gap: 8px`. In a 56 header they are `--h-sm` 32px; in an
  80 header `--h-md` 40px. Both leave equal space above and below (12 and 20).
- **Close** is always the right-most action, always the same: paper block, text "Close ✕", Esc closes, backdrop click
  closes. Minimize (side panel) sits to its left. Save/star sits left of that.
- **Title** in a header is `--fs-h2` (28) with an optional mono label line under it (`gap: 4px`); the title block is
  vertically centered, so its first line and the actions share a centre line, not a top edge.
- **Body** pads `24px` left and right, `24px` top, `24px` bottom; sections inside it stack with `gap: 24px`.
- **Section head** inside an overlay: `--fs-h3` lowercase title (or mono label) with `padding-bottom: 8px` and a 2px
  `--fg` rule under it, then `gap: 12px` to its content.
- **Footer** is `--foot` 72px: `padding: 16px 24px`, 2px rule above, status message on the left (on the 24px line),
  actions right-aligned with the primary action right-most. Footer buttons are `--h-md` 40; the dialog's single primary
  action may be `--h-lg` 48.

---

## 5. Alignment rules

1. **One inner edge per surface.** Inside any panel or overlay the title, section rules, body text, list row content,
   inputs and footer buttons all start on the same 24px line. Full-bleed things (list row hover fill, selected fill,
   section rules) run edge to edge, but their *content* starts at 24.
2. **List rows share columns.** Every parcel row (map list, home saved list, project table) uses the same grid:
   `[rank 24]? [score 48] 12 [text 1fr] 12 [trailing auto]`. The score block is always 48×48, so every parcel name
   in the app starts the same distance from its score. Rows pad 12px top/bottom; no rule between rows; hover and
   selected rows get the `--fill` background, selected also gets a 4px `--accent` mark on the left edge.
3. **Bars line up on one centre line.** Every control in the header bar, chip bar and map bar is `--h-md` or `--h-sm`
   and `align-items: center`; no control sets its own margin-top to look aligned.
4. **Baselines, not padding hacks.** Label/value pairs (`dl`, stat blocks, `.block-head`) use `align-items: baseline`.
   Remove the `padding-top: 2px` on `dt`. Mono label column in a `dl` is fixed at 128px in panels, 152px in Full.
5. **Popovers hang from their trigger.** Top edge flush with the trigger's bottom edge, side edge flush with the
   trigger's side edge. No 6px gaps.
6. **Map overlays sit 16px in** from the map edges (legend, satellite toggle, corner ticks). Nothing else sits on the map.
7. **Panels touch.** The rail, list panel, map, and side panel butt against each other with 2px rules between; no
   10–12px floating insets.
8. **Equal split of spare height.** When a control sits in a taller strip, the spare height splits evenly above and
   below (56 bar − 40 control = 8 + 8; 48 chip bar − 32 chip = 8 + 8).
9. **Lines.** 2px `--fg` rules mark sections and edges; 4px marks mean "selected / current / Nice". No 1px row dividers,
   no 1px boxes, no shadows, no radius. Inputs are filled blocks (`--fill`) with no border; focus is a 2px `--accent`
   outline offset 2px.

---

## 6. Inventory: every overlay and container today

| Element | Where | Width | Height | Padding | Header | Close | Corners / shadow |
|---|---|---|---|---|---|---|---|
| Property pop-out `#propModal` | `property.js` build(), `styles.css:480–527` | min(1280, 100vw−48) | min(860, 100vh−48) | bar 14/18/14/22; detail 4/22/24 | `.pmBar` brown, ~78px, score 50 | ghost "Close ✕", 38px, 13px text | radius 4, no shadow |
| Feedback `#feedbackModal` | `feedback.js`, `styles.css:529–548` | min(560, 100vw−32) | content | 24 all round | `.fbHead` inline, title 34px | ghost "Close ✕", 32px, 12px text | radius 4 |
| Parcel side panel `#detail` | `map.html`, `candidates.js`, `styles.css` 103, 116, 205–208, 222, 305, 380–382, 437, 604 (7 rules) | 380 | top `--mapbar`+12 to bottom 10 | 0/18/18 | `.detailBar` sticky, 8/10/8/18, ~48px | ghost "Close ✕" (+ span), 32px | radius 6 → 4 (!important), shadow 0 6 20 → none, 4px brown left border |
| Criteria builder (brief / interview) | `builder.js` renders into `#detail` | 380 | panel | panel | `h3` 20/26px | panel close | chat bubbles radius 6 |
| More filters popover `.pop .popBody` | `map.html:120–127`, `styles.css:594–602` | 260 | content | 14 | none | toggles via summary | radius 4, 1px line, 6px offset |
| Layers popover `#layers.popBody` | `map.html:128–137`, `styles.css:600–614` | 220 | content | 14 (+ `.mapctl` 8/10 leftovers) | none | summary | radius 4, rows 32 |
| Legend `#legend.mapctl` | `map.html:131–142`, `styles.css:89–95, 378–379, 436` | max calc(100vw−nav−420) | content | 8/10 | none | — | radius 4, shadow killed |
| Satellite toggle `.pmSat` | `property.js`, `styles.css:495, 527` | content | content | 8/10 | — | — | radius 4 |
| MapLibre popup | `app.js:62`, `styles.css:184–185` | library default (240) | content | library default 10/15 | none | library × | radius 4 |
| Sign-in `#signin` / `.signinCard` + Clerk | `index/map/project.html`, `auth.js:42`, `styles.css:127–131` | Clerk card (~400) | full-screen scrim | page 16 | h1 40px | — | Clerk `borderRadius: '4px'`, font `Inter` (wrong family) |
| Project edit form `#projForm` | `map.html:42–60`, `styles.css:154` | panel | content | 12 | `summary` 13px | — | radius 4, 1px box |
| Criterion card `.crit` | `candidates.js`, `styles.css:163–169` | panel | content | 9 | `.head` 13/600 | × 16px | radius 4, 1px box |
| Home project head `.projHead` | `index.html`, `styles.css:450–464` | page | content | 26/28 | h3 36 | — | radius 4 |
| Start box `.startOne` | `index.html`, `styles.css:551` | page | content | 22 | label | — | 4px green top border |
| Project hero `.hero` | `project.html`, `styles.css:354–359` | page | content | 32 | title 64 | — | radius 4 |
| Saved table `.table-wrap` | `project.html`, `styles.css:269–274, 362–366` | page | content | th 12, td 16/12 | — | — | 2px top rule, 1px row rules |

---

## 7. Mapping: every current value to its token

Apply these mechanically. Where a value maps to two tokens, the role column decides.

### Font size

| Now | → | Where it appears |
|---|---|---|
| 10.5 | `--fs-label` 11 | `.themeSwitch button` |
| 10 (mockup) | `--fs-label` 11 | MUST/NICE tags in "why it scores", Nice dots |
| 11 | `--fs-label` 11 (mono) or `--fs-small` 12 (text) | mono: `.lbl .lblish dt h2 th .unit`; text: `.pill .chip .facts .pill` → 12 |
| 11.5 | `--fs-small` | `.pill, .tag, .chip` |
| 12 | `--fs-small` | `.list .m`, `label`, `code`, `table.hist`, `.bars`, `.fields`, `.crit .opts`, `.draft .why`, `ol.hist`, `.taperToggle`, `button.ghost`, `button.star`, all inline `style="font-size:12px"` in `app.js` (9), `candidates.js` (8), `builder.js` (2), `map.html` (1) |
| 12.5 | `--fs-small` | `.small`, `.savedRow .m`, `.startBtns small`, mockup `.why` |
| 13 | `--fs-body` | `.mapctl`, `dl`, `.zrow`, `.crit`, `.chat .b`, `.draft`, `.builder textarea`, `.bizRow`, `.topbar .back`, `#profEdit summary`, `.expert`, `.startBlock small`, `.pmBar` buttons, `label.pmSat`, `table.grid textarea`, mockup `.btn` |
| 13.5 | `--fs-body` | `.howItWorks li`, `.popBody` checkbox labels, mockup chips |
| 14 / 14.5 | `--fs-body` | `:root` (14 then 14.5), buttons, `a.btn`, `.card .brief`, `.lede`, `.fbMsg textarea`, `.mapSearch`, `.linkBtn`, `.fileLink`, table cells |
| 15 / 15.5 | `--fs-lead` 16 | `.list .t`, `.list li.row > .score` (15, old), `.profileBar select`, `.startOne textarea`, `.plainList`, mockup nav links and `.t` |
| 16 | `--fs-lead` | `.savedRow .t`, `.titleBtn`, `table.grid td b`, `.navLinks a`, `.crit .head button` (×) |
| 18 / 19 | `--fs-h3` 20 | `.rowStar` glyph (18 → 20), list/saved score number, `.empty b`, mockup score |
| 20 | `--fs-h3` | `#detail h3` (old), `.card h3` (old), `.stats dd`, `.howItWorks li::before`, `.pmTitle .score` |
| 22 | `--fs-h3` | `h1` (old base), `.block-head h2` (old), mockup list head and overlay h3 |
| 24 | `--fs-h2` 28 | `.wordmark` (old), `.startBlock b`, mobile wordmark, mockup property score |
| 26 | `--fs-h2` | `#detail h3`, `.wordmark` |
| 28 | `--fs-h2` | `.pmH` |
| 30 | `--fs-h2` | `.card h3`, `.sidenav .wordmark`, mockup project name and property title |
| 32 | `--fs-h2` (in overlays) / `--fs-h1` (on pages) | `.block-head h1` (old) → 40; mockup criterion editor title → 28 |
| 34 | `--fs-h1` on pages, `--fs-h2` in dialogs | `h2.title` → 40; `.fbHead .title` → 28 |
| 36 | `--fs-h1` | `.projMain h3` |
| 40 / 44 | `--fs-h1` | `.panelHead .title`, `.signinCard h1`, `.title`, mobile hero title |
| 64 | `--fs-display` | `.hero .title` |
| 88 / 120 | `--fs-key` 96 | `.keyNum .big`, `.heroSide .keyNum .big` |

### Weight, line height, tracking

| Now | → |
|---|---|
| 600 | 700 (`.list .t` old, `.pill`, `.chip`, `.crit .head`, `.tabs` old, `.profileBar select`, `.topnav a`, `.mapBar select`) |
| 500 on a text link (`#profEdit summary`, `.sub a.back`) | 400 + underline |
| 500 on Inter Tight | 400 (`.mapctl`, `.mapSearch`, `.startBtns small`, `.linkBtn`, `.taperToggle`) — 500 is mono-only |
| line-height 0.85 / 0.95 | `--lh-tight` 0.9 |
| line-height 1 / 1.05 | `--lh-head` 1.05 |
| line-height 1.4 / 1.45 / 1.5 / 1.55 | `--lh-body` 1.5 (1.4 for `--fs-small`) |
| tracking .03 / .04 / .05 / .06em (mono) | `--track-label` .06em |
| tracking −.06em | `--track-key` |
| −.05 / −.045 / −.04 / −.035 / −.03 / −.025em | `--track-title` −.045em (h1, h2) |
| −.02 / −.01em | `--track-snug` −.02em (lead, h3) |
| −.005 / 0 | `--track-body` |

### Spacing (padding, gap, margin)

| Now | → | Notes |
|---|---|---|
| 1, 2, 3 | `--sp-half` 2 | tag / pill vertical padding only; elsewhere 0 or 4 |
| 5, 6, 7 | `--sp-2` 8 (control gaps) or `--sp-1` 4 (inline) | `gap: 6px` ×17 → 8 between controls, 4 between tags; `padding: 5px 7px` (theme switch) → `0 8px` at `--h-sm`; popover 6px offset → 0 |
| 9, 10, 11 | `--sp-3` 12 (stack / row padding) or `--sp-2` 8 (control gap) | `gap: 10px` ×10 → 12 in forms, 8 in button rows; `padding: 9px 11px` → 12/24; `.crit` 9 → 12 |
| 14 | `--sp-3` 12 (gap) or `--sp-4` 16 (padding) | `gap: 14px` ×6 → 12; `.popBody` 14 → 16; `.pmReview` 14 → 16 |
| 18 | `--sp-5` 24 (overlay edge / section gap) or `--sp-4` 16 | `#panel` 18, `#detail` 18, section margin-top 18 → 24; `.navFoot` bottom 18 → 16 |
| 20, 22 | `--sp-5` 24 | `#panel 22/20`, `.pmBar` left 22, `.pmDetail` 22, `.startOne` 22, `.startBlock 20/22`, `.sidenav` 22, gap 22 |
| 26, 28 | `--sp-5` 24 (overlay) or `--sp-6` 32 (hero/page) | `.card` 26, `.projHead 26/28`, `.savedRow` 28, gap 28 (topbar) → 24 |
| 36 | `--sp-6` 32 | page gap (old), mockup dialog inset |
| 40 | `--sp-7` 48 (page gutter) / `--sp-6` 32 (inset) | `.page-in` 40 |
| 56, 72 | `--sp-8` 64 | page block gap 56 → 64; page bottom 72 → 64 |
| inline `margin: 4px 0 0`, `6px 0 0` on notes and h2 | remove; parent `gap` does it | `app.js`, `builder.js`, `map.html` |

### Heights and widths

| Now | → |
|---|---|
| control 38, 40 | `--h-md` 40 |
| ghost 32, theme 28, layer row 32, mockup chip 34 | `--h-sm` 32 |
| mockup 42, 46, 52 inputs/buttons | `--h-lg` 48 (or `--h-md` 40 for secondary header buttons) |
| score 46, 50, 56 | `--score` 48 |
| table score min-width 30, padding 2/7 | `--score-sm` 24 high, min-width 32 |
| `--bar` 56, mockup header 56 | `--bar` 56 |
| `--mapbar` 60 | `--bar` 56 (search + Layers move into the header bar in Survey sheet) |
| mockup chip bar 52 | `--critbar` 48 |
| `.pmBar` ~78, mockup 84 | `--head-lg` 80 |
| `.detailBar` ~48 | `--head` 56 |
| `--nav` 196, mockup 168 | `--nav-w` 168 |
| `#panel` 380 (was 360), `#detail` 380, mockup 404 | `--panel-w` 400 |
| popover 220, 260 | `--pop-w` 280 |
| mockup criterion editor 520 | `--pop-w-lg` 520 |
| `#feedbackModal` 560 | `--dlg-m` 560 |
| `#propModal` 1280 × 860, viewport −48 | Full: viewport −64, max 1376 × 864 |
| `.startActions button` 180, `.fbFoot button` 160 | remove min-widths; buttons size to label + `0 16px` padding |
| `.mapBar select` 158/210, acres inputs 52/58 | 160 and 56 |
| `.fields` max-height 260 | 256 |
| page max-width 1120 / 1240 / 1280 | 1280 content max |

### Corners, borders, shadows

| Now | → |
|---|---|
| radius 1, 2, 3, 4, 6, `var(--r)` and `!important` overrides | `--r` 0, then delete every `border-radius` declaration and every `!important` that existed only to undo one |
| shadows (`.mapctl`, `#detail`, `box-shadow: none !important` reset) | none; delete both the shadow and its reset |
| 1px `--line` row rules (`.list li`, `.savedList li + li`, `.bizRow`, `.plainList li`, `.fields div`, `table.grid td`, `table.hist`, `.detailBar`, `details.refine`) | none; rows separate by 12px padding and hover fill |
| 1px boxes (`.crit`, `#projForm`, `.fields`, `.popBody`, `.card.start`, `.startBlock`, inputs) | none (filled blocks); popovers get a 2px `--fg` outline |
| 2px `--fg` rules (`.tabs`, `#list`, `.table-wrap`, `.empty`, `.startDraft`, `.pmDetail h2`) | `--rule` 2px, keep |
| 3px `.topnav` borders, mockup Nice inset 3px | `--mark` 4px |
| 4px left marks (`.navLinks`, `#detail`, selected row) | `--mark` 4px, keep |

---

## 8. Biggest inconsistencies found

1. **26 font sizes and 15 tracking values** for what is really 9 roles, including half-pixel steps
   (10.5, 11.5, 12.5, 13.5, 14.5). The base size itself is set twice (14px at line 26, 14.5px at line 288).
2. **No overlay shares an inner edge with its own header.** Side panel header pads 18 left / 10 right over an 18px
   body; the property header pads 22 / 18 over a 22px body; feedback pads 24. Close buttons come in three heights
   (32, 38, 32) and two text sizes (12, 13).
3. **Seven control heights** (28, 32, 38, 40, 46, 50, 60) in a row of bars that should share one centre line; the map
   bar is 60 next to a 56 top bar.
4. **Radius and shadow are declared, then undone with `!important`** (line 305 kills shadows on 10 selectors; radius
   is 1, 2, 3, 4 or 6 depending on layer). The Survey sheet wants 0 and none, so both the values and the resets can go.
5. **The parcel side panel is defined by 7 separate rules** across four layers (its `top` alone is set four times) and
   still floats 10–12px off the map edges with a 4px brown stripe; `body.map`'s grid is redefined 6 times.
6. **1px row dividers in every list and table**, the opposite of the Survey sheet rule.
7. **Popovers don't agree with each other**: 220 vs 260 wide, 6px gap from the trigger, and Layers still inherits
   `.mapctl` padding and flex rules that it then overrides.
8. **About 20 inline `style="font-size:12px;margin:…"` notes** in `app.js`, `candidates.js`, `builder.js` and `map.html`
   bypass the stylesheet; they should all become one `.note` class (`--fs-small`, `--muted`, no margin).
9. **Mono label tracking varies** (.03, .04, .05, .06em) and `dt` uses a 2px padding nudge instead of baseline alignment.
10. **Clerk sign-in** is themed with `Inter` (not Inter Tight) and 4px radius in `auth.js:42`.
11. **The mockups carry their own near-duplicates** (chip 13.5px/34px, row title 15.5px, buttons 38/42/46px, score 19/24px,
    panel 404px). This system rounds them to the scale above; implement from the tokens, not the mockup pixels.
12. `docs/design.md` still says "4px corners on blocks; 2px on small labels". Survey sheet is 0; that line should be
    updated when the redesign lands.

---

## 9. Implementation notes

- Start a fresh `styles.css` from the token block rather than appending a sixth layer; the mapping tables above
  cover every selector that exists today.
- Replace inline note styles with `<p class="note">` and inline section-head margins with parent `gap`.
- Give dialogs one shared class (`.sheet` with `.sheet-s/-m/-l/-full`) and one header/body/footer structure
  (`.sheet-head`, `.sheet-body`, `.sheet-foot`), so the property pop-out, feedback, builder and criterion editor
  can't drift apart again. The side panel uses the same `.sheet-head` and `.sheet-body`.
- MapLibre popup: set `.maplibregl-popup-content { padding: 16px; border-radius: 0; box-shadow: 0 0 0 2px var(--fg); }`
  and size it to `--pop-w`.
- `auth.js` Clerk appearance: `fontFamily: 'Inter Tight, sans-serif'`, `borderRadius: '0px'`.
