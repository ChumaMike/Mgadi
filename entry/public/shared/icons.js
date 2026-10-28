// One small icon set, drawn here so the interface looks the same everywhere and needs no download.
// Icons are decoration only: they are hidden from screen readers (aria-hidden) and every control keeps a text label.
// Built with DOM calls, never by parsing markup from a string, so the strict content security policy still applies.
const NS = 'http://www.w3.org/2000/svg';

// Each icon is a list of drawing steps on a 24 x 24 grid: ['path', d] or ['circle', cx, cy, r] or ['rect', x, y, w, h, rx].
const ICONS = {
  check: [['rect', 5, 4, 14, 17, 2], ['path', 'M9 3h6v3H9z'], ['path', 'M9 14l2 2 4-4']],
  alert: [['path', 'M10.3 4.2l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.8l-8-14a2 2 0 0 0-3.4 0z'], ['path', 'M12 9.5v4'], ['path', 'M12 17.2h.01']],
  money: [['rect', 2.5, 6, 19, 12, 2], ['circle', 12, 12, 2.6], ['path', 'M6 9.5h.01M18 14.5h.01']],
  lock: [['rect', 5, 11, 14, 9.5, 2], ['path', 'M8 11V8a4 4 0 0 1 8 0v3']],
  mail: [['rect', 3, 5, 18, 14, 2], ['path', 'M3.5 7.5L12 13l8.5-5.5']],
  link: [['path', 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'], ['path', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1']],
  help: [['circle', 12, 12, 9], ['path', 'M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8'], ['path', 'M12 16.8h.01']],
  mic: [['rect', 9, 3, 6, 11, 3], ['path', 'M5.5 11a6.5 6.5 0 0 0 13 0'], ['path', 'M12 17.5V21']],
  file: [['path', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'], ['path', 'M14 3v5h5'], ['path', 'M9 13h6M9 17h6']],
  pack: [['path', 'M4 8l8-4 8 4v8l-8 4-8-4z'], ['path', 'M4 8l8 4 8-4'], ['path', 'M12 12v8']],
  resume: [['circle', 12, 12, 9], ['path', 'M10 8.5l5 3.5-5 3.5z']],
  settings: [['path', 'M4 7h9M17 7h3M4 17h3M11 17h9'], ['circle', 15, 7, 2], ['circle', 9, 17, 2]],
  bank: [['path', 'M3 10l9-6 9 6'], ['path', 'M5.5 10v7M10 10v7M14 10v7M18.5 10v7'], ['path', 'M3 20.5h18']],
  arrow: [['path', 'M5 12h14'], ['path', 'M13 6l6 6-6 6']],
  tick: [['path', 'M5 12.5l4.5 4.5L19 7.5']],
  cross: [['path', 'M6 6l12 12M18 6L6 18']],
};

export function icon(name, className = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name}${className ? ` ${className}` : ''}`);
  for (const [kind, ...args] of ICONS[name] ?? ICONS.help) {
    const part = document.createElementNS(NS, kind === 'path' ? 'path' : kind);
    if (kind === 'path') part.setAttribute('d', args[0]);
    else if (kind === 'circle') { part.setAttribute('cx', args[0]); part.setAttribute('cy', args[1]); part.setAttribute('r', args[2]); }
    else { part.setAttribute('x', args[0]); part.setAttribute('y', args[1]); part.setAttribute('width', args[2]); part.setAttribute('height', args[3]); part.setAttribute('rx', args[4] ?? 0); }
    svg.append(part);
  }
  return svg;
}

export const iconNames = Object.keys(ICONS);
