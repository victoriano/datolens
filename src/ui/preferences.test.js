import { describe, expect, test } from 'bun:test';
import { readPreferences, resolvePreferences, setUiPreferences, getUiSnapshot, PREFERENCES_KEY } from './preferences';
import { translate } from './i18n';
import { english } from './messages';

describe('appearance preferences', () => {
  test('first launch follows a supported system language; corrupt storage recovers', () => {
    expect(readPreferences(null, ['fr-FR', 'en-GB'])).toEqual({language:'en',theme:'system',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
    expect(readPreferences('{broken', ['es-ES'])).toEqual({language:'es',theme:'system',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
    expect(readPreferences('null', ['de-DE'])).toEqual({language:'es',theme:'system',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
    expect(readPreferences('{"language":"xx","theme":"sepia","colorCategoricalCells":"true","categoryChartMode":"invalid","defaultCategoryPalette":"other"}', ['es'])).toEqual({language:'es',theme:'system',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
  });
  test('migrates old preferences with coloring off and accepts only an explicit boolean true', () => {
    expect(readPreferences('{"language":"en","theme":"dark"}')).toEqual({language:'en',theme:'dark',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
    expect(readPreferences('{"colorCategoricalCells":1}').colorCategoricalCells).toBe(false);
    expect(readPreferences('{"colorCategoricalCells":true}').colorCategoricalCells).toBe(true);
    expect(readPreferences('{"categoryChartMode":"detailed"}').categoryChartMode).toBe('detailed');
    expect(readPreferences('{"showAnalyticalRole":true}').showAnalyticalRole).toBe(true);
    expect(readPreferences('{"showAnalyticalRole":"true"}').showAnalyticalRole).toBe(false);
    for (const palette of ['classic','tableau','pastel','vivid','earth']) expect(readPreferences(JSON.stringify({defaultCategoryPalette:palette})).defaultCategoryPalette).toBe(palette);
    expect(readPreferences('{"defaultCategoryPalette":"neon"}').defaultCategoryPalette).toBe('classic');
  });
  test('explicit choices survive a conflicting OS language and appearance', () => {
    const chosen=readPreferences('{"language":"es","theme":"light"}', ['en-US']);
    expect(resolvePreferences(chosen,true)).toMatchObject({language:'es',resolvedTheme:'light',locale:'es-ES'});
    expect(resolvePreferences({language:'en',theme:'dark'},false).resolvedTheme).toBe('dark');
    expect(resolvePreferences({language:'en',theme:'system'},true).resolvedTheme).toBe('dark');
    expect(resolvePreferences({language:'en',theme:'system'},false).resolvedTheme).toBe('light');
  });
  test('stores preferences, preserves coloring across updates, works without storage, and does not require a dataset', () => {
    const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
    const previous=getUiSnapshot();
    const writes=new Map();
    try {
      Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(key,value)=>writes.set(key,value)}});
      setUiPreferences({language:'en',theme:'dark'});
      expect(JSON.parse(writes.get(PREFERENCES_KEY))).toEqual({language:'en',theme:'dark',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
      expect(readPreferences(writes.get(PREFERENCES_KEY),['es'])).toEqual({language:'en',theme:'dark',colorCategoricalCells:false,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
      setUiPreferences({ colorCategoricalCells:true });
      expect(JSON.parse(writes.get(PREFERENCES_KEY))).toEqual({language:'en',theme:'dark',colorCategoricalCells:true,categoryChartMode:'compact',showAnalyticalRole:false,defaultCategoryPalette:'classic'});
      setUiPreferences({ categoryChartMode:'detailed' });
      setUiPreferences({ showAnalyticalRole:true });
      setUiPreferences({ language:'es' });
      setUiPreferences({ defaultCategoryPalette:'pastel' });
      expect(JSON.parse(writes.get(PREFERENCES_KEY))).toEqual({language:'es',theme:'dark',colorCategoricalCells:true,categoryChartMode:'detailed',showAnalyticalRole:true,defaultCategoryPalette:'pastel'});
      Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('unavailable');}});
      setUiPreferences({language:'es',theme:'light'});
      expect(getUiSnapshot()).toMatchObject({language:'es',resolvedTheme:'light'});
    } finally {
      if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;
      setUiPreferences(previous);
    }
  });
});

describe('localization boundaries', () => {
  test('translates controls while preserving filenames, precise identifiers and braces in values', () => {
    expect(translate('en','Abrir archivo')).toBe('Open file');
    const name='Precio {value1} 123456789012345678901234567890.csv';
    expect(translate('en','Seleccionar archivo: {value0}',{value0:name})).toBe(`Select file: ${name}`);
    expect(translate('es','Seleccionar archivo: {value0}',{value0:name})).toBe(`Seleccionar archivo: ${name}`);
    expect(translate('en','Exportado: /tmp/Precio.csv')).toBe('Exported: /tmp/Precio.csv');
    expect(translate('en',' filas')).toBe(' rows');
    expect(translate('en','__proto__')).toBe('__proto__');
    expect(translate('en','{constructor}',{})).toBe('{constructor}');
  });
  test('every English translation preserves all interpolation fields', () => {
    const fields=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    for(const [source,translated] of Object.entries(english)) {
      expect(translated.trim().length,source).toBeGreaterThan(0);
      expect(fields(translated),source).toEqual(fields(source));
    }
  });
});
