import { useI18n } from '../../ui';
import type { ProviderEvidence } from '../../contracts/desktop-api';

/** The source links and provider's search suggestions stay with saved cell history. */
export function EvidenceDetails({evidence, label='resultado'}:{evidence?:ProviderEvidence|null;label?:string}) {
  const { t } = useI18n();
  if(!evidence)return null;
  return <div>
    {evidence.confidence!=null&&<small className="ec-confidence">{t("Confianza Jev · ")}{Math.round(evidence.confidence*100)}%</small>}
    {evidence.probability!=null&&<small className="ec-confidence">{t("Probabilidad de sí · ")}{Math.round(evidence.probability*100)}%</small>}
    {!!evidence.sources.length&&<div className="ec-sources">{evidence.sources.map((source,index)=><a key={index} href={/^https?:\/\//i.test(source.url)?source.url:undefined} target="_blank" rel="noreferrer">↗ {source.title}</a>)}</div>}
    {evidence.searchSuggestions&&<iframe title={t("Sugerencias de Google, {value0}", { value0: label === 'resultado' ? t('resultado') : label })} className="ec-search-suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={evidence.searchSuggestions}/>}
  </div>;
}
