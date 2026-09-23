const NAMED: Record<string, string> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  ' ': 'Space',
  Escape: 'Escape',
  Shift: 'ShiftLeft',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

export function keyCode(ev: KeyboardEvent): string {
  if (ev.code) return ev.code;
  const key = ev.key;
  if (!key) return '';
  if (NAMED[key]) return NAMED[key];
  if (key.length === 1 && /[a-z]/i.test(key)) return 'Key' + key.toUpperCase();
  return key;
}
