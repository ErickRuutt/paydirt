// Can a sports club (lit fields + indoor athletic facility) go on this parcel?
// Unincorporated King County only: K.C.C. 21A.08.050 (personal services), "Sports club",
// Title 21A updated September 9, 2026. City parcels follow each city's own code (not yet read).
//
// Columns of the table: A F M RA UR R-1 R-4–8 R-12–48 NB CB RB O I
// Row:                  -  - -  C3 P6/C7 P6/C7 P6/C7 P6/C7 P6/C P P - -
//   3: outside the urban area only; not in RA-10 or RA-20; bulk and scale compatible with rural
//      character; gross floor area max 10,000 sq ft unless on or next to a public facility site;
//      limited to sports clubs providing supervised instructional or athletic programs.
//   6: urban area; max 2,500 sq ft; no amplified noise; 7am–10pm.
//   7: urban area; no amplified noise; max 10,000 sq ft unless next to a public facility or nonprofit; 7am–10pm.
export const KC_CODE_SOURCE = 'https://aqua.kingcounty.gov/council/clerk/code/24-30_Title_21A.pdf';

const RULES = [
  { re: /^RA-(10|20)\b/, verdict: 'prohibited', note: 'Sports clubs are not allowed in RA-10 or RA-20 (KCC 21A.08.050 B.3.a).' },
  { re: /^RA-(2\.5|5)\b/, verdict: 'conditional', note: 'Conditional use permit; building up to 10,000 sq ft unless next to a public facility; supervised athletic programs only; must fit rural character (KCC 21A.08.050 B.3).' },
  { re: /^(A-\d+|F|M)\b/, verdict: 'prohibited', note: 'Not allowed in agricultural (A), forest (F) or mineral (M) zones (KCC 21A.08.050).' },
  { re: /^(UR|R-\d+)\b/, verdict: 'conditional', note: 'Urban residential: permitted up to 2,500 sq ft, conditional up to 10,000 sq ft; no amplified noise; 7am–10pm (KCC 21A.08.050 B.6–7).' },
  { re: /^NB\b/, verdict: 'conditional', note: 'Neighborhood business: permitted up to 2,500 sq ft, conditional above (KCC 21A.08.050 B.6).' },
  { re: /^(CB|RB)\b/, verdict: 'permitted', note: 'Permitted outright in community and regional business zones (KCC 21A.08.050).' },
  { re: /^(O|I)\b/, verdict: 'prohibited', note: 'Not listed as allowed in office (O) or industrial (I) zones (KCC 21A.08.050).' },
];

export function sportsClubVerdict(zone, city) {
  const z = String(zone ?? '').trim().toUpperCase();
  if (city) return { verdict: 'unknown', note: `Inside ${city}: city zoning code applies and hasn't been read yet.` };
  if (!z) return { verdict: 'unknown', note: 'No zoning on record.' };
  for (const r of RULES) if (r.re.test(z)) return { verdict: r.verdict, note: r.note };
  return { verdict: 'unknown', note: `Zone ${z} not mapped yet.` };
}
