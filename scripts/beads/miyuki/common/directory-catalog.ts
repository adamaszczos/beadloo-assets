#!/usr/bin/env tsx
/**
 * Miyuki directory enumerator (the I/O half; `directory-products.ts` holds the pure parsers).
 *
 * Fetches every product of `directory.miyuki-beads.co.jp` through its WooCommerce Store API and stores a
 * reduced dump in `sources/miyuki/directory/products.json`, which the Delica and Round Rocailles syncs
 * read instead of scraping shop pages. One throttled pass (43 pages of 100) replaces both the listing
 * scrape and the per-product metadata page fetches, and it never guesses URLs: the directory's
 * Wordfence blocks a client that produces too many 404s per minute, which the old fallback-URL
 * probing did.
 *
 * Usage:
 *   pnpm beads:miyuki:directory -- --fetch            Fetch all pages, write the dump, then report
 *   pnpm beads:miyuki:directory                       Report on the committed dump (offline)
 *   pnpm beads:miyuki:directory -- --fetch --no-sitemap   Skip the sitemap cross-check
 *   pnpm beads:miyuki:directory -- --allow-unparsed   Report instead of failing on unparsed names
 *   pnpm beads:miyuki:directory -- --fetch --fresh   Ignore the per-page cache in .scratch/directory-pages/
 *
 * Exit code 1 when any Delica or Round Rocailles product name does not parse (no silent drops).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASSET_REPO_ROOT } from '../../common/lib/paths.js';
import { splitCsvLine } from './csv.js';
import {
  classifyDirectoryProducts,
  reduceStoreProduct,
  type DirectoryDump,
  type DirectoryListing,
  type DirectoryListings,
  type DirectoryProduct,
  type MiyukiBeadType,
} from './directory-products.js';

// ============================================================================
// Constants
// ============================================================================

export const MIYUKI_DIRECTORY_BASE_URL = 'https://directory.miyuki-beads.co.jp';
export const DIRECTORY_DUMP_PATH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'directory', 'products.json');
/** Human decisions on products the parsers hold out (name/SKU conflicts): accept with a bead ID, or reject with a reason. */
export const DECISIONS_PATH = path.join(ASSET_REPO_ROOT, 'sources', 'miyuki', 'decisions.csv');
/** Raw pages of the last fetch (gitignored). A rerun after a dropped connection reuses them instead of asking the directory again. */
export const PAGE_CACHE_DIR = path.join(ASSET_REPO_ROOT, '.scratch', 'directory-pages');

const STORE_API_PATH = '/wp-json/wc/store/v1/products';
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 1500;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ============================================================================
// Pure helpers
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function storeApiUrl(page: number, perPage = PER_PAGE, baseUrl = MIYUKI_DIRECTORY_BASE_URL): string {
  return `${baseUrl}${STORE_API_PATH}?per_page=${perPage}&page=${page}`;
}

export function sitemapUrl(index: number, baseUrl = MIYUKI_DIRECTORY_BASE_URL): string {
  return `${baseUrl}/wp-sitemap-posts-product-${index}.xml`;
}

/** Wordfence answers a rate-limited client with an HTML 503 that names the block; stop at once rather than retry into a longer ban. */
export function isWordfenceBlock(status: number, contentType: string | null, body: string): boolean {
  return status === 503 && (contentType ?? '').includes('text/html') && /access to this site has been limited/i.test(body);
}

export function countSitemapLocs(xml: string): number {
  return (xml.match(/<loc>/g) ?? []).length;
}

export type ListingSummary = {
  byTypeAndSize: Record<MiyukiBeadType, Record<string, number>>;
  squareHole: Record<string, number>;
  withOldNumber: number;
  withConflicts: DirectoryListing[];
};

export function summarizeListings(listings: DirectoryListing[]): ListingSummary {
  const summary: ListingSummary = {
    byTypeAndSize: { 'miyuki-delica': {}, 'miyuki-round_rocailles': {} },
    squareHole: {},
    withOldNumber: 0,
    withConflicts: [],
  };
  for (const listing of listings) {
    const sizes = summary.byTypeAndSize[listing.beadType];
    sizes[listing.size] = (sizes[listing.size] ?? 0) + 1;
    if (listing.hole === 'SH') summary.squareHole[listing.size] = (summary.squareHole[listing.size] ?? 0) + 1;
    if (listing.oldNumber) summary.withOldNumber += 1;
    if (listing.conflicts.length > 0) summary.withConflicts.push(listing);
  }
  return summary;
}

// ============================================================================
// Decisions on held-out products
// ============================================================================

export type ConflictDecision = {
  productId: number;
  sku: string;
  name: string;
  decision: 'accept' | 'reject';
  beadId: string;
  size: string;
  decidedOn: string;
  reason: string;
};

