import {
  formatPublicMerchantId,
  generateMerchantApiKey,
  parsePublicMerchantId,
} from '../../apps/api-edge/src/lib/merchantKeys';

describe('merchant public identifiers', () => {
  it('issues apk_ keys and mer_ merchant ids', () => {
    const { apiKey, keyPrefix } = generateMerchantApiKey();
    expect(apiKey).toMatch(/^apk_[0-9a-f]{64}$/);
    expect(keyPrefix).toHaveLength(8);
    expect(apiKey.startsWith(keyPrefix)).toBe(true);

    const uuid = '26e7ac4f-017e-4316-bf4f-9a1b37112510';
    expect(formatPublicMerchantId(uuid)).toBe(`mer_${uuid}`);
    expect(formatPublicMerchantId(`mer_${uuid}`)).toBe(`mer_${uuid}`);
    expect(parsePublicMerchantId(`mer_${uuid}`)).toBe(uuid);
  });
});
