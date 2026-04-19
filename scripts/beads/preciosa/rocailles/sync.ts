#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { parse } from 'node-html-parser';
import { extractColors } from '../../common/extract-colors.js';
import { generateMetadata } from '../../common/generate-metadata.js';
import { validateBeadType } from '../../common/validate-bead-type.js';
import {
  getBeadTypeDirectory,
  getDownloadedBeadTypeDirectory,
} from '../../common/lib/paths.js';
import { generateDerivatives, needsRegeneration } from '../../common/lib/thumbnails.js';
import {
  PRECIOSA_ROCAILLES_SIZES,
  type PreciosaRocaillesSize,
  assertPreciosaRocaillesDimensionsForSizes,
  getPreciosaRocaillesSizeDisplayName,
  normalizePreciosaRocaillesSize,
} from './lib/config.js';

dotenv.config();

type SyncOptions = {
  sizes: PreciosaRocaillesSize[] | null;
  explicitSizes: boolean;
  dryRun: boolean;
  verbose: boolean;
  localOnly: boolean;
  force: boolean;
};

type SyncSummary = {
  scraped: number;
  downloaded: number;
  metadataWritten: number;
  derivativesGenerated: number;
  colorsRebuilt: number;
  processedSizes: PreciosaRocaillesSize[];
};

type CatalogPageResponse = {
  results: PreciosaCatalogListing[];
  pages: Array<number | string>;
  page: number;
};

type PreciosaCatalogListing = {
  href: string;
  colour: string;
  article: string;
  size: string;
  photoView: string;
  product?: string[];
};

export type PreciosaRocaillesListing = {
  beadId: string;
  detailUrl: string;
  imageUrl: string;
  articleNumber: string;
  size: PreciosaRocaillesSize;
  sizeLabel: `${number}/0`;
  colorNumber: string;
  productKeys: string[];
};

export type PreciosaRocaillesDetail = {
  wholeArticleNumber: string;
  additionalArticleNumber?: string;
  articleDescription: string;
  sizeLabel: `${number}/0`;
  colorNumber: string;
  colorDescription: string;
  resistance?: string;
  naturalFinished?: string;
};

export type PreciosaRocaillesMetadata = {
  beadId?: string;
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
  additionalArticleNumber?: string;
  wholeArticleNumber?: string;
  colorNumber?: string;
  colorDescription?: string;
  naturalFinished?: string;
  resistance?: string;
  articleDescription?: string;
};

const BASE_URL = 'https://catalog.preciosa-ornela.com';
const PRODUCT_ENDPOINT = `${BASE_URL}/RUN/product-catalog-perlicky`;
const SHAPE_FILTER = 'Rokajl';
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};
const PAGE_BATCH_SIZE = 6;
const DETAIL_BATCH_SIZE = 6;
const DOWNLOAD_PROGRESS_INTERVAL = 25;

const BEAD_TYPE = 'preciosa-rocailles';
const PRECIOSA_DIR = getBeadTypeDirectory(BEAD_TYPE);
const PRECIOSA_DOWNLOADED_DIR = getDownloadedBeadTypeDirectory(BEAD_TYPE);

const FINISH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bharlequin\b/i, label: 'Harlequin' },
  { pattern: /\bcornelian\b/i, label: 'Cornelian' },
  { pattern: /\bmat(?:te|t)\b/i, label: 'Matte' },
  { pattern: /\brainbow\b/i, label: 'Rainbow' },
  { pattern: /\bluster\b/i, label: 'Luster' },
  { pattern: /\bpearl\b|\bshell\b/i, label: 'Pearl' },
  { pattern: /\btravertin\b/i, label: 'Travertin' },
  { pattern: /\bmetallic\b/i, label: 'Metallic' },
  { pattern: /\blined\b/i, label: 'Lined' },
  { pattern: /\biris\b/i, label: 'Iris' },
  { pattern: /\bsfinx\b/i, label: 'Sfinx' },
  { pattern: /\bpermalux\b/i, label: 'PermaLux' },
  { pattern: /\bterra\b/i, label: 'Terra' },
  { pattern: /\bsolgel\b/i, label: 'Solgel' },
  { pattern: /\betch(?:ing)?\b/i, label: 'Etching' },
  { pattern: /\bab\b/i, label: 'AB' },
];

