import { useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '../../contracts/desktop-api';
import { ModelPicker } from '../../ui/ModelPicker';

export function SemanticAiSettings({ api, en, disabled, model, onModel, context, onContext }: { api?: DesktopApi; en: boolean; disabled: boolean; model: string; onModel: (value: string) => void; context: string; onContext: (value: string) => void }) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => {
    if (!api?.analysisModels) return;
    setLoading(true); setError('');
    try {
      const available = await api.analysisModels('gemini');
      if (mounted.current) setModels(available.filter(item => item.provider === 'gemini').map(item => item.id));
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setLoading(false); }
  };
  return <><div className="dl-category-color-ai-controls">
    <label><span>{en ? 'Optional context' : 'Contexto opcional'}</span><input value={context} disabled={disabled} maxLength={500} onChange={e => onContext(e.target.value)} placeholder={en ? 'e.g. an agreement scale' : 'Ej.: escala de acuerdo'} /></label>
    <ModelPicker label={en ? 'Model' : 'Modelo'} value={model} disabled={disabled || loading} onChange={onModel} options={[...new Set([model, 'gemini-2.5-flash', ...models])].map(id => ({ id, provider: 'gemini' }))} />
    <button type="button" disabled={disabled || loading || !api?.analysisModels} onClick={() => void refresh()}>{loading ? '…' : en ? 'Refresh models' : 'Actualizar modelos'}</button>
  </div>{error && <p role="alert" className="dl-category-color-error">{error}</p>}</>;
}
