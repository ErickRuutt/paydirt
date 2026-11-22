# Paydirt design

Paydirt is a full-screen web app for land sourcing, used at a desk by CRE people and buyers. Its visual language is
the **Survey sheet**: a working paper sheet, ruled and labelled like a plat or a survey ledger. It borrows the
discipline of PerFin's design (bold type, flat color, nothing round, color that always means something) and tones it
down from fun to professional. Colors stay inside the Paydirt brand book (docs/brand/paydirt-brand.html).

> **The answer first, in big type. Color only when it means something.**

Every size, space, type step and overlay frame lives in **[docs/design-system.md](design-system.md)**. This page
says what the rules are; that page says what the values are. `public/styles.css` uses its tokens and nothing else.

## What carried over from PerFin, and what didn't

| PerFin | Paydirt |
|---|---|
| Two typefaces: heavy grotesk + small mono labels | Same: **Inter Tight** for everything you read, **IBM Plex Mono** for labels. Inter is dropped. |
| Big lowercase titles ("november") | Same: page and section titles are lowercase, heavy and tight ("projects", "saved", "best matches"). |
| One flat color panel per screen | Flat **ink** blocks (dark brown): the left rail, the project hero that holds the key number, the property header. No gradients, no shadows. |
| Square corners, no pills, no ghost buttons | Stricter: **0px corners** everywhere. Tags are square labels; buttons and chips are solid blocks. |
| Tilt 8° on chips, 1.5° on presses | Toned down: one small 8° gold chip marks each section title; presses tip 0.75°. Nothing else tilts. |
| Phone-first, tabs at the top | Desk-first and full-width; a dark brown rail on the left of every page, and the wordmark always goes home. |
| Days, not dollars; graveyard; fun | Cut. Professional tone; no jokes in the UI. |

## Color meaning

| Color | Means |
|---|---|
| Brown (loam, chocolate, bedrock) | The ground: the rail, ink blocks, Must chips, text, rules. Never a status. |
| Paper / sheet / fill | The page is paper; inputs, paper buttons and the selected row are the darker fill; the chip bar is the band. |
| Green (fir, cedar) | The main action, a fit, permitted, saved / shortlisted. |
| Gold (ore, gilt) | Value and attention: the wordmark, section chips, the key number, the Nice underline, the save star, the selected-row mark. |
| Red (survey red) | A catch: fails, not allowed, an active tenant, rejected. |
| Score scale | The one exception: a standard red → yellow → green scale, because everyone reads it instantly. |

## Survey sheet rules

1. **The key number is the biggest thing on the page** (saved properties on home and project pages; the score in a row).
2. **Paper ground.** Pages, panels and dialogs are flat paper. Nothing floats: the rail, list panel, map and side
   panel butt against each other with 2px rules between them, and dialogs sit on a scrim with no shadow.
3. **Nothing round.** 0px corners on everything, including inputs, chips, tags, score tiles and dialogs. No shadows,
   no dashed outlines, no ghost (outline-only) buttons.
4. **Rules mark sections, not rows.** A heavy 2px brown rule tops every list, table and section, and sits under every
   overlay header. List rows have **no dividers**: they separate by spacing, a rank number and a hover fill.
5. **Ledger rows.** Every parcel row shares one grid: a mono rank number, a square solid score tile, the name and a
   mono meta line, then trailing actions. The selected row gets the fill and a 4px gold mark on its left edge.
6. **Solid blocks.** Buttons and chips are filled blocks. The primary action is green; secondary actions are paper
   blocks. Must chips are ink; Nice chips are paper with a 4px gold underline.
7. **Labels are mono**, 11px, uppercase, 0.06em tracking: form labels, `dt`, table heads, meta lines, group labels,
   save state. Everything else is Inter Tight. Never set a sentence in mono.
8. **Numbers are tabular** so columns line up.
9. **One inner edge per surface.** Inside a panel or overlay, the title, rules, text and buttons start on the same
   24px line. Overlays share one frame: header strip, body, footer with a 2px rule above.
10. **Bad news comes with what to do next** (e.g. a site no longer fits: say so, and keep it reachable).

## Check before shipping a screen

- Is the one number someone needs the biggest thing on it?
- Does every color carry its meaning above, or is it absent?
- Is anything round, shadowed, floating, or outlined-ghost?
- Is there a 1px line between rows anywhere? (There shouldn't be.)
- Are labels mono and everything else Inter Tight?
- Does every value come from a token in docs/design-system.md?
- Would it pass the "obviously made by AI" test?
