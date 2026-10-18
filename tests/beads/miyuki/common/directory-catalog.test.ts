import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  applyDecisions,
  countSitemapLocs,
  isWordfenceBlock,
  loadDirectoryListings,
  parseDecisionsCsv,
  readDirectoryDump,
  sitemapUrl,
  storeApiUrl,
  summarizeListings,
  writeDirectoryDump,
} from '../../../../scripts/beads/miyuki/common/directory-catalog.js';
import type { DirectoryDump, DirectoryProduct } from '../../../../scripts/beads/miyuki/common/directory-products.js';

function product(id: number, name: string, sku: string): DirectoryProduct {
  return { id, sku, name, slug: '', permalink: `https://directory.miyuki-beads.co.jp/${id}/`, categories: [], images: [{ src: `https://x/${id}.jpg` }], attributes: [] };
}

function dumpWith(products: DirectoryProduct[]): DirectoryDump {
  return { source: 'test', fetchedAt: '2026-10-16T00:00:00.000Z', perPage: 100, pages: 1, reportedTotal: products.length, sitemapTotal: null, products };
}

describe('URL helpers', () => {
  it('builds the Store API and sitemap URLs', () => {
    expect(storeApiUrl(3)).toBe('https://directory.miyuki-beads.co.jp/wp-json/wc/store/v1/products?per_page=100&page=3');
    expect(sitemapUrl(2)).toBe('https://directory.miyuki-beads.co.jp/wp-sitemap-posts-product-2.xml');
  });

  it('recognises a Wordfence block and nothing else', () => {
    expect(isWordfenceBlock(503, 'text/html; charset=UTF-8', '<title>Your access to this site has been limited by the site owner</title>')).toBe(true);
    expect(isWordfenceBlock(503, 'application/json', '{"error":"maintenance"}')).toBe(false);
    expect(isWordfenceBlock(200, 'text/html', 'access to this site has been limited')).toBe(false);
  });

  it('counts sitemap entries', () => {
    expect(countSitemapLocs('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>')).toBe(2);
    expect(countSitemapLocs('')).toBe(0);
  });
});

describe('dump I/O and listings', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-dump-'));
  const dumpPath = path.join(tmp, 'products.json');
  const noDecisions = path.join(tmp, 'no-decisions.csv');

  it('writes products sorted by id and reads them back', () => {
    writeDirectoryDump(dumpWith([product(5, '#1 Round Rocailles 15/0', 'N-RR15-0001'), product(2, 'DB0001 Delica Beads 11/0', 'N-DB-0001')]), dumpPath);
    expect(readDirectoryDump(dumpPath).products.map((p) => p.id)).toEqual([2, 5]);
  });

  it('refuses to read a missing dump with a hint', () => {
    expect(() => readDirectoryDump(path.join(tmp, 'nope.json'))).toThrow(/beads:miyuki:directory -- --fetch/);
  });

  it('separates square hole, conflicts and the requested bead type', () => {
    writeDirectoryDump(
      dumpWith([
        product(1, '#1 Round Rocailles 15/0', 'N-RR15-0001'),
        product(2, '3271 Round Rocailles (SH) 6/0', 'N-RR6S-3271'),
        product(3, '#260(148R) Round Rocailles 6/0', 'N-RR6-0148R'),
        product(4, 'DB31L Delica Beads 11/0', 'N-DB-0031L'),
        product(5, 'TL-420 TILA Beads', 'TL-420'),
      ]),
      dumpPath
    );
    const heldOut = loadDirectoryListings('miyuki-round_rocailles', { dumpPath, decisionsPath: noDecisions });
    expect(heldOut.listings.map((l) => l.beadId)).toEqual(['1']);
    expect(heldOut.deferredSquareHole.map((l) => l.beadId)).toEqual(['3271SH']);
    expect(heldOut.conflicts.map((l) => l.beadId)).toEqual(['260']);

    const withSquareHole = loadDirectoryListings('miyuki-round_rocailles', { dumpPath, includeSquareHole: true, decisionsPath: noDecisions });
    expect(withSquareHole.listings.map((l) => l.beadId)).toEqual(['1', '3271SH']);
    expect(withSquareHole.deferredSquareHole).toEqual([]);

    expect(loadDirectoryListings('miyuki-delica', { dumpPath, decisionsPath: noDecisions }).listings.map((l) => l.beadId)).toEqual(['DB0031L']);
  });

  it('fails loudly when a product that looks like a bead does not parse', () => {
    writeDirectoryDump(dumpWith([product(1, 'Round Rocailles assortment 11/0', 'X')]), dumpPath);
    expect(() => loadDirectoryListings('miyuki-round_rocailles', { dumpPath, decisionsPath: noDecisions })).toThrow(/1 directory product\(s\) do not parse/);
  });

  it('summarises listings per type, size and hole', () => {
    writeDirectoryDump(
      dumpWith([
        product(1, '#1 Round Rocailles 15/0', 'N-RR15-0001'),
        product(2, '#1(131S) Round Rocailles 6/0', 'N-RR6-0001'),
        product(3, '3271 Round Rocailles (SH) 6/0', 'N-RR6S-3271'),
        product(4, 'DB0001 Delica Beads 11/0', 'N-DB-0001'),
      ]),
      dumpPath
    );
    const { listings } = loadDirectoryListings('miyuki-round_rocailles', { dumpPath, includeSquareHole: true, decisionsPath: noDecisions });
    const all = [...listings, ...loadDirectoryListings('miyuki-delica', { dumpPath, decisionsPath: noDecisions }).listings];
    const summary = summarizeListings(all);
    expect(summary.byTypeAndSize).toEqual({ 'miyuki-delica': { '11': 1 }, 'miyuki-round_rocailles': { '15': 1, '6': 2 } });
    expect(summary.squareHole).toEqual({ '6': 1 });
    expect(summary.withOldNumber).toBe(1);
    expect(summary.withConflicts).toEqual([]);
  });
});

