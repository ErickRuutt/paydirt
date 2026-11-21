import { all } from './db.js';

// King County Assessor lookup codes (EXTR_LookUp.csv): LUType 6 = SaleInstrument, LUType 5 = SaleReason.
const INSTRUMENT = { 2: 'Warranty Deed', 3: 'Statutory Warranty Deed', 4: 'Special Warranty Deed', 5: 'Corporate Warranty Deed', 7: 'Grant Deed', 10: 'Real Estate Contract', 15: 'Quit Claim Deed', 18: "Trustees' Deed", 19: "Executor's Deed", 20: 'Fiduciary Deed', 21: "Sheriff's Deed", 22: 'Bargain and Sale Deed', 24: 'Deed of Personal Rep', 26: 'Other', 27: 'Deed' };
const REASON = { 1: 'None', 4: 'Foreclosure', 5: 'Trust', 6: 'Executor/guardian', 7: 'Testamentary trust', 8: 'Estate settlement', 9: 'Settlement', 10: 'Property settlement', 11: 'Divorce', 14: 'Gift (partial interest)', 17: 'Trade', 18: 'Other', 19: 'Quit claim gift' };

const INHERITANCE_REASONS = new Set([6, 7, 8]);
const INHERITANCE_INSTRUMENTS = new Set([19, 20, 24]);
const FAMILY_REASONS = new Set([5, 10, 11, 13, 14, 19]);

function kindOf(s) {
  if (INHERITANCE_REASONS.has(s.reason) || INHERITANCE_INSTRUMENTS.has(s.instrument)) return 'inheritance';
  if (s.instrument === 15 || FAMILY_REASONS.has(s.reason)) return 'family / trust transfer';
  if (s.reason === 4 || s.instrument === 21) return 'foreclosure';
  if (s.price >= 10000 && (s.reason === 1 || s.reason == null)) return 'market sale';
  return 'other transfer';
}

const yearsSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / (365.25 * 864e5) : null);

// King County PIN = 6-digit major + 4-digit minor. Accept any formatting.
export const normalizePin = (apn) => String(apn ?? '').replace(/\D/g, '').padStart(10, '0').slice(-10);

const SALES_SQL = 'SELECT pin, doc_date, price, instrument, reason, seller, buyer FROM sales WHERE pin = ANY(?) ORDER BY pin, doc_date DESC';

// One query for many parcels; returns Map(apn -> ownership summary).
export async function ownershipForMany(apns) {
  const pins = [...new Set(apns.map(normalizePin))].filter((p) => !/^0+$/.test(p));
  const rows = pins.length ? await all(SALES_SQL, [pins]) : [];
  const byPin = new Map();
  for (const r of rows) (byPin.get(r.pin) ?? byPin.set(r.pin, []).get(r.pin)).push(r);
  return new Map(apns.map((apn) => [apn, summarize(normalizePin(apn), byPin.get(normalizePin(apn)) ?? [])]));
}

export async function ownershipFor(apn) {
  return (await ownershipForMany([apn])).get(apn);
}

function summarize(pin, sales) {
  if (/^0+$/.test(pin)) return { available: true, records: 0, signals: ['no parcel number to match'] };
  const rows = sales.map((s) => ({
    date: s.doc_date, price: s.price, seller: s.seller, buyer: s.buyer,
    instrument: INSTRUMENT[s.instrument] ?? (s.instrument ? `Code ${s.instrument}` : null),
    reason: REASON[s.reason] ?? (s.reason ? `Code ${s.reason}` : null),
    kind: kindOf(s),
  }));
  if (!rows.length) return { available: true, records: 0, signals: ['no recorded sales'] };

  const last = rows[0];
  const lastMarket = rows.find((r) => r.kind === 'market sale') ?? null;
  const yTransfer = yearsSince(last.date);
  const yMarket = lastMarket ? yearsSince(lastMarket.date) : null;
  const earliest = rows.at(-1).date;

  const signals = [];
  if (yMarket == null) signals.push(`no market sale on record (records start ${earliest.slice(0, 4)})`);
  else if (yMarket >= 20) signals.push(`held ${Math.floor(yMarket)}+ years since last market sale`);
  if (last.kind === 'inheritance') signals.push(yTransfer <= 5 ? 'recently inherited' : 'inherited');
  if (last.kind === 'family / trust transfer') signals.push('last transfer was family or trust');
  if (last.kind === 'foreclosure') signals.push('foreclosure');
  if (yMarket != null && yMarket < 3) signals.push('bought within 3 years');

  return {
    available: true,
    records: rows.length,
    lastTransfer: { ...last, years: round1(yTransfer) },
    lastMarketSale: lastMarket ? { ...lastMarket, years: round1(yMarket) } : null,
    yearsSinceTransfer: round1(yTransfer),
    yearsSinceMarketSale: round1(yMarket),
    signals,
    history: rows.slice(0, 12),
  };
}

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
