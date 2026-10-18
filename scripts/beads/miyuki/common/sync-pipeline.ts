/**
 * The parts of a Miyuki sync that both Delica and Round Rocailles share, now that listings come from
 * the committed directory dump instead of scraped shop pages.
 *
 * - new listings = listings with neither a downloaded original nor a published sidecar;
 * - images are fetched from the URL the Store API gave for the product, never guessed (guessing 404s
 *   is what got this client rate-limited by the directory's Wordfence);
 * - the metadata sidecar is built from the product's attribute terms;
 * - every added bead gets a provenance row in `sources/miyuki/registry/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBeadTypeDirectory, getDownloadedBeadTypeDirectory } from '../../common/lib/paths.js';
import { sidecarFromAttributes, type DirectoryListing, type MiyukiBeadType } from './directory-products.js';
import { readRegistry, todayIso, upsertRegistryRows, writeRegistry, type RegistryRow } from './registry.js';

export const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isOriginalImageFile(fileName: string): boolean {
  return /\.jpe?g$/i.test(fileName) && !/_(?:16x16|48x48)\.jpe?g$/i.test(fileName);
}

// ============================================================================
// Pure: which listings are new
// ============================================================================

export function listingKey(listing: Pick<DirectoryListing, 'beadId' | 'size'>): string {
  return `${listing.size}:${listing.beadId.toUpperCase()}`;
}

/** Listings of one size whose bead exists neither as a downloaded original nor as a published sidecar. */
/** The listings of a size that Beadloo does not hold yet. */
export function findNewListings(
  listings: DirectoryListing[],
  size: string,
  existingBeadIds: Iterable<string>
): DirectoryListing[] {
  const existing = new Set(Array.from(existingBeadIds, (id) => id.toUpperCase()));
  return listings.filter((listing) => listing.size === size && !existing.has(listing.beadId.toUpperCase()));
}

// ============================================================================
// Filesystem inventory
// ============================================================================

/** Bead IDs of one size known locally: downloaded originals (above the placeholder size) plus published sidecars. */
export function getKnownBeadIds(beadType: MiyukiBeadType, size: string, minimumOriginalBytes = 0): Set<string> {
  const known = new Set<string>();
  const downloadedDir = getDownloadedBeadTypeDirectory(beadType, size);
  if (fs.existsSync(downloadedDir)) {
    for (const file of fs.readdirSync(downloadedDir)) {
      if (!isOriginalImageFile(file)) continue;
      if (minimumOriginalBytes > 0 && fs.statSync(path.join(downloadedDir, file)).size < minimumOriginalBytes) continue;
      known.add(path.basename(file, path.extname(file)).toUpperCase());
    }
  }
  const beadDir = getBeadTypeDirectory(beadType, size);
  if (fs.existsSync(beadDir)) {
    for (const file of fs.readdirSync(beadDir)) {
      if (file.endsWith('.metadata.json')) known.add(file.slice(0, -'.metadata.json'.length).toUpperCase());
    }
  }
  return known;
}

export function hasSidecar(beadType: MiyukiBeadType, size: string, beadId: string): boolean {
  return fs.existsSync(path.join(getBeadTypeDirectory(beadType, size), `${beadId}.metadata.json`));
}

// ============================================================================
// Network
// ============================================================================

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && (error as Error).message === 'fetch failed') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('ECONNRESET') || msg.includes('UND_ERR_SOCKET') || msg.includes('other side closed');
}

export async function downloadImage(url: string, outputPath: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      return;
    } catch (error) {
      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = RETRY_BASE_DELAY_MS * attempt;
        console.warn(`    Transient error downloading, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})...`);
        await delay(backoff);
        continue;
      }
      throw error;
    }
  }
}

// ============================================================================
// Sidecars and registry
// ============================================================================

/** Writes `<beadId>.metadata.json` from the listing's attributes unless one exists. Returns what happened. */
export function writeSidecarFromListing(
  beadType: MiyukiBeadType,
  listing: DirectoryListing
): 'written' | 'exists' | 'incomplete' {
  if (hasSidecar(beadType, listing.size, listing.beadId)) return 'exists';
  const result = sidecarFromAttributes(listing);
  if (!result.ok) {
    console.warn(`    ${listing.beadId} (${listing.size}/0): attributes missing ${result.missing.join(', ')}; no sidecar written`);
    return 'incomplete';
  }
  const beadDir = getBeadTypeDirectory(beadType, listing.size);
  fs.mkdirSync(beadDir, { recursive: true });
  fs.writeFileSync(path.join(beadDir, `${listing.beadId}.metadata.json`), `${JSON.stringify(sidecarForListing(listing, result.sidecar), null, 2)}\n`, 'utf-8');
  return 'written';
}

/** The directory's attributes say nothing about the hole; a square-hole listing records it (issue #203 Phase 1 field). */
export function sidecarForListing(listing: Pick<DirectoryListing, 'hole'>, sidecar: Record<string, string>): Record<string, string> {
  return listing.hole === 'SH' ? { ...sidecar, hole: 'Square Hole' } : sidecar;
}

export function registryRowForDirectoryListing(listing: DirectoryListing, addedOn = todayIso()): RegistryRow {
  return {
    beadId: listing.beadId,
    size: listing.size,
    listingSource: 'directory',
    imageSource: 'directory',
    sizeSource: 'directory',
    colorAccuracy: 'photo',
    sourceRef: `product:${listing.productId} ${listing.permalink}`,
    addedOn,
  };
}

export function recordDirectoryListings(beadType: MiyukiBeadType, listings: DirectoryListing[]): number {
  if (listings.length === 0) return 0;
  const { rows, added } = upsertRegistryRows(readRegistry(beadType), listings.map((listing) => registryRowForDirectoryListing(listing)));
  writeRegistry(beadType, rows);
  return added;
}

// ============================================================================
// Reporting helpers
// ============================================================================

export function describeListings(listings: DirectoryListing[], limit = 8): string {
  const ids = listings.map((listing) => listing.beadId);
  return ids.length > limit ? `${ids.slice(0, limit).join(', ')}, … (${ids.length})` : ids.join(', ');
}
