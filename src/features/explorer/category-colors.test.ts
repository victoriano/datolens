import { describe, expect, test } from 'bun:test';
import { CATEGORICAL_PALETTE, CATEGORY_PALETTES, DEFAULT_CATEGORY_PALETTE, categoryColorRanks, effectiveCategoryPalette, getCategoryColor, getCategoryPalette, isCategoricalKind, normalizeCategoryColor, normalizeCategoryPalette, reconcileCategoryColors, reconcileCategoryPalettes, setCategoryColor, setCategoryPaletteOverride } from './category-colors';
import { initialView, reconcileView } from './model';
import type { Bin, Dataset } from '../../contracts/desktop-api';

const dataset: Dataset = {
  id: 'fixture', name: 'Fixture', sourcePath: '/fixture.csv', rowCount: 3, revision: '1',
  columns: [{ id: 'city', name: 'City', dataType: 'VARCHAR', kind: 'categorical' }],
};
const bin = (value: string | null, background: number): Bin => ({ value, background, foreground: background, rBackground: 0, rForeground: 0 });

describe('category colors', () => {
  test('global palette changes inheriting variables while explicit Classic and manual colors keep priority', () => {
    expect(effectiveCategoryPalette(undefined, 'pastel')).toBe('pastel');
    expect(effectiveCategoryPalette(undefined, 'earth')).toBe('earth');
    expect(effectiveCategoryPalette('classic', 'pastel')).toBe('classic');
    expect(effectiveCategoryPalette('tableau', 'earth')).toBe('tableau');
    expect(getCategoryColor('Yes', { Yes: '#123456' }, effectiveCategoryPalette(undefined, 'earth'))).toBe('#123456');
    const initial = initialView(dataset);
    expect(setCategoryPaletteOverride(initial, 'city', undefined).categoryPalettes).toBeUndefined();
    const classic = setCategoryPaletteOverride(initial, 'city', 'classic');
    expect(classic.categoryPalettes).toEqual({ city: 'classic' });
    expect(effectiveCategoryPalette(classic.categoryPalettes?.city, 'pastel')).toBe('classic');
    expect(setCategoryPaletteOverride(classic, 'city', undefined).categoryPalettes).toBeUndefined();
  });
  test('offers distinct valid palettes while classic keeps existing assignments', () => {
    expect(CATEGORY_PALETTES.map(palette => palette.id)).toEqual(['classic', 'tableau', 'pastel', 'vivid', 'earth']);
    expect(DEFAULT_CATEGORY_PALETTE).toBe('classic');
    for (const palette of CATEGORY_PALETTES) {
      expect(palette.colors.length).toBeGreaterThanOrEqual(10);
      expect(new Set(palette.colors).size).toBe(palette.colors.length);
      expect(palette.colors.every(color => normalizeCategoryColor(color) === color)).toBe(true);
      expect(palette.name.es.length && palette.name.en.length).toBeTruthy();
    }
    expect(getCategoryPalette('unknown')).toBe(getCategoryPalette('classic'));
    expect(normalizeCategoryPalette('unknown')).toBe('classic');
    for (const value of ['High', 'Low', 'Medium-high', 'Medium-low']) {
      expect(getCategoryColor(value)).toBe(getCategoryColor(value, undefined, 'classic'));
      expect(CATEGORICAL_PALETTE).toContain(getCategoryColor(value));
      expect(getCategoryColor(value, { [value]: '#ABC' }, 'earth')).toBe('#aabbcc');
    }
  });

  test('reconciles palette settings by column ID and survives a JSON view', () => {
    const view = initialView(dataset);
    view.categoryPalettes = { city: 'pastel', deleted: 'vivid' };
    expect(reconcileView(dataset, JSON.parse(JSON.stringify(view))).categoryPalettes).toEqual({ city: 'pastel' });
    expect(reconcileCategoryPalettes(JSON.parse('{"city":"missing","__proto__":"earth"}'), new Set(['city', '__proto__']))).toEqual(Object.fromEntries([['city', 'classic'], ['__proto__', 'earth']]));
    expect(reconcileCategoryPalettes([], new Set(['city']))).toEqual({});
    expect(reconcileView(dataset, initialView(dataset)).categoryPalettes).toBeUndefined();
  });
  test('uses a finite distinct palette keyed by raw values', () => {
    expect(CATEGORICAL_PALETTE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATEGORICAL_PALETTE).size).toBe(CATEGORICAL_PALETTE.length);
    const values = ['Madrid', 'Sevilla', 'Madrid ', 'madrid', '東京', '__proto__'];
    const before = Object.fromEntries(values.map(value => [value, getCategoryColor(value)]));
    for (const value of [...values].reverse()) expect(getCategoryColor(value)).toBe(before[value]);
    expect(getCategoryColor('Madrid', { Madrid: '#A1B' })).toBe('#aa11bb');
    expect(getCategoryColor('Madrid', { Madrid: 'invalid' })).toBe(before.Madrid);
  });

  test('spreads sequential category IDs over the full palette while staying deterministic', () => {
    const values = Array.from({ length: 1000 }, (_, index) => `category-${index}`);
    const colors = values.map(value => getCategoryColor(value));
    expect(new Set(colors)).toEqual(new Set(CATEGORICAL_PALETTE));
    expect(values.slice().reverse().map(value => getCategoryColor(value))).toEqual(colors.slice().reverse());
  });

  test('assigns palette slots by background frequency with deterministic ties and explicit overrides', () => {
    const bins = [
      bin('Yes', 4), bin('No phone service', 1), bin('No', 8),
      bin('Missing', 30), bin(null, 40), bin('B', 2), bin('A', 2),
    ];
    const ranks = categoryColorRanks(bins, ['Missing']);
    expect([...ranks.keys()]).toEqual(['No', 'Yes', 'A', 'B', 'No phone service']);
    expect(getCategoryColor('No', undefined, 'tableau', ranks)).toBe('#4e79a7');
    expect(getCategoryColor('Yes', undefined, 'tableau', ranks)).toBe('#f28e2b');
    expect(getCategoryColor('No', { No: '#ABC' }, 'tableau', ranks)).toBe('#aabbcc');
    expect(getCategoryColor('Unseen', undefined, 'tableau', ranks)).toBe(getCategoryColor('Unseen', undefined, 'tableau'));
    expect(categoryColorRanks([...bins].reverse(), ['Missing'])).toEqual(ranks);
  });

  test('cycles the palette for more ranked values than available colors', () => {
    const bins = Array.from({ length: 30 }, (_, index) => bin(`code-${index}`, 30 - index));
    const ranks = categoryColorRanks(bins);
    expect(getCategoryColor('code-0', undefined, 'tableau', ranks)).toBe('#4e79a7');
    expect(getCategoryColor('code-10', undefined, 'tableau', ranks)).toBe('#4e79a7');
  });

  test('normalizes only hex RGB forms', () => {
    expect(normalizeCategoryColor('#AbC')).toBe('#aabbcc');
    expect(normalizeCategoryColor('#A1b2C3')).toBe('#a1b2c3');
    for (const invalid of ['red', ' #abc', '#abcd', '#12345678', '#12g', '']) {
      expect(normalizeCategoryColor(invalid)).toBeNull();
    }
    expect(isCategoricalKind('categorical')).toBe(true);
    expect(isCategoricalKind('boolean')).toBe(true);
    expect(isCategoricalKind('multivalued')).toBe(true);
    expect(isCategoricalKind('numeric')).toBe(false);
  });

  test('reconciles saved raw-value overrides without stale columns or inherited keys', () => {
    const saved = JSON.parse('{"city":{"Madrid":"#ABC","__proto__":"#123456","bad":"red"},"removed":{"X":"#fff"},"constructor":["#fff"]}');
    const inherited = Object.create(saved);
    expect(reconcileCategoryColors(inherited, new Set(['city']))).toEqual({});
    const cleaned = reconcileCategoryColors(saved, new Set(['city']));
    expect(cleaned).toEqual({ city: Object.fromEntries([['Madrid', '#aabbcc'], ['__proto__', '#123456']]) });
    expect(Object.hasOwn(cleaned.city, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(cleaned.city)).toBe(Object.prototype);
    expect(reconcileCategoryColors({ city: [] }, new Set(['city']))).toEqual({});
    expect(reconcileCategoryColors(null, new Set(['city']))).toEqual({});
  });

  test('sets and resets choices immutably, then survives JSON view restoration', () => {
    const original = initialView(dataset);
    const madrid = setCategoryColor(original, 'city', 'Madrid', '#ABC');
    const sevilla = setCategoryColor(madrid, 'city', 'Sevilla', '#102030');
    expect(original.categoryColors).toBeUndefined();
    expect(madrid.categoryColors).toEqual({ city: { Madrid: '#aabbcc' } });
    expect(sevilla.categoryColors?.city).toEqual({ Madrid: '#aabbcc', Sevilla: '#102030' });
    expect(reconcileView(dataset, JSON.parse(JSON.stringify(sevilla))).categoryColors).toEqual(sevilla.categoryColors);
    expect(setCategoryColor(sevilla, 'city', 'Madrid', null).categoryColors?.city).toEqual({ Sevilla: '#102030' });
    expect(setCategoryColor(madrid, 'city', 'Madrid', null).categoryColors).toBeUndefined();
    expect(setCategoryColor(original, 'city', 'Madrid', 'red')).toBe(original);
    expect(reconcileView(dataset, JSON.parse(JSON.stringify(original))).categoryColors).toBeUndefined();
  });

  test('preserves special and empty raw keys as own properties through set, reset, and JSON', () => {
    const original = initialView(dataset);
    let view = original;
    for (const columnId of ['__proto__', 'constructor', '']) {
      for (const value of ['__proto__', 'constructor', '']) {
        view = setCategoryColor(view, columnId, value, '#ABC');
        expect(Object.hasOwn(view.categoryColors!, columnId)).toBe(true);
        expect(Object.hasOwn(view.categoryColors![columnId], value)).toBe(true);
        expect(getCategoryColor(value, view.categoryColors![columnId])).toBe('#aabbcc');
      }
    }
    expect(Object.getPrototypeOf(view.categoryColors)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(view.categoryColors!.__proto__)).toBe(Object.prototype);
    const restored = JSON.parse(JSON.stringify(view));
    expect(Object.keys(restored.categoryColors)).toHaveLength(3);
    view = setCategoryColor(view, '__proto__', '__proto__', null);
    expect(Object.hasOwn(view.categoryColors!.__proto__, '__proto__')).toBe(false);
    expect(Object.hasOwn(restored.categoryColors.__proto__, '__proto__')).toBe(true);
    expect(original.categoryColors).toBeUndefined();
    for (const columnId of ['__proto__', 'constructor', '']) {
      for (const value of ['__proto__', 'constructor', '']) view = setCategoryColor(view, columnId, value, null);
    }
    expect(view.categoryColors).toBeUndefined();
  });
});
