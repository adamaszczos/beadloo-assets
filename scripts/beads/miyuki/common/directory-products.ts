/**
 * Miyuki directory products: the pure half of the Store API pipeline.
 *
 * The directory (`directory.miyuki-beads.co.jp`) is a WooCommerce shop whose Store API returns, for
 * every product, its name, SKU, slug, images and attribute terms. These helpers turn one such product
 * into a bead listing (bead type, bead ID, size, hole type, image URL) and its metadata sidecar. They
 * never touch the network or the filesystem; `directory-catalog.ts` does that.
 *
 * Why product names are parsed strictly: the old shop-listing scraper accepted only
 * `#<n><suffix> Round Rocailles <size>/0` and silently dropped 53 official products whose names carry
 * Miyuki's old number in brackets (`#1(131S) Round Rocailles 6/0`) or the square-hole marker
 * (`3271 Round Rocailles (SH) 6/0`), and 2 Delica whose IDs end in a letter (`DB31L`). A product that
 * looks like a Delica or a round rocaille but does not parse is now an error, never a skip.
 */

// ============================================================================
// Types
// ============================================================================

export type DirectoryProductImage = {
  src: string;
  name?: string;
};

export type DirectoryAttribute = {
  name: string;
  terms: string[];
};

/** The subset of a Store API product that the pipeline keeps in `sources/miyuki/directory/products.json`. */
export type DirectoryProduct = {
  id: number;
  sku: string;
  name: string;
  slug: string;
  permalink: string;
  categories: string[];
  images: DirectoryProductImage[];
  attributes: DirectoryAttribute[];
};

export type DirectoryDump = {
  source: string;
  fetchedAt: string;
  perPage: number;
  pages: number;
  /** `X-WP-Total` as reported by the API on the first page. */
  reportedTotal: number | null;
  /** Product URL count from the sitemap, when it was fetched. */
  sitemapTotal: number | null;
  products: DirectoryProduct[];
};

export type MiyukiBeadType = 'miyuki-delica' | 'miyuki-round_rocailles';
export type HoleType = 'RH' | 'SH';

export type DirectoryListing = {
  beadType: MiyukiBeadType;
  /** Beadloo's bead ID: `1`, `1F`, `3271SH`, `DB0031L`. */
  beadId: string;
  /** Compact size id: `11`, `6`, `15`. */
  size: string;
  hole: HoleType;
  /** Miyuki's old (tentative) number when the name carries it in brackets, e.g. `131S`. */
  oldNumber?: string;
  name: string;
  sku: string;
  imageUrl?: string;
  productId: number;
  permalink: string;
  /** The product's attribute terms, from which the metadata sidecar is built. */
  attributes: DirectoryAttribute[];
  /** Name/SKU disagreements; a listing with conflicts is held out for a human decision. */
  conflicts: string[];
};

export type ClassifiedProduct =
  | { kind: 'listing'; listing: DirectoryListing }
  | { kind: 'other'; product: DirectoryProduct }
  | { kind: 'unparsed'; product: DirectoryProduct; reason: string };

/** The sidecar shape written to `beads/miyuki/<type>/<size>/<id>.metadata.json` (key order matters for diffs). */
export type DirectorySidecar = {
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish: string;
  dyed: string;
  galvanized: string;
  plating: string;
};

// ============================================================================
// Round Rocailles
// ============================================================================

const RR_NAME_HASH = /^#\s*(\d+[A-Z]*)\s*(?:\(([^)]*)\))?\s+Round\s+Rocailles\s+(\d+)\/0\s*$/i;
const RR_NAME_SQUARE_HOLE = /^(\d+[A-Z]*)\s+Round\s+Rocailles\s+\(SH\)\s+(\d+)\/0\s*$/i;
const RR_SKU = /^N-RR(\d+)(S?)-(\d+[A-Z]*)$/i;

export type ParsedRoundRocaillesName = {
  colourNo: string;
  size: string;
  hole: HoleType;
  oldNumber?: string;
};

/**
 * Parses a round-rocaille product name.
 *   "#1 Round Rocailles 15/0"            → { colourNo: "1",    size: "15", hole: "RH" }
 *   "#1F Round Rocailles 15/0"           → { colourNo: "1F",   size: "15", hole: "RH" }
 *   "#1(131S) Round Rocailles 6/0"       → { colourNo: "1",    size: "6",  hole: "RH", oldNumber: "131S" }
 *   "3271 Round Rocailles (SH) 6/0"      → { colourNo: "3271", size: "6",  hole: "SH" }
 */
