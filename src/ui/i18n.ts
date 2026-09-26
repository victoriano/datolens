import { useSyncExternalStore } from 'react';
import { english } from './messages';
import { getUiSnapshot, subscribeUi, type Language } from './preferences';

export type MessageValues = Record<string, string | number>;
const statusPrefixes: Array<[string, string]> = [
  ['No se pudo restaurar la vista: ', 'Could not restore the view: '],
  ['No se pudo recuperar el último archivo: ', 'Could not restore the last file: '],
  ['No se pudieron consultar las filas: ', 'Could not query rows: '],
  ['No se pudieron calcular las distribuciones: ', 'Could not calculate distributions: '],
  ['No se pudo guardar la vista: ', 'Could not save the view: '],
  ['No se pudo copiar: ', 'Could not copy: '],
  ['No se pudo actualizar el estado: ', 'Could not update status: '],
  ['Exportado: ', 'Exported: '],
  ['No se pudo escribir junto al archivo original. Los ajustes están guardados en este Mac: ', 'Could not write beside the original file. Settings are saved on this Mac: '],
];
export function translate(language: Language, message: string, values?: MessageValues): string {
  const key = message.trim();
  let template = message;
  if (language === 'en') {
    if (Object.hasOwn(english, key)) template = message.replace(key, () => english[key]);
    else {
      const prefix = statusPrefixes.find(([source]) => message.startsWith(source));
      if (prefix) template = prefix[1] + message.slice(prefix[0].length);
    }
  }
  return values ? template.replace(/\{(\w+)\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder) : template;
}
// Stable identity: locale changes rerender subscribers without restarting queries or effects.
export const t = (message: string, values?: MessageValues) => translate(getUiSnapshot().language, message, values);
export function useI18n() {
  const preferences = useSyncExternalStore(subscribeUi, getUiSnapshot, getUiSnapshot);
  return { ...preferences, t };
}
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString(getUiSnapshot().locale, options);
