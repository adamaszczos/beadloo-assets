import { describe, expect, it } from 'vitest';
import { parseMetadataFromHtml } from '../../../../scripts/beads/miyuki/common/scrape-metadata.js';

function buildAdditionalInformationTable(rows: Array<[string, string]>): string {
  const tableRows = rows
    .map(([label, value]) => `<tr><th>${label}</th><td><p>${value}</p></td></tr>`)
    .join('');

  return `<html><body><h2>Additional information</h2><table>${tableRows}</table></body></html>`;
}

describe('parseMetadataFromHtml', () => {
  it('parses Miyuki metadata when Color Group is missing', () => {
    const html = buildAdditionalInformationTable([
      ['Shape', 'Round Rocailles'],
      ['Size', '11/0'],
      ['Glass Group', 'Opaque'],
      ['Finish', 'Glass enamel, Rainbow'],
      ['Dyed', 'Non Dyed'],
      ['Galvanized', 'Non-galvanized'],
      ['Plating', 'Non-Plating'],
    ]);

    expect(parseMetadataFromHtml(html)).toEqual({
      shape: 'Round Rocailles',
      size: '11/0',
      glassGroup: 'Opaque',
      finish: 'Glass enamel, Rainbow',
      dyed: 'Non Dyed',
      galvanized: 'Non-galvanized',
      plating: 'Non-Plating',
    });
  });

  it('still rejects pages missing required metadata fields', () => {
    const html = buildAdditionalInformationTable([
      ['Shape', 'Round Rocailles'],
      ['Size', '11/0'],
      ['Finish', 'Glass enamel, Rainbow'],
      ['Dyed', 'Non Dyed'],
      ['Galvanized', 'Non-galvanized'],
      ['Plating', 'Non-Plating'],
    ]);

    expect(parseMetadataFromHtml(html)).toBeNull();
  });
});
