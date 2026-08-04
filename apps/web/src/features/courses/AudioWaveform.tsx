const BAR_COUNT = 40;

export function AudioWaveform({ levels, label }: {
  levels: number[];
  label: string;
}) {
  const visible = levels.slice(-BAR_COUNT);
  const bars = [
    ...Array.from({ length: Math.max(0, BAR_COUNT - visible.length) }, () => 0),
    ...visible,
  ];
  return <div className="course-audio-waveform" role="img" aria-label={label}>
    <span className="course-audio-waveform-dot" aria-hidden="true" />
    <span className="course-audio-waveform-bars" aria-hidden="true">
      {bars.map((level, index) => <i
        key={index}
        style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, level))})` }}
      />)}
    </span>
  </div>;
}
