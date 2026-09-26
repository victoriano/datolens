import { expect, test } from 'bun:test';
import { initialView, reorderVariables } from './model';
import { applyClassification, mergeAnalysisFilters, variableGroups } from './analysis-model';
import type { Dataset, Filter } from '../../contracts/desktop-api';

const dataset: Dataset = { id: 'analysis', name: 'test', sourcePath: '/fixtures/test', revision: '1', rowCount: 5, columns: [
  { id: 'id', name: 'ID', kind: 'text', dataType: 'VARCHAR' },
  { id: 'price', name: 'Precio', kind: 'numeric', dataType: 'DOUBLE' },
  { id: 'city', name: 'Ciudad', kind: 'categorical', dataType: 'VARCHAR' },
] };
test('classification only changes the selected variables and preserves panel preferences', () => {
  const view = initialView(dataset);
  view.variablePanel.metadata = { city: { role: 'feature', group: 'Grupo manual' } };
  view.variablePanel.statistics = ['price'];
  const next = applyClassification(view, { datasetRevision: '1', explanation: '', assignments: [{ column: 'price', role: 'target', group: 'Precio y valoración' }] });
  expect(next.variablePanel.metadata?.city).toEqual(view.variablePanel.metadata.city);
  expect(next.variablePanel.statistics).toEqual(['price']);
  expect(variableGroups(dataset.columns, next).map(g => g.name)).toEqual(['Sin grupo', 'Precio y valoración', 'Grupo manual']);
  next.variablePanel.roleFilter = 'target';
  expect(variableGroups(dataset.columns, next).flatMap(g => g.columns.map(c => c.id))).toEqual(['price']);
  next.variablePanel.groupFilter = 'Grupo manual';
  expect(variableGroups(dataset.columns, next)).toHaveLength(0);
});
test('classification and regrouping retain manual variable text', () => {
  const view = initialView(dataset);
  view.variablePanel.metadata = { price: { role: 'feature', group: 'Original', name: 'Precio final', description: 'Importe en euros' } };
  const classified = applyClassification(view, { datasetRevision: '1', explanation: '', assignments: [{ column: 'price', role: 'target', group: 'Valoración' }] });
  expect(classified.variablePanel.metadata?.price).toEqual({ role: 'target', group: 'Valoración', name: 'Precio final', description: 'Importe en euros' });
  const moved = reorderVariables(classified.variablePanel, 'price', 'city', ['id', 'price', 'city']);
  expect(moved.metadata?.price?.name).toBe('Precio final');
  expect(moved.metadata?.price?.description).toBe('Importe en euros');
});
test('pinned variables stay first and hidden/search preferences compose with groups', () => {
  const view = initialView(dataset);
  view.variablePanel.pinned = ['price'];
  view.variablePanel.hidden = ['id'];
  expect(variableGroups(dataset.columns, view).map(g => g.name)).toEqual(['Fijadas', 'Sin grupo']);
  view.variablePanel.search = 'ciUDad';
  expect(variableGroups(dataset.columns, view).flatMap(g => g.columns.map(c => c.id))).toEqual(['city']);
});
test('AI filters replace only affected columns and preserve unrelated filters', () => {
  const current: Filter[] = [{ kind: 'categorical', column: 'city', selected: ['Madrid'] }, { kind: 'numeric', column: 'price', min: 100 }];
  const proposed: Filter[] = [{ kind: 'numeric', column: 'price', min: 200, max: 500 }];
  expect(mergeAnalysisFilters(current, proposed)).toEqual([current[0], proposed[0]]);
  expect(current).toHaveLength(2);
});
test('dropping across thematic groups adopts the target group without changing analytical role', () => {
  const view = initialView(dataset);
  view.variablePanel.metadata = { id: { role: 'identifier', group: 'IDs' }, price: { role: 'target', group: 'Precio' }, city: { role: 'feature', group: 'Ubicación' } };
  view.variablePanel = reorderVariables(view.variablePanel, 'price', 'city', ['id', 'price', 'city']);
  expect(view.variablePanel.metadata?.price).toEqual({ role: 'target', group: 'Ubicación' });
  expect(variableGroups(dataset.columns, view).flatMap(g => g.columns.map(c => c.id))).toEqual(['id', 'city', 'price']);
  view.variablePanel.hidden = ['id'];
  view.variablePanel = reorderVariables(view.variablePanel, 'price', 'city', ['city', 'price']);
  expect(view.variablePanel.order[0]).toBe('id');
  expect(variableGroups(dataset.columns, view).flatMap(g => g.columns.map(c => c.id))).toEqual(['price', 'city']);
});
