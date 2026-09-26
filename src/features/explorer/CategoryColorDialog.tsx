import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Bin, Column, Dataset, DesktopApi, ViewState } from '../../contracts/desktop-api';
import { useI18n } from '../../ui';
import { ModelPicker } from '../../ui/ModelPicker';
import { CATEGORY_PALETTES, categoryColorRanks, effectiveCategoryPalette, getCategoryColor, getCategoryPalette, normalizeCategoryColor, normalizeCategoryPalette, setCategoryPaletteOverride, type CategoryColorOverrides, type CategoryPaletteId } from './category-colors';
import './category-colors.css';

interface Props {
  column: Column;
  bins: Bin[];
  truncated?: boolean;
  overrides?: CategoryColorOverrides;
  paletteId?: string;
  api?: DesktopApi;
  dataset?: Dataset;
  onView: (update: (view: ViewState) => ViewState) => void;
  onClose: () => void;
}

export function CategoryColorDialog({ column, bins, truncated, overrides, paletteId, api, dataset, onView, onClose }: Props) {
  const { language, defaultCategoryPalette } = useI18n();
  const en = language === 'en';
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const aiInFlight = useRef(false);
  const missingValues = column.spss?.missingValues;
  const labels = column.spss?.valueLabels;
  const ranks = useMemo(() => categoryColorRanks(bins, missingValues), [bins, missingValues]);
  const frequencyValues = useMemo(() => [...ranks.entries()].sort((a, b) => a[1] - b[1]).slice(0, 6).map(([value]) => value), [ranks]);
  const [draft, setDraft] = useState<CategoryColorOverrides>(() => ({ ...overrides }));
  const [paletteOverride, setPaletteOverride] = useState<CategoryPaletteId | undefined>(() => paletteId === undefined ? undefined : normalizeCategoryPalette(paletteId));
  const palette = effectiveCategoryPalette(paletteOverride, defaultCategoryPalette);
  const [selected, setSelected] = useState<string | null>(() => frequencyValues[0] ?? Object.keys(overrides ?? {}).find(value => !missingValues?.includes(value)) ?? null);
  const [query, setQuery] = useState('');
  const [exactValue, setExactValue] = useState('');
  const [hexInput, setHexInput] = useState(() => selected === null ? '' : getCategoryColor(selected, overrides, palette, ranks));
  const [invalidHex, setInvalidHex] = useState(false);
  const [context, setContext] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [models, setModels] = useState<string[]>([]);
  const [includeCustom, setIncludeCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [aiReasons, setAiReasons] = useState<Array<{ value: string; color: string; reason: string }>>([]);
  useEffect(() => {
    if (paletteOverride === undefined && selected !== null) setHexInput(getCategoryColor(selected, draft, defaultCategoryPalette, ranks));
  }, [defaultCategoryPalette]);
  useEffect(() => { dialog.current?.showModal(); return () => { requestVersion.current++; }; }, []);
  const sourceIdentity = JSON.stringify([dataset?.id, dataset?.revision, column.id]);
  const initialSource = useRef(sourceIdentity);
  useEffect(() => {
    if (initialSource.current === sourceIdentity) return;
    requestVersion.current++;
    aiInFlight.current = false;
    setLoading(false);
    setModelsLoading(false);
    dialog.current?.close();
  }, [sourceIdentity]);

  const loadedValues = useMemo(() => new Set(bins.map(bin => bin.value).filter((value): value is string => value != null)), [bins]);

  const values = useMemo(() => {
    return [...new Set([...loadedValues, ...Object.keys(draft)])];
  }, [loadedValues, draft]);
  const matching = useMemo(() => values.filter(value => {
    const lower = query.toLocaleLowerCase();
    return !lower || value.toLocaleLowerCase().includes(lower) || (labels && Object.hasOwn(labels, value) ? labels[value] : '').toLocaleLowerCase().includes(lower);
  }), [values, query, labels]);
  const aiScope = useMemo(() => {
    const eligible = matching.filter(value => value.length > 0 && loadedValues.has(value) && !missingValues?.includes(value) && (includeCustom || !Object.hasOwn(draft, value)));
    const encoder = new TextEncoder();
    const chosen: string[] = [];
    let bytes = encoder.encode(column.name).length + encoder.encode(context).length;
    for (const value of eligible) {
      const rawBytes = encoder.encode(value).length;
      const labelBytes = encoder.encode(labels && Object.hasOwn(labels, value) ? labels[value] : '').length;
      const size = rawBytes + labelBytes;
      if (chosen.length >= 100) break;
      if (rawBytes > 500 || labelBytes > 500 || bytes + size > 19_000) continue;
      chosen.push(value);
      bytes += size;
    }
    return { values: chosen, eligible: eligible.length };
  }, [matching, loadedValues, missingValues, labels, column.name, context, includeCustom, draft]);

  const closeDialog = () => { requestVersion.current++; dialog.current?.close(); };
  const refreshModels = async () => {
    if (!api?.analysisModels || modelsLoading || loading) return;
    const version = ++requestVersion.current;
    setModelsLoading(true);
    setAiError('');
    try {
      const available = await api.analysisModels('gemini');
      if (version !== requestVersion.current) return;
      const ids = available.filter(item => item.provider === 'gemini').map(item => item.id);
      setModels([...new Set(ids)]);
      if (ids.length && !ids.includes(model)) setModel(ids[0]);
    } catch (error) {
      if (version === requestVersion.current) setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === requestVersion.current) setModelsLoading(false);
    }
  };
  const suggestColors = async () => {
    if (!api?.suggestCategoryColors || !dataset || aiInFlight.current || !aiScope.values.length) return;
    aiInFlight.current = true;
    const version = ++requestVersion.current;
    setLoading(true);
    setNeedsKey(false);
    setAiError('');
    setAiSummary('');
    setAiReasons([]);
    try {
      const hasKey = await api.hasProviderKey('gemini');
      if (version !== requestVersion.current) return;
      if (!hasKey) { setNeedsKey(true); return; }
      const requested = aiScope.values;
      const result = await api.suggestCategoryColors({ datasetId: dataset.id, column: column.id, values: requested, model, language, context: context.trim() || undefined });
      if (version !== requestVersion.current) return;
      if (result.datasetRevision !== dataset.revision || result.column !== column.id || !Array.isArray(result.assignments)) {
        throw new Error(en ? 'The dataset changed. Reopen the color editor and try again.' : 'El conjunto de datos ha cambiado. Vuelve a abrir el editor de colores.');
      }
      const allowed = new Set(requested);
      const accepted: Array<{ value: string; color: string; reason: string }> = [];
      const additions: CategoryColorOverrides = {};
      for (const item of result.assignments) {
        if (!item || typeof item.value !== 'string' || !allowed.has(item.value) || item.color === null) continue;
        const color = normalizeCategoryColor(item.color);
        if (!color || (!includeCustom && Object.hasOwn(draft, item.value))) continue;
        Object.defineProperty(additions, item.value, { value: color, enumerable: true, configurable: true, writable: true });
        accepted.push({ value: item.value, color, reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : '' });
      }
      setDraft(current => ({ ...current, ...additions }));
      if (selected !== null && Object.hasOwn(additions, selected)) setHexInput(additions[selected]);
      setAiReasons(accepted);
      setAiSummary(typeof result.explanation === 'string' ? result.explanation.slice(0, 800) : '');
    } catch (error) {
      if (version === requestVersion.current) setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      aiInFlight.current = false;
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const selectValue = (value: string) => {
    if (loading || missingValues?.includes(value)) return;
    setSelected(value);
    setHexInput(getCategoryColor(value, draft, palette, ranks));
    setInvalidHex(false);
  };
  const changeColor = (color: string) => {
    if (loading) return;
    const normalized = normalizeCategoryColor(color);
    setHexInput(color);
    setInvalidHex(!normalized);
    if (selected !== null && normalized) setDraft(current => ({ ...current, [selected]: normalized }));
    if (selected !== null) setAiReasons(current => current.filter(item => item.value !== selected));
  };
  const resetCategory = () => {
    if (selected === null || loading) return;
    setDraft(current => { const next = { ...current }; delete next[selected]; return next; });
    setHexInput(getCategoryColor(selected, undefined, palette, ranks));
    setAiReasons(current => current.filter(item => item.value !== selected));
    setInvalidHex(false);
  };
  const resetVariable = () => {
    if (loading) return;
    setDraft({});
    if (selected !== null) setHexInput(getCategoryColor(selected, undefined, palette, ranks));
    setAiReasons([]);
    setAiSummary('');
    setInvalidHex(false);
  };
  const choosePalette = (id: string) => {
    if (loading) return;
    const chosen = normalizeCategoryPalette(id);
    setPaletteOverride(chosen);
    if (selected !== null) setHexInput(getCategoryColor(selected, draft, chosen, ranks));
    setInvalidHex(false);
  };
  const useGlobalPalette = () => {
    if (loading) return;
    setPaletteOverride(undefined);
    if (selected !== null) setHexInput(getCategoryColor(selected, draft, defaultCategoryPalette, ranks));
    setInvalidHex(false);
  };
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = selected === null ? null : normalizeCategoryColor(hexInput);
    if (selected !== null && !normalized) { setInvalidHex(true); return; }
    let next = { ...draft };
    // The HEX field is editable without requiring blur or Enter before Apply.
    if (selected !== null && normalized && normalized !== getCategoryColor(selected, next, palette, ranks)) next = { ...next, [selected]: normalized };
    onView(view => {
      const categoryColors = Object.fromEntries(Object.entries(view.categoryColors ?? {}).filter(([id]) => id !== column.id));
      return {
        ...setCategoryPaletteOverride(view, column.id, paletteOverride),
        categoryColors: Object.keys(next).length ? { ...categoryColors, [column.id]: next } : Object.keys(categoryColors).length ? categoryColors : undefined,
      };
    });
    dialog.current?.close();
  };

  const raw = (value: string) => JSON.stringify(value);
  return <dialog ref={dialog} className="dl-category-color-dialog" aria-labelledby="dl-category-color-title" onCancel={() => { requestVersion.current++; }} onClose={onClose} onClick={event => { if (event.target === dialog.current) closeDialog(); }}>
    <form onSubmit={apply}>
      <header><div><h2 id="dl-category-color-title">{en ? 'Category colors' : 'Colores de categorías'}</h2><p>{column.name}</p></div><button type="button" className="dl-category-color-close" aria-label={en ? 'Close' : 'Cerrar'} onClick={closeDialog}>×</button></header>
      <section className="dl-category-color-palettes" aria-label={en ? 'Variable palette' : 'Paleta de la variable'}>
        <div><strong>{en ? 'Variable palette' : 'Paleta de la variable'}</strong><small>{en ? 'Custom category colors stay in place when you switch palettes.' : 'Los colores personalizados se conservan al cambiar de paleta.'}</small></div>
        <button type="button" className="dl-category-color-global-palette" aria-pressed={paletteOverride === undefined} disabled={loading} onClick={useGlobalPalette}>{en ? 'Use global palette' : 'Usar paleta general'} · {getCategoryPalette(defaultCategoryPalette).name[en ? 'en' : 'es']}</button>
        <div className="dl-category-color-palette-options">{CATEGORY_PALETTES.map(option => <button type="button" key={option.id} aria-pressed={paletteOverride === option.id} disabled={loading} onClick={() => choosePalette(option.id)}><span>{option.name[en ? 'en' : 'es']}</span><span className="dl-category-color-palette-preview" aria-label={en ? 'Automatic colors by frequency' : 'Colores automáticos por frecuencia'}>{frequencyValues.length ? frequencyValues.map(value => <i key={value} title={labels && Object.hasOwn(labels, value) ? labels[value] : value} style={{ backgroundColor: getCategoryColor(value, undefined, option.id, ranks) }} />) : option.colors.slice(0, 6).map((color, index) => <i key={`${color}-${index}`} style={{ backgroundColor: color }} />)}</span></button>)}</div>
        <small className="dl-category-color-frequency-note">{en ? 'Preview: automatic colors assigned from left to right by frequency (most frequent first). Custom colors are shown in the category list.' : 'Vista previa: colores automáticos asignados de izquierda a derecha por frecuencia (primero el más frecuente). Los colores personalizados aparecen en la lista.'}</small>
      </section>
      <div className="dl-category-color-body">
        <div className="dl-category-color-values">
          <label className="dl-category-color-search"><span>{en ? 'Search loaded values' : 'Buscar valores cargados'}</span><input autoFocus type="search" value={query} disabled={loading} onChange={event => setQuery(event.target.value)} placeholder={en ? 'Code or label…' : 'Código o etiqueta…'} /></label>
          <div className="dl-category-color-list" role="group" aria-label={en ? 'Categories' : 'Categorías'}>
            {matching.map(value => {
              const missing = !!missingValues?.includes(value);
              const label = labels && Object.hasOwn(labels, value) ? labels[value] : value || (en ? '(empty string)' : '(cadena vacía)');
              return <button type="button" aria-pressed={selected === value} disabled={loading || missing} key={value} onClick={() => selectValue(value)} title={missing ? (en ? 'SPSS missing value: neutral color' : 'Valor perdido SPSS: color neutro') : undefined}>
                <i className="dl-category-color-swatch" style={{ backgroundColor: missing ? 'var(--dl-chart-background)' : getCategoryColor(value, draft, palette, ranks) }} />
                <span className="dl-category-color-value"><strong>{label}</strong><small>{en ? 'Raw code' : 'Código original'}: {raw(value)}{!loadedValues.has(value) ? ` · ${en ? 'custom' : 'personalizado'}` : ''}{missing ? ` · ${en ? 'SPSS missing' : 'Perdido SPSS'}` : ''}</small></span>
              </button>;
            })}
            {!matching.length && <p>{en ? 'No matching values.' : 'No hay valores coincidentes.'}</p>}
          </div>
          {bins.some(bin => bin.value == null) && <div className="dl-category-color-null"><i className="dl-category-color-swatch" />{en ? 'Null value · neutral' : 'Valor nulo · neutro'}</div>}
          <label className="dl-category-color-exact"><span>{en ? 'Exact raw value' : 'Valor original exacto'}</span><span><input value={exactValue} disabled={loading} onChange={event => setExactValue(event.target.value)} placeholder={en ? 'Another category…' : 'Otra categoría…'} /><button type="button" disabled={loading} aria-label={en ? 'Edit exact value' : 'Editar valor exacto'} onClick={() => { selectValue(exactValue); setExactValue(''); }}>{en ? 'Edit' : 'Editar'}</button></span></label>
          {truncated && <p className="dl-category-color-hint">{en ? 'Only loaded categories appear above. Enter an exact raw value to color another category.' : 'Arriba solo aparecen las categorías cargadas. Escribe un valor original exacto para colorear otra categoría.'}</p>}
        </div>
        <div className="dl-category-color-editor">
          <h3>{selected === null ? (en ? 'Select a category' : 'Selecciona una categoría') : (labels && Object.hasOwn(labels, selected) ? labels[selected] : selected || (en ? '(empty string)' : '(cadena vacía)'))}</h3>
          {selected !== null && <><p>{en ? 'Raw code' : 'Código original'}: <code>{raw(selected)}</code></p>
            <div className="dl-category-color-fields"><label>{en ? 'Color' : 'Color'}<input type="color" disabled={loading} value={normalizeCategoryColor(hexInput) ?? getCategoryColor(selected, draft, palette, ranks)} onChange={event => changeColor(event.target.value)} /></label><label>HEX<input type="text" disabled={loading} inputMode="text" spellCheck={false} value={hexInput} onChange={event => changeColor(event.target.value)} aria-invalid={invalidHex} aria-describedby={invalidHex ? 'dl-category-color-error' : undefined} /></label></div>
            {invalidHex && <small id="dl-category-color-error" className="dl-category-color-error">{en ? 'Enter a valid HEX color, such as #3B82F6.' : 'Introduce un color HEX válido, como #3B82F6.'}</small>}
            <div className="dl-category-color-palette" aria-label={en ? 'Suggested colors' : 'Colores sugeridos'}>{getCategoryPalette(palette).colors.map((color, index) => <button type="button" key={`${index}-${color}`} aria-label={`${en ? 'Use color' : 'Usar color'} ${color}`} title={color} style={{ backgroundColor: color }} disabled={loading} onClick={() => changeColor(color)} />)}</div>
            <button type="button" className="dl-category-color-reset" onClick={resetCategory} disabled={loading || !Object.hasOwn(draft, selected)}>{en ? 'Reset category' : 'Restablecer categoría'}</button>
          </>}
        </div>
      </div>
      <section className="dl-category-color-ai" aria-label={en ? 'AI color suggestions' : 'Sugerencias de color con IA'}>
        <div className="dl-category-color-ai-heading"><strong>{en ? 'Semantic colors with AI' : 'Colores semánticos con IA'}</strong><small>{en ? 'One request sends this variable name, up to 100 loaded values and their labels to Google Gemini.' : 'Una solicitud envía a Google Gemini el nombre de esta variable, hasta 100 valores cargados y sus etiquetas.'}</small></div>
        <div className="dl-category-color-ai-controls"><label><span>{en ? 'Optional context' : 'Contexto opcional'}</span><input value={context} disabled={loading} maxLength={500} onChange={event => setContext(event.target.value)} placeholder={en ? 'e.g. Spanish political parties' : 'Ej.: partidos políticos españoles'} /></label><ModelPicker label={en ? 'Model' : 'Modelo'} value={model} disabled={loading || modelsLoading} onChange={setModel} options={[...new Set([model, 'gemini-2.5-flash', ...models])].map(id => ({ id, provider: 'gemini' }))} /><button type="button" disabled={loading || modelsLoading || !api?.analysisModels} onClick={() => void refreshModels()}>{modelsLoading ? (en ? 'Loading…' : 'Cargando…') : (en ? 'Refresh models' : 'Actualizar modelos')}</button></div>
        <div className="dl-category-color-ai-action"><label><input type="checkbox" checked={includeCustom} disabled={loading} onChange={event => setIncludeCustom(event.target.checked)} />{en ? 'Replace customized category colors' : 'Reemplazar colores personalizados'}</label><span>{en ? `${aiScope.values.length} of ${aiScope.eligible} matching loaded values` : `${aiScope.values.length} de ${aiScope.eligible} valores cargados coincidentes`}</span><button type="button" className="dl-category-color-suggest" disabled={loading || modelsLoading || !api?.suggestCategoryColors || !dataset || !aiScope.values.length} onClick={() => void suggestColors()}>{loading ? (en ? 'Suggesting…' : 'Sugiriendo…') : (en ? 'Suggest semantic colors' : 'Sugerir colores con IA')}</button></div>
        {needsKey && <p role="status">{en ? 'Add a Gemini key in Settings to use suggestions.' : 'Añade una clave de Gemini en Ajustes para usar las sugerencias.'} <button type="button" onClick={() => window.dispatchEvent(new Event('datolens:open-settings'))}>{en ? 'Open Settings' : 'Abrir Ajustes'}</button></p>}
        {aiError && <p role="alert" className="dl-category-color-error">{aiError}</p>}
        {(aiSummary || aiReasons.length > 0) && <div className="dl-category-color-ai-result" role="status">{aiSummary && <p>{aiSummary}</p>}<small>{en ? `${aiReasons.length} proposed colors staged for review. Apply to save.` : `${aiReasons.length} colores propuestos en borrador. Pulsa Aplicar para guardar.`}</small>{aiReasons.length > 0 && <div>{aiReasons.map(item => <p key={item.value}><i className="dl-category-color-swatch" style={{ backgroundColor: item.color }} /><span><b>{labels && Object.hasOwn(labels, item.value) ? labels[item.value] : item.value}</b> <code>{raw(item.value)}</code>{item.reason ? ` · ${item.reason}` : ''}</span></p>)}</div>}</div>}
      </section>
      <footer><button type="button" className="dl-category-color-reset" onClick={resetVariable} disabled={loading || !Object.keys(draft).length}>{en ? 'Reset variable' : 'Restablecer variable'}</button><span /><button type="button" onClick={closeDialog}>{en ? 'Cancel' : 'Cancelar'}</button><button type="submit" className="dl-primary" disabled={loading || invalidHex}>{en ? 'Apply' : 'Aplicar'}</button></footer>
    </form>
  </dialog>;
}
