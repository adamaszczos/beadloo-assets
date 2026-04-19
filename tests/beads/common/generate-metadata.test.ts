import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateMetadata } from '../../../scripts/beads/common/generate-metadata.js';
import { getGeneratedMetadataDataPath } from '../../../scripts/beads/common/lib/paths.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('generateMetadata', () => {
  it('uses metadata beadId values from nested directories as the generated keys', async () => {
    const inputDir = createTemporaryDirectory('beadloo-metadata-input-');
    const outputDir = createTemporaryDirectory('beadloo-metadata-output-');

    fs.mkdirSync(path.join(inputDir, '1', '331-19001'), { recursive: true });
    fs.writeFileSync(
      path.join(inputDir, '1', '331-19001', '20420.metadata.json'),
      JSON.stringify({
        beadId: '311-19001-1_0-20420',
        shape: 'Rocailles',
        size: '1/0',
        glassGroup: 'Transparent',
        dyed: 'Non Dyed',
        galvanized: 'Non Galvanized',
        plating: 'Non Plated',
      })
    );

    const result = await generateMetadata({
      beadType: 'vitest-generate-metadata',
      sizes: ['1'],
      inputDir,
      outputDir,
    });

    expect(result.success).toBe(true);

    const metadataJson = JSON.parse(
      fs.readFileSync(getGeneratedMetadataDataPath('vitest-generate-metadata', '1', outputDir), 'utf-8')
    );

    expect(metadataJson['311-19001-1_0-20420']).toEqual(
      expect.objectContaining({
        beadId: '311-19001-1_0-20420',
        shape: 'Rocailles',
      })
    );
  });
});