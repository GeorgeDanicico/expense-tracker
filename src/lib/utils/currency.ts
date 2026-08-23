export const DEFAULT_CURRENCY = "EUR";

export const CURRENCY_OPTIONS = [
  { code: "EUR", label: "Euro" },
  { code: "RON", label: "Romanian leu" },
  { code: "USD", label: "US dollar" },
  { code: "GBP", label: "British pound" },
  { code: "AED", label: "UAE dirham" },
  { code: "AUD", label: "Australian dollar" },
  { code: "BGN", label: "Bulgarian lev" },
  { code: "BRL", label: "Brazilian real" },
  { code: "CAD", label: "Canadian dollar" },
  { code: "CHF", label: "Swiss franc" },
  { code: "CNY", label: "Chinese yuan" },
  { code: "CZK", label: "Czech koruna" },
  { code: "DKK", label: "Danish krone" },
  { code: "HKD", label: "Hong Kong dollar" },
  { code: "HUF", label: "Hungarian forint" },
  { code: "IDR", label: "Indonesian rupiah" },
  { code: "ILS", label: "Israeli new shekel" },
  { code: "INR", label: "Indian rupee" },
  { code: "JPY", label: "Japanese yen" },
  { code: "KRW", label: "South Korean won" },
  { code: "MXN", label: "Mexican peso" },
  { code: "MYR", label: "Malaysian ringgit" },
  { code: "NOK", label: "Norwegian krone" },
  { code: "NZD", label: "New Zealand dollar" },
  { code: "PHP", label: "Philippine peso" },
  { code: "PLN", label: "Polish zloty" },
  { code: "SEK", label: "Swedish krona" },
  { code: "SGD", label: "Singapore dollar" },
  { code: "THB", label: "Thai baht" },
  { code: "TRY", label: "Turkish lira" },
  { code: "UAH", label: "Ukrainian hryvnia" },
  { code: "ZAR", label: "South African rand" },
] as const;

const supportedCurrencies = new Set<string>(
  CURRENCY_OPTIONS.map((currency) => currency.code),
);

export function isSupportedCurrency(value: unknown): value is string {
  return typeof value === "string" && supportedCurrencies.has(value);
}

export function normalizeCurrency(value: unknown) {
  return isSupportedCurrency(value) ? value : DEFAULT_CURRENCY;
}

export function formatCurrency(
  amount: number,
  currency = DEFAULT_CURRENCY,
  locale = "en-US",
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
