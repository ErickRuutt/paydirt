# Paydirt design

Paydirt is a full-screen web app for land sourcing, used at a desk by CRE people and buyers. It borrows the discipline of
PerFin's design (bold type, flat color, nothing round, color that always means something) and tones it down
from fun to professional. Colors stay inside the Paydirt brand book (docs/brand/paydirt-brand.html).

> **The answer first, in big type. Color only when it means something.**

## What carried over from PerFin, and what didn't

| PerFin | Paydirt |
|---|---|
| Two typefaces: heavy grotesk + small mono labels | Same: **Inter Tight** for everything you read, **IBM Plex Mono** for labels. Inter is dropped. |
| Big lowercase titles ("november") | Same: page and section titles are lowercase, heavy and tight ("projects", "saved", "field house"). |
| One flat color panel per screen | One flat **chocolate** field per page holding the page's key number. No gradients, no shadows. |
| Square, 4px corners, no pills, no ghost buttons | Same, strictly. Tags are square labels; buttons are solid blocks. |
| Tilt 8° on chips, 1.5° on presses | Toned down: one small 8° gold chip marks each section title; presses tip 0.75°. Nothing else tilts. |
| Phone-first, tabs at the top | Desk-first and full-width; one top bar on every page, and the wordmark always goes home. |
| Days, not dollars; graveyard; fun | Cut. Professional tone; no jokes in the UI. |

## Color meaning

| Color | Means |
|---|---|
| Brown (chocolate, loam, bedrock) | The ground: top bar, key-number fields, text. Never a status. |
| Paper / sheet | Lists, tables, forms, anything you read or type into. |
| Green (fir, cedar) | The main action, a fit, permitted, saved / shortlisted. |
| Gold (ore, gilt) | Value and attention: the wordmark, section chips, needs review, the save star. |
| Red (survey red) | A catch: fails, not allowed, an active tenant, rejected. |
| Score scale | The one exception: a standard red → yellow → green scale, because everyone reads it instantly. |

## Rules

1. **The key number is the biggest thing on the page** (saved properties on home and project pages; the score in a row).
2. **Nothing round.** 4px corners on blocks; 2px on small labels. No pills, no rounded cards, no shadows, no dashed outlines.
3. **Labels are mono**, 11px, uppercase, 0.06em tracking. Everything else is Inter Tight.
4. **Numbers are tabular** so columns line up.
5. **Rules, not boxes.** Lists and tables are separated by lines, not wrapped in cards.
6. **Actions run full width** inside their column; secondary actions are paper blocks, never outlines.
7. **Bad news comes with what to do next** (e.g. a site no longer fits: say so, and keep it reachable).

## Check before shipping a screen

- Is the one number someone needs the biggest thing on it?
- Does every color carry its meaning above, or is it absent?
- Is anything round, shadowed, or outlined-ghost?
- Are labels mono and everything else Inter Tight?
- Would it pass the "obviously made by AI" test?
