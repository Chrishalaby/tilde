import { describe, expect, it } from 'vitest';
import { createOverlay, type DialogueView } from '../src/ui/overlay';

type Listener = (ev: FakeEvent) => void;

interface FakeEvent {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  target: FakeElement;
  prevented: boolean;
  preventDefault(): void;
}

class FakeElement {
  tagName: string;
  doc: FakeDocument;
  children: FakeElement[] = [];
  classes = new Set<string>();
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  props = new Map<string, string>();
  style = { setProperty: (key: string, value: string): void => void this.props.set(key, value), cssText: '' };
  id = '';
  value = '';
  type = '';
  placeholder = '';
  autocomplete = '';
  spellcheck = true;
  maxLength = -1;
  own = '';

  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
  }

  get ownerDocument(): FakeDocument {
    return this.doc;
  }

  get classList() {
    const set = this.classes;
    return {
      add: (...names: string[]) => names.forEach((name) => set.add(name)),
      remove: (...names: string[]) => names.forEach((name) => set.delete(name)),
      toggle: (name: string, force?: boolean) => {
        const on = force === undefined ? !set.has(name) : force;
        if (on) set.add(name);
        else set.delete(name);
        return on;
      },
      contains: (name: string) => set.has(name),
    };
  }

  get className(): string {
    return Array.from(this.classes).join(' ');
  }

  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  get textContent(): string {
    return this.children.length > 0 ? this.children.map((child) => child.textContent).join('') : this.own;
  }

  set textContent(value: string) {
    this.children = [];
    this.own = String(value);
  }

  set innerHTML(value: string) {
    this.children = [];
    this.own = value;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.doc.activeElement = this;
  }

  blur(): void {
    if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
  }

  fire(type: string, key = '', repeat = false): FakeEvent {
    const ev: FakeEvent = {
      key,
      repeat,
      isComposing: false,
      target: this,
      prevented: false,
      preventDefault() {
        ev.prevented = true;
      },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }

  find(cls: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      if (el.classes.has(cls)) out.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

class FakeDocument {
  head: FakeElement;
  body: FakeElement;
  documentElement: FakeElement;
  activeElement: FakeElement;

  constructor() {
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement = new FakeElement('html', this);
    this.activeElement = this.body;
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  getElementById(id: string): FakeElement | null {
    return this.head.children.find((child) => child.id === id) ?? null;
  }
}

function setup() {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  const overlay = createOverlay(root as unknown as HTMLElement);
  const panel = root.find('tilde-dialogue')[0];
  const input = root.find('td-input')[0];
  return { doc, root, overlay, panel, input };
}

function conversation(over: Partial<DialogueView> = {}): DialogueView {
  return {
    title: 'goshes · by the castle',
    speaker: 'goshes',
    lines: [
      { who: 'npc', text: 'good, another pair of feet on the path' },
      { who: 'player', text: 'where is the letter' },
    ],
    pending: true,
    ...over,
  };
}

describe('overlay dialogue', () => {
  it('shows the villager, the last exchanges and a waiting mark, and only it takes the mouse', () => {
    const { root, overlay, panel, input } = setup();
    expect(overlay.isDialogueOpen()).toBe(false);
    overlay.showDialogue(conversation(), { send: () => true, close: () => undefined });
    expect(overlay.isDialogueOpen()).toBe(true);
    expect(panel.classes.has('tilde-open')).toBe(true);
    expect(root.find('td-title')[0].textContent).toBe('goshes · by the castle');
    const lines = root.find('td-line').map((line) => line.textContent);
    expect(lines).toEqual(['goshesgood, another pair of feet on the path', 'youwhere is the letter', 'goshes…']);
    expect(input.maxLength).toBe(240);
    const style = String(root.doc.head.children[0].textContent);
    expect(style).toContain('.tilde-ui > .tilde-el { position: absolute; pointer-events: none;');
    expect(style).toContain('.tilde-ui > .tilde-el.tilde-dialogue {\n  pointer-events: auto;');
    const many = Array.from({ length: 20 }, (_, i) => ({ who: 'npc' as const, text: `line ${i}` }));
    overlay.showDialogue(conversation({ lines: many, pending: false }), { send: () => true, close: () => undefined });
    expect(root.find('td-line').map((line) => line.textContent)).toEqual([
      'goshesline 14', 'goshesline 15', 'goshesline 16', 'goshesline 17', 'goshesline 18', 'goshesline 19',
    ]);
  });

  it('sends on enter, keeps the words while the villager is still answering, and leaves on escape', () => {
    const { overlay, input, doc } = setup();
    const sent: string[] = [];
    let accept = false;
    let closed = 0;
    overlay.showDialogue(conversation(), {
      send: (text) => {
        sent.push(text);
        return accept;
      },
      close: () => {
        closed++;
      },
    });
    overlay.focusDialogue();
    expect(doc.activeElement).toBe(input);
    input.value = 'which way';
    expect(input.fire('keydown', 'Enter').prevented).toBe(true);
    expect(input.value).toBe('which way');
    accept = true;
    input.fire('keydown', 'Enter');
    expect(input.value).toBe('');
    expect(sent).toEqual(['which way', 'which way']);
    input.fire('keydown', 'Enter');
    expect(sent).toEqual(['which way', 'which way', '']);
    expect(input.fire('keydown', 'e', true).prevented).toBe(true);
    expect(input.fire('keydown', 'Enter', true).prevented).toBe(true);
    expect(sent.length).toBe(3);
    input.value = 'e';
    expect(input.fire('keydown', 'e', true).prevented).toBe(false);
    input.fire('keydown', 'Escape');
    expect(closed).toBe(1);
    overlay.hideDialogue();
    expect(overlay.isDialogueOpen()).toBe(false);
    expect(doc.activeElement).toBe(doc.body);
    expect(input.value).toBe('');
  });

  it('keeps the typing line focused when the panel itself is clicked', () => {
    const { overlay, panel, input, doc } = setup();
    overlay.showDialogue(conversation(), { send: () => true, close: () => undefined });
    doc.activeElement = doc.body;
    const ev = panel.fire('mousedown');
    expect(ev.prevented).toBe(true);
    expect(doc.activeElement).toBe(input);
  });

  it('shows and hides the talk prompt', () => {
    const { root, overlay } = setup();
    const prompt = root.find('tilde-prompt')[0];
    overlay.showPrompt('e — talk to goshes');
    expect(prompt.textContent).toBe('e — talk to goshes');
    expect(prompt.classes.has('tilde-on')).toBe(true);
    overlay.hidePrompt();
    expect(prompt.classes.has('tilde-on')).toBe(false);
  });

  it('draws the journal as a notebook and lists e in the controls', () => {
    const { root, overlay } = setup();
    overlay.showJournal({
      letters: new Set(['K']),
      places: [{ id: '0,0', kind: 'letter', letter: 'K', x: 0, z: -600, at: 1, day: 2 }],
      people: [{ id: 'person:a', type: 'person', name: 'goshes', home: 'by the castle', said: 'go well', day: 2, at: 2 }],
      traces: [{ id: 'trace:2:1,1', type: 'trace', kind: 2, x: 1, z: 1, day: 1, at: 3 }],
      startX: 0,
      startZ: 0,
      day: 2,
      walked: 1500,
    });
    const journal = root.find('tilde-journal')[0];
    expect(journal.classes.has('tilde-open')).toBe(true);
    expect(overlay.isPanelOpen()).toBe(true);
    const text = journal.children.map((line) => line.textContent);
    expect(text).toContain('1 of 26');
    expect(text).toContain('the letter k       600 m north         day 2');
    expect(text).toContain('“go well”');
    expect(text).toContain('a shipwreck');
    expect(text).toContain('day 2 · 1.5 km walked');
    expect(journal.children.map((line) => line.className)).toContain('tj-quote');
    const controls = root.find('tilde-grid').map((grid) => grid.textContent).join('\n');
    expect(controls).toMatch(/\ne +— {2}talk\n/);
  });
});
