import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { anchoredVariableScrollTop, sameVariableWindow, variableRows, variableScrollAnchor, variableWindow, type VariableGroup } from './variable-window';

export function useVariableWindow(root: RefObject<HTMLDivElement | null>, groups: VariableGroup[], grouped: boolean, collapsed: string[], expanded: boolean, highlighted: string | null, onVisible: (ids: string[]) => void) {
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 300 });
  const heights = useRef(new Map<string, number>());
  const [measureVersion, setMeasureVersion] = useState(0);
  // Match the grid's padding and gap so Explore cards stay compact without
  // squeezing below the width needed for their chart controls.
  const lanes = expanded ? Math.max(1, Math.floor((viewport.width - 40 + 12) / (310 + 12))) : 1;
  const collapsedKey = JSON.stringify(collapsed);
  const rows = useMemo(() => variableRows(groups, grouped, JSON.parse(collapsedKey), lanes, heights.current), [groups, grouped, collapsedKey, lanes, measureVersion]);
  const latestRows = useRef(rows); latestRows.current = rows;
  const anchor = useRef<ReturnType<typeof variableScrollAnchor>>(null);
  const frame = useRef(0);
  const window = variableWindow(rows, viewport.top, viewport.height);
  const idsKey = JSON.stringify(window.ids);
  useLayoutEffect(() => { onVisible(JSON.parse(idsKey)); }, [idsKey, onVisible]);
  const measureNow = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const next = { top: element.scrollTop, height: element.clientHeight, width: element.clientWidth };
    setViewport(previous => previous.height === next.height && previous.width === next.width
      && sameVariableWindow(variableWindow(latestRows.current, previous.top, previous.height), variableWindow(latestRows.current, next.top, next.height)) ? previous : next);
  }, [root]);
  const measure = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measureNow(); });
  }, [measureNow]);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    measureNow(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [measure, measureNow, root]);
  const order = JSON.stringify(groups.map(group => [group.name, group.columns.map(column => column.id)]));
  useLayoutEffect(() => { if (root.current) { anchor.current = null; root.current.scrollTop = 0; measureNow(); } }, [order, expanded]);
  useLayoutEffect(() => {
    if (root.current && anchor.current) {
      const top = anchoredVariableScrollTop(rows, anchor.current);
      if (top !== null) root.current.scrollTop = top;
      anchor.current = null;
    }
    measureNow();
  }, [rows, measureNow, root]);
  useLayoutEffect(() => {
    if (!highlighted || !root.current) return;
    const row = rows.find(row => row.columns.some(column => column.id === highlighted));
    if (row) { root.current.scrollTop = Math.max(0, row.top - 40); measureNow(); }
  }, [highlighted, order]);
  const renderedKey = JSON.stringify(window.rendered.map(row => row.key));
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const node = entry.target as HTMLElement, key = node.dataset.virtualRow!;
        const height = node.getBoundingClientRect().height;
        if (height > 0 && Math.abs((heights.current.get(key) ?? 0) - height) > 1) { heights.current.set(key, height); changed = true; }
      }
      if (changed) {
        // Async charts above the viewport may change height. Keep the same row
        // and pixel offset on screen instead of moving the user's scroll position.
        anchor.current = variableScrollAnchor(latestRows.current, element.scrollTop);
        setMeasureVersion(version => version + 1);
      }
    });
    for (const node of element.querySelectorAll('[data-virtual-row]')) observer.observe(node);
    return () => observer.disconnect();
  }, [renderedKey, root]);
  return { ...window, lanes, measure };
}
