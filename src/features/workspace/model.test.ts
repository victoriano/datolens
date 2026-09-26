import { test, expect } from 'bun:test';
import { registerTabs, workbookTabs, sourceKey, joinExample } from './model';

test('each worksheet has a distinct stable tab; reopening does not duplicate tabs', () => {
  const sheets=workbookTabs('/tmp/book.xlsx',['Customers','Orders']);
  const csv={key:sourceKey('/tmp/data.csv'),path:'/tmp/data.csv',name:'data'};
  const tabs=registerTabs([csv],sheets);
  expect(tabs).toHaveLength(3);
  expect(tabs[1].key).not.toBe(tabs[2].key);
  expect(registerTabs(tabs,sheets)).toEqual(tabs);
  expect(registerTabs(tabs,workbookTabs('/other/book.xlsx',['Customers']))).toHaveLength(4);
});

test('join example quotes real column IDs including punctuation', () => {
  const dataset:any={columns:[{id:'customer "id"'}]};
  const sql=joinExample([{alias:'t1',dataset},{alias:'t2',dataset}]);
  expect(sql).toContain('LEFT JOIN t2');
  expect(sql).toContain('a."customer ""id""" = b."customer ""id"""');
  expect(joinExample([{alias:'t3'}])).toContain('FROM t3');
});
