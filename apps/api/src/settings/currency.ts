/**
 * The currency an organisation keeps its books in. Every amount the system
 * stores is in it; this decides how amounts are shown, rounded and spelled
 * out on invoices.
 */
export interface Currency {
  code: string;
  /** What goes in front of an amount: "RM", "S$", "€". */
  symbol: string;
  /** 2 for most currencies, 0 for those without a minor unit in use (IDR, VND, JPY…). */
  decimals: 0 | 2;
  name: string;
  /** Words on invoices: "Ringgit Malaysia One Hundred … and Sen Fifty Only". */
  major: string;
  minor: string;
}

const c = (code: string, symbol: string, decimals: 0 | 2, name: string, major: string, minor = 'Cents'): Currency =>
  ({ code, symbol, decimals, name, major, minor });

/** The currencies an organisation can choose. */
export const CURRENCIES: Currency[] = [
  c('MYR', 'RM', 2, 'Malaysian ringgit', 'Ringgit Malaysia', 'Sen'),
  c('SGD', 'S$', 2, 'Singapore dollar', 'Singapore Dollars'),
  c('BND', 'B$', 2, 'Brunei dollar', 'Brunei Dollars'),
  c('IDR', 'Rp', 0, 'Indonesian rupiah', 'Rupiah'),
  c('THB', '฿', 2, 'Thai baht', 'Baht', 'Satang'),
  c('PHP', '₱', 2, 'Philippine peso', 'Pesos', 'Centavos'),
  c('VND', '₫', 0, 'Vietnamese dong', 'Dong'),
  c('KHR', '៛', 0, 'Cambodian riel', 'Riel'),
  c('MMK', 'K', 0, 'Myanmar kyat', 'Kyat'),
  c('USD', 'US$', 2, 'US dollar', 'US Dollars'),
  c('EUR', '€', 2, 'Euro', 'Euros'),
  c('GBP', '£', 2, 'Pound sterling', 'Pounds Sterling', 'Pence'),
  c('AUD', 'A$', 2, 'Australian dollar', 'Australian Dollars'),
  c('NZD', 'NZ$', 2, 'New Zealand dollar', 'New Zealand Dollars'),
  c('CAD', 'C$', 2, 'Canadian dollar', 'Canadian Dollars'),
  c('HKD', 'HK$', 2, 'Hong Kong dollar', 'Hong Kong Dollars'),
  c('CNY', '¥', 2, 'Chinese yuan', 'Yuan', 'Fen'),
  c('JPY', '¥', 0, 'Japanese yen', 'Yen'),
  c('KRW', '₩', 0, 'South Korean won', 'Won'),
  c('TWD', 'NT$', 2, 'New Taiwan dollar', 'New Taiwan Dollars'),
  c('INR', '₹', 2, 'Indian rupee', 'Rupees', 'Paise'),
  c('PKR', 'Rs', 2, 'Pakistani rupee', 'Rupees', 'Paisa'),
  c('BDT', '৳', 2, 'Bangladeshi taka', 'Taka', 'Poisha'),
  c('LKR', 'Rs', 2, 'Sri Lankan rupee', 'Rupees'),
  c('AED', 'AED', 2, 'UAE dirham', 'Dirhams', 'Fils'),
  c('SAR', 'SAR', 2, 'Saudi riyal', 'Riyals', 'Halalas'),
  c('QAR', 'QAR', 2, 'Qatari riyal', 'Riyals', 'Dirhams'),
  c('ZAR', 'R', 2, 'South African rand', 'Rand'),
];

export const DEFAULT_CURRENCY = CURRENCIES[0];

export function currencyOf(code: string | undefined): Currency {
  return CURRENCIES.find((x) => x.code === code) ?? DEFAULT_CURRENCY;
}

/** Round to the currency's smallest unit. */
export function roundMoney(n: number, cur: Currency = DEFAULT_CURRENCY): number {
  const f = 10 ** cur.decimals;
  return Math.round(n * f) / f;
}

/** "RM 1,234.50", "Rp 1.250.000"-style grouping kept simple: "Rp 1,250,000". */
export function formatMoney(n: number, cur: Currency = DEFAULT_CURRENCY): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${cur.symbol} ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })}`;
}