export function parseDecisionsCsv(text: string): ConflictDecision[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const expected = ['productId', 'sku', 'name', 'decision', 'beadId', 'size', 'decidedOn', 'reason'];
  if (header.join(',') !== expected.join(',')) throw new Error(`decisions.csv: unexpected header ${lines[0]}`);
  return lines.slice(1).map((line) => {
    const [productId, sku, name, decision, beadId, size, decidedOn, reason] = splitCsvLine(line);
    if (decision !== 'accept' && decision !== 'reject') throw new Error(`decisions.csv: decision must be accept or reject (product ${productId})`);
    if (decision === 'accept' && !beadId) throw new Error(`decisions.csv: an accepted product needs a beadId (product ${productId})`);
    return { productId: Number(productId), sku, name, decision, beadId: beadId.toUpperCase(), size, decidedOn, reason };
  });
}

export function readDecisions(decisionsPath = DECISIONS_PATH): ConflictDecision[] {
  if (!fs.existsSync(decisionsPath)) return [];
  return parseDecisionsCsv(fs.readFileSync(decisionsPath, 'utf-8'));
}

export type AppliedDecisions = {
  /** Conflicting listings accepted by a decision, now clean, with the decided bead ID. */
  accepted: DirectoryListing[];
  /** Conflicting listings rejected by a decision. */
  rejected: DirectoryListing[];
  /** Conflicting listings nobody has decided on yet. */
  undecided: DirectoryListing[];
};

/** Applies the committed decisions to the listings whose name and SKU disagree. A decision must name the same product (id and SKU) and, for accept, the bead ID the parser derived. */
export function applyDecisions(listings: DirectoryListing[], decisions: ConflictDecision[]): AppliedDecisions {
  const byProduct = new Map(decisions.map((decision) => [decision.productId, decision]));
  const result: AppliedDecisions = { accepted: [], rejected: [], undecided: [] };
  for (const listing of listings) {
    if (listing.conflicts.length === 0) continue;
    const decision = byProduct.get(listing.productId);
    if (!decision || decision.sku.toUpperCase() !== listing.sku.toUpperCase()) {
      result.undecided.push(listing);
      continue;
    }
    if (decision.decision === 'reject') {
      result.rejected.push(listing);
      continue;
    }
    if (decision.beadId !== listing.beadId.toUpperCase() || decision.size !== listing.size) {
      throw new Error(
        `decisions.csv: product ${listing.productId} is accepted as ${decision.beadId} (${decision.size}/0) but the listing parses as ${listing.beadId} (${listing.size}/0)`
      );
    }
    result.accepted.push({ ...listing, conflicts: [] });
  }
  return result;
}

// ============================================================================
// Dump I/O
// ============================================================================

export function readDirectoryDump(dumpPath = DIRECTORY_DUMP_PATH): DirectoryDump {
  if (!fs.existsSync(dumpPath)) {
    throw new Error(
      `Directory dump not found at ${path.relative(ASSET_REPO_ROOT, dumpPath)}. Run \`pnpm beads:miyuki:directory -- --fetch\` first.`
    );
  }
  return JSON.parse(fs.readFileSync(dumpPath, 'utf-8')) as DirectoryDump;
}

export function writeDirectoryDump(dump: DirectoryDump, dumpPath = DIRECTORY_DUMP_PATH): void {
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  const sorted: DirectoryDump = { ...dump, products: [...dump.products].sort((a, b) => a.id - b.id) };
  fs.writeFileSync(dumpPath, `${JSON.stringify(sorted, null, 1)}\n`, 'utf-8');
}

/** The listings of one bead type from the dump, square hole included only on request (the app accepts `SH` IDs from Phase 1 on). */
export function loadDirectoryListings(
  beadType: MiyukiBeadType,
  options: { includeSquareHole?: boolean; dumpPath?: string; decisionsPath?: string } = {}
): {
  listings: DirectoryListing[];
  deferredSquareHole: DirectoryListing[];
  /** Name/SKU conflicts nobody has decided on (held out). */
  conflicts: DirectoryListing[];
  rejected: DirectoryListing[];
  dump: DirectoryDump;
} {
  const dump = readDirectoryDump(options.dumpPath);
  const classified = classifyDirectoryProducts(dump.products);
  if (classified.unparsed.length > 0) {
    const names = classified.unparsed.slice(0, 10).map((entry) => `"${entry.product.name}"`).join(', ');
    throw new Error(
      `${classified.unparsed.length} directory product(s) do not parse (${names}${classified.unparsed.length > 10 ? ', …' : ''}). Fix the parser before syncing.`
    );
  }
  const ofType = classified.listings.filter((listing) => listing.beadType === beadType);
  const decided = applyDecisions(ofType, readDecisions(options.decisionsPath));
  const clean = [...ofType.filter((listing) => listing.conflicts.length === 0), ...decided.accepted];
  const deferredSquareHole = options.includeSquareHole ? [] : clean.filter((listing) => listing.hole === 'SH');
  const listings = options.includeSquareHole ? clean : clean.filter((listing) => listing.hole !== 'SH');
  return { listings, deferredSquareHole, conflicts: decided.undecided, rejected: decided.rejected, dump };
}