export function parseRoundRocaillesName(name: string): ParsedRoundRocaillesName | null {
  const squareHole = name.match(RR_NAME_SQUARE_HOLE);
  if (squareHole) {
    return { colourNo: squareHole[1].toUpperCase(), size: squareHole[2], hole: 'SH' };
  }
  const hash = name.match(RR_NAME_HASH);
  if (!hash) return null;
  const oldNumber = hash[2]?.trim().toUpperCase();
  return {
    colourNo: hash[1].toUpperCase(),
    size: hash[3],
    hole: 'RH',
    ...(oldNumber ? { oldNumber } : {}),
  };
}

export type ParsedRoundRocaillesSku = {
  size: string;
  squareHole: boolean;
  code: string;
};

/** `N-RR6S-3271` → { size: "6", squareHole: true, code: "3271" }; `N-RR6-0148R` → code "0148R". */
export function parseRoundRocaillesSku(sku: string): ParsedRoundRocaillesSku | null {
  const match = sku.trim().match(RR_SKU);
  if (!match) return null;
  return { size: match[1], squareHole: match[2].toUpperCase() === 'S', code: match[3].toUpperCase() };
}

function splitNumberSuffix(colourNo: string): { number: number; suffix: string } | null {
  const match = colourNo.match(/^(\d+)([A-Z]*)$/i);
  if (!match) return null;
  return { number: Number.parseInt(match[1], 10), suffix: match[2].toUpperCase() };
}

/** Beadloo's ID for a round rocaille: the colour number as printed plus `SH` for square hole. */
export function roundRocaillesBeadId(colourNo: string, hole: HoleType): string {
  return hole === 'SH' ? `${colourNo}SH` : colourNo;
}

// ============================================================================
// Delica
// ============================================================================

const DELICA_NAME = /^(DB[LMS]?)(\d+)([A-Z]?)\s+Delica\s+Beads\s+(\d+)\/0\s*$/i;
const DELICA_PREFIX_SIZE: Record<string, string> = { DB: '11', DBM: '10', DBL: '8', DBS: '15' };

export type ParsedDelicaName = {
  prefix: string;
  number: string;
  suffix: string;
  size: string;
};

/**
 * Parses a Delica product name; the optional letter suffix is what the old scraper lacked.
 *   "DB0001 Delica Beads 11/0" → { prefix: "DB", number: "0001", suffix: "", size: "11" }
 *   "DB31L Delica Beads 11/0"  → { prefix: "DB", number: "31",   suffix: "L", size: "11" }
 */
export function parseDelicaName(name: string): ParsedDelicaName | null {
  const match = name.match(DELICA_NAME);
  if (!match) return null;
  return {
    prefix: match[1].toUpperCase(),
    number: match[2],
    suffix: match[3].toUpperCase(),
    size: match[4],
  };
}

/** Beadloo's canonical Delica ID: prefix + 4-digit number + suffix (`DB31L` → `DB0031L`). */
export function delicaBeadId(parsed: Pick<ParsedDelicaName, 'prefix' | 'number' | 'suffix'>): string {
  return `${parsed.prefix}${parsed.number.padStart(4, '0')}${parsed.suffix}`;
}

export function delicaSizeForPrefix(prefix: string): string | null {
  return DELICA_PREFIX_SIZE[prefix.toUpperCase()] ?? null;
}

// ============================================================================
// Images
// ============================================================================

/**
 * The Store API's `images[0].src` is the full-size upload; strip a WordPress `-WxH` suffix anyway so a
 * resized variant can never be stored as an original.
 */
export function fullSizeImageUrl(src: string | undefined): string | undefined {
  if (!src) return undefined;
  const full = src.replace(/-\d+x\d+(\.(?:jpe?g|png|webp))(?=$|\?)/i, '$1');
  return /\.(?:jpe?g|png|webp)(?:$|\?)/i.test(full) ? full : undefined;
}

// ============================================================================
// Classification
// ============================================================================

function looksLikeRoundRocailles(name: string): boolean {
  return /round\s+rocailles/i.test(name);
}

