import type { Config, Spec } from 'vega';
import type { Language } from './preferences';

/** Per-view locale; never mutate Vega's process-wide default locale. */
export function chartLocale(language: Language): Config['locale'] {
  const es = language === 'es';
  return {
    number: { decimal: es ? ',' : '.', thousands: es ? '.' : ',', grouping: [3], currency: es ? ['', ' €'] : ['$', ''] },
    time: {
      dateTime: es ? '%A, %e de %B de %Y, %X' : '%A, %B %e, %Y, %X',
      date: es ? '%d/%m/%Y' : '%m/%d/%Y', time: '%H:%M:%S', periods: ['AM', 'PM'],
      days: es ? ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      shortDays: es ? ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      months: es ? ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      shortMonths: es ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    },
  };
}
export function localizeChart(spec: Spec, language: Language): Spec {
  return { ...spec, config: { ...spec.config, locale: chartLocale(language) } };
}