// ============================================================================
// Network
// ============================================================================

type FetchPageResult = { products: DirectoryProduct[]; reportedTotal: number | null; totalPages: number | null };

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${(error as { cause?: { code?: string } }).cause?.code ?? ''}` : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|other side closed|socket hang up/i.test(message);
}

async function fetchWithBackoff(url: string, accept: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && isTransientNetworkError(error)) {
        const wait = 5_000 * attempt;
        console.warn(`  network error for ${url} (${error instanceof Error ? error.message : error}); retrying in ${wait / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await delay(wait);
        continue;
      }
      throw error;
    }
    if (response.ok) return response;
    const contentType = response.headers.get('content-type');
    const body = await response.text();
    if (isWordfenceBlock(response.status, contentType, body)) {
      throw new Error(
        `The directory has rate-limited this client (Wordfence, HTTP 503). Wait for the block to lift before fetching again; the dump on disk is unchanged.`
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_BASE_MS * attempt;
      console.warn(`  HTTP ${response.status} for ${url}; retrying in ${wait / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await delay(wait);
      continue;
    }
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  throw new Error(`Gave up on ${url} after ${MAX_ATTEMPTS} attempts`);
}

type CachedPage = { raw: unknown[]; total: string | null; totalPages: string | null };

function pageCachePath(page: number): string {
  return path.join(PAGE_CACHE_DIR, `page-${String(page).padStart(3, '0')}.json`);
}

async function fetchStorePage(page: number, useCache: boolean): Promise<FetchPageResult & { fromCache: boolean }> {
  let cached: CachedPage | null = null;
  if (useCache && fs.existsSync(pageCachePath(page))) {
    cached = JSON.parse(fs.readFileSync(pageCachePath(page), 'utf-8')) as CachedPage;
  }
  if (!cached) {
    const response = await fetchWithBackoff(storeApiUrl(page), 'application/json');
    const raw = (await response.json()) as unknown;
    if (!Array.isArray(raw)) throw new Error(`Store API page ${page} did not return an array`);
    cached = { raw, total: response.headers.get('x-wp-total'), totalPages: response.headers.get('x-wp-totalpages') };
    fs.mkdirSync(PAGE_CACHE_DIR, { recursive: true });
    fs.writeFileSync(pageCachePath(page), JSON.stringify(cached), 'utf-8');
  }
  return {
    products: cached.raw.map((item) => reduceStoreProduct(item as Parameters<typeof reduceStoreProduct>[0])),
    reportedTotal: cached.total ? Number.parseInt(cached.total, 10) : null,
    totalPages: cached.totalPages ? Number.parseInt(cached.totalPages, 10) : null,
    fromCache: useCache && fs.existsSync(pageCachePath(page)),
  };
}

export async function fetchAllStoreProducts(
  log: (line: string) => void = console.log,
  options: { useCache?: boolean } = {}
): Promise<Omit<DirectoryDump, 'sitemapTotal'>> {
  const useCache = options.useCache ?? true;
  if (!useCache) fs.rmSync(PAGE_CACHE_DIR, { recursive: true, force: true });
  const products: DirectoryProduct[] = [];
  let reportedTotal: number | null = null;
  let page = 1;
  let totalPages: number | null = null;
  for (;;) {
    const result = await fetchStorePage(page, useCache);
    log(`  page ${page}${totalPages ? ` of ${totalPages}` : ''}${result.fromCache ? ' (cached)' : ''}`);
    if (page === 1) {
      reportedTotal = result.reportedTotal;
      totalPages = result.totalPages;
    }
    products.push(...result.products);
    if (result.products.length < PER_PAGE || (totalPages !== null && page >= totalPages)) break;
    page += 1;
    if (!result.fromCache) await delay(REQUEST_DELAY_MS);
  }
  return {
    source: `${MIYUKI_DIRECTORY_BASE_URL}${STORE_API_PATH}`,
    fetchedAt: new Date().toISOString(),
    perPage: PER_PAGE,
    pages: page,
    reportedTotal,
    products,
  };
}

export async function fetchSitemapProductCount(log: (line: string) => void = console.log): Promise<number> {
  let total = 0;
  for (let index = 1; index <= 20; index++) {
    const url = sitemapUrl(index);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' } });
    if (response.status === 404) break;
    const contentType = response.headers.get('content-type');
    const body = await response.text();
    if (isWordfenceBlock(response.status, contentType, body)) {
      throw new Error('The directory has rate-limited this client (Wordfence, HTTP 503) while reading the sitemap.');
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const count = countSitemapLocs(body);
    log(`  sitemap ${index}: ${count} product URLs`);
    total += count;
    await delay(REQUEST_DELAY_MS);
  }
  return total;
}

// ============================================================================
// Reporting
// ============================================================================

export function reportDirectory(dump: DirectoryDump, classified: DirectoryListings): void {
  const summary = summarizeListings(classified.listings);
  console.log(`\nDirectory dump: ${dump.products.length} products (fetched ${dump.fetchedAt}, ${dump.pages} pages)`);
  if (dump.reportedTotal !== null) console.log(`  API reported total: ${dump.reportedTotal}`);
  if (dump.sitemapTotal !== null) console.log(`  sitemap product URLs: ${dump.sitemapTotal}`);
  for (const beadType of ['miyuki-delica', 'miyuki-round_rocailles'] as const) {
    const sizes = summary.byTypeAndSize[beadType];
    const total = Object.values(sizes).reduce((sum, count) => sum + count, 0);
    const perSize = Object.entries(sizes)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([size, count]) => `${size}/0: ${count}`)
      .join(', ');
    console.log(`  ${beadType}: ${total} (${perSize})`);
  }
  const squareHole = Object.entries(summary.squareHole).map(([size, count]) => `${size}/0: ${count}`).join(', ');
  console.log(`  square hole (SH): ${squareHole || 'none'}`);
  console.log(`  names carrying an old number in brackets: ${summary.withOldNumber}`);
  console.log(`  other products (TILA, …): ${classified.others.length}`);
  if (summary.withConflicts.length > 0) {
    const decided = applyDecisions(summary.withConflicts, readDecisions());
    console.log(`\n  name/SKU conflicts: ${decided.accepted.length} accepted, ${decided.rejected.length} rejected, ${decided.undecided.length} undecided (sources/miyuki/decisions.csv)`);
    for (const listing of decided.accepted) console.log(`    accepted as ${listing.beadId} (${listing.size}/0): ${listing.name} [${listing.sku}]`);
    for (const listing of decided.rejected) console.log(`    rejected: ${listing.name} [${listing.sku}]`);
    for (const listing of decided.undecided) console.log(`    UNDECIDED: ${listing.name} [${listing.sku}]: ${listing.conflicts.join('; ')}`);
  }
  if (classified.unparsed.length > 0) {
    console.log(`\n  UNPARSED Delica / Round Rocailles products (${classified.unparsed.length}):`);
    for (const entry of classified.unparsed) {
      console.log(`    ${entry.product.name} [${entry.product.sku}] ${entry.product.permalink}: ${entry.reason}`);
    }
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: tsx scripts/beads/miyuki/common/directory-catalog.ts [--fetch] [--no-sitemap] [--allow-unparsed]`);
    return;
  }
  const shouldFetch = argv.includes('--fetch');
  const withSitemap = !argv.includes('--no-sitemap');
  const allowUnparsed = argv.includes('--allow-unparsed');
  const fresh = argv.includes('--fresh');

  let dump: DirectoryDump;
  if (shouldFetch) {
    console.log(`\nFetching the Miyuki directory through the Store API (${REQUEST_DELAY_MS} ms between requests)…`);
    const fetched = await fetchAllStoreProducts(console.log, { useCache: !fresh });
    let sitemapTotal: number | null = null;
    if (withSitemap) {
      console.log('\nCross-checking with the sitemap…');
      sitemapTotal = await fetchSitemapProductCount();
    }
    dump = { ...fetched, sitemapTotal };
    writeDirectoryDump(dump);
    console.log(`\nWrote ${path.relative(ASSET_REPO_ROOT, DIRECTORY_DUMP_PATH)} (${dump.products.length} products)`);
    if (dump.reportedTotal !== null && dump.reportedTotal !== dump.products.length) {
      console.warn(`  WARNING: the API reported ${dump.reportedTotal} products but ${dump.products.length} were fetched`);
    }
    if (sitemapTotal !== null && sitemapTotal !== dump.products.length) {
      console.warn(`  WARNING: the sitemap lists ${sitemapTotal} product URLs but ${dump.products.length} products were fetched`);
    }
  } else {
    dump = readDirectoryDump();
  }

  const classified = classifyDirectoryProducts(dump.products);
  reportDirectory(dump, classified);
  if (classified.unparsed.length > 0 && !allowUnparsed) {
    console.error(`\n${classified.unparsed.length} product name(s) did not parse. Fix the parser (no bead may be dropped silently).`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nMiyuki directory enumeration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
