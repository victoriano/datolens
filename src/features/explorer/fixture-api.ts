/** Explicit UI-only fixture. Never imported by the application entry point. */
import type { Dataset, DesktopApi, Filter, Row, ViewState } from '../../contracts/desktop-api';
export const fixtureDataset: Dataset = { id: 'explorer-fixture', name: 'empresas.csv · FIXTURE DE INTERFAZ', sourcePath: '/fixtures/empresas.csv', revision: 'fixture-1', rowCount: 240, columns: [
  { id: 'id', name: 'Identificador', kind: 'text', dataType: 'VARCHAR' },
  { id: 'company', name: 'Empresa', kind: 'categorical', dataType: 'VARCHAR' },
  { id: 'city', name: 'Ciudad', kind: 'categorical', dataType: 'VARCHAR' },
  { id: 'sector', name: 'Sector', kind: 'categorical', dataType: 'VARCHAR' },
  { id: 'revenue', name: 'Facturación', kind: 'numeric', dataType: 'DOUBLE' },
  { id: 'employees', name: 'Empleados', kind: 'numeric', dataType: 'BIGINT' },
  { id: 'founded', name: 'Fundación', kind: 'date', dataType: 'DATE' },
] };
const rows: Row[] = Array.from({ length: 240 }, (_, i) => ({ id: `fixture-row-${i}`, values: { id: `${9007199254740993n + BigInt(i)}`, company: ['Norte Studio', 'Oliva Digital', 'Atlas Sistemas', 'Azul Logística', 'Marea Labs', 'Lima Foods'][i % 6], city: ['Madrid', 'Barcelona', 'Sevilla', 'Bilbao'][i % 4], sector: ['Tecnología', 'Servicios', 'Industria'][i % 3], revenue: (i * 17321) % 1000000, employees: i % 31 === 0 ? null : 5 + i % 120, founded: `202${i % 5}-0${1 + i % 9}-15` } }));
const matches = (row: Row, filters: Filter[]) => filters.every(filter => {
  const value = row.values[filter.column];
  if (filter.kind === 'numeric') return typeof value === 'number' && (filter.min === undefined || value >= filter.min) && (filter.max === undefined || value <= filter.max);
  if (filter.kind === 'date') return value !== null && (!filter.start || new Date(String(value)).getTime() >= new Date(filter.start).getTime()) && (!filter.end || new Date(String(value)).getTime() <= new Date(filter.end).getTime());
  if (filter.kind === 'text') return filter.terms.some(term => String(value ?? '').toLowerCase().includes(term.toLowerCase()));
  return filter.selected.includes(String(value));
});
export function createFixtureApi(): DesktopApi {
  let saved: ViewState | null = null;
  const unsupported = async (): Promise<never> => { throw new Error('Fixture de interfaz: operación nativa no disponible.'); };
  return {
    openDataset: async () => fixtureDataset, listSheets: async () => [],
    queryPage: async request => {
      const selected = rows.filter(row => matches(row, request.filters));
      selected.sort((a, b) => { for (const sort of request.sorting) { const av = a.values[sort.id], bv = b.values[sort.id]; const compare = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv)); if (compare) return sort.desc ? -compare : compare; } return a.id.localeCompare(b.id); });
      return { rows: selected.slice(request.offset, request.offset + request.limit).map(row => ({ ...row, values: Object.fromEntries(request.columns.map(id => [id, row.values[id]])) })), filteredCount: selected.length, datasetRevision: 'fixture-1' };
    },
    getDistributions: async request => {
      const selected = rows.filter(row => matches(row, request.filters));
      return { selectedCount: selected.length, totalRows: rows.length, analyzedRows: rows.length, sampled: false, variables: request.columns.map(id => {
        const column = fixtureDataset.columns.find(c => c.id === id)!;
        if (column.kind === 'numeric' || column.kind === 'date') {
          const number = (r: Row) => column.kind === 'date' ? new Date(String(r.values[id])).getTime() : Number(r.values[id]);
          const values = rows.filter(r => r.values[id] !== null).map(number); const min = Math.min(...values), max = Math.max(...values); const step = (max - min) / 12;
          return { column: id, kind: column.kind, bins: Array.from({ length: 12 }, (_, i) => { const left = min + step * i, right = min + step * (i + 1); const inBin = (r: Row) => r.values[id] !== null && number(r) >= left && (i === 11 ? number(r) <= right : number(r) < right); const background = rows.filter(inBin).length, foreground = selected.filter(inBin).length; return { left, right, background, foreground, rBackground: background / rows.length, rForeground: selected.length ? foreground / selected.length : 0 }; }) };
        }
        return { column: id, kind: column.kind, bins: [...new Set(rows.map(r => r.values[id]))].slice(0, 30).map(value => { const background = rows.filter(r => r.values[id] === value).length, foreground = selected.filter(r => r.values[id] === value).length; return { value: String(value), background, foreground, rBackground: background / rows.length, rForeground: selected.length ? foreground / selected.length : 0 }; }) };
      }) };
    },
    loadView: async () => saved, saveView: async (_id, view) => { saved = structuredClone(view); },
    listRuns: async () => [], getCells: async () => [], getCellHistory: async () => [], exportDataset: unsupported, listEnrichments: async () => [], saveEnrichment: unsupported, deleteEnrichment: unsupported, saveProviderKey: unsupported, hasProviderKey: async () => false, removeProviderKey: unsupported, planRun: unsupported, startRun: unsupported, getRunStatus: unsupported, pauseRun: unsupported, resumeRun: unsupported, cancelRun: unsupported,
  };
}
