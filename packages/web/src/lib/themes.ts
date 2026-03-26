export type ThemeDefinition = {
  description: string;
  fontSample: string;
  id: string;
  name: string;
  swatchAccent: string;
  swatchBg: string;
  swatchBorder: string;
};

export const THEMES: Array<ThemeDefinition> = [
  {
    description: 'Clean lines, rounded corners, system fonts',
    fontSample: 'system-ui, sans-serif',
    id: 'modern',
    name: 'Modern',
    swatchAccent: '#be185d',
    swatchBg: '#fafafa',
    swatchBorder: '1px solid #e5e5e5',
  },
  {
    description: 'Early 1900s newsprint with serif fonts',
    fontSample: "'Abril Fatface', Georgia, serif",
    id: 'broadsheet',
    name: 'Broadsheet',
    swatchAccent: '#8b2500',
    swatchBg: '#f4edd3',
    swatchBorder: '2px double #5c4a32',
  },
];

/** Valid theme IDs for server-side validation */
export const VALID_THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));
