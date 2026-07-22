import { useI18n } from "../../i18n";
import { vocabularyParseErrorMessage, type VocabularyParseError } from "./parser";

export function VocabularyErrorList({ errors }: { errors: VocabularyParseError[] }) {
  const { l, locale } = useI18n();
  if (!errors.length) return null;
  return <div className="course-errors" role="alert">{errors.map((entry, index) => {
    const start = Math.max(0, entry.column - 1);
    const end = start + entry.length;
    return <div className="course-error-line" key={`${entry.line}-${entry.code}-${index}`}>
      <b>{l(`Line ${entry.line}`, `第 ${entry.line} 行`)}</b>
      <div>
        <span>{entry.source.slice(0, start)}</span><mark>{entry.source.slice(start, end) || "␠"}</mark><span>{entry.source.slice(end)}</span>
        <div style={{ color: "var(--pink)" }}>{entry.code}: {vocabularyParseErrorMessage(entry, locale)}</div>
      </div>
    </div>;
  })}</div>;
}
