/**
 * The organisation's currency, set from /config when it loads (Ringgit until
 * then, and for organisations that never chose another).
 */
export interface CurrencyInfo { code: string; symbol: string; decimals: number }
let currency: CurrencyInfo = { code: "MYR", symbol: "RM", decimals: 2 };

export function setCurrency(c: CurrencyInfo | undefined) {
  if (c?.code) currency = { code: c.code, symbol: c.symbol, decimals: c.decimals };
}

export const currencyCode = () => currency.code;
export const currencySymbol = () => currency.symbol;

const fmt = (n: number, digits: number) =>
  `${n < 0 ? "-" : ""}${currency.symbol} ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** A rounded amount for summaries and cards: "RM 18,400". (Named for history; it follows the organisation's currency.) */
export const fmtMYR = (n: number) => fmt(n, 0);

/** An exact amount: "RM 18,400.50", "Rp 1,250,000". */
export const fmtMoney = (n: number) => fmt(n, currency.decimals);

export const fmtNum = (n: number) => new Intl.NumberFormat("en-MY").format(n);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

export const daysUntil = (iso: string) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
