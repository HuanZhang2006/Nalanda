import { useI18n } from "../../i18n";

export function CourseLocaleButton() {
  const { l, toggleLocale, languageLabel } = useI18n();
  const label = l("Switch to Chinese", "切换到英文");
  return <button className="btn btn-sm" type="button" onClick={toggleLocale} title={label} aria-label={label}>
    {languageLabel}
  </button>;
}
