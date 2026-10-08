const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** Cached Intl.NumberFormat: building one is slow on Hermes and money lists format many rows. */
export function numberFormat(locale: string | undefined, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale ?? ""}|${options ? JSON.stringify(options) : ""}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, formatter);
  }
  return formatter;
}

/** Cached Intl.DateTimeFormat, keyed by locale and options. */
export function dateTimeFormat(locale: string | undefined, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${options ? JSON.stringify(options) : ""}`;
  let formatter = dateTimeFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, formatter);
  }
  return formatter;
}
