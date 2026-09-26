import { memo, type CSSProperties } from 'react';
import type { CellValue, Column, Row, ViewState } from '../../contracts/desktop-api';
import { cellText } from './model';
import { useI18n } from '../../ui';
import { getCategoryColor, isCategoricalKind, type CategoryColorMappings, type CategoryColorOverrides } from './category-colors';
import './table-category-colors.css';

const NO_CELLS = new Set<string>();
export type CategoryRanksByColumn = ReadonlyMap<string, ReadonlyMap<string, number>>;
function ColoredValue({ value, label, colors, palette, ranks }: { value: string; label: string; colors?: CategoryColorOverrides; palette?: string; ranks?: ReadonlyMap<string, number> }) {
  return <span className="dl-category-cell" style={{ '--dl-category-color': getCategoryColor(value, colors, palette, ranks) } as CSSProperties}><i aria-hidden="true" />{label || '""'}</span>;
}
const TableCell = memo(function TableCell({ rowId, column, value, selected, nullLabel, colorize, colors, palette, ranks }: { rowId: string; column: Column; value: CellValue | undefined; selected: boolean; nullLabel: string; colorize: boolean; colors?: CategoryColorOverrides; palette?: string; ranks?: ReadonlyMap<string, number> }) {
  const code = value === null || value === undefined ? '' : cellText(value);
  const labels = column.spss?.valueLabels;
  const label = labels && Object.hasOwn(labels, code) ? labels[code] : undefined;
  const display = label ? `${code} · ${label}` : code;
  colorize = colorize && !column.spss?.missingValues.includes(code);
  return <td data-row-id={rowId} data-column-id={column.id} aria-selected={selected} className={`${selected ? 'is-cell-selected' : ''} ${column.kind === 'numeric' ? 'is-number' : ''}`} title={value === null ? nullLabel : display} tabIndex={0}>{value === undefined ? <span className="dl-cell-pending" aria-hidden="true" /> : value === null ? <span className="dl-null">null</span> : colorize ? Array.isArray(value) && column.kind === 'multivalued' ? <span className="dl-category-cell-values">{value.map((item, index) => item === null ? <span key={index} className="dl-null">null</span> : <ColoredValue key={index} value={cellText(item)} label={cellText(item)} colors={colors} palette={palette} ranks={ranks} />)}</span> : <ColoredValue value={code} label={display} colors={colors} palette={palette} ranks={ranks} /> : typeof value === 'boolean' ? <span className="dl-boolean">{value ? 'true' : 'false'}</span> : display}</td>;
});

interface RowProps { row: Row; number: number; columns: Column[]; before: boolean; after: boolean; selected: boolean; cells: Set<string>; nullLabel: string; rowLabel: (number: number) => string; onRowSelection: (id: string, checked: boolean) => void; colorCategoricalCells: boolean; categoryColors?: CategoryColorMappings; categoryPalettes?: ViewState['categoryPalettes']; categoryRanks?: CategoryRanksByColumn; defaultCategoryPalette: string }
const TableRow = memo(function TableRow({ row, number, columns, before, after, selected, cells, nullLabel, rowLabel, onRowSelection, colorCategoricalCells, categoryColors, categoryPalettes, categoryRanks, defaultCategoryPalette }: RowProps) {
  return <tr data-row-id={row.id} className={selected ? 'is-row-selected' : ''}>
    <td className="dl-row-index"><label><span>{number}</span><input type="checkbox" checked={selected} aria-label={rowLabel(number)} onChange={event => onRowSelection(row.id, event.target.checked)} /></label></td>
    {before && <td aria-hidden="true" className="dl-column-spacer" />}
    {columns.map(column => <TableCell key={column.id} rowId={row.id} column={column} value={row.values[column.id]} selected={cells.has(column.id)} nullLabel={nullLabel} colorize={colorCategoricalCells && isCategoricalKind(column.kind)} colors={colorCategoricalCells && isCategoricalKind(column.kind) ? categoryColors?.[column.id] : undefined} palette={colorCategoricalCells && isCategoricalKind(column.kind) ? categoryPalettes?.[column.id] ?? defaultCategoryPalette : undefined} ranks={categoryRanks?.get(column.id)} />)}
    {after && <td aria-hidden="true" className="dl-column-spacer" />}
  </tr>;
});

/** Busy/filter/header changes stop above this boundary; unchanged cells also survive row moves. */
export const TableRows = memo(function TableRows({ rows, columns, offset, before, after, selectedRows, selectedCells, nullLabel, rowLabel, onRowSelection, colorCategoricalCells = false, categoryColors, categoryPalettes, categoryRanks }: {
  rows: Row[]; columns: Column[]; offset: number; before: boolean; after: boolean;
  selectedRows: Set<string>; selectedCells: Map<string, Set<string>>;
  nullLabel: string; rowLabel: RowProps['rowLabel']; onRowSelection: RowProps['onRowSelection'];
  colorCategoricalCells?: boolean; categoryColors?: CategoryColorMappings; categoryPalettes?: ViewState['categoryPalettes']; categoryRanks?: CategoryRanksByColumn;
}) {
  const { defaultCategoryPalette } = useI18n();
  return rows.map((row, index) => <TableRow key={row.id} row={row} number={offset + index + 1} columns={columns} before={before} after={after} selected={selectedRows.has(row.id)} cells={selectedCells.get(row.id) ?? NO_CELLS} nullLabel={nullLabel} rowLabel={rowLabel} onRowSelection={onRowSelection} colorCategoricalCells={colorCategoricalCells} categoryColors={categoryColors} categoryPalettes={categoryPalettes} categoryRanks={categoryRanks} defaultCategoryPalette={defaultCategoryPalette} />);
});
