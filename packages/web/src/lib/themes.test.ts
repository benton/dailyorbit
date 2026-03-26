import { describe, expect, it } from 'vitest';
import { THEMES, VALID_THEME_IDS, type ThemeDefinition } from './themes.ts';

describe('theme registry', () => {
  it('contains modern and broadsheet themes', () => {
    const ids: Array<string> = THEMES.map((t: ThemeDefinition) => t.id);
    expect(ids).toEqual(['modern', 'broadsheet']);
  });

  it('VALID_THEME_IDS matches THEMES array', () => {
    for (const theme of THEMES) {
      expect(VALID_THEME_IDS.has(theme.id)).toEqual(true);
    }
    expect(VALID_THEME_IDS.size).toEqual(THEMES.length);
  });

  it('each theme has all required fields', () => {
    for (const theme of THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.fontSample).toBeTruthy();
      expect(theme.swatchBg).toBeTruthy();
      expect(theme.swatchBorder).toBeTruthy();
      expect(theme.swatchAccent).toBeTruthy();
    }
  });

  it('theme ids are unique', () => {
    const ids: Array<string> = THEMES.map((t: ThemeDefinition) => t.id);
    expect(new Set(ids).size).toEqual(ids.length);
  });
});
