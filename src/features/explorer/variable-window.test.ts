import { expect, test } from 'bun:test';
import { anchoredVariableScrollTop, sameVariableWindow, variableRows, variableScrollAnchor, variableWindow } from './variable-window';
import type { Column } from '../../contracts/desktop-api';
const columns:Column[]=Array.from({length:4911},(_,i)=>({id:`c${i}`,name:`Column ${i}`,dataType:'DOUBLE',kind:'numeric'}));
test('4911 variables only mount and request the viewport with bounded neighbours',()=>{
  const rows=variableRows([{name:'all',columns}],false,[],1,new Map());
  const first=variableWindow(rows,0,700);
  expect(first.ids).toEqual(['c0','c1','c2','c3']);
  expect(first.rendered.length).toBe(4);
  const middle=variableWindow(rows,1000*240,700);
  expect(middle.ids.slice(0,3)).toEqual(['c1000','c1001','c1002']);
  expect(middle.ids.length).toBeLessThan(7);
  expect(middle.before).toBe(999*240);
  expect(variableWindow(rows,9999999,700).ids).toContain('c4910');
});
test('pixel scrolling within the same card window needs no React update', () => {
  const rows = variableRows([{ name: 'all', columns }], false, [], 1, new Map());
  expect(sameVariableWindow(variableWindow(rows, 20, 650), variableWindow(rows, 25, 650))).toBe(true);
  expect(sameVariableWindow(variableWindow(rows, 20, 650), variableWindow(rows, 260, 650))).toBe(false);
});
test('loading an overscan chart above the viewport preserves the visible row and pixel offset', () => {
  const groups = [{ name: 'all', columns: columns.slice(0, 8) }];
  const rows = variableRows(groups, false, [], 1, new Map());
  const anchor = variableScrollAnchor(rows, 500);
  expect(anchor).toEqual({ key: JSON.stringify(['c2']), offset: 20 });
  const loaded = variableRows(groups, false, [], 1, new Map([[JSON.stringify(['c1']), 480]]));
  const top = anchoredVariableScrollTop(loaded, anchor)!;
  expect(top).toBe(740);
  expect(variableScrollAnchor(loaded, top)).toEqual(anchor);
  // Shrinking a preceding card also keeps the same content in place.
  const smaller = variableRows(groups, false, [], 1, new Map([[JSON.stringify(['c1']), 130]]));
  expect(variableScrollAnchor(smaller, anchoredVariableScrollTop(smaller, anchor)!)).toEqual(anchor);
  expect(anchoredVariableScrollTop([], anchor)).toBeNull();
});
test('grid, measured heights, collapsed groups and searched results retain the right variables',()=>{
  const groups=[{name:'pinned',columns:columns.slice(0,2)},{name:'other',columns:columns.slice(2,12)}];
  const rows=variableRows(groups,true,['pinned'],3,new Map());
  expect(rows[0].header).toBe(true);expect(rows[1].group.name).toBe('other');
  expect(rows.flatMap(r=>r.columns.map(c=>c.id))).not.toContain('c0');
  expect(variableWindow(rows,0,700).ids.slice(0,3)).toEqual(['c2','c3','c4']);
  const measured=variableRows([{name:'all',columns:columns.slice(0,2)}],false,[],1,new Map([[JSON.stringify(['c0']),500]]));
  expect(measured[1].top).toBe(500);
  expect(variableWindow(variableRows([{name:'search',columns:[columns[4000]]}],false,[],1,new Map()),0,700).ids).toEqual(['c4000']);
});
