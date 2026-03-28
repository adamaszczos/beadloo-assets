import { describe, expect, it } from 'vitest';
import {
  normalizeTohoRoundBeadId,
  extractTohoRoundDescription,
  inferColorGroup,
  inferTohoRoundMetadata,
  toPreferredOriginalImageUrl,
} from '../../../../scripts/beads/toho/round/sync.js';
import { isOriginalBlobAssetFile } from '../../../../scripts/beads/common/lib/blob.js';

describe('normalizeTohoRoundBeadId', () => {
  it('accepts valid bead IDs', () => {
    expect(normalizeTohoRoundBeadId('TR-11-1', '11')).toBe('TR-11-1');
    expect(normalizeTohoRoundBeadId('TR-08-49F', '8')).toBe('TR-08-49F');
    expect(normalizeTohoRoundBeadId('TR-15-PF557', '15')).toBe('TR-15-PF557');
  });

  it('normalizes to uppercase', () => {
    expect(normalizeTohoRoundBeadId('tr-11-1', '11')).toBe('TR-11-1');
  });

  it('rejects null/undefined/empty', () => {
    expect(normalizeTohoRoundBeadId(null, '11')).toBeNull();
    expect(normalizeTohoRoundBeadId(undefined, '11')).toBeNull();
    expect(normalizeTohoRoundBeadId('', '11')).toBeNull();
  });

  it('rejects IDs with wrong size prefix', () => {
    expect(normalizeTohoRoundBeadId('TR-08-1', '11')).toBeNull();
    expect(normalizeTohoRoundBeadId('TR-11-1', '8')).toBeNull();
  });

  it('rejects malformed IDs', () => {
    expect(normalizeTohoRoundBeadId('NOTABEADID', '11')).toBeNull();
    expect(normalizeTohoRoundBeadId('TR-11-', '11')).toBeNull();
  });
});

describe('extractTohoRoundDescription', () => {
  it('strips TOHO Round size prefix', () => {
    expect(extractTohoRoundDescription('TOHO Round 11/0: Transparent Ruby', '11/0'))
      .toBe('Transparent Ruby');
  });

  it('handles variations with dash', () => {
    expect(extractTohoRoundDescription('TOHO - Round 8/0: Opaque White', '8/0'))
      .toBe('Opaque White');
  });

  it('returns original when no prefix', () => {
    expect(extractTohoRoundDescription('Opaque White', '11/0')).toBe('Opaque White');
  });

  it('trims whitespace', () => {
    expect(extractTohoRoundDescription('  TOHO Round 11/0: Silver  ', '11/0')).toBe('Silver');
  });
});

describe('inferColorGroup', () => {
  it('removes noise words from description', () => {
    const result = inferColorGroup('Transparent Frosted Ruby');
    expect(result.toLowerCase()).not.toContain('transparent');
    expect(result.toLowerCase()).not.toContain('frosted');
    expect(result).toContain('Ruby');
  });

  it('works with TOHO prefix in description', () => {
    const result = inferColorGroup('TOHO Round 11/0: Opaque White');
    expect(result).toBe('White');
  });

  it('returns cleaned color group', () => {
    const result = inferColorGroup('Silver-Lined Crystal');
    expect(result.toLowerCase()).not.toContain('silver-lined');
    expect(result).toContain('Crystal');
  });
});

describe('inferTohoRoundMetadata', () => {
  const baseListing = {
    beadId: 'TR-11-1',
    size: '11' as const,
    sizeCode: '11',
    sizeLabel: '11/0' as const,
    name: 'TOHO Round 11/0: Transparent Crystal',
    description: 'Transparent Crystal',
    imageUrl: '',
    productUrl: '',
    availability: 'available' as const,
    sourceUrl: '',
  };

  it('sets shape to Round', () => {
    const meta = inferTohoRoundMetadata(baseListing);
    expect(meta.shape).toBe('Round');
    expect(meta.size).toBe('11/0');
  });

  it('detects Transparent glass group', () => {
    const meta = inferTohoRoundMetadata(baseListing);
    expect(meta.glassGroup).toBe('Transparent');
  });

  it('detects Opaque glass group', () => {
    const meta = inferTohoRoundMetadata({
      ...baseListing,
      description: 'Opaque White',
    });
    expect(meta.glassGroup).toBe('Opaque');
  });

  it('detects Metallic glass group from galvanized', () => {
    const meta = inferTohoRoundMetadata({
      ...baseListing,
      description: 'Galvanized Gold',
    });
    expect(meta.glassGroup).toBe('Metallic');
    expect(meta.galvanized).toBe('Galvanized');
  });

  it('detects dyed', () => {
    const meta = inferTohoRoundMetadata({
      ...baseListing,
      description: 'Opaque Dyed Rose',
    });
    expect(meta.dyed).toBe('Dyed');
  });

  it('defaults to Non Dyed', () => {
    const meta = inferTohoRoundMetadata(baseListing);
    expect(meta.dyed).toBe('Non Dyed');
  });

  it('detects finish', () => {
    const meta = inferTohoRoundMetadata({
      ...baseListing,
      description: 'Transparent Frosted Crystal',
    });
    expect(meta.finish).toContain('Frosted');
  });
});

describe('isOriginalBlobAssetFile', () => {
  it('accepts plain .jpg files', () => {
    expect(isOriginalBlobAssetFile('TR-11-1.jpg')).toBe(true);
  });

  it('rejects 16x16 thumbnails', () => {
    expect(isOriginalBlobAssetFile('TR-11-1_16x16.jpg')).toBe(false);
  });

  it('rejects 48x48 thumbnails', () => {
    expect(isOriginalBlobAssetFile('TR-11-1_48x48.jpg')).toBe(false);
  });

  it('rejects non-jpg files', () => {
    expect(isOriginalBlobAssetFile('TR-11-1.png')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isOriginalBlobAssetFile('TR-11-1.JPG')).toBe(true);
    expect(isOriginalBlobAssetFile('TR-11-1_16X16.JPG')).toBe(false);
  });
});

describe('toPreferredOriginalImageUrl', () => {
  it('appends _detail before extension for product images', () => {
    const url = 'https://www.czechbeads.eu/images/Products/TR-11-1.jpg';
    expect(toPreferredOriginalImageUrl(url)).toBe(
      'https://www.czechbeads.eu/images/Products/TR-11-1_detail.jpg'
    );
  });

  it('does not double-add _detail', () => {
    const url = 'https://www.czechbeads.eu/images/Products/TR-11-1_detail.jpg';
    expect(toPreferredOriginalImageUrl(url)).toBe(url);
  });

  it('returns non-product URLs unchanged', () => {
    const url = 'https://example.com/other/path/image.jpg';
    expect(toPreferredOriginalImageUrl(url)).toBe(url);
  });

  it('returns empty string for empty input', () => {
    expect(toPreferredOriginalImageUrl('')).toBe('');
  });
});
