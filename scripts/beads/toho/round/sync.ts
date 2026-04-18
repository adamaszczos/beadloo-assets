#!/usr/bin/env tsx
/**
 * TOHO Round bead sync/build pipeline.
 *
 * Responsibilities:
 * 1. Scrape Czech Beads TOHO Round category pages for product IDs/descriptions/images.
 * 2. Download missing source images into beads/toho/round/<size>/.
 * 3. Generate 16x16 and 48x48 derivatives for palette/editor previews.
 * 4. Rebuild local generated TOHO color datasets via image-based color extraction.
 * 5. Rebuild local generated TOHO metadata datasets from scraped metadata sidecars.
 */

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import dotenv from "dotenv";
import { parse } from "node-html-parser";
import { extractColors } from "../../common/extract-colors.js";
import { regenerateUnifiedLoader } from "../../common/generate-metadata.js";
import {
  getBeadTypeDirectory,
  getDownloadedBeadTypeDirectory,
  getGeneratedMetadataDataPath,
} from "../../common/lib/paths.js";
import { generateDerivatives } from "../../common/lib/thumbnails.js";
import {
  TOHO_ROUND_SIZES,
  type TohoRoundSize,
  getTohoRoundSizeCode,
  getTohoRoundSizeDisplayName,
  tohoRoundDimensionTable,
} from "./lib/config.js";

dotenv.config();

type SyncOptions = {
  sizes: TohoRoundSize[];
  dryRun: boolean;
  verbose: boolean;
  localOnly: boolean;
  force: boolean;
};

type TohoRoundListing = {
  beadId: string;
  size: TohoRoundSize;
  sizeCode: string;
  sizeLabel: `${number}/0`;
  name: string;
  description: string;
  imageUrl: string;
  thumbnailImageUrl?: string;
  productUrl: string;
  availability: "available" | "outofstock";
  sourceUrl: string;
};

type TohoRoundMetadata = {
  shape: string;
  size: string;
  colorGroup?: string;
  glassGroup: string;
  finish?: string;
  dyed: string;
  galvanized: string;
  plating: string;
};

type SyncSummary = {
  scraped: number;
  downloaded: number;
  metadataWritten: number;
  derivativesGenerated: number;
  colorsRebuilt: number;
};

const TOHO_BASE_URL = "https://www.czechbeads.eu";
const REQUEST_DELAY_MS = 1200;
const TOHO_ASSET_DIR = getBeadTypeDirectory('toho-round');
const TOHO_DOWNLOADED_DIR = getDownloadedBeadTypeDirectory('toho-round');
const TOHO_DIMENSIONS_PATH = path.join(TOHO_ASSET_DIR, "toho-rounded.json");
const FETCH_TIMEOUT_MS = 30000;

const TOHO_GROUP_URLS: Record<TohoRoundSize, string> = {
  "3": `${TOHO_BASE_URL}/Catalog/Groups/TR-03/TOHO-Round-30?v=IMGS`,
  "6": `${TOHO_BASE_URL}/Catalog/Groups/TR-06/TOHO-Round-60?v=IMGS`,
  "8": `${TOHO_BASE_URL}/Catalog/Groups/TR-08/TOHO-Round-80?v=IMGS`,
  "11": `${TOHO_BASE_URL}/Catalog/Groups/TR-11/TOHO-Round-110?v=IMGS`,
  "15": `${TOHO_BASE_URL}/Catalog/Groups/TR-15/TOHO-Round-150?v=IMGS`,
};

