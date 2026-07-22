import { useCallback, useSyncExternalStore } from "react";

export type Locale = "en" | "zh";

export const LOCALE_STORAGE_KEY = "nalanda-locale";

const listeners = new Set<() => void>();

function storedLocale(): Locale | null {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return null;
  const value = localStorage.getItem(LOCALE_STORAGE_KEY);
  return value === "zh" || value === "en" ? value : null;
}

let locale: Locale = storedLocale() || "en";

function applyDocumentLanguage(value: Locale) {
  if (typeof document !== "undefined") document.documentElement.lang = value === "zh" ? "zh-CN" : "en";
}

applyDocumentLanguage(locale);

export function getLocale(): Locale {
  return locale;
}

export function hasStoredLocale(): boolean {
  return storedLocale() !== null;
}

export function setLocale(value: Locale, options: { persist?: boolean } = {}) {
  const next: Locale = value === "zh" ? "zh" : "en";
  if (options.persist !== false && typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") localStorage.setItem(LOCALE_STORAGE_KEY, next);
  applyDocumentLanguage(next);
  if (locale === next) return;
  locale = next;
  listeners.forEach((listener) => listener());
}

export function toggleLocale() {
  setLocale(locale === "en" ? "zh" : "en");
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localize(english: string, chinese: string, value: Locale = locale) {
  return value === "zh" ? chinese : english;
}

export function localeTag(value: Locale = locale) {
  return value === "zh" ? "zh-CN" : "en-US";
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeTag(), options).format(value);
}

export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(localeTag(), options).format(new Date(value));
}

export function formatDateTime(value: string | number | Date) {
  return formatDate(value, { dateStyle: "medium", timeStyle: "short" });
}

export function useI18n() {
  const current = useSyncExternalStore(subscribeLocale, getLocale, () => "en" as Locale);
  const l = useCallback((english: string, chinese: string) => localize(english, chinese, current), [current]);
  return {
    locale: current,
    l,
    setLocale,
    toggleLocale,
    languageLabel: current === "en" ? "中文" : "EN",
  };
}
