import type { Column, Dataset, DesktopApi, Filter, Scalar } from '../../contracts/desktop-api';

export type PlotKind = 'bar' | 'stackedBar' | 'groupedBar' | 'segmentedBar' | 'percentBar' | 'line' | 'segmentedLine' | 'multipleLine' | 'seasonal' | 'area' | 'stackedArea' | 'segmentedArea' | 'percentArea' | 'heatmap' | 'box' | 'scatter' | 'coloredScatter' | 'bubble' | 'coloredBubble' | 'table';
export type Statistic = 'count' | 'relativeCount' | 'cumulativeCount' | 'valid' | 'distinct' | 'sum' | 'mean' | 'median' | 'min' | 'max' | 'stddev' | 'q1' | 'q3' | 'percentile' | 'countWhere' | 'percentWhere';
export type QueryStatistic = Exclude<Statistic, 'relativeCount' | 'cumulativeCount'>;
export type Binning = 'exact' | 'width' | 'quantile' | 'date';
export type DateInterval = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface Dimension { column: string; binning: Binning; bins?: number; interval?: DateInterval; component?: 'year' | 'quarter' | 'month' | 'dayofweek' | 'hour' }
export interface Measure { column?: string; stat: QueryStatistic; percentile?: number; value?: string }
export interface PlotQuery {
  datasetId: string; filters: Filter[]; mode: 'aggregate' | 'points';
  dimensions: Dimension[]; measures: Measure[]; pointColumns?: string[];
  limit: number; includeMissing: boolean; sort?: 'natural' | 'value' | 'count'; descending?: boolean;
  /** Aggregate only these dimension indices, retaining eligibility from all dimensions. */
  groupDimensions?: number[];
}
/** Aggregate aliases: d0, d0End, d1… and m0, m1…; points: id, d0… . */
export type PlotDatum = Record<string, Scalar>;
export interface PlotResult {
  rows: PlotDatum[]; matchedRows: number; totalRows: number; plottedRows: number; truncated: boolean;
  datasetRevision: string; selectionMethod: 'allGroups' | 'orderedGroups' | 'allPoints' | 'firstRows';
  statistics?: { correlation?: number | null; slope?: number | null; intercept?: number | null; rSquared?: number | null };
}
export interface PlotApi {
  queryPlot(request: PlotQuery): Promise<PlotResult>;
  exportPlot?(request: { name: string; format: 'svg' | 'png' | 'csv'; content: string; encoding: 'utf8' | 'base64' }): Promise<string | null>;
}
export interface AxisOptions {
  title: string; showTitle: boolean; format: string; log: boolean; zero: boolean;
  grid: boolean; min?: number; max?: number; ticks: number; customTicks: string;
  rotation: number; labelWidth: number; labelSeparation?: number;
  binLabel?: 'range' | 'start' | 'end';
}
export interface Annotation { id: string; kind: 'x' | 'y' | 'text'; value: number; end?: number; label: string; x: number; y: number; color: string }
export interface PlotConfig {
  kind: PlotKind; x: string; y: string; color: string; size: string; cell: string;
  tableRows: string[]; tableColumns: string[]; tableValues: string[]; multipleY: string[];
  stat: Statistic; percentile: number; statisticValue: string;
  xBinning: Binning; yBinning: Binning; colorBinning: Binning; bins: number; binsY: number; binsColor: number;
  interval: DateInterval; intervalY: DateInterval; intervalColor: DateInterval; dateComponent: '' | NonNullable<Dimension['component']>;
  includeMissing: boolean; sort: 'natural' | 'value' | 'count'; descending: boolean;
  sortY: 'natural' | 'value' | 'count'; descendingY: boolean; horizontal: boolean;
  palette: 'tableau10' | 'category10' | 'blues' | 'viridis' | 'magma' | 'redblue'; reversePalette: boolean;
  singleColor: string; categoryColors: Record<string, string>; opacity: number; background: string;
  theme: 'light' | 'dark' | 'paper'; title: string; subtitle: string; description: string; footer: string;
  showTitle: boolean; showSubtitle: boolean; showDescription: boolean; showFooter: boolean;
  labels: boolean; showCount: boolean; showChange: boolean; showTotals: boolean;
  labelPosition: 'inside' | 'outside'; labelAlign: 'left' | 'center' | 'right'; numberFormat: string;
  tooltip: boolean; tooltipColumns: string[]; legend: boolean;
  xAxis: AxisOptions; yAxis: AxisOptions; interpolation: 'linear' | 'monotone' | 'step' | 'basis';
  lineWidth: number; dashed: boolean; markers: boolean; missing: 'gap' | 'zero' | 'connect'; zerosMissing: boolean;
  innerPadding: number; outerPadding: number; pointMin: number; pointMax: number;
  boxStyle: 'quartiles' | 'iqr' | 'extent' | 'deviation'; regression: boolean; correlation: boolean;
  period: number; sharedSeasonalScale: boolean;
  pageSize: number; hideIndex: boolean; cellStyle: 'plain' | 'heat' | 'bars';
  width?: number; height: number; annotations: Annotation[]; linkFilters: boolean;
}
export interface SavedPlot { id: string; name: string; config: PlotConfig; savedAt: string; thumbnail?: string }
export interface PlotWorkspace { version: 1; staged: string[]; draft: PlotConfig | null; saved: SavedPlot[]; activeId?: string }
export interface PlotsPanelProps {
  api: DesktopApi & Partial<PlotApi>; dataset: Dataset; filters: Filter[];
  value?: PlotWorkspace; onChange(value: PlotWorkspace): void;
  onFilter(column: string, filter?: Filter): void; revision?: number;
}
export interface ChartDefinition { kind: PlotKind; label: string; family: string; description: string }
export type { Column, Dataset, Filter, Scalar };
