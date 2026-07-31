import en from '../locales/en.json';
import de from '../locales/de.json';

export type Dict = Record<string, string>;

const dicts: Record<string, Dict> = { en, de };

/**
 * UI language comes from APP_LANG (env). Adding a locale = dropping a new
 * JSON file into src/locales and registering it here.
 */
export function getLang(): string {
  const lang = process.env.APP_LANG ?? 'en';
  return lang in dicts ? lang : 'en';
}

export function getDict(): Dict {
  return dicts[getLang()];
}

export function t(key: string): string {
  return getDict()[key] ?? key;
}
