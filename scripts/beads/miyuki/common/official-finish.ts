/**
 * Reads the "Glass Type / Finish" phrase of Miyuki's official Delica list (`durability.tsv`) as round-
 * rocaille attributes in the directory's vocabulary, for a seed twin (`Seed#`) the list names but the
 * directory does not carry (issue #203, batch e).
 *
 * The phrase is Miyuki's own (`Silver Lined - Dyed`, `Qpaque - AB` with the list's typo, `Galvanized -
 * Dyed`); the vocabulary is the directory's (`Outside-Dyed, Silverline`, `Rainbow`). Terms the
 * directory does not record are left out the way it leaves them out: "Semi Matte" (the directory files
 * the catalogue's Silverlined Semi Frost Dyed colours as `Outside-Dyed, Silverline`). A phrase with a
 * term this table does not know throws, so nothing is guessed.
 */
import { joinAttributeTerms } from './directory-products.js';

export type OfficialAttributes = { glassGroup: string; finish: string; dyed: string; galvanized: string; plating: string };

const GLASS = new Map([
  ['transparent', 'Transparent'],
  ['opaque', 'Opaque'],
  ['alabaster', 'Alabaster'],
  ['ceylon', 'Alabaster'],
  ['silk', 'Silk'],
]);

/** The glass a phrase implies when it names none: the directory's glass for colours of that kind. */
const IMPLIED_GLASS = new Map([
  ['silver lined', 'Transparent'],
  ['galvanized', 'Transparent'],
  ['color lined', 'Transparent'],
  ['metallic', 'Opaque'],
]);

const FINISH = new Map<string, { finish?: string; dyed?: string; galvanized?: string }>([
  ['silver lined', { finish: 'Silverline' }],
  ['dyed', { finish: 'Outside-Dyed', dyed: 'Outside Dyed' }],
  ['ab', { finish: 'Rainbow' }],
  ['rainbow', { finish: 'Rainbow' }],
  ['luster', { finish: 'Luster' }],
  ['gold luster', { finish: 'Gold Luster' }],
  ['glazed luster', { finish: 'Glazed Luster' }],
  ['galvanized', { finish: 'Galvanized', galvanized: 'Galvanized' }],
  ['color lined', { finish: 'Color-Lined', dyed: 'Color-Lined' }],
  ['glass enamel', { finish: 'Glass enamel' }],
  ['metallic', { finish: 'Metallic' }],
  ['matte', { finish: 'Frosted (Matte)' }],
  ['semi matte', {}],
]);

/** A phrase this table cannot read: `term` is the unknown term, or null when the phrase names no glass. */
export class OfficialFinishError extends Error {
  constructor(message: string, readonly term: string | null) {
    super(message);
    this.name = 'OfficialFinishError';
  }
}

/** Splits `Matte Opaque - Gold Luster - AB` into its terms: `matte`, `opaque`, `gold luster`, `ab`. */
export function officialFinishTerms(text: string): string[] {
  const normalised = text
    .replace(/\bQpaque\b/gi, 'Opaque')
    .replace(/\bLuste\b/gi, 'Luster')
    .replace(/\bColor-Lined\b/gi, 'Color Lined');
  const terms: string[] = [];
  for (const raw of normalised.split('-')) {
    let part = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!part) continue;
    for (const prefix of ['semi matte', 'matte']) {
      if (part === prefix || part.startsWith(`${prefix} `)) {
        terms.push(prefix);
        part = part.slice(prefix.length).trim();
        break;
      }
    }
    if (part) terms.push(part);
  }
  return terms;
}

export function attributesFromOfficialFinish(text: string): OfficialAttributes {
  const terms = officialFinishTerms(text);
  let glassGroup = '';
  const finishes = new Set<string>();
  let dyed = 'Non Dyed';
  let galvanized = 'Non-galvanized';
  for (const term of terms) {
    const glass = GLASS.get(term);
    if (glass) {
      glassGroup = glass;
      if (term === 'ceylon') {
        finishes.add('Color-Lined').add('Luster');
        dyed = 'Color-Lined';
      }
      continue;
    }
    const finish = FINISH.get(term);
    if (!finish) throw new OfficialFinishError(`unknown term "${term}" in official finish "${text}"`, term);
    if (finish.finish) finishes.add(finish.finish);
    if (finish.dyed) dyed = finish.dyed;
    if (finish.galvanized) galvanized = finish.galvanized;
    if (!glassGroup && IMPLIED_GLASS.has(term)) glassGroup = IMPLIED_GLASS.get(term)!;
  }
  if (!glassGroup) throw new OfficialFinishError(`no glass in official finish "${text}"`, null);
  const finish = finishes.size ? joinAttributeTerms(Array.from(finishes)) : 'Non-Extra Finish';
  return { glassGroup, finish, dyed, galvanized, plating: 'Non-Plating' };
}