const FINISH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\btransparent-frosted\b/i, label: "Frosted" },
  { pattern: /\bfrosted\b/i, label: "Frosted" },
  { pattern: /\bmatte\b/i, label: "Matte" },
  { pattern: /\bsilver[- ]lined\b/i, label: "Silver-Lined" },
  { pattern: /\bgold[- ]lined\b/i, label: "Gold-Lined" },
  { pattern: /\bcolor[- ]lined\b/i, label: "Color-Lined" },
  { pattern: /\binside[- ]color\b/i, label: "Inside-Color" },
  { pattern: /\bgalvanized\b/i, label: "Galvanized" },
  { pattern: /\bmetallic\b/i, label: "Metallic" },
  { pattern: /\bperma(?:nent)?[- ]finish\b/i, label: "Permanent Finish" },
  { pattern: /\brace?bow\b/i, label: "Rainbow" },
  { pattern: /\bceylon\b/i, label: "Ceylon" },
  { pattern: /\bluster(?:ed)?\b/i, label: "Luster" },
  { pattern: /\bab\b/i, label: "AB" },
];

const COLOR_GROUP_NOISE = [
  "transparent",
  "opaque",
  "frosted",
  "matte",
  "silver-lined",
  "silver lined",
  "gold-lined",
  "gold lined",
  "color-lined",
  "color lined",
  "inside-color",
  "inside color",
  "galvanized",
  "metallic",
  "permafinish",
  "permanent finish",
  "rainbow",
  "ceylon",
  "luster",
  "lustered",
  "higher",
  "hybrid colortrends",
  "ab",
];

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsoluteUrl(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${TOHO_BASE_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

export function toPreferredOriginalImageUrl(url: string): string {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/images/Products/")) {
      return url;
    }

    const extension = path.posix.extname(parsed.pathname);
    const baseName = path.posix.basename(parsed.pathname, extension);

    if (!extension || baseName.toLowerCase().endsWith("_detail")) {
      return url;
    }

    parsed.pathname = path.posix.join(
      path.posix.dirname(parsed.pathname),
      `${baseName}_detail${extension}`
    );

    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeTohoRoundBeadId(
  rawBeadId: string | null | undefined,
  size: TohoRoundSize
): string | null {
  if (!rawBeadId) {
    return null;
  }

  const normalized = rawBeadId.trim().toUpperCase();
  const expectedPrefix = `TR-${getTohoRoundSizeCode(size)}-`;

  if (!normalized.startsWith(expectedPrefix)) {
    return null;
  }

  return /^TR-(03|06|08|11|15)-[A-Z0-9]+$/i.test(normalized) ? normalized : null;
}

export function extractTohoRoundDescription(
  altText: string,
  sizeLabel: `${number}/0`
): string {
  const normalized = altText.trim();
  const prefixPattern = new RegExp(
    `^TOHO(?:\\s*-\\s*|\\s+)Round\\s*${sizeLabel.replace("/", "\\/")}\\s*:\\s*`,
    "i"
  );
  const stripped = normalized.replace(prefixPattern, "").trim();
  return stripped || normalized;
}

export function inferColorGroup(description: string): string {
  let value = description.replace(/^TOHO(?:\s*-\s*|\s+)Round\s*\d+\/0\s*:\s*/i, "").trim();

  for (const token of COLOR_GROUP_NOISE) {
    value = value.replace(new RegExp(`\\b${token.replace(/[ -]/g, "[- ]")}\\b`, "ig"), " ");
  }

  value = value.replace(/^[/:,\-\s]+/, "").replace(/\s+/g, " ").replace(/\s*-\s*/g, " ").trim();
  return value;
}

export function inferTohoRoundMetadata(listing: TohoRoundListing): TohoRoundMetadata {
  const description = listing.description;
  const normalized = description.toLowerCase();
  const colorGroup = inferColorGroup(description);
  const finishes = FINISH_PATTERNS.filter(({ pattern }) => pattern.test(description)).map(
    ({ label }) => label
  );

  let glassGroup = "Other";
  if (/\bmetallic\b|\bgalvanized\b|\bperma(?:nent)?[- ]finish\b/i.test(description)) {
    glassGroup = "Metallic";
  } else if (/\bopaque\b|\bceylon\b/i.test(description)) {
    glassGroup = "Opaque";
  } else if (
    /\btransparent\b|\bsilver[- ]lined\b|\bgold[- ]lined\b|\bcolor[- ]lined\b|\binside[- ]color\b/i.test(
      description
    )
  ) {
    glassGroup = "Transparent";
  }

  return {
    shape: "Round",
    size: listing.sizeLabel,
    ...(colorGroup ? { colorGroup } : {}),
    glassGroup,
    finish: finishes.length > 0 ? Array.from(new Set(finishes)).join(", ") : undefined,
    dyed: /\bdyed\b/i.test(normalized) ? "Dyed" : "Non Dyed",
    galvanized: /\bgalvanized\b/i.test(normalized) ? "Galvanized" : "Non Galvanized",
    plating:
      /\bplated\b|\bsilver[- ]lined\b|\bgold[- ]lined\b|\bcolor[- ]lined\b|\bperma(?:nent)?[- ]finish\b/i.test(
        normalized
      )
        ? "Plated"
        : "Non Plated",
  };
}

export function parseTohoRoundGroupHtml(
  html: string,
  size: TohoRoundSize
): TohoRoundListing[] {
  const root = parse(html);
  const sizeCode = getTohoRoundSizeCode(size);
  const sizeLabel = getTohoRoundSizeDisplayName(size);
  const sourceUrl = TOHO_GROUP_URLS[size];
  const byId = new Map<string, TohoRoundListing>();

  for (const card of root.querySelectorAll(".card.product")) {
    const cardImage = card.querySelector(".card-image");
    const link = cardImage?.querySelector("a");
    const image = cardImage?.querySelector("img");
    const rawBeadId = cardImage?.getAttribute("itemcode") || "";
    const beadId = normalizeTohoRoundBeadId(rawBeadId, size);

    if (!beadId || !image) {
      continue;
    }

    const description = extractTohoRoundDescription(image.getAttribute("alt") || beadId, sizeLabel);
    const availability = card.classNames.includes("outofstock") ? "outofstock" : "available";

    const thumbnailImageUrl = toAbsoluteUrl(image.getAttribute("src"));
    const imageUrl = toPreferredOriginalImageUrl(thumbnailImageUrl);

    byId.set(beadId, {
      beadId,
      size,
      sizeCode,
      sizeLabel,
      name: image.getAttribute("alt") || beadId,
      description,
      imageUrl,
      thumbnailImageUrl: thumbnailImageUrl !== imageUrl ? thumbnailImageUrl : undefined,
      productUrl: toAbsoluteUrl(link?.getAttribute("href")),
      availability,
      sourceUrl,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.beadId.localeCompare(b.beadId));
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

function getSizeDirectory(size: TohoRoundSize): string {
  return path.join(TOHO_ASSET_DIR, size);
}

function getDownloadedSizeDirectory(size: TohoRoundSize): string {
  return path.join(TOHO_DOWNLOADED_DIR, size);
}

function getOriginalImagePath(size: TohoRoundSize, beadId: string): string {
  return path.join(getDownloadedSizeDirectory(size), `${beadId}.jpg`);
}

function getMetadataSidecarPath(size: TohoRoundSize, beadId: string): string {
  return path.join(getSizeDirectory(size), `${beadId}.metadata.json`);
}

function getConsolidatedMetadataPath(size: TohoRoundSize): string {
  return getGeneratedMetadataDataPath('toho-round', size);
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function getDownloadCandidates(listing: TohoRoundListing): string[] {
  return Array.from(
    new Set([listing.imageUrl, listing.thumbnailImageUrl].filter((value): value is string => Boolean(value)))
  );
}

async function downloadImage(urls: string[], outputPath: string): Promise<string> {
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      return url;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Failed to download image candidates for ${outputPath}`);
}

async function isUndersizedOriginal(imagePath: string): Promise<boolean> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  return width <= 100 && height <= 50;
}

function writeMetadataSidecar(
  listing: TohoRoundListing,
  dryRun: boolean
): boolean {
  const outputPath = getMetadataSidecarPath(listing.size, listing.beadId);
  const metadata = inferTohoRoundMetadata(listing);

  if (dryRun) {
    return !fileExists(outputPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  return true;
}

function loadMetadataSidecars(size: TohoRoundSize): Record<string, TohoRoundMetadata> {
  const sizeDir = getSizeDirectory(size);
  const consolidated: Record<string, TohoRoundMetadata> = {};

  if (!fileExists(sizeDir)) {
    return consolidated;
  }

  for (const entry of fs.readdirSync(sizeDir)) {
    if (!entry.endsWith(".metadata.json")) {
      continue;
    }

    const beadId = entry.replace(/\.metadata\.json$/i, "").toUpperCase();
    const content = fs.readFileSync(path.join(sizeDir, entry), "utf-8");
    consolidated[beadId] = JSON.parse(content) as TohoRoundMetadata;
  }

  return Object.fromEntries(
    Object.entries(consolidated).sort(([left], [right]) => left.localeCompare(right))
  );
}

function writeConsolidatedMetadata(size: TohoRoundSize, dryRun: boolean): boolean {
  const outputPath = getConsolidatedMetadataPath(size);
  const metadata = loadMetadataSidecars(size);

  if (dryRun) {
    return true;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  return true;
}

function writeDimensionsFile(dryRun: boolean): void {
  if (dryRun) {
    return;
  }

  fs.mkdirSync(path.dirname(TOHO_DIMENSIONS_PATH), { recursive: true });
  fs.writeFileSync(TOHO_DIMENSIONS_PATH, `${JSON.stringify(tohoRoundDimensionTable, null, 2)}\n`, "utf-8");
}

async function scrapeListingsForSize(size: TohoRoundSize, verbose: boolean): Promise<TohoRoundListing[]> {
  const url = TOHO_GROUP_URLS[size];
  if (verbose) {
    console.log(`\n[TOHO ${size}/0] Fetching ${url}`);
  }

  const html = await fetchHtml(url);
  const listings = parseTohoRoundGroupHtml(html, size);

  if (verbose) {
    console.log(`[TOHO ${size}/0] Parsed ${listings.length} listings`);
  }

  return listings;
}

async function ensureLocalAssetsForSize(
  size: TohoRoundSize,
  listings: TohoRoundListing[],
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  const sizeDir = getSizeDirectory(size);
  const downloadedSizeDir = getDownloadedSizeDirectory(size);
  fs.mkdirSync(sizeDir, { recursive: true });
  fs.mkdirSync(downloadedSizeDir, { recursive: true });

  for (const listing of listings) {
    const imagePath = getOriginalImagePath(size, listing.beadId);
    const imageExists = fileExists(imagePath);
    let shouldDownload = !options.localOnly && (options.force || !imageExists);
    let resolvedListing = listing;

    if (!shouldDownload && imageExists && !options.localOnly) {
      try {
        shouldDownload = await isUndersizedOriginal(imagePath);
        if (shouldDownload && options.verbose) {
          console.log(`  Refreshing undersized original ${listing.beadId}`);
        }
      } catch (error) {
        console.warn(
          `  Failed to inspect existing original for ${listing.beadId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    if (shouldDownload) {
      try {
        if (options.verbose) {
          console.log(`  ${options.dryRun ? "[dry-run] " : ""}Downloading ${listing.beadId}`);
        }

        if (!options.dryRun) {
          const usedImageUrl = await downloadImage(getDownloadCandidates(listing), imagePath);
          if (usedImageUrl !== listing.imageUrl) {
            resolvedListing = { ...listing, imageUrl: usedImageUrl };
          }
        }
        summary.downloaded += 1;
      } catch (error) {
        console.warn(`  Failed to download ${listing.beadId}: ${error instanceof Error ? error.message : error}`);
        if (!fileExists(imagePath)) {
          continue;
        }
      }
    }

    summary.metadataWritten += writeMetadataSidecar(resolvedListing, options.dryRun) ? 1 : 0;

    if (!options.dryRun && fileExists(imagePath)) {
      try {
        const derivativeResult = await generateDerivatives(imagePath, { force: options.force, outputDir: sizeDir });
        summary.derivativesGenerated += Number(derivativeResult.generated16) + Number(derivativeResult.generated48);
      } catch (error) {
        console.warn(`  Failed to generate derivatives for ${listing.beadId}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

async function rebuildSizeData(
  size: TohoRoundSize,
  options: SyncOptions,
  summary: SyncSummary
): Promise<void> {
  writeConsolidatedMetadata(size, options.dryRun);

  if (!options.dryRun) {
    const extractionResult = await extractColors({
      beadType: "toho-round",
      size,
      inputDir: getSizeDirectory(size),
      originalDir: getDownloadedSizeDirectory(size),
      verbose: options.verbose,
    });

    if (!extractionResult.success) {
      throw new Error(`Color extraction failed for TOHO ${size}/0`);
    }
  }

  summary.colorsRebuilt += 1;
}

async function scrapeAndSyncTohoRound(options: SyncOptions): Promise<SyncSummary> {
  const summary: SyncSummary = {
    scraped: 0,
    downloaded: 0,
    metadataWritten: 0,
    derivativesGenerated: 0,
    colorsRebuilt: 0,
  };

  writeDimensionsFile(options.dryRun);

  for (const size of options.sizes) {
    const listings = options.localOnly ? [] : await scrapeListingsForSize(size, options.verbose);
    summary.scraped += listings.length;

    if (!options.localOnly) {
      await ensureLocalAssetsForSize(size, listings, options, summary);
      await delay(REQUEST_DELAY_MS);
    }

    await rebuildSizeData(size, options, summary);
  }

  if (!options.dryRun) {
    console.log('\nRegenerating unified bead-metadata.ts...');
    regenerateUnifiedLoader();
  }

  return summary;
}

function parseArgs(argv: string[]): SyncOptions {
  const sizesArgIndex = argv.indexOf("--sizes");
  const requestedSizes =
    sizesArgIndex >= 0 && argv[sizesArgIndex + 1]
      ? argv[sizesArgIndex + 1]
          .split(",")
          .map((value) => value.trim())
          .filter((value): value is TohoRoundSize => TOHO_ROUND_SIZES.includes(value as TohoRoundSize))
      : [...TOHO_ROUND_SIZES];

  return {
    sizes: requestedSizes,
    dryRun: argv.includes("--dry-run"),
    verbose: argv.includes("--verbose"),
    localOnly: argv.includes("--local-only"),
    force: argv.includes("--force"),
  };
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/beads/toho/round/sync.ts [options]

Options:
  --local-only    Skip scraping/downloading and rebuild local TOHO data only
  --sizes 3,6     Limit processing to specific sizes
  --dry-run       Report what would change without writing files
  --force         Redownload/regenerate even when local files exist
  --verbose       Print detailed progress
`);
}

export async function runTohoRoundSync(options: SyncOptions): Promise<void> {
  const startedAt = Date.now();
  const summary = await scrapeAndSyncTohoRound(options);

  console.log(`\nTOHO Round sync summary`);
  console.log(`  sizes processed: ${options.sizes.join(", ")}`);
  console.log(`  scraped listings: ${summary.scraped}`);
  console.log(`  downloaded images: ${summary.downloaded}`);
  console.log(`  metadata writes: ${summary.metadataWritten}`);
  console.log(`  derivatives generated: ${summary.derivativesGenerated}`);
  console.log(`  color datasets rebuilt: ${summary.colorsRebuilt}`);
  console.log(`\nCompleted in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    return;
  }

  const options = parseArgs(argv);
  await runTohoRoundSync(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\nTOHO Round sync failed:`, error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
