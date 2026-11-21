// Who is operating on a parcel, and what that means. Curated lists; the closing list goes stale and
// should eventually be fed by news/RSS (docs/product-notes.md). Last reviewed Nov 21, 2026.

// Strong anchors: national tenants whose sites are rarely for sale and whose leases are long.
export const ANCHORS = [
  'Costco', 'Home Depot', "Lowe's", 'Walmart', 'Target', 'Fred Meyer', 'Safeway', 'QFC', 'WinCo', 'Kroger', 'Albertsons',
  'Amazon', 'Whole Foods', "Trader Joe's", 'Haggen', 'PCC', 'Uwajimaya', 'H Mart', "Sam's Club", 'IKEA', 'REI', 'Best Buy',
  "Kohl's", 'Ross', 'TJ Maxx', 'Marshalls', 'HomeGoods', 'Burlington', "Dick's Sporting Goods", 'Bartell Drugs', 'Walgreens', 'CVS',
  'Starbucks', "McDonald's", 'Chevron', 'Shell', 'Arco', '76', 'Les Schwab', 'Boeing', 'Microsoft', 'PACCAR', 'UPS', 'FedEx',
];

// Chains that are bankrupt, liquidated or closing many stores. A site with one of these may be (or soon be) empty.
export const CLOSING = [
  { brand: 'Joann', note: 'bankrupt 2025; all stores closed' },
  { brand: 'Big Lots', note: 'bankrupt 2024; most stores closed' },
  { brand: 'Rite Aid', note: 'second bankruptcy 2025; all stores closed' },
  { brand: 'Party City', note: 'closed all stores 2025' },
  { brand: 'Bed Bath & Beyond', note: 'closed all stores 2023' },
  { brand: 'Tuesday Morning', note: 'liquidated 2023' },
  { brand: 'Christmas Tree Shops', note: 'liquidated 2023' },
  { brand: 'Buy Buy Baby', note: 'closed 2023' },
  { brand: 'Express', note: 'bankrupt 2024; many stores closed' },
  { brand: 'Forever 21', note: 'closed US stores 2025' },
  { brand: 'Conn\'s', note: 'bankrupt 2024' },
  { brand: 'Hudson\'s Bay', note: 'liquidated 2025' },
  { brand: 'Big 5 Sporting Goods', note: 'closing stores' },
  { brand: 'Walgreens', note: 'closing many stores' },
];

// Mailing cities that are company headquarters or property-tax firms rather than a person's home.
// A tax bill sent here says "a business pays this bill", not "the owner lives elsewhere".
export const CORPORATE_MAIL = [
  /\bATLANTA\s+GA\b/, /\bBENTONVILLE\s+AR\b/, /\bISSAQUAH\s+WA\b/, /\bDALLAS\s+TX\b/, /\bHOUSTON\s+TX\b/, /\bMINNEAPOLIS\s+MN\b/,
  /\bCINCINNATI\s+OH\b/, /\bBOISE\s+ID\b/, /\bPLEASANTON\s+CA\b/, /\bMOORESVILLE\s+NC\b/, /\bFRAMINGHAM\s+MA\b/, /\bSAN\s+RAMON\s+CA\b/,
];
export const CORPORATE_ATTN = /\b(PROPERTY TAX|TAX DEPT|TAX DEPARTMENT|REAL ESTATE|C\/O|ATTN|INC|LLC|CORP|COMPANY|CO\b|LP\b|TRUST CO)/i;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
const ANCHOR_N = ANCHORS.map((a) => [a, norm(a)]);
const CLOSING_N = CLOSING.map((c) => ({ ...c, n: norm(c.brand) }));

export function classifyBusiness(name, brand) {
  const n = norm(brand || name);
  // Match on the start of the name only: "Express" must not catch "Panda Express".
  const closing = CLOSING_N.find((c) => n === c.n || n.startsWith(c.n + ' '));
  if (closing) return { status: 'closing', note: closing.note, label: closing.brand };
  const anchor = ANCHOR_N.find(([, a]) => n === a || n.startsWith(a + ' '));
  if (anchor) return { status: 'anchor', label: anchor[0] };
  return { status: 'operating', label: brand || name };
}

// Owner type from a buyer or taxpayer name in the sales records.
export function ownerType(name) {
  const s = String(name ?? '').toUpperCase();
  if (!s.trim()) return null;
  if (/\b(CITY OF|COUNTY|STATE OF|SCHOOL DIST|PORT OF|UNITED STATES|DEPT OF|DISTRICT|TRIBE|WSDOT)\b/.test(s)) return 'government';
  if (/\b(TRUST|TRUSTEE|ESTATE OF|LIVING TR|FAMILY TR|REVOCABLE)\b/.test(s)) return 'trust';
  if (/\b(INC|CORP|CORPORATION|COMPANY|STORES|CO\b|L\s?P\b|LP\b|REIT|HOLDINGS|PROPERTIES|PARTNERS|INVESTMENTS?|REALTY|REAL ESTATE|BANK)\b/.test(s)) return 'company';
  if (/\b(L\s?L\s?C|LLC)\b/.test(s)) return 'llc';
  return 'individual';
}
