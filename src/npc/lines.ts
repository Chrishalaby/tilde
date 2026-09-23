import { MATERIAL } from '../config';
import type { Landmark } from '../world/types';
import type { Npc, NpcWorld, Temperament } from './types';

type Phase = 'dawn' | 'morning' | 'noon' | 'dusk' | 'night';
type Ground = 'grass' | 'forest' | 'stone' | 'sand' | 'snow' | 'water' | 'bare';

interface Hint {
  dir: string;
  dist: string;
  wet: boolean;
  thing: string;
}

interface Facts {
  phase: Phase;
  ground: Ground;
  hint: Hint | null;
  homeLetter: string | null;
  found: number;
  tone: Temperament;
}

export interface SpeechFacts {
  phase: Phase;
  ground: Ground;
  hint: string;
  lettersFound: number;
}

interface Template {
  tone: Temperament | null;
  weight: number;
  ok(f: Facts): boolean;
  say(f: Facts): string;
}

const HINT_RADIUS = 900;
const WATER_LEVEL = 0.5;
const CROSS_SAMPLES = 8;
const MAX_LENGTH = 90;
const FALLBACK = 'it is quiet, that is the whole of it';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const COUNTS = [
  'none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
  'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six',
];

function countWord(n: number): string {
  return n >= 0 && n < COUNTS.length ? COUNTS[n] : String(n);
}

function phaseOf(t: number): Phase {
  const d = t - Math.floor(t);
  if (d >= 0.22 && d < 0.32) return 'dawn';
  if (d >= 0.32 && d < 0.46) return 'morning';
  if (d >= 0.46 && d < 0.64) return 'noon';
  if (d >= 0.64 && d < 0.8) return 'dusk';
  return 'night';
}

function groundOf(material: number): Ground {
  if (material === MATERIAL.GRASS) return 'grass';
  if (material === MATERIAL.FOREST) return 'forest';
  if (material === MATERIAL.STONE) return 'stone';
  if (material === MATERIAL.SAND) return 'sand';
  if (material === MATERIAL.SNOW) return 'snow';
  if (material === MATERIAL.WATER) return 'water';
  return 'bare';
}

function compassOf(dx: number, dz: number): string {
  const angle = Math.atan2(dx, -dz);
  const step = Math.round(angle / (Math.PI / 4));
  return COMPASS[((step % 8) + 8) % 8];
}

function distanceWord(d: number): string {
  if (d < 120) return 'close';
  if (d < 350) return 'a short walk';
  if (d < 650) return 'a long walk';
  return 'far';
}

function thingWord(kind: string): string {
  if (kind === 'letter') return 'a tall one';
  if (kind === 'ring') return 'a ring of stones';
  if (kind === 'tree') return 'an old tree';
  if (kind === 'pool') return 'a still pool';
  if (kind === 'shelter') return 'a low shelter';
  return 'something standing';
}

function crossesWater(world: NpcWorld, x0: number, z0: number, x1: number, z1: number): boolean {
  for (let i = 1; i <= CROSS_SAMPLES; i++) {
    const t = i / (CROSS_SAMPLES + 1);
    if (world.heightAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) < WATER_LEVEL) return true;
  }
  return false;
}

function hintFor(npc: Npc, world: NpcWorld): Hint | null {
  const marks = world.landmarksNear(npc.x, npc.z, HINT_RADIUS);
  let best: Landmark | null = null;
  let bestD = HINT_RADIUS * HINT_RADIUS;
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.regionKey === npc.homeKey) continue;
    if (world.discovered(mark.regionKey)) continue;
    const dx = mark.x - npc.x;
    const dz = mark.z - npc.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD) continue;
    bestD = d2;
    best = mark;
  }
  if (!best) return null;
  return {
    dir: compassOf(best.x - npc.x, best.z - npc.z),
    dist: distanceWord(Math.sqrt(bestD)),
    wet: crossesWater(world, npc.x, npc.z, best.x, best.z),
    thing: thingWord(best.kind),
  };
}

export function homeLetterFor(npc: Npc, world: NpcWorld): string | null {
  const marks = world.landmarksNear(npc.homeX, npc.homeZ, 24);
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.regionKey !== npc.homeKey) continue;
    if (mark.kind !== 'letter' || !mark.letter) return null;
    return mark.letter.toLowerCase();
  }
  return null;
}

function hintText(hint: Hint | null): string {
  if (!hint) return '';
  const wet = hint.wet ? ', water in the way' : '';
  return `${hint.thing} to the ${hint.dir}, ${hint.dist}${wet}`;
}

