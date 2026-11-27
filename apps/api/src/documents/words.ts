import { Currency, DEFAULT_CURRENCY } from '../settings/currency';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' and ');
}

export function integerInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`Cannot spell ${n}`);
  if (n === 0) return 'zero';
  const groups: string[] = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${below1000(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
  }
  return groups.join(' ');
}

const title = (s: string) => s.replace(/\b[a-z]+/g, (w) => (w === 'and' ? w : w[0].toUpperCase() + w.slice(1)));

/**
 * An amount spelled out the way invoices print it, in the organisation's
 * currency: "Ringgit Malaysia One Thousand and Eighty and Sen Fifty Only",
 * "Singapore Dollars Ten and Cents Five Only", "Rupiah One Million Only".
 */
export function amountInWords(amount: number, cur: Currency = DEFAULT_CURRENCY): string {
  const minorUnits = Math.round(amount * 10 ** cur.decimals);
  const major = cur.decimals ? Math.floor(minorUnits / 100) : minorUnits;
  const minor = cur.decimals ? minorUnits % 100 : 0;
  return `${cur.major} ${title(integerInWords(major))}${minor ? ` and ${cur.minor} ${title(integerInWords(minor))}` : ''} Only`;
}

/** Ringgit, as printed on Malaysian invoices. */
export const ringgitInWords = (amount: number) => amountInWords(amount, DEFAULT_CURRENCY);
