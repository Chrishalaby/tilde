import { MATERIAL } from '../config';
import type { Landmark } from '../world/types';
import type { ChatTurn, Npc, NpcWorld, Temperament } from './types';

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
  name: string;
  glyph: string;
  place: string;
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
const HOME_RADIUS = 24;
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
  if (kind === 'castle') return 'a castle';
  if (kind === 'ring') return 'a ring of stones';
  if (kind === 'tree') return 'an old tree';
  if (kind === 'pool') return 'a still pool';
  if (kind === 'shelter') return 'a low shelter';
  return 'something standing';
}

export function placePhrase(kind: string, letter: string | null): string {
  if (kind === 'letter') return letter ? `under the letter ${letter.toLowerCase()}` : 'under the big letter';
  if (kind === 'castle') return 'by the castle';
  if (kind === 'ring') return 'by the stone ring';
  if (kind === 'shelter') return 'at the shelter';
  if (kind === 'tree') return 'by the lone tree';
  if (kind === 'pool') return 'by the still pool';
  return 'near here';
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

function homeOf(npc: Npc, world: NpcWorld): Landmark | null {
  const marks = world.landmarksNear(npc.homeX, npc.homeZ, HOME_RADIUS);
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].regionKey === npc.homeKey) return marks[i];
  }
  return null;
}

function letterOf(home: Landmark | null): string | null {
  if (!home || home.kind !== 'letter' || !home.letter) return null;
  return home.letter.toLowerCase();
}

export function homeLetterFor(npc: Npc, world: NpcWorld): string | null {
  return letterOf(homeOf(npc, world));
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

function gather(npc: Npc, world: NpcWorld, homeKind = ''): Facts {
  const base = gatherFacts(npc, world);
  const home = homeOf(npc, world);
  const homeLetter = letterOf(home);
  return {
    phase: base.phase,
    ground: base.ground,
    hint: hintFor(npc, world),
    homeLetter,
    found: base.lettersFound,
    tone: npc.temperament,
    name: npc.name.toLowerCase(),
    glyph: npc.glyph.toLowerCase(),
    place: placePhrase(home ? home.kind : homeKind, homeLetter),
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
const hasHome = (f: Facts): boolean => f.homeLetter !== null;

const TIME_LINES: Template[] = [
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
];

const GROUND_LINES: Template[] = [
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
];

const HINT_LINES: Template[] = [
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
];

const HOME_LINES: Template[] = [
  { tone: null, weight: 3, ok: hasHome, say: () => 'the big letter behind me is the only one i know' },
  { tone: null, weight: 3, ok: hasHome, say: (f) => `i was born under the letter ${f.homeLetter} and i have not left it` },
  { tone: null, weight: 2, ok: hasHome, say: () => 'the letter does not mean anything to us, it is the shape we live under' },
  { tone: 'wistful', weight: 3, ok: hasHome, say: (f) => `my whole life is one letter wide and the letter is ${f.homeLetter}` },
];

const COUNT_LINES: Template[] = [
  { tone: null, weight: 3, ok: (f) => f.found === 0, say: () => 'you have not seen any of the letters yet, that will change' },
  { tone: null, weight: 3, ok: (f) => f.found === 1, say: () => 'you have seen one of the letters, i have only seen mine' },
  { tone: null, weight: 3, ok: (f) => f.found > 1 && f.found < 8, say: (f) => `you have seen ${countWord(f.found)} of the letters, i have only seen mine` },
  { tone: null, weight: 3, ok: (f) => f.found >= 8, say: (f) => `${countWord(f.found)} letters, you have walked further than anyone i know` },
];

const IDLE_LINES: Template[] = [
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

const TEMPLATES: Template[] = TIME_LINES.concat(GROUND_LINES, HINT_LINES, HOME_LINES, COUNT_LINES, IDLE_LINES);

const OPEN_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: (f) => `hello, i am ${f.name}, i live ${f.place}` },
  { tone: null, weight: 2, ok: always, say: (f) => `i am ${f.name}, i do not think we have met` },
  { tone: 'cheerful', weight: 3, ok: always, say: (f) => `hello, i am ${f.name}, it is good to see a new face` },
  { tone: 'quiet', weight: 3, ok: always, say: (f) => `i am ${f.name}, you can stand here if you like` },
  { tone: 'wistful', weight: 3, ok: always, say: (f) => `i am ${f.name}, i was hoping someone would come this way` },
  { tone: 'curious', weight: 3, ok: always, say: (f) => `i am ${f.name}, you are not from round here, are you` },
];

const MET_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: () => 'you came back, i thought you might' },
  { tone: null, weight: 3, ok: always, say: () => 'i know you, you stood here before' },
  { tone: null, weight: 2, ok: always, say: () => 'back again, the path must have brought you round' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'you again, good, i hoped you would come by' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'you came back, not many do' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'you again, stand here as long as you like' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'you came back, tell me where you got to' },
];

const GREET_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: (f) => `hello to you too, i am ${f.name}` },
  { tone: null, weight: 2, ok: always, say: (f) => `hello, i am ${f.name}, i live ${f.place}` },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'hello, good, another pair of feet on the path' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'hello, it is quiet here, that suits me' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'hello, it has been a while since anyone said that to me' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'hello, where have you come from' },
];

const NAME_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: (f) => `i am ${f.name}, i live ${f.place}` },
  { tone: null, weight: 2, ok: always, say: (f) => `my name is ${f.name}, but ${f.glyph} will do` },
  { tone: 'quiet', weight: 3, ok: always, say: (f) => `${f.name}, that is all there is to it` },
  { tone: 'cheerful', weight: 3, ok: always, say: (f) => `i am ${f.name}, and you are welcome here` },
];