describe('decisions on held-out products', () => {
  const csv = [
    'productId,sku,name,decision,beadId,size,decidedOn,reason',
    '6566,N-RR6-0148R,#260(148R) Round Rocailles 6/0,accept,260,6,2026-10-17,"old number in the SKU, current number free at 6/0"',
    '7086,N-RR8-1255,#2006(1255) Round Rocailles 8/0,reject,,8,2026-10-17,"collides with the plain #2006 8/0 product"',
  ].join('\n');

  it('parses the CSV and validates it', () => {
    const decisions = parseDecisionsCsv(csv);
    expect(decisions.map((d) => [d.productId, d.decision, d.beadId])).toEqual([[6566, 'accept', '260'], [7086, 'reject', '']]);
    expect(() => parseDecisionsCsv('productId,sku\n1,x')).toThrow(/unexpected header/);
    expect(() => parseDecisionsCsv(`${csv.split('\n')[0]}\n1,x,y,maybe,,6,2026-10-17,r`)).toThrow(/accept or reject/);
    expect(() => parseDecisionsCsv(`${csv.split('\n')[0]}\n1,x,y,accept,,6,2026-10-17,r`)).toThrow(/needs a beadId/);
  });

  it('accepts, rejects or leaves conflicts undecided, matching product id and SKU', () => {
    const conflict = (id: number, name: string, sku: string, beadId: string, size: string) => ({
      ...product(id, name, sku),
      beadType: 'miyuki-round_rocailles' as const,
      beadId,
      size,
      hole: 'RH' as const,
      imageUrl: undefined,
      productId: id,
      attributes: [],
      conflicts: ['SKU code ≠ name number'],
    });
    const listings = [
      conflict(6566, '#260(148R) Round Rocailles 6/0', 'N-RR6-0148R', '260', '6'),
      conflict(7086, '#2006(1255) Round Rocailles 8/0', 'N-RR8-1255', '2006', '8'),
      conflict(9999, '#1053(182) Round Rocailles 15/0', 'N-RR15-0182', '1053', '15'),
    ];
    const applied = applyDecisions(listings as never, parseDecisionsCsv(csv));
    expect(applied.accepted.map((l) => [l.beadId, l.conflicts])).toEqual([['260', []]]);
    expect(applied.rejected.map((l) => l.beadId)).toEqual(['2006']);
    expect(applied.undecided.map((l) => l.beadId)).toEqual(['1053']);
  });

  it('refuses an accept decision whose bead ID disagrees with the parsed listing', () => {
    const listing = { ...product(6566, '#261(148R) Round Rocailles 6/0', 'N-RR6-0148R'), beadType: 'miyuki-round_rocailles', beadId: '261', size: '6', hole: 'RH', productId: 6566, attributes: [], conflicts: ['x'] };
    expect(() => applyDecisions([listing as never], parseDecisionsCsv(csv))).toThrow(/accepted as 260/);
  });

  it('loadDirectoryListings applies the decisions file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-decisions-'));
    const dumpPath = path.join(tmp, 'products.json');
    const decisionsPath = path.join(tmp, 'decisions.csv');
    fs.writeFileSync(decisionsPath, csv);
    writeDirectoryDump(
      dumpWith([
        product(6566, '#260(148R) Round Rocailles 6/0', 'N-RR6-0148R'),
        product(7086, '#2006(1255) Round Rocailles 8/0', 'N-RR8-1255'),
        product(1, '#1 Round Rocailles 15/0', 'N-RR15-0001'),
      ]),
      dumpPath
    );
    const result = loadDirectoryListings('miyuki-round_rocailles', { dumpPath, decisionsPath });
    expect(result.listings.map((l) => `${l.size}:${l.beadId}`).sort()).toEqual(['15:1', '6:260']);
    expect(result.rejected.map((l) => l.beadId)).toEqual(['2006']);
    expect(result.conflicts).toEqual([]);
  });
});