const COLOR_GROUP_NOISE_PATTERNS = [
  /\bharlequin\b/ig,
  /\bcornelian\b/ig,
  /\bmat(?:te|t)\b/ig,
  /\brainbow\b/ig,
  /\bluster\b/ig,
  /\bpearl\b/ig,
  /\bshell\b/ig,
  /\btravertin\b/ig,
  /\bmetallic\b/ig,
  /\blined\b/ig,
  /\biris\b/ig,
  /\bsfinx\b/ig,
  /\bpermalux\b/ig,
  /\bterra\b/ig,
  /\bsolgel\b/ig,
  /\betch(?:ing)?\b/ig,
  /\bab\b/ig,
  /\btransparent\b/ig,
  /\bopaque\b/ig,
  /\bdyed\b/ig,
  /\bgalvanized\b/ig,
  /\bfinished\b/ig,
  /\bnatural\b/ig,
];

const ORIGINAL_FILE_REGEX = /\.(webp|jpg|jpeg)$/i;

function buildCatalogCookie(page: number): string {
  return `perlicky=${JSON.stringify({ lang: 'en', shape: SHAPE_FILTER, page })}`;
}

function toAbsoluteUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;
}

function getMaxPage(pages: Array<number | string>): number {
  const numericPages = pages.filter((page): page is number => typeof page === 'number');
  return numericPages.length > 0 ? Math.max(...numericPages) : 1;
}

function getPreciosaOriginalExtension(listing: PreciosaRocaillesListing): string {
  return path.extname(new URL(listing.imageUrl).pathname) || '.webp';
}

export function getPreciosaRelativeAssetStem(listing: PreciosaRocaillesListing): string {
  return `${listing.articleNumber}/${listing.colorNumber}`;
}

function getPreciosaRelativeOriginalPath(listing: PreciosaRocaillesListing): string {
  return `${getPreciosaRelativeAssetStem(listing)}${getPreciosaOriginalExtension(listing)}`;
}

function getDownloadedOriginalPath(listing: PreciosaRocaillesListing): string {
  return path.join(PRECIOSA_DOWNLOADED_DIR, listing.size, listing.articleNumber, `${listing.colorNumber}${getPreciosaOriginalExtension(listing)}`);
}

function getMetadataSidecarPath(listing: PreciosaRocaillesListing): string {
  return path.join(PRECIOSA_DIR, listing.size, listing.articleNumber, `${listing.colorNumber}.metadata.json`);
}

function getThumbnailPath(listing: PreciosaRocaillesListing, thumbnailSize: '16x16' | '48x48'): string {
  return path.join(PRECIOSA_DIR, listing.size, listing.articleNumber, `${listing.colorNumber}_${thumbnailSize}.jpg`);
}

function getLegacyDownloadedOriginalPaths(listing: PreciosaRocaillesListing): string[] {
  const extension = getPreciosaOriginalExtension(listing);

  return [
    path.join(PRECIOSA_DOWNLOADED_DIR, listing.size, `${listing.beadId}${extension}`),
    path.join(PRECIOSA_DOWNLOADED_DIR, listing.size, `${listing.colorNumber}${extension}`),
    path.join(PRECIOSA_DOWNLOADED_DIR, listing.size, `${listing.colorNumber}__${listing.articleNumber}${extension}`),
  ];
}

function getLegacyMetadataSidecarPaths(listing: PreciosaRocaillesListing): string[] {
  return [
    path.join(PRECIOSA_DIR, listing.size, `${listing.beadId}.metadata.json`),
    path.join(PRECIOSA_DIR, listing.size, `${listing.colorNumber}.metadata.json`),
    path.join(PRECIOSA_DIR, listing.size, `${listing.colorNumber}__${listing.articleNumber}.metadata.json`),
  ];
}

function getLegacyThumbnailPaths(
  listing: PreciosaRocaillesListing,
  thumbnailSize: '16x16' | '48x48'
): string[] {
  return [
    path.join(PRECIOSA_DIR, listing.size, `${listing.beadId}_${thumbnailSize}.jpg`),
    path.join(PRECIOSA_DIR, listing.size, `${listing.colorNumber}_${thumbnailSize}.jpg`),
    path.join(PRECIOSA_DIR, listing.size, `${listing.colorNumber}__${listing.articleNumber}_${thumbnailSize}.jpg`),
  ];
}

