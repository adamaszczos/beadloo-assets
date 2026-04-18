import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBeadTypeDirectory, getGeneratedColorDataPath } from '../../../scripts/beads/common/lib/paths.js';

const TEST_BEAD_TYPE = 'vitest-validate-colors';
const TEST_DATA_DIR = path.join(process.cwd(), '.tmp-generated', 'validate-colors');

function cleanup(): void {
  fs.rmSync(path.join(process.cwd(), 'beads', 'vitest'), { recursive: true, force: true });
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  delete process.env.BEAD_ASSETS_DATA_DIR;
}

function writeMetadataLoaderStub(): void {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(TEST_DATA_DIR, 'bead-metadata.ts'),
    `export interface BeadMetadata {
  shape: string;
  size: string;
  glassGroup: string;
  dyed: string;
  galvanized: string;
  plating: string;
}

export type BeadType = "${TEST_BEAD_TYPE}";

export interface BeadTypeSizes {
  "${TEST_BEAD_TYPE}": "11";
}

export function getBeadMetadata(): BeadMetadata | null {
  return null;
}

export async function getBeadMetadataAsync(): Promise<BeadMetadata | null> {
  return null;
}

export async function preloadMetadata(): Promise<void> {}
`
  );
}

async function loadValidator() {
  process.env.BEAD_ASSETS_DATA_DIR = '.tmp-generated/validate-colors';
  vi.resetModules();
  return import('../../../scripts/beads/common/validate-bead-type.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('validateBeadType', () => {
  it('does not treat thumbnail-only beads as orphaned metadata', async () => {
    const beadDir = getBeadTypeDirectory(TEST_BEAD_TYPE, '11');
    fs.mkdirSync(beadDir, { recursive: true });

    fs.writeFileSync(path.join(beadDir, 'DB0001.metadata.json'), JSON.stringify({ size: '11/0' }));
    fs.writeFileSync(path.join(beadDir, 'DB0001_48x48.jpg'), Buffer.from('thumb'));

    writeMetadataLoaderStub();
    const colorJsonPath = getGeneratedColorDataPath(TEST_BEAD_TYPE, '11', TEST_DATA_DIR);
    fs.mkdirSync(path.dirname(colorJsonPath), { recursive: true });
    fs.writeFileSync(
      colorJsonPath,
      JSON.stringify(
        {
          beadIds: { '#112233': ['DB0001'] },
          colorMappings: { DB0001: '#112233' },
        },
        null,
        2
      )
    );

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { validateBeadType } = await loadValidator();
    const result = validateBeadType({ beadType: TEST_BEAD_TYPE, size: '11' });
    consoleSpy.mockRestore();

    expect(
      result.issues.some(issue => issue.message.includes('Metadata exists but no image assets were found'))
    ).toBe(false);
  });

  it('warns when a metadata-backed bead ID is missing from color JSON', async () => {
    const beadDir = getBeadTypeDirectory(TEST_BEAD_TYPE, '11');
    fs.mkdirSync(beadDir, { recursive: true });

    fs.writeFileSync(path.join(beadDir, 'DB0001.metadata.json'), JSON.stringify({ size: '11/0' }));
    fs.writeFileSync(path.join(beadDir, 'DB0001_48x48.jpg'), Buffer.from('thumb'));

    writeMetadataLoaderStub();
    const colorJsonPath = getGeneratedColorDataPath(TEST_BEAD_TYPE, '11', TEST_DATA_DIR);
    fs.mkdirSync(path.dirname(colorJsonPath), { recursive: true });
    fs.writeFileSync(
      colorJsonPath,
      JSON.stringify(
        {
          beadIds: {},
          colorMappings: {},
        },
        null,
        2
      )
    );

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { validateBeadType } = await loadValidator();
    const result = validateBeadType({ beadType: TEST_BEAD_TYPE, size: '11' });
    consoleSpy.mockRestore();

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: 'color-coverage',
        message: 'Known bead ID missing from color JSON: DB0001',
      })
    );
  });
});