function looksLikeDelica(name: string): boolean {
  return /delica\s+beads/i.test(name);
}

function classifyRoundRocailles(product: DirectoryProduct): ClassifiedProduct {
  const parsed = parseRoundRocaillesName(product.name);
  if (!parsed) {
    return { kind: 'unparsed', product, reason: 'round-rocaille name does not match any known form' };
  }

  const conflicts: string[] = [];
  const sku = parseRoundRocaillesSku(product.sku);
  if (!sku) {
    conflicts.push(`SKU "${product.sku}" is not N-RR<size>[S]-<code>`);
  } else {
    if (sku.size !== parsed.size) conflicts.push(`SKU size ${sku.size} ≠ name size ${parsed.size}`);
    if (sku.squareHole !== (parsed.hole === 'SH')) conflicts.push(`SKU hole marker ≠ name hole (${parsed.hole})`);
    const skuParts = splitNumberSuffix(sku.code);
    const nameParts = splitNumberSuffix(parsed.colourNo);
    if (!skuParts || !nameParts || skuParts.number !== nameParts.number || skuParts.suffix !== nameParts.suffix) {
      conflicts.push(`SKU code ${sku.code} ≠ name number ${parsed.colourNo}`);
    }
  }

  return {
    kind: 'listing',
    listing: {
      beadType: 'miyuki-round_rocailles',
      beadId: roundRocaillesBeadId(parsed.colourNo, parsed.hole),
      size: parsed.size,
      hole: parsed.hole,
      ...(parsed.oldNumber ? { oldNumber: parsed.oldNumber } : {}),
      name: product.name,
      sku: product.sku,
      imageUrl: fullSizeImageUrl(product.images[0]?.src),
      productId: product.id,
      permalink: product.permalink,
      attributes: product.attributes,
      conflicts,
    },
  };
}

function classifyDelica(product: DirectoryProduct): ClassifiedProduct {
  const parsed = parseDelicaName(product.name);
  if (!parsed) {
    return { kind: 'unparsed', product, reason: 'Delica name does not match <prefix><number>[letter] Delica Beads <size>/0' };
  }
  const conflicts: string[] = [];
  const expectedSize = delicaSizeForPrefix(parsed.prefix);
  if (expectedSize !== parsed.size) {
    conflicts.push(`prefix ${parsed.prefix} implies size ${expectedSize} but the name says ${parsed.size}`);
  }
  return {
    kind: 'listing',
    listing: {
      beadType: 'miyuki-delica',
      beadId: delicaBeadId(parsed),
      size: parsed.size,
      hole: 'RH',
      name: product.name,
      sku: product.sku,
      imageUrl: fullSizeImageUrl(product.images[0]?.src),
      productId: product.id,
      permalink: product.permalink,
      attributes: product.attributes,
      conflicts,
    },
  };
}

/** Decides what a directory product is. Anything that merely resembles a Delica or a round rocaille but does not parse is `unparsed`, which the enumerator treats as a hard error. */
export function classifyDirectoryProduct(product: DirectoryProduct): ClassifiedProduct {
  if (looksLikeRoundRocailles(product.name)) return classifyRoundRocailles(product);
  if (looksLikeDelica(product.name)) return classifyDelica(product);
  return { kind: 'other', product };
}

export type DirectoryListings = {
  listings: DirectoryListing[];
  others: DirectoryProduct[];
  unparsed: Array<{ product: DirectoryProduct; reason: string }>;
};

export function classifyDirectoryProducts(products: DirectoryProduct[]): DirectoryListings {
  const result: DirectoryListings = { listings: [], others: [], unparsed: [] };
  for (const product of products) {
    const classified = classifyDirectoryProduct(product);
    if (classified.kind === 'listing') result.listings.push(classified.listing);
    else if (classified.kind === 'other') result.others.push(classified.product);
    else result.unparsed.push({ product: classified.product, reason: classified.reason });
  }
  return result;
}

// ============================================================================
// Metadata sidecars from attributes
// ============================================================================

/**
 * Attribute names as the Store API returns them, with the labels the product page prints as aliases
 * ("Color" is shown as "Color Group", "Glass Type" as "Glass Group"). The API also carries Peeling,
 * Discoloration and Dry Cleaning (durability grades), not stored in the sidecar today.
 */
