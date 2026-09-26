import { VariableChecklist } from '../../ui/VariablePicker';
import { ModelPicker } from '../../ui/ModelPicker';
import { useI18n } from '../../ui';
import { useEffect, useRef, useState } from 'react';
import type { Column, Dataset, DesktopApi, VariableKind, ViewState } from '../../contracts/desktop-api';
import type { AnalysisModel, CastPreview, CastResult, Classification, FilterProposal } from '../../contracts/analysis';
import { applyClassification, filterDescription, mergeAnalysisFilters, ROLE_OPTIONS } from './analysis-model';
import { kindLabel } from './model';
import './analysis.css';

type Mode = { kind: 'classify' | 'filter' } | { kind: 'cast'; column: Column; target: VariableKind | null };
interface Options {
  api: DesktopApi; dataset: Dataset | null; view: ViewState | null; opening?: boolean;
  onView: (update: (view: ViewState) => ViewState) => void;
  beforeCast: () => Promise<void>;
  onCast: (result: CastResult, column: string) => void;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const DEFAULT_MODELS: AnalysisModel[] = [
  { id: 'jev-latest', provider: 'jev' },
  ...['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].map(id => ({ id, provider: 'gemini' as const })),
];

/** Caller owns dataset refresh/autosave sequencing. Closing discards late proposals. */
export function useVariableAnalysis(options: Options) {
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => setMode(null), [options.dataset?.id, options.dataset?.revision, options.opening]);
  return {
    openClassify: () => setMode({ kind: 'classify' }),
    openFilter: () => setMode({ kind: 'filter' }),
    openCast: (column: Column, target: VariableKind | null) => setMode({ kind: 'cast', column, target }),
    dialog: options.dataset && options.view && mode ? <AnalysisDialog key={`${options.dataset.id}:${options.dataset.revision}:${mode.kind}`} {...options} dataset={options.dataset} view={options.view} mode={mode} onClose={() => setMode(null)} /> : null,
  };
}
function AnalysisDialog({ api, dataset, view, mode, beforeCast, onCast, onView, onClose }: Options & { dataset: Dataset; view: ViewState; mode: Mode; onClose: () => void }) {
  const { t, locale, language } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [keys, setKeys] = useState<Record<'jev' | 'gemini', boolean | null | 'unavailable'>>({ jev: null, gemini: null });
  const [key, setKey] = useState<Record<'jev' | 'gemini', string>>({ jev: '', gemini: '' });
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [model, setModel] = useState(mode.kind === 'classify' ? 'jev-latest' : 'gemini-3.8-flash');
  const provider = model.startsWith('jev-') ? 'jev' : 'gemini';
  const keyReady = keys[provider] === true;
  const [prompt, setPrompt] = useState('');
  const [columns, setColumns] = useState(dataset.columns.slice(0, 128).map(c => c.id));
  const [classification, setClassification] = useState<Classification | null>(null);
  const [proposal, setProposal] = useState<FilterProposal | null>(null);
  const [castPreview, setCastPreview] = useState<CastPreview | null>(null);
  const cast = mode.kind === 'cast' ? mode : null;
  const title = cast ? t("Tipo de {name}", {name: cast.column.name}) : mode.kind === 'classify' ? 'Clasificar variables con IA' : 'Filtrar con lenguaje natural';
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    if (cast) {
      setBusy(true);
      if (!api.analysisPreviewCast) { setError('La conversión requiere la app nativa actualizada.'); setBusy(false); }
      else void api.analysisPreviewCast({ datasetId: dataset.id, column: cast.column.id, kind: cast.target }).then(result => { if (alive.current) setCastPreview(result); }).catch(e => { if (alive.current) setError(errorText(e)); }).finally(() => { if (alive.current) setBusy(false); });
    } else {
      for (const name of (mode.kind === 'classify' ? ['jev', 'gemini'] : ['gemini']) as Array<'jev' | 'gemini'>) {
        void api.hasProviderKey(name).then(ready => { if (alive.current) setKeys(current => ({ ...current, [name]: ready })); }).catch(e => { if (alive.current) { setError(errorText(e)); setKeys(current => ({ ...current, [name]: 'unavailable' })); } });
      }
    }
    return () => { alive.current = false; dialog.current?.close(); };
  }, []);
  const clearProposal = () => { setClassification(null); setProposal(null); setError(''); };
  const saveKey = async (name: 'jev' | 'gemini') => {
    setBusy(true); setError('');
    try { await api.saveProviderKey(name, key[name].trim()); if (alive.current) { setKey(current => ({ ...current, [name]: '' })); setKeys(current => ({ ...current, [name]: true })); } }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const refreshModels = async () => {
    if (!api.analysisModels) return;
    setBusy(true); setRefreshingModels(true); setError('');
    const names = (mode.kind === 'classify' ? ['jev', 'gemini'] : ['gemini']) as Array<'jev' | 'gemini'>;
    const ready = names.filter(name => keys[name] === true);
    const results = await Promise.allSettled(ready.map(name => api.analysisModels!(name)));
    if (alive.current) {
      const found = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      if (found.length) setModels(current => {
        return [...current.filter(item => !ready.includes(item.provider)), ...found].sort((a, b) => a.provider === b.provider ? b.id.localeCompare(a.id) : a.provider === 'jev' ? -1 : 1);
      });
      if (found.length && ready.includes(provider) && !found.some(item => item.id === model)) { setModel(found.find(item => item.provider === provider)?.id ?? found[0].id); clearProposal(); }
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') setError(errorText(failure.reason));
      setBusy(false);
      setRefreshingModels(false);
    }
  };
  const generate = async () => {
    if (busy || !keyReady || !columns.length) return;
    setBusy(true); clearProposal();
    const request = { datasetId: dataset.id, columns, model: model.trim(), language, prompt };
    try {
      if (mode.kind === 'classify') {
        if (!api.analysisClassify) throw new Error('Abre la versión actualizada de Datolens para clasificar.');
        const result = await api.analysisClassify(request); if (alive.current) setClassification(result);
      } else {
        if (!api.analysisFilter) throw new Error('Abre la versión actualizada de Datolens para filtrar con Gemini.');
        const result = await api.analysisFilter(request); if (alive.current) setProposal(result);
      }
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const apply = async () => {
    setError('');
    if (cast && castPreview && api.analysisCast) {
      setBusy(true); setCommitting(true);
      try {
        await beforeCast();
        if (!alive.current) return;
        const result = await api.analysisCast({ datasetId: dataset.id, column: cast.column.id, kind: cast.target, expectedRevision: castPreview.datasetRevision });
        if (!alive.current) return;
        onCast(result, cast.column.id); onClose();
      } catch (e) { if (alive.current) setError(errorText(e)); }
      finally { if (alive.current) { setBusy(false); setCommitting(false); } }
    } else if (classification) {
      if (classification.datasetRevision !== dataset.revision) return setError('La propuesta ha caducado. Vuelve a generarla.');
      onView(v => applyClassification(v, classification)); onClose();
    } else if (proposal?.filters.length) {
      if (proposal.datasetRevision !== dataset.revision) return setError('La propuesta ha caducado. Vuelve a generarla.');
      onView(v => ({ ...v, filters: mergeAnalysisFilters(v.filters, proposal.filters), workspace: { ...v.workspace!, pageOffset: 0 } })); onClose();
    }
  };
  const canApply = cast ? !!castPreview : !!classification || !!proposal?.filters.length;
  return <dialog ref={dialog} className="dl-analysis-dialog" onCancel={event => { if (committing) event.preventDefault(); else onClose(); }} aria-labelledby="dl-analysis-title"><header><div><span className="dl-analysis-eyebrow">{cast ? t('CONVERSIÓN LOCAL') : t(provider === 'jev' ? 'JEV · UNA CONSULTA' : 'GEMINI · UNA CONSULTA')}</span><h2 id="dl-analysis-title">{t(title)}</h2></div><button aria-label={t("Cerrar análisis")} disabled={committing} onClick={onClose}>×</button></header>
    {cast ? <div className="dl-cast-review"><p>{t("Convertir a ")}<strong>{cast.target ? t(kindLabel[cast.target]) : t('Auto (detectado)')}</strong>{t(". Se actualizarán la tabla, las distribuciones, los filtros y las exportaciones.")}</p>{busy && !castPreview && <p role="status">{t("Comprobando todos los valores…")}</p>}{castPreview && <><div className="dl-cast-count"><strong>{castPreview.invalidCount.toLocaleString(locale)}</strong><span>{t("de ")}{castPreview.nonNullCount.toLocaleString(locale)}{t(" valores no vacíos ")}{castPreview.invalidCount === 1 ? t('pasará a vacío') : t('pasarán a vacío')}</span></div><p>{t("El archivo original se conserva. Puedes recuperar sus valores y su tipo con ")}<strong>Auto</strong>{t(". Se quitará el filtro actual de esta variable.")}</p>{cast.target === 'multivalued' && <small>{t("Las listas deben estar escritas entre corchetes, como [Madrid, Barcelona].")}</small>}</>}</div> : <>
      <p className="dl-analysis-intro">{mode.kind === 'classify' ? t('Propón grupos temáticos y una función para cada variable. Podrás revisar y editar el resultado.') : t('Describe las filas que quieres ver. Revisa los filtros propuestos antes de aplicarlos.')}</p>
      <div className="dl-analysis-keys">{((mode.kind === 'classify' ? ['jev', 'gemini'] : ['gemini']) as Array<'jev' | 'gemini'>).map(name => <div key={name} className="dl-key-entry">{keys[name] === null ? <span>{t('Comprobando claves…')} {name === 'jev' ? 'Jev' : 'Gemini'}</span> : keys[name] === 'unavailable' ? <span>{t('No se pudo comprobar la clave guardada.')} {name === 'jev' ? 'Jev' : 'Gemini'}</span> : keys[name] ? <span>✓ {name === 'jev' ? 'Jev' : 'Gemini'} {t('configurado en este Mac')}</span> : <form className="dl-key-form" onSubmit={e => { e.preventDefault(); void saveKey(name); }}><label>{t('Tu clave de')} {name === 'jev' ? 'Jev' : 'Gemini'}<input type="password" autoComplete="off" value={key[name]} onChange={e => setKey(current => ({ ...current, [name]: e.target.value }))} placeholder={t('Pega tu API key')} disabled={busy} /></label><button type="submit" disabled={busy || !key[name].trim()}>{t('Guardar en Llavero')}</button><small>{t('La clave queda en el Llavero de macOS.')}</small></form>}</div>)}</div>
      <fieldset disabled={busy}><details className="dl-analysis-scope"><summary>{columns.length}{t(" de ")}{dataset.columns.length}{t(" variables · elegir alcance")}</summary><div className="dl-scope-actions"><button type="button" onClick={() => { setColumns(dataset.columns.slice(0, 128).map(c => c.id)); clearProposal(); }}>{t("Seleccionar ")}{Math.min(128, dataset.columns.length)}</button><button type="button" onClick={() => { setColumns([]); clearProposal(); }}>{t("Ninguna")}</button></div><VariableChecklist label={t("Variables")} columns={dataset.columns} value={columns} maxSelected={128} onChange={ids=>{setColumns(ids);clearProposal();}}/></details>
      <p className="dl-analysis-privacy">{mode.kind === 'filter' ? t('Se envían los nombres, tipos, cuantiles numéricos y algunos valores categóricos frecuentes de las variables seleccionadas, además de tu petición') : t('Se envían solo los nombres y tipos de las variables seleccionadas')}{t('. No se envían filas. Una consulta por clic; el coste depende de tu proveedor.')}</p>
      <div className="dl-analysis-model"><ModelPicker label={t('Modelo')} value={model} options={models.filter(item => mode.kind === 'classify' || item.provider === 'gemini')} disabled={busy} onChange={value => { setModel(value); clearProposal(); }} /><button type="button" onClick={() => void refreshModels()} disabled={busy || !Object.values(keys).some(value => value === true)}>{t('Actualizar modelos disponibles')}</button></div>
      {mode.kind === 'filter' && <form onSubmit={e => { e.preventDefault(); void generate(); }}><label className="dl-analysis-prompt">{t("Qué filas quieres ver")}<textarea autoFocus rows={3} maxLength={4000} value={prompt} onChange={e => { setPrompt(e.target.value); clearProposal(); }} placeholder={t("Ej. Ciudad es Madrid y el precio está entre 100000 y 300000")} /></label><button type="submit" className="dl-primary" disabled={!keyReady || !columns.length || !prompt.trim()}>{t("Proponer filtros")}</button></form>}
      {mode.kind === 'classify' && <button className="dl-primary" onClick={() => void generate()} disabled={!keyReady || !columns.length}>{t("Proponer clasificación")}</button>}</fieldset>
      {busy && <p className="dl-analysis-working" role="status">{t(refreshingModels ? 'Consultando modelos disponibles…' : provider === 'jev' ? 'Jev está preparando la propuesta…' : 'Gemini está preparando la propuesta…')}</p>}
      {classification && <section className="dl-analysis-result"><p>{classification.explanation}</p><div className="dl-classification-list">{classification.assignments.map((assignment, index) => <div key={assignment.column}><strong title={assignment.column}>{dataset.columns.find(c => c.id === assignment.column)?.name}</strong><select aria-label={t("Función propuesta de {value0}", { value0: assignment.column })} value={assignment.role} onChange={e => setClassification({ ...classification, assignments: classification.assignments.map((a, i) => i === index ? { ...a, role: e.target.value as typeof a.role } : a) })}>{ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{t(role.label)}</option>)}</select><input aria-label={t("Grupo propuesto de {value0}", { value0: assignment.column })} maxLength={80} value={assignment.group} onChange={e => setClassification({ ...classification, assignments: classification.assignments.map((a, i) => i === index ? { ...a, group: e.target.value } : a) })} /></div>)}</div></section>}
      {proposal && <section className="dl-analysis-result"><p>{proposal.explanation}</p>{proposal.filters.map(filter => <div className="dl-proposed-filter" key={filter.column}><strong>{dataset.columns.find(c => c.id === filter.column)?.name}</strong><span>{filterDescription(filter)}</span></div>)}{!!proposal.filters.length && <small>{t("Se combinan con los filtros actuales. Si una variable ya tiene un filtro, se sustituye por el propuesto.")}</small>}</section>}
    </>}
    {error && <p className="dl-analysis-error" role="alert">{t(error)}</p>}<footer><button disabled={committing} onClick={onClose}>{busy ? t('Cerrar') : t('Cancelar')}</button><button className="dl-primary" disabled={busy || !canApply || !!classification?.assignments.some(a => !a.group.trim())} onClick={() => void apply()}>{cast ? t('Aplicar tipo') : mode.kind === 'classify' ? t('Aplicar clasificación') : t('Aplicar filtros')}</button></footer>
  </dialog>;
}