function isOriginalSourceFile(fileName: string): boolean {
  return ORIGINAL_FILE_REGEX.test(fileName);
}

export function normalizePreciosaBeadId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().replace(/\s+/g, '').replace(/\//g, '_');
  return /^\d{3}-\d{5}-\d{1,2}_0-\d{5}$/i.test(normalized) ? normalized : null;
}

function extractBeadIdFromPhotoUrl(photoUrl: string): string | null {
  try {
    const parsedUrl = new URL(toAbsoluteUrl(photoUrl));
    return normalizePreciosaBeadId(path.posix.basename(parsedUrl.pathname, path.posix.extname(parsedUrl.pathname)));
  } catch {
    return null;
  }
}

export function parsePreciosaCatalogListing(listing: PreciosaCatalogListing): PreciosaRocaillesListing | null {
  const size = normalizePreciosaRocaillesSize(listing.size);
  if (!size) {
    return null;
  }

  const beadId =
    normalizePreciosaBeadId(listing.product?.find((value) => value.includes('/0') || value.includes('_0')) || '') ||
    extractBeadIdFromPhotoUrl(listing.photoView);

  if (!beadId) {
    return null;
  }

  return {
    beadId,
    detailUrl: toAbsoluteUrl(listing.href),
    imageUrl: toAbsoluteUrl(listing.photoView),
    articleNumber: listing.article.trim(),
    size,
    sizeLabel: getPreciosaRocaillesSizeDisplayName(size),
    colorNumber: listing.colour.trim(),
    productKeys: Array.isArray(listing.product) ? listing.product : [],
  };
}