const SIDECAR_ATTRIBUTES: Array<{ attributes: string[]; key: keyof DirectorySidecar; required: boolean }> = [
  { attributes: ['Shape'], key: 'shape', required: true },
  { attributes: ['Size'], key: 'size', required: true },
  { attributes: ['Color', 'Color Group'], key: 'colorGroup', required: false },
  { attributes: ['Glass Type', 'Glass Group'], key: 'glassGroup', required: true },
  { attributes: ['Finish'], key: 'finish', required: false },
  { attributes: ['Dyed'], key: 'dyed', required: true },
  { attributes: ['Galvanized'], key: 'galvanized', required: true },
  { attributes: ['Plating'], key: 'plating', required: true },
];

/** The directory renders multi-term attributes joined by ", " in name order; the sidecars mirror that. */
export function joinAttributeTerms(terms: string[]): string {
  return [...terms]
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .join(', ');
}

export function findAttribute(holder: Pick<DirectoryProduct, 'attributes'>, attributeName: string): DirectoryAttribute | undefined {
  const wanted = attributeName.toLowerCase();
  return holder.attributes.find((attribute) => attribute.name.trim().toLowerCase() === wanted);
}

export type SidecarFromAttributesResult =
  | { ok: true; sidecar: DirectorySidecar }
  | { ok: false; missing: string[] };

/**
 * Builds the sidecar from the product's attribute terms, the same fields the product page's
 * "Additional information" table shows. `finish` defaults to "Not Specified" when absent, as the old
 * page scraper did; `colorGroup` is omitted when absent.
 */
export function sidecarFromAttributes(holder: Pick<DirectoryProduct, 'attributes'>): SidecarFromAttributesResult {
  const values: Partial<DirectorySidecar> = {};
  const missing: string[] = [];
  for (const { attributes, key, required } of SIDECAR_ATTRIBUTES) {
    const found = attributes.map((name) => findAttribute(holder, name)).find((attribute) => attribute !== undefined);
    const value = found ? joinAttributeTerms(found.terms) : '';
    if (value) {
      values[key] = value;
    } else if (required) {
      missing.push(attributes[0]);
    }
  }
  if (missing.length > 0) return { ok: false, missing };

  const sidecar: DirectorySidecar = {
    shape: values.shape!,
    size: values.size!,
    ...(values.colorGroup ? { colorGroup: values.colorGroup } : {}),
    glassGroup: values.glassGroup!,
    finish: values.finish ?? 'Not Specified',
    dyed: values.dyed!,
    galvanized: values.galvanized!,
    plating: values.plating!,
  };
  return { ok: true, sidecar };
}

// ============================================================================
// Store API reduction
// ============================================================================

type RawStoreProduct = {
  id?: unknown;
  sku?: unknown;
  name?: unknown;
  slug?: unknown;
  permalink?: unknown;
  categories?: unknown;
  images?: unknown;
  attributes?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Keeps only the fields the pipeline needs from a raw Store API product. */
export function reduceStoreProduct(raw: RawStoreProduct): DirectoryProduct {
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((category) => asString((category as { name?: unknown })?.name)).filter(Boolean)
    : [];
  const images = Array.isArray(raw.images)
    ? raw.images
        .map((image) => {
          const src = asString((image as { src?: unknown })?.src);
          const name = asString((image as { name?: unknown })?.name);
          return src ? (name ? { src, name } : { src }) : null;
        })
        .filter((image): image is DirectoryProductImage => image !== null)
    : [];
  const attributes = Array.isArray(raw.attributes)
    ? raw.attributes.map((attribute) => {
        const terms = (attribute as { terms?: unknown }).terms;
        return {
          name: asString((attribute as { name?: unknown })?.name),
          terms: Array.isArray(terms) ? terms.map((term) => asString((term as { name?: unknown })?.name)).filter(Boolean) : [],
        };
      })
    : [];
  return {
    id: Number(raw.id),
    sku: asString(raw.sku),
    name: decodeHtmlEntities(asString(raw.name)),
    slug: asString(raw.slug),
    permalink: asString(raw.permalink),
    categories,
    images,
    attributes,
  };
}

/** Store API names are HTML-escaped (`&#8211;`, `&amp;`); product names here only ever need these. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
