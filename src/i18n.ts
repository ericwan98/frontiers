// English or French, picked once per page load: switching stores the choice and reloads.
export type Lang = "en" | "fr";

const LANG_KEY = "frontiers:lang";
/** Set just before a reload for a language switch: the page reopens on the map it was on. */
export const SWITCHED_KEY = "frontiers:lang-switched";

function initial(): Lang {
  // Tests run without a page, in English.
  if (typeof document === "undefined") return "en";
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === "en" || stored === "fr") return stored;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const lang: Lang = initial();

/** The text in the page's language: `tr("Skip", "Passer")`. */
export const tr = <T>(en: T, fr: T): T => (lang === "fr" ? fr : en);

const locale = tr("en", "fr");

export const num = (n: number, digits = 0) =>
  n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A percentage of `share` (0..1), as "35%" or "35 %". */
export const percent = (share: number, digits = 0) => `${num(share * 100, digits)}${tr("%", " %")}`;

export function setLang(next: Lang): void {
  localStorage.setItem(LANG_KEY, next);
  sessionStorage.setItem(SWITCHED_KEY, "1");
  location.reload();
}
