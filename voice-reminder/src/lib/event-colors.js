// Presentation-only colours. rgba works in older Android WebViews too.
export function eventCardStyle(color) {
  const valid = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  const normalized = valid ? color.toLowerCase() : '#146ad4';
  const rgb = [1, 3, 5].map(i => parseInt(normalized.slice(i, i + 2), 16));
  return {
    '--event-color': normalized,
    '--event-tint': `rgba(${rgb.join(', ')}, 0.14)`,
    '--event-tint-soft': `rgba(${rgb.join(', ')}, 0.06)`,
  };
}