const LIVE_LINES: Template[] = HOME_LINES.concat([
  { tone: null, weight: 3, ok: always, say: (f) => `i live ${f.place}, i have not lived anywhere else` },
  { tone: null, weight: 3, ok: always, say: (f) => `home is ${f.place}, it is enough for me` },
  { tone: 'wistful', weight: 3, ok: always, say: (f) => `i have always lived ${f.place}, i think i always will` },
]);

const BYE_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: () => 'go well, the path will still be here' },
  { tone: null, weight: 3, ok: always, say: (f) => `go on then, i will be ${f.place}` },
  { tone: null, weight: 2, ok: always, say: () => 'come back when the light is better' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'go well' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'go well, and come by the fire some night' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'go on, i will wonder where you got to' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'go on, and come and tell me what you find' },
];

const THANKS_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: () => 'it was only talk, it costs nothing' },
  { tone: null, weight: 3, ok: always, say: () => 'you are welcome to it' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'no need, i like to be asked' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'it is nothing' },
];

const LOST_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: () => 'you have seen everything near here, you will have to walk further' },
  { tone: null, weight: 3, ok: always, say: () => 'i do not know of anything close that you have not found' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'past what i know there is more, there is always more' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'i only know the part near home, and you have seen it' },
];

const WELL_LINES: Template[] = [
  { tone: null, weight: 3, ok: always, say: () => 'well enough, the days are much the same' },
  { tone: null, weight: 2, ok: always, say: () => 'i am as i was yesterday, which is fine' },
  { tone: 'cheerful', weight: 3, ok: always, say: () => 'very well, thank you for asking' },
  { tone: 'quiet', weight: 3, ok: always, say: () => 'well, thank you' },
  { tone: 'wistful', weight: 3, ok: always, say: () => 'i am all right, a little behind the day' },
  { tone: 'curious', weight: 3, ok: always, say: () => 'well, and you look like you have walked a long way' },
];

const ASKS_BYE = /\b(bye|goodbye|farewell|see you|so long|good night|goodnight|take care|i must go|i have to go)\b/;
const ASKS_THANKS = /\b(thanks|thank|cheers|grateful)\b/;
const ASKS_NAME = /\b(your name|who are you|what are you called|what do they call you|name)\b/;
const ASKS_WELL = /\b(how are you|how are things|how is it going|how do you do|are you well|are you ok|are you okay)\b/;
const ASKS_LIVE = /\b(where do you live|do you live|live here|your home|home|where are you from|live)\b/;
const ASKS_COUNT = /\b(how many|how much have i|count)\b/;
const ASKS_WAY = /\b(where|wheres|which way|way|direction|directions|find|lost|go next|look for|looking for|letter|letters|landmark|castle|castles|ring|pool|tree|shelter|explore|nearby|anything)\b/;
const ASKS_GREET = /\b(hi|hello|hey|hiya|howdy|greetings|good morning|good evening|good afternoon|good day)\b/;
const ASKS_TIME = /\b(time|night|day|dark|sun|dawn|dusk|morning|evening|noon|light|sky|stars|moon|weather)\b/;
const ASKS_GROUND = /\b(grass|forest|woods|trees|stone|stones|rock|sand|beach|snow|water|sea|ground)\b/;

function choose(pool: Template[], facts: Facts, rng: () => number): string | null {
  const open: Template[] = [];
  let total = 0;
  for (let i = 0; i < pool.length; i++) {
    const template = pool[i];
    if (template.tone !== null && template.tone !== facts.tone) continue;
    if (!template.ok(facts)) continue;
    open.push(template);
    total += template.weight;
  }
  if (open.length === 0) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let roll = rng() * total;
    let chosen = open[open.length - 1];
    for (let i = 0; i < open.length; i++) {
      roll -= open[i].weight;
      if (roll < 0) {
        chosen = open[i];
        break;
      }
    }
    const text = chosen.say(facts);
    if (text.length < MAX_LENGTH) return text;
  }
  return null;
}

export function composeLine(npc: Npc, world: NpcWorld, rng: () => number): string {
  return choose(TEMPLATES, gather(npc, world), rng) ?? FALLBACK;
}

function plain(message: string): string {
  return message.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function poolFor(said: string, facts: Facts, turn: ChatTurn): Template[] {
  if (said.length === 0) {
    const opening = turn.history.length === 0;
    if (opening) return turn.metBefore ? MET_LINES : OPEN_LINES;
    return TEMPLATES;
  }
  if (ASKS_BYE.test(said)) return BYE_LINES;
  if (ASKS_THANKS.test(said)) return THANKS_LINES;
  if (ASKS_NAME.test(said)) return NAME_LINES;
  if (ASKS_WELL.test(said)) return WELL_LINES;
  if (ASKS_LIVE.test(said)) return LIVE_LINES;
  if (ASKS_COUNT.test(said)) return COUNT_LINES;
  if (ASKS_WAY.test(said)) return facts.hint ? HINT_LINES : LOST_LINES;
  if (ASKS_GREET.test(said)) return turn.metBefore ? MET_LINES : GREET_LINES;
  if (ASKS_TIME.test(said)) return TIME_LINES;
  if (ASKS_GROUND.test(said)) return GROUND_LINES;
  return TEMPLATES;
}

export function replyLine(npc: Npc, world: NpcWorld, turn: ChatTurn, rng: () => number): string {
  const facts = gather(npc, world, turn.homeKind);
  const pool = poolFor(plain(turn.message), facts, turn);
  return choose(pool, facts, rng) ?? choose(TEMPLATES, facts, rng) ?? FALLBACK;
}