export function gatherFacts(npc: Npc, world: NpcWorld): SpeechFacts {
  const view = world.player();
  return {
    phase: phaseOf(world.timeOfDay()),
    ground: groundOf(world.materialAt(view.x, view.z)),
    hint: hintText(hintFor(npc, world)),
    lettersFound: view.lettersFound.size,
  };
}

function gather(npc: Npc, world: NpcWorld): Facts {
  const base = gatherFacts(npc, world);
  return {
    phase: base.phase,
    ground: base.ground,
    hint: hintFor(npc, world),
    homeLetter: homeLetterFor(npc, world),
    found: base.lettersFound,
    tone: npc.temperament,
  };
}

function atPhase(phase: Phase): (f: Facts) => boolean {
  return (f) => f.phase === phase;
}

function onGround(ground: Ground): (f: Facts) => boolean {
  return (f) => f.ground === ground;
}

const always = (): boolean => true;
const wetHint = (f: Facts): boolean => f.hint !== null && f.hint.wet;
const dryHint = (f: Facts): boolean => f.hint !== null && !f.hint.wet;

const TEMPLATES: Template[] = [
  { tone: null, weight: 2, ok: atPhase('dawn'), say: () => 'the light comes back slow here, it always has' },
  { tone: null, weight: 2, ok: atPhase('dawn'), say: () => 'i am usually up before the birds, i like the gap' },
  { tone: null, weight: 2, ok: atPhase('dawn'), say: () => 'the grass is wet through until the sun clears the low ground' },
  { tone: 'cheerful', weight: 2, ok: atPhase('dawn'), say: () => 'the day is new and i have not spoiled it yet' },
  { tone: null, weight: 2, ok: atPhase('morning'), say: () => 'the shade goes off the field about now' },
  { tone: null, weight: 2, ok: atPhase('morning'), say: () => 'i walked the same line this morning as every morning' },
  { tone: 'curious', weight: 2, ok: atPhase('morning'), say: () => 'i went a little further than usual today and came back anyway' },
  { tone: null, weight: 2, ok: atPhase('noon'), say: () => 'shadows are short and everything looks plain' },
  { tone: null, weight: 2, ok: atPhase('noon'), say: () => 'nothing much happens at midday, it is the best part' },
  { tone: null, weight: 2, ok: atPhase('noon'), say: () => 'the heat sits in the stone until the evening lets it go' },
  { tone: null, weight: 2, ok: atPhase('dusk'), say: () => 'the light goes orange and then it goes' },
  { tone: null, weight: 2, ok: atPhase('dusk'), say: () => 'i head back when the far ridge turns grey' },
  { tone: null, weight: 2, ok: atPhase('dusk'), say: () => 'we light the fire before it is properly dark' },
  { tone: null, weight: 2, ok: atPhase('night'), say: () => 'at night we sit by the fire and do not say much' },
  { tone: null, weight: 2, ok: atPhase('night'), say: () => 'the stars come out in the same places, i have checked' },
  { tone: null, weight: 2, ok: atPhase('night'), say: () => 'you can hear water further at night than in the day' },
  { tone: null, weight: 2, ok: atPhase('night'), say: () => 'stay near the fire, the cold comes up out of the ground' },

  { tone: null, weight: 2, ok: onGround('grass'), say: () => 'the grass here is short because we walk it' },
  { tone: null, weight: 2, ok: onGround('grass'), say: () => 'grass all the way out, and then more grass' },
  { tone: null, weight: 2, ok: onGround('forest'), say: () => 'under the trees it is always a little earlier in the day' },
  { tone: null, weight: 2, ok: onGround('forest'), say: () => 'the trees hold the sound in, you go quiet without meaning to' },
  { tone: null, weight: 2, ok: onGround('stone'), say: () => 'stone underfoot means the water went somewhere else' },
  { tone: null, weight: 2, ok: onGround('stone'), say: () => 'the stone up here keeps the last of the sun' },
  { tone: null, weight: 2, ok: onGround('sand'), say: () => 'sand does not remember a footprint for long' },
  { tone: null, weight: 2, ok: onGround('sand'), say: () => 'you are standing on old shore, it was wider once' },
  { tone: null, weight: 2, ok: onGround('snow'), say: () => 'the snow squeaks up here when it is cold enough' },
  { tone: null, weight: 2, ok: onGround('snow'), say: () => 'everything is one colour up here and i do not mind it' },
  { tone: null, weight: 2, ok: onGround('water'), say: () => 'you are in the water, it is colder than it looks' },
  { tone: null, weight: 2, ok: onGround('water'), say: () => 'water finds the low ground and then it stays there' },
  { tone: null, weight: 2, ok: onGround('bare'), say: () => 'nothing grows on this part, it has been tried' },

  { tone: null, weight: 3, ok: wetHint, say: (f) => `there is ${f.hint!.thing} to the ${f.hint!.dir}, ${f.hint!.dist}, and water in the way` },
  { tone: null, weight: 3, ok: wetHint, say: (f) => `i have seen ${f.hint!.thing} ${f.hint!.dir}, ${f.hint!.dist}, with water between` },
  { tone: null, weight: 3, ok: wetHint, say: (f) => `${f.hint!.thing} lies ${f.hint!.dir}, ${f.hint!.dist}, and you will cross water` },
  { tone: null, weight: 2, ok: wetHint, say: (f) => `go ${f.hint!.dir} for ${f.hint!.thing}, ${f.hint!.dist}, but the water is first` },
  { tone: null, weight: 2, ok: wetHint, say: (f) => `${f.hint!.dist} ${f.hint!.dir} there is ${f.hint!.thing}, past water` },
  { tone: null, weight: 3, ok: dryHint, say: (f) => `there is ${f.hint!.thing} ${f.hint!.dir} of here, ${f.hint!.dist} on dry ground` },
  { tone: null, weight: 3, ok: dryHint, say: (f) => `if you go ${f.hint!.dir} you will come to ${f.hint!.thing}, ${f.hint!.dist}` },
  { tone: null, weight: 3, ok: dryHint, say: (f) => `${f.hint!.thing} stands ${f.hint!.dir} of here, ${f.hint!.dist} if you keep dry` },
  { tone: null, weight: 2, ok: dryHint, say: (f) => `${f.hint!.dist} ${f.hint!.dir} of here, ${f.hint!.thing}, nothing in between` },
  { tone: null, weight: 2, ok: dryHint, say: (f) => `keep ${f.hint!.dir} and you will find ${f.hint!.thing}, ${f.hint!.dist}` },

  { tone: null, weight: 3, ok: (f) => f.homeLetter !== null, say: () => 'the big letter behind me is the only one i know' },
  { tone: null, weight: 3, ok: (f) => f.homeLetter !== null, say: (f) => `i was born under the letter ${f.homeLetter} and i have not left it` },
  { tone: null, weight: 2, ok: (f) => f.homeLetter !== null, say: () => 'the letter does not mean anything to us, it is the shape we live under' },
  { tone: 'wistful', weight: 3, ok: (f) => f.homeLetter !== null, say: (f) => `my whole life is one letter wide and the letter is ${f.homeLetter}` },

  { tone: null, weight: 3, ok: (f) => f.found === 0, say: () => 'you have not seen any of the letters yet, that will change' },
  { tone: null, weight: 3, ok: (f) => f.found === 1, say: () => 'you have seen one of the letters, i have only seen mine' },
  { tone: null, weight: 3, ok: (f) => f.found > 1 && f.found < 8, say: (f) => `you have seen ${countWord(f.found)} of the letters, i have only seen mine` },
  { tone: null, weight: 3, ok: (f) => f.found >= 8, say: (f) => `${countWord(f.found)} letters, you have walked further than anyone i know` },

  { tone: 'curious', weight: 3, ok: always, say: () => 'i keep meaning to walk past the ridge and i keep not doing it' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'you came from somewhere, i can tell by the way you stand' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'i count things, it is not a useful habit' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'there are letters i have only heard about, i think about them' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'i am not much for talking, but you can stand here' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'we do not say much out here, there is not the need' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'it is quiet, that is the whole of it' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'stay as long as you like, i will not ask you anything' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'someone else used to stand about where you are standing' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'i think the world is bigger than the part i got' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'i will be here when you come back, if you come back' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'the light was better when i was younger, or i was' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'good, another pair of feet on the path' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'it is a fine day for going nowhere in particular' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'you are the second good thing today, the first was a bird' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'come by the fire tonight, we keep it going till late' },
];

export function composeLine(npc: Npc, world: NpcWorld, rng: () => number): string {
  const facts = gather(npc, world);
  const pool: Template[] = [];
  let total = 0;
  for (let i = 0; i < TEMPLATES.length; i++) {
    const template = TEMPLATES[i];
    if (template.tone !== null && template.tone !== facts.tone) continue;
    if (!template.ok(facts)) continue;
    pool.push(template);
    total += template.weight;
  }
  if (pool.length === 0) return FALLBACK;
  for (let attempt = 0; attempt < 4; attempt++) {
    let roll = rng() * total;
    let chosen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll < 0) {
        chosen = pool[i];
        break;
      }
    }
    const text = chosen.say(facts);
    if (text.length < MAX_LENGTH) return text;
  }
  return FALLBACK;
}
