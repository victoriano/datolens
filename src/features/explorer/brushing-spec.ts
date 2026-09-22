/**
 * Vega spec for the brushing histogram used by the cross-filter variable
 * panel. Ported from graphext/charts `src/BrushingBarChart/spec.ts` (Vega v6,
 * hand-built signals) and adapted for this app: self-contained (no theme
 * system — colors are injected per app theme via useChartColors). Rich hover
 * details are rendered by the React wrapper so the spec stays interaction-only.
 *
 * Interactions provided by the signal graph:
 * - drag on bars creates a brush; drag inside the brush moves it;
 *   `leftSlider`/`rightSlider` edge handles resize it
 * - `barClick` selects a single bin
 * - `filterStop` fires on mouseup with the final range
 */
import type { Spec } from 'vega';

const YAXIS_OFFSET = 30;

export interface BrushingSpecOptions {
  isDate: boolean;
  width: number;
  height: number;
  foregroundColor: string;
  backgroundColor: string;
  brushColor: string;
  axisLabelColor: string;
  axisLineColor: string;
  /** Fill for the brush range value labels above the chart. */
  rangeLabelColor: string;
}

export function buildBrushingSpec(options: BrushingSpecOptions): Spec {
  const { isDate } = options;

  return {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    width: options.width,
    height: options.height,
    padding: { top: 14, bottom: 16, left: 4, right: 4 },
    autosize: 'pad',
    config: {
      events: {
        defaults: {
          prevent: true,
        },
      },
      text: { fontSize: 10 },
      axis: {
        labelColor: options.axisLabelColor,
        labelFontSize: 9,
        tickColor: options.axisLineColor,
        domainColor: options.axisLineColor,
      },
    },
    data: [
      // `project` clones tuples before the date formula transforms run so the
      // consumer's data objects are not mutated in place (see the upstream
      // graphext spec for the full explanation of the mutation leak).
      {
        name: 'data',
        ...(isDate
          ? {
              transform: [
                { type: 'project' },
                { type: 'formula', as: 'left', expr: 'time(datum.left)' },
                { type: 'formula', as: 'right', expr: 'time(datum.right)' },
              ],
            }
          : {}),
      },
      {
        name: 'selected',
        ...(isDate
          ? {
              transform: [
                { type: 'project' },
                {
                  type: 'formula',
                  as: 'filterRange',
                  expr: '[time(datum.filterRange[0]), time(datum.filterRange[1])]',
                },
              ],
            }
          : {}),
      },
      { name: 'propsAsData' },
    ],
    signals: [
      { name: 'interactive', value: true },
      { name: 'foregroundColor', value: options.foregroundColor },
      { name: 'backgroundColor', value: options.backgroundColor },
      {
        name: 'bgField',
        update: `data("propsAsData").length && data("propsAsData")[0].bgField
          ? data("propsAsData")[0].bgField
          : "rBackground"`,
      },
      {
        name: 'fgField',
        update: `data("propsAsData").length && data("propsAsData")[0].fgField
          ? data("propsAsData")[0].fgField
          : "rForeground"`,
      },
      {
        name: 'relative',
        update: `data("propsAsData").length && data("propsAsData")[0].relative
          ? data("propsAsData")[0].relative
          : false`,
      },
      { name: 'showBarBackground', value: true },
      { name: 'showYAxis', value: true },
      { name: 'undefined' },
      {
        name: 'dragging',
        value: false,
        on: [
          {
            events: `
              @bars:mousedown,
              @bars:touchstart,
              @brush:mousedown,
              @brush:touchstart,
              @background:mousedown,
              @background:touchstart,
              @foreground:mousedown,
              @foreground:touchstart,
              @leftSlider:mousedown,
              @leftSlider:touchstart,
              @rightSlider:mousedown,
              @rightSlider:touchstart
            `,
            update: 'true',
          },
          {
            events: 'window:mouseup, window:touchend',
            update: 'false',
          },
        ],
      },
      {
        name: 'filterRange',
        ...(isDate
          ? {
              update: `internalFilterRange
                ? [
                  utcFormat(internalFilterRange[0], "%Y-%m-%dT%H:%M:%S.%LZ"),
                  utcFormat(internalFilterRange[1], "%Y-%m-%dT%H:%M:%S.%LZ")
                ]
                : internalFilterRange`,
            }
          : { update: 'internalFilterRange' }),
      },
      {
        name: 'externalFilterRange',
        update: 'data("selected").length ? data("selected")[0].filterRange : undefined',
      },
      {
        name: 'internalFilterRange',
        update: 'dragging ? internalFilterRange : externalFilterRange',
      },
      {
        // `filterStop` emits the raw internal range (numeric pair) on mouseup;
        // the wrapper converts back to the consumer format.
        name: 'filterStop',
        update: '!dragging && externalFilterRange ? externalFilterRange : filterStop',
      },
      { name: 'barClick' },
      { name: 'internalBrush' },
    ],
    marks: [
      {
        type: 'group',
        name: 'bars',
        encode: {
          enter: {
            x: { value: 0 },
            y: { value: 0 },
            fill: { value: 'transparent' },
            cursor: { signal: 'interactive ? "crosshair" : "default"' },
          },
          update: {
            height: { signal: 'height' },
            width: { signal: 'width' },
          },
        },
        signals: [
          {
            name: 'xScaleFormat',
            update: 'domain("x")[0] >= -1 && domain("x")[1] <= 1 ? ".3" : "~s"',
          },
          {
            name: 'internalWidth',
            update: `showYAxis ? width - ${YAXIS_OFFSET} : width`,
          },
          {
            name: 'internalBrush',
            value: 'undefined',
            on: [
              {
                events: '@bars:mousedown, @bars:touchstart',
                update: 'null',
              },
              {
                events: `
                  [@bars:mousedown, window:mouseup] > window:mousemove!{30},
                  [@bars:touchstart, window:touchend] > window:touchmove!{30},
                  [@background:mousedown, window:mouseup] > window:mousemove!{30},
                  [@background:touchstart, window:touchend] > window:touchmove!{30},
                  [@foreground:mousedown, window:mouseup] > window:mousemove!{30},
                  [@foreground:touchstart, window:touchend] > window:touchmove!{30}
                `,
                update: isDate
                  ? `x() < xdown
                    ? [time(invert("x", clamp(x(), 0, internalWidth))), time(invert("x", xdown))]
                    : [time(invert("x", xdown)), time(invert("x", clamp(x(), 0, internalWidth)))]`
                  : `x() < xdown
                    ? [invert("x", clamp(x(), 0, internalWidth)), invert("x", xdown)]
                    : [invert("x", xdown), invert("x", clamp(x(), 0, internalWidth))]`,
              },
              {
                events: { signal: 'invertedDelta' },
                update: `[
                  clamp(filterStop[0] + invertedDelta[0], domain("x")[0], domain("x")[1]),
                  clamp(filterStop[1] + invertedDelta[1], domain("x")[0], domain("x")[1])
                ]`,
              },
            ],
          },
          {
            name: 'barClick',
            push: 'outer',
            on: [
              {
                events: '@foreground:click!, @background:click!',
                update: isDate
                  ? `merge(datum, {
                    left: utcFormat(datum.left, "%Y-%m-%dT%H:%M:%S.%LZ"),
                    right: utcFormat(datum.right, "%Y-%m-%dT%H:%M:%S.%LZ")
                  })`
                  : 'datum',
                force: true,
              },
            ],
          },
          {
            name: 'filterStop',
            push: 'outer',
            on: [
              {
                events: 'window:mouseup, window:touchend',
                update: 'internalFilterRange',
              },
            ],
          },
          {
            name: 'invertedDelta',
            value: [0, 0],
            on: [
              {
                events: { signal: 'delta' },
                update: `clampRange(
                  [invert("x", delta) - domain("x")[0], invert("x", delta) - domain("x")[0]],
                  domain("x")[0] - filterStop[0],
                  domain("x")[1] - filterStop[1]
                )`,
              },
              {
                events: { signal: 'leftDelta' },
                update: '[invert("x", leftDelta) - domain("x")[0], 0]',
              },
              {
                events: { signal: 'rightDelta' },
                update: '[0, invert("x", rightDelta) - domain("x")[0]]',
              },
            ],
          },
          {
            name: 'xdown',
            value: 0,
            on: [
              {
                events: `
                  @bars:mousedown,
                  @bars:touchstart,
                  @brush:mousedown,
                  @brush:touchstart,
                  @background:mousedown,
                  @background:touchstart,
                  @foreground:mousedown,
                  @foreground:touchstart,
                  @leftSlider:mousedown,
                  @leftSlider:touchstart,
                  @rightSlider:mousedown,
                  @rightSlider:touchstart
                `,
                update: 'x()',
              },
            ],
          },
          {
            name: 'delta',
            value: 0,
            on: [
              {
                events: `
                  [@brush:mousedown, window:mouseup] > window:mousemove!{30},
                  [@brush:touchstart, window:touchend] > window:touchmove!{30}
                `,
                update: 'x() - xdown',
              },
            ],
          },
          {
            name: 'leftDelta',
            value: 0,
            on: [
              {
                events: `
                  [@leftSlider:mousedown, window:mouseup] > window:mousemove!{30},
                  [@leftSlider:touchstart, window:touchend] > window:touchmove!{30}
                `,
                update: 'x() - xdown',
              },
            ],
          },
          {
            name: 'rightDelta',
            value: 0,
            on: [
              {
                events: `
                  [@rightSlider:mousedown, window:mouseup] > window:mousemove!{30},
                  [@rightSlider:touchstart, window:touchend] > window:touchmove!{30}
                `,
                update: 'x() - xdown',
              },
            ],
          },
          {
            name: 'internalFilterRange',
            push: 'outer',
            on: [
              {
                events: { signal: 'internalBrush' },
                update: 'internalBrush',
              },
            ],
          },
          {
            // Drives the brush rect. Subscribes directly to
            // `externalFilterRange` because in vega 6 outer-scope updates do
            // not propagate into inner scopes (see upstream spec comments).
            name: 'brush',
            value: [],
            update: isDate
              ? `internalFilterRange
                ? [time(scale("x", internalFilterRange[0])), time(scale("x", internalFilterRange[1]))]
                : []`
              : `internalFilterRange
                ? [scale("x", internalFilterRange[0]), scale("x", internalFilterRange[1])]
                : []`,
            on: [
              {
                events: { signal: 'externalFilterRange' },
                update: isDate
                  ? `!dragging && externalFilterRange
                    ? [
                      time(scale("x", externalFilterRange[0])),
                      time(scale("x", externalFilterRange[1]))
                    ]
                    : brush`
                  : `!dragging && externalFilterRange
                    ? [scale("x", externalFilterRange[0]), scale("x", externalFilterRange[1])]
                    : brush`,
              },
            ],
          },
        ],
        scales: [
          {
            name: 'x',
            type: isDate ? 'time' : 'linear',
            range: [0, { signal: 'internalWidth' }],
            round: true,
            ...(isDate ? {} : { zero: false }),
            nice: false,
            domain: {
              fields: [
                { data: 'data', field: 'left' },
                { data: 'data', field: 'right' },
              ],
            },
          },
          {
            name: 'y',
            type: 'linear',
            range: [{ signal: 'height' }, 0],
            domain: {
              fields: [
                { data: 'data', field: { signal: 'bgField' } },
                { data: 'data', field: { signal: 'fgField' } },
              ],
            },
            nice: true,
            zero: true,
            round: true,
          },
        ],
        axes: [
          {
            orient: 'bottom',
            scale: 'x',
            tickCount: 4,
            grid: false,
            labelFlush: true,
            labelOverlap: 'parity',
            ...(isDate ? {} : { format: { signal: 'xScaleFormat' } }),
          },
          // Relative (%) / count axis for the bins, drawn at the right edge of
          // the plot area (the x range already reserves YAXIS_OFFSET for it).
          {
            orient: 'right',
            scale: 'y',
            domainWidth: { signal: 'showYAxis ? 1 : 0' },
            format: { signal: 'relative ? "p" : "~s"' },
            grid: false,
            tickCount: { signal: 'showYAxis ? 4 : 0' },
            labelOverlap: 'parity',
            offset: -YAXIS_OFFSET,
          },
        ],
        marks: [
          {
            type: 'rect',
            name: 'background',
            from: { data: 'data' },
            encode: {
              enter: {
                cursor: { signal: 'interactive ? "pointer" : "default"' },
              },
              update: {
                x: { scale: 'x', field: 'left', offset: 1 },
                x2: { scale: 'x', field: 'right' },
                y: { scale: 'y', field: { signal: 'bgField' } },
                y2: { scale: 'y', value: 0 },
                fill: { signal: 'backgroundColor' },
                // With no active selection fg === bg, so the background bar
                // adds nothing — hidden until a filter exists.
                fillOpacity: { signal: 'showBarBackground ? 1 : 0' },
              },
            },
          },
          {
            type: 'rect',
            name: 'foreground',
            from: { data: 'data' },
            encode: {
              enter: {
                cursor: { signal: 'interactive ? "pointer" : "default"' },
              },
              update: {
                // Horizontally inset within the background bar (upstream
                // `foregroundMargin`), so the gray peeks out at the sides and
                // the two distributions stay readable whichever is taller.
                x: { scale: 'x', field: 'left', offset: { signal: 'showBarBackground ? 3 : 1' } },
                x2: { scale: 'x', field: 'right', offset: { signal: 'showBarBackground ? -2 : 0' } },
                y: { scale: 'y', field: { signal: 'fgField' } },
                y2: { scale: 'y', value: 0 },
                fill: { signal: 'foregroundColor' },
              },
            },
          },
          {
            type: 'rect',
            name: 'brush',
            interactive: true,
            encode: {
              enter: {
                y: { value: 0 },
                fill: { value: options.brushColor },
                fillOpacity: { value: 0.15 },
              },
              update: {
                x: { signal: 'brush[0]' },
                x2: { signal: 'brush[1]' },
                height: { signal: 'height' },
                cursor: { signal: 'interactive ? "move" : "default"' },
              },
            },
          },
          {
            type: 'rect',
            name: 'leftSlider',
            interactive: true,
            encode: {
              enter: {
                y: { value: 0 },
                fill: { value: options.brushColor },
                fillOpacity: { value: 0.8 },
              },
              update: {
                x: { signal: 'brush[0] + 1' },
                x2: { signal: 'brush[0] - 2' },
                height: { signal: 'height' },
                cursor: { signal: 'interactive ? "ew-resize" : "default"' },
              },
            },
          },
          {
            type: 'rect',
            name: 'rightSlider',
            interactive: true,
            encode: {
              enter: {
                y: { value: 0 },
                fill: { value: options.brushColor },
                fillOpacity: { value: 0.8 },
              },
              update: {
                x: { signal: 'brush[1] - 1' },
                x2: { signal: 'brush[1] + 2' },
                height: { signal: 'height' },
                cursor: { signal: 'interactive ? "ew-resize" : "default"' },
              },
            },
          },
          {
            type: 'text',
            name: 'leftRange',
            encode: {
              enter: {
                fontWeight: { value: 'bold' },
                fill: { value: options.rangeLabelColor },
              },
              update: {
                x: { signal: 'brush[0]' },
                y: { value: 0, offset: -4 },
                align: { signal: 'brush[0] > width / 2 ? "right" : "left"' },
                text: {
                  signal: `internalFilterRange
                    ? ${
                      isDate
                        ? 'utcFormat(internalFilterRange[0], "%b %d, %Y")'
                        : "(abs(internalFilterRange[0]) < 10 ? format(internalFilterRange[0], '.2') : format(internalFilterRange[0], ',d'))"
                    }
                    : ''`,
                },
                opacity: { value: 0.9 },
              },
            },
          },
          {
            type: 'text',
            name: 'rightRange',
            encode: {
              enter: {
                fontWeight: { value: 'bold' },
                fill: { value: options.rangeLabelColor },
              },
              update: {
                x: { signal: 'brush[1]' },
                y: { value: 0, offset: -4 },
                align: { signal: 'brush[1] > width / 2 ? "right" : "left"' },
                text: {
                  signal: `internalFilterRange && brush[1] - brush[0] > 40
                    ? ${
                      isDate
                        ? 'utcFormat(internalFilterRange[1], "%b %d, %Y")'
                        : "(abs(internalFilterRange[1]) < 10 ? format(internalFilterRange[1], '.2') : format(internalFilterRange[1], ',d'))"
                    }
                    : ''`,
                },
                opacity: { value: 0.9 },
              },
            },
          },
        ],
      },
    ],
  } as Spec;
}