async function fetchCatalogPage(page: number): Promise<CatalogPageResponse> {
  const response = await fetch(PRODUCT_ENDPOINT, {
    method: 'POST',
    headers: {
      ...REQUEST_HEADERS,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: buildCatalogCookie(page),
    },
    body: new URLSearchParams({ search: '1' }),
  });

  if (!response.ok) {
    throw new Error(`Catalog request failed: HTTP ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as CatalogPageResponse;
}

export async function scrapeAllListings(
  requestedSizes: readonly PreciosaRocaillesSize[] | null,
  verbose: boolean
): Promise<PreciosaRocaillesListing[]> {
  console.log('\nScraping Preciosa Rocailles catalog...\n');

  const firstPage = await fetchCatalogPage(1);
  const maxPage = getMaxPage(firstPage.pages);
  const discovered = new Map<string, PreciosaRocaillesListing>();

  const registerListings = (rows: PreciosaCatalogListing[]): void => {
    for (const row of rows) {
      const listing = parsePreciosaCatalogListing(row);
      if (!listing || (requestedSizes && !requestedSizes.includes(listing.size))) {
        continue;
      }

      discovered.set(listing.beadId, listing);
    }
  };

  registerListings(firstPage.results);

  for (let start = 2; start <= maxPage; start += PAGE_BATCH_SIZE) {
    const pages = Array.from(
      { length: Math.min(PAGE_BATCH_SIZE, maxPage - start + 1) },
      (_, index) => start + index
    );

    if (verbose) {
      console.log(`  Fetching pages ${pages[0]}-${pages[pages.length - 1]}...`);
    }

    const results = await Promise.all(pages.map((page) => fetchCatalogPage(page)));
    for (const result of results) {
      registerListings(result.results);
    }
  }

  const listings = Array.from(discovered.values()).sort((left, right) => {
    if (Number(left.size) !== Number(right.size)) {
      return Number(left.size) - Number(right.size);
    }

    return left.beadId.localeCompare(right.beadId);
  });

  console.log(`  Found ${listings.length} Preciosa Rocailles listings across ${maxPage} pages\n`);
  return listings;
}

async function fetchDetailHtml(detailUrl: string): Promise<string> {
  const response = await fetch(detailUrl, {
    headers: {
      ...REQUEST_HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Detail request failed: HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function collectDetailFields(html: string): Record<string, string> {
  const root = parse(html);
  const fields: Record<string, string> = {};

  for (const row of root.querySelectorAll('.detailContent__row, .detailInfo__row')) {
    const nodes = row.querySelectorAll('p, h3');
    if (nodes.length < 2) {
      continue;
    }

    const label = nodes[0].text.trim().replace(/:\s*$/, '');
    const value = nodes.slice(1).map((node) => node.text.trim()).join(' ').replace(/\s+/g, ' ').trim();

    if (label) {
      fields[label] = value;
    }
  }

  return fields;
}

export function parsePreciosaDetailHtml(html: string): PreciosaRocaillesDetail | null {
  const fields = collectDetailFields(html);

  const wholeArticleNumber = fields['Whole article number'];
  const articleDescription = fields['Article (shape) description'];
  const sizeLabel = fields['Size'];
  const colorNumber = fields['Color number'];

  if (!wholeArticleNumber || !articleDescription || !sizeLabel || !colorNumber) {
    return null;
  }

  return {
    wholeArticleNumber,
    additionalArticleNumber: fields['Article number (shape)'],
    articleDescription,
    sizeLabel: sizeLabel as `${number}/0`,
    colorNumber,
    colorDescription: fields['Color description'] || '',
    resistance: fields['Resistance'],
    naturalFinished: fields['Natural / Finished'],
  };
}

export function inferPreciosaColorGroup(description: string): string | undefined {
  let value = description.trim();

  for (const pattern of COLOR_GROUP_NOISE_PATTERNS) {
    value = value.replace(pattern, ' ');
  }

  value = value.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  return value || undefined;
}

function inferPreciosaGlassGroup(description: string, naturalFinished?: string): string {
  const normalized = description.toLowerCase();
  const finishState = (naturalFinished || '').trim().toLowerCase();

  if (/\bmetallic\b|\bgalvanized\b|\bsfinx\b|\breal gold\b|\breal silver\b/i.test(normalized)) {
    return 'Metallic';
  }

  if (/\bchalkwhite\b|\balabaster\b|\bopaque\b|\bjet\b|\bhematite\b/i.test(normalized)) {
    return 'Opaque';
  }

  if (/\bcrystal\b|\btransparent\b|\blined\b|\brainbow\b|\bab\b|\biris\b|\bvitrail\b/i.test(normalized)) {
    return 'Transparent';
  }

  if (finishState === 'natural') {
    return 'Transparent';
  }

  return 'Other';
}

function inferDyed(description: string): string {
  return /\bdyed\b|\bterra\b|\bpermalux\b|\bsolgel\b/i.test(description) ? 'Dyed' : 'Non Dyed';
}

function inferPlating(description: string, naturalFinished?: string): string {
  if (
    /\blined\b|\bmetallic\b|\bplated\b|\bsfinx\b|\breal gold\b|\breal silver\b|\bvitrail\b|\bclarit\b|\bcelsian\b|\bcapri\b|\bblue sky\b|\bblond flare\b|\bazuro\b|\bargentic\b|\bsliperit\b|\bmarea\b|\blagoon\b|\blabrador\b|\bchrome\b|\bamber\b|\bhoney\b|\bvalentinit\b/i.test(
      description
    )
  ) {
    return 'Plated';
  }

  if ((naturalFinished || '').trim().toLowerCase() === 'finished' && !/\bdyed\b|\bterra\b|\bpermalux\b|\bsolgel\b/i.test(description)) {
    return 'Plated';
  }

  return 'Non Plated';
}

export function inferPreciosaRocaillesMetadata(
  detail: PreciosaRocaillesDetail
): PreciosaRocaillesMetadata {
  const description = detail.colorDescription.trim();
  const finishes = FINISH_PATTERNS.filter(({ pattern }) => pattern.test(description)).map(({ label }) => label);
  const colorGroup = inferPreciosaColorGroup(description);
  const naturalFinished = detail.naturalFinished?.trim();

  return {
    shape: 'Rocailles',
    size: detail.sizeLabel,
    ...(colorGroup ? { colorGroup } : {}),
    glassGroup: inferPreciosaGlassGroup(description, naturalFinished),
    finish:
      finishes.length > 0
        ? Array.from(new Set(finishes)).join(', ')
        : naturalFinished?.toLowerCase() === 'finished'
          ? 'Finished'
          : undefined,
    dyed: inferDyed(description),
    galvanized: /\bgalvanized\b/i.test(description) ? 'Galvanized' : 'Non Galvanized',
    plating: inferPlating(description, naturalFinished),
    additionalArticleNumber: detail.additionalArticleNumber,
    wholeArticleNumber: detail.wholeArticleNumber,
    colorNumber: detail.colorNumber,
    colorDescription: detail.colorDescription,
    naturalFinished,
    resistance: detail.resistance,
    articleDescription: detail.articleDescription,
  };
}

function sortPreciosaRocaillesSizes(sizes: Iterable<PreciosaRocaillesSize>): PreciosaRocaillesSize[] {
  return Array.from(new Set(sizes)).sort((left, right) => Number(left) - Number(right));
}

function findExistingPath(paths: readonly string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) || null;
}

function moveLegacyFile(preferredPath: string, legacyPaths: readonly string[]): void {
  const existingLegacyPaths = legacyPaths.filter((candidate) => candidate !== preferredPath && fs.existsSync(candidate));

  if (existingLegacyPaths.length === 0) {
    return;
  }

  fs.mkdirSync(path.dirname(preferredPath), { recursive: true });

  if (!fs.existsSync(preferredPath)) {
    fs.renameSync(existingLegacyPaths[0], preferredPath);
  }

  for (const legacyPath of existingLegacyPaths) {
    if (legacyPath === preferredPath || !fs.existsSync(legacyPath)) {
      continue;
    }

    fs.rmSync(legacyPath, { force: true });
  }
}

function reconcileLegacyListingFiles(listing: PreciosaRocaillesListing): void {
  moveLegacyFile(getDownloadedOriginalPath(listing), getLegacyDownloadedOriginalPaths(listing));
  moveLegacyFile(getMetadataSidecarPath(listing), getLegacyMetadataSidecarPaths(listing));
  moveLegacyFile(getThumbnailPath(listing, '16x16'), getLegacyThumbnailPaths(listing, '16x16'));
  moveLegacyFile(getThumbnailPath(listing, '48x48'), getLegacyThumbnailPaths(listing, '48x48'));
}

function shouldReportDownloadProgress(current: number, total: number, verbose: boolean): boolean {
  if (verbose || total <= 10) {
    return true;
  }

  return current === 1 || current === total || current % DOWNLOAD_PROGRESS_INTERVAL === 0;
}

function walkFilesRecursive(directory: string): string[] {
  const discovered: string[] = [];

  function walk(currentDirectory: string): void {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) => {
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      discovered.push(entryPath);
    }
  }

  walk(directory);
  return discovered;
}

function collectLocalPreciosaRocaillesSizes(): PreciosaRocaillesSize[] {
  const discovered = new Set<PreciosaRocaillesSize>();

  for (const baseDir of [PRECIOSA_DIR, PRECIOSA_DOWNLOADED_DIR]) {
    if (!fs.existsSync(baseDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const size = normalizePreciosaRocaillesSize(entry.name);
      if (size) {
        discovered.add(size);
      }
    }
  }

  return sortPreciosaRocaillesSizes(discovered);
}

export function resolvePreciosaRocaillesSyncSizes(
  requestedSizes: readonly PreciosaRocaillesSize[] | null,
  listingSizes: readonly PreciosaRocaillesSize[],
  localSizes: readonly PreciosaRocaillesSize[]
): PreciosaRocaillesSize[] {
  const availableSizes = new Set<PreciosaRocaillesSize>([...listingSizes, ...localSizes]);

  if (requestedSizes && requestedSizes.length > 0) {
    return requestedSizes.filter((size) => availableSizes.has(size));
  }

  return sortPreciosaRocaillesSizes(availableSizes);
}

function collectRequestedProcessSizes(
  requestedSizes: readonly PreciosaRocaillesSize[] | null,
  listings: PreciosaRocaillesListing[]
): PreciosaRocaillesSize[] {
  const listingSizes = sortPreciosaRocaillesSizes(listings.map((listing) => listing.size));
  const localSizes = collectLocalPreciosaRocaillesSizes();
  return resolvePreciosaRocaillesSyncSizes(requestedSizes, listingSizes, localSizes);
}

function groupListingsBySize(listings: PreciosaRocaillesListing[]): Map<PreciosaRocaillesSize, PreciosaRocaillesListing[]> {
  const grouped = new Map<PreciosaRocaillesSize, PreciosaRocaillesListing[]>();

  for (const listing of listings) {
    if (!grouped.has(listing.size)) {
      grouped.set(listing.size, []);
    }
    grouped.get(listing.size)!.push(listing);
  }

  return grouped;
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

async function ensureLocalAssetsForSize(
  size: PreciosaRocaillesSize,
  listings: PreciosaRocaillesListing[],
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  const sizeDir = path.join(PRECIOSA_DIR, size);
  const downloadedSizeDir = path.join(PRECIOSA_DOWNLOADED_DIR, size);
  fs.mkdirSync(sizeDir, { recursive: true });
  fs.mkdirSync(downloadedSizeDir, { recursive: true });

  const pending = listings.filter((listing) => {
    if (!options.dryRun) {
      reconcileLegacyListingFiles(listing);
    }

    return (
      options.force ||
      !findExistingPath([getDownloadedOriginalPath(listing), ...getLegacyDownloadedOriginalPaths(listing)])
    );
  });

  if (pending.length === 0) {
    console.log(`  Size ${size}: originals already up to date`);
    return;
  }

  console.log(
    `  Size ${size}: ${pending.length} ${options.dryRun ? 'originals to download' : 'originals to download'}`
  );

  for (const [index, listing] of pending.entries()) {
    const imagePath = getDownloadedOriginalPath(listing);
    const current = index + 1;

    if (shouldReportDownloadProgress(current, pending.length, options.verbose)) {
      console.log(
        `    ${options.dryRun ? 'Would download' : 'Downloading'} ${current}/${pending.length}: ${getPreciosaRelativeOriginalPath(listing)}`
      );
    }

    if (!options.dryRun) {
      await downloadImage(listing.imageUrl, imagePath);
    }

    summary.downloaded += 1;
  }
}

function hasMetadataSidecars(size: string): boolean {
  const sizeDir = path.join(PRECIOSA_DIR, size);
  return fs.existsSync(sizeDir) && walkFilesRecursive(sizeDir).some((file) => file.endsWith('.metadata.json'));
}

async function writeMetadataForListings(
  listings: PreciosaRocaillesListing[],
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  const pending = listings.filter((listing) => {
    if (!options.dryRun) {
      reconcileLegacyListingFiles(listing);
    }

    return (
      options.force ||
      !findExistingPath([getMetadataSidecarPath(listing), ...getLegacyMetadataSidecarPaths(listing)])
    );
  });

  if (pending.length === 0) {
    return;
  }

  console.log(`\nFetching Preciosa detail metadata for ${pending.length} beads...`);

  for (let start = 0; start < pending.length; start += DETAIL_BATCH_SIZE) {
    const batch = pending.slice(start, start + DETAIL_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (listing) => {
        const html = await fetchDetailHtml(listing.detailUrl);
        const detail = parsePreciosaDetailHtml(html);

        if (!detail) {
          throw new Error(`Failed to parse detail fields for ${listing.beadId}`);
        }

        return {
          listing,
          metadata: {
            ...inferPreciosaRocaillesMetadata(detail),
            beadId: listing.beadId,
          },
        };
      })
    );

    for (const { listing, metadata } of results) {
      const outputPath = getMetadataSidecarPath(listing);

      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
      }

      summary.metadataWritten += 1;
    }
  }
}

async function generateThumbnailsForSize(
  size: PreciosaRocaillesSize,
  force: boolean,
  verbose: boolean,
  dryRun: boolean
): Promise<number> {
  const downloadedSizeDir = path.join(PRECIOSA_DOWNLOADED_DIR, size);
  if (!fs.existsSync(downloadedSizeDir)) {
    return 0;
  }

  const outputSizeDir = path.join(PRECIOSA_DIR, size);
  if (!dryRun) {
    fs.mkdirSync(outputSizeDir, { recursive: true });
  }

  let generated = 0;
  const files = walkFilesRecursive(downloadedSizeDir).filter((file) => isOriginalSourceFile(file));

  for (const sourcePath of files) {
    const relativeParent = path.relative(downloadedSizeDir, path.dirname(sourcePath));
    const outputDir = path.join(outputSizeDir, relativeParent);
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const crop48Path = path.join(outputDir, `${baseName}_48x48.jpg`);
    const thumb16Path = path.join(outputDir, `${baseName}_16x16.jpg`);

    try {
      if (dryRun) {
        const wouldGenerate48 = needsRegeneration(sourcePath, crop48Path, force);
        const wouldGenerate16 = needsRegeneration(sourcePath, thumb16Path, force);
        const count = Number(wouldGenerate16) + Number(wouldGenerate48);
        generated += count;
        if (verbose && count > 0) {
          console.log(`    [dry-run] Would generate derivatives for ${path.relative(downloadedSizeDir, sourcePath)}`);
        }
        continue;
      }

      fs.mkdirSync(outputDir, { recursive: true });
      const result = await generateDerivatives(sourcePath, { force, outputDir });
      const count = Number(result.generated16) + Number(result.generated48);
      generated += count;
      if (verbose && count > 0) {
        console.log(`    Generated derivatives for ${path.relative(downloadedSizeDir, sourcePath)}`);
      }
    } catch (error) {
      console.warn(`    Failed derivatives for ${path.relative(downloadedSizeDir, sourcePath)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return generated;
}

async function rebuildSizeData(
  size: PreciosaRocaillesSize,
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  if (!hasMetadataSidecars(size)) {
    if (options.verbose) {
      console.warn(`  Skipping color extraction for size ${size}: no metadata sidecars found`);
    }
    return;
  }

  if (!options.dryRun) {
    const extractionResult = await extractColors({
      beadType: BEAD_TYPE,
      size,
      inputDir: path.join(PRECIOSA_DIR, size),
      originalDir: path.join(PRECIOSA_DOWNLOADED_DIR, size),
      verbose: options.verbose,
    });

    if (!extractionResult.success) {
      throw new Error(`Color extraction failed for Preciosa Rocailles ${size}/0`);
    }
  }

  summary.colorsRebuilt += 1;
}

async function runPreciosaRocaillesSync(options: SyncOptions): Promise<SyncSummary> {
  const summary: SyncSummary = {
    scraped: 0,
    downloaded: 0,
    metadataWritten: 0,
    derivativesGenerated: 0,
    colorsRebuilt: 0,
    processedSizes: [],
  };

  const scrapedListings = options.localOnly ? [] : await scrapeAllListings(options.sizes, options.verbose);
  summary.scraped = scrapedListings.length;

  const processSizes = collectRequestedProcessSizes(options.sizes, scrapedListings);
  summary.processedSizes = processSizes;

  assertPreciosaRocaillesDimensionsForSizes(processSizes);

  const missingRequestedSizes = (options.sizes || []).filter((size) => !processSizes.includes(size));
  if (options.explicitSizes && missingRequestedSizes.length > 0) {
    console.warn(`Requested sizes not found in the live catalog or local data: ${missingRequestedSizes.join(', ')}`);
  }

  if (processSizes.length === 0) {
    throw new Error('No Preciosa Rocailles sizes are available for processing');
  }

  console.log(
    `${options.localOnly ? 'Using local Preciosa sizes' : 'Processing Preciosa sizes'}: ${processSizes.join(', ')}`
  );

  const listingsBySize = groupListingsBySize(scrapedListings);

  if (!options.localOnly) {
    console.log(options.dryRun ? 'Checking missing originals...' : 'Downloading missing originals...');
    for (const size of processSizes) {
      await ensureLocalAssetsForSize(size, listingsBySize.get(size) || [], options, summary);
    }

    await writeMetadataForListings(scrapedListings, options, summary);
  } else {
    const missingLocalMetadata = processSizes.filter((size) => !hasMetadataSidecars(size));
    if (missingLocalMetadata.length > 0) {
      console.warn(
        `Local-only mode cannot fetch missing metadata for sizes without sidecars: ${missingLocalMetadata.join(', ')}`
      );
    }
  }

  console.log(options.dryRun ? '\nChecking thumbnails...' : '\nGenerating thumbnails...');
  for (const size of processSizes) {
    const generated = await generateThumbnailsForSize(size, options.force, options.verbose, options.dryRun);
    summary.derivativesGenerated += generated;
    console.log(`  Size ${size}: ${generated} ${options.dryRun ? 'derivatives to generate' : 'derivatives generated'}`);
  }

  console.log(options.dryRun ? '\nChecking colors...' : '\nExtracting colors...');
  for (const size of processSizes) {
    await rebuildSizeData(size, options, summary);
  }

  if (options.dryRun) {
    return summary;
  }

  const metadataSizes = processSizes.filter((size) => hasMetadataSidecars(size));

  if (metadataSizes.length === 0) {
    throw new Error('No metadata sidecars are available to generate consolidated metadata');
  }

  if (!options.dryRun) {
    console.log('\nGenerating consolidated metadata...');
    const metadataResult = await generateMetadata({
      beadType: BEAD_TYPE,
      sizes: metadataSizes,
      inputDir: PRECIOSA_DIR,
      verbose: options.verbose,
    });

    if (!metadataResult.success) {
      throw new Error('Metadata generation failed');
    }

    console.log('\nValidating output files...');
    const validation = validateBeadType({ beadType: BEAD_TYPE });
    if (!validation.success) {
      console.warn('Validation reported issues — check output above');
    }
  }

  return summary;
}

function parseArgs(argv: string[]): SyncOptions {
  const sizesArgIndex = argv.indexOf('--sizes');
  const explicitSizes = sizesArgIndex >= 0;
  const requestedSizes =
    explicitSizes && argv[sizesArgIndex + 1]
      ? Array.from(
          new Set(
            argv[sizesArgIndex + 1]
              .split(',')
              .map((value) => normalizePreciosaRocaillesSize(value.trim()))
              .filter((value): value is PreciosaRocaillesSize => Boolean(value))
          )
        )
      : null;

  return {
    sizes: requestedSizes,
    explicitSizes,
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    localOnly: argv.includes('--local-only'),
    force: argv.includes('--force'),
  };
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/beads/preciosa/rocailles/sync.ts [options]

Options:
  --local-only    Skip catalog scraping and rebuild local data only
  --sizes 10,11   Limit processing to specific sizes (default: sizes found in catalog/local data)
  --dry-run       Report what would change without writing files
  --force         Redownload metadata/assets and regenerate thumbnails
  --verbose       Print detailed progress
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    return;
  }

  const options = parseArgs(argv);

  console.log('\n' + '='.repeat(70));
  console.log('PRECIOSA ROCAILLES SYNC');
  console.log('='.repeat(70));

  if (options.dryRun) {
    console.log('DRY RUN: no files will be written\n');
  }

  const startedAt = Date.now();
  const summary = await runPreciosaRocaillesSync(options);

  const summaryLabels = options.dryRun
    ? {
        downloaded: 'images to download',
        metadataWritten: 'metadata files to write',
        derivativesGenerated: 'derivatives to generate',
        colorsRebuilt: 'color datasets to rebuild',
      }
    : {
        downloaded: 'downloaded images',
        metadataWritten: 'metadata written',
        derivativesGenerated: 'derivatives generated',
        colorsRebuilt: 'color datasets rebuilt',
      };

  console.log(`\nPreciosa Rocailles sync summary`);
  console.log(`  sizes processed: ${summary.processedSizes.join(', ')}`);
  console.log(`  scraped listings: ${summary.scraped}`);
  console.log(`  ${summaryLabels.downloaded}: ${summary.downloaded}`);
  console.log(`  ${summaryLabels.metadataWritten}: ${summary.metadataWritten}`);
  console.log(`  ${summaryLabels.derivativesGenerated}: ${summary.derivativesGenerated}`);
  console.log(`  ${summaryLabels.colorsRebuilt}: ${summary.colorsRebuilt}`);
  console.log(`\nCompleted in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\nPreciosa Rocailles sync failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}