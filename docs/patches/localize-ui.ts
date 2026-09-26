/** One-off localization handoff. Only --apply writes a feature owned by this task. */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { english } from '../../src/ui/messages';

const apply = process.argv.includes('--apply');
for (const file of process.argv.slice(2).filter(arg => !arg.startsWith('--'))) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: Array<{start:number;end:number;text:string}> = [];
  const missing = new Set<string>();
  const uiAttrs = new Set(['title', 'aria-label', 'placeholder', 'label']);
  const insideUi = (node: ts.Node): boolean => {
    let current = node.parent;
    while (current) {
      if (ts.isJsxAttribute(current)) return uiAttrs.has(current.name.getText(ast));
      if (ts.isJsxExpression(current) && !ts.isJsxAttribute(current.parent)) return true;
      if (ts.isFunctionDeclaration(current) || ts.isArrowFunction(current)) return false;
      current = current.parent;
    }
    return false;
  };
  const add = (node:ts.Node,text:string) => edits.push({start:node.getStart(ast),end:node.end,text});
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 't') return;
    if (ts.isJsxText(node)) {
      const text = node.text.split(/\r?\n/).map((line,index,lines) => {
        let value = line.replace(/\t/g, ' ');
        if (index > 0) value = value.trimStart();
        if (index < lines.length - 1) value = value.trimEnd();
        return value;
      }).filter(Boolean).join(' ');
      if (english[text.trim()] !== undefined) edits.push({start:node.pos,end:node.end,text:`{t(${JSON.stringify(text)})}`});
      else if (/[A-Za-zÁÉÍÓÚáéíóúñ]/.test(text) && !['datolens','LOCAL','null','CSV · XLSX · Parquet'].includes(text.trim())) missing.add(text.trim());
      return;
    }
    if (ts.isStringLiteral(node) && insideUi(node) && english[node.text.trim()] !== undefined) {
      const call = `t(${node.getText(ast)})`;
      add(node,ts.isJsxAttribute(node.parent)?`{${call}}`:call);
      return;
    }
    if (ts.isTemplateExpression(node) && insideUi(node)) {
      let key = node.head.text;
      const params = node.templateSpans.map((span,index) => {
        key += `{value${index}}${span.literal.text}`;
        const value = span.expression.getText(ast);
        return `value${index}: ${/^kindLabel\[/.test(value)?`t(${value})`:value}`;
      });
      if (english[key.trim()] !== undefined) { add(node,`t(${JSON.stringify(key)}, { ${params.join(', ')} })`); return; }
      if (/[ÁÉÍÓÚáéíóúñ ]/.test(key)) missing.add(key);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  let output=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start)) output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  // Subscribers rerender only presentation; identifiers/queries and component keys stay unchanged.
  if(edits.length && !source.includes('useI18n')) {
    output = `import { useI18n } from '../../ui';\n` + output;
    const functions = [...output.matchAll(/(?:export )?function (\w+)\([^\n]*\) \{/g)];
    for(const match of functions.reverse()) {
      if(['ExplorerApp','DataTable','Variables','CategoryBars','RangeInputs','Histogram','EnrichmentPanel','EnrichmentComposer','EvidenceDetails','AnalysisDialog','VariableTypeControl','VariableRoleControl','VariableStatisticsView'].includes(match[1])) {
        const at = match.index! + match[0].length;
        output=output.slice(0,at)+"\n  const { t, locale } = useI18n();"+output.slice(at);
      }
    }
  }
  const destination=apply?file:`/tmp/datolens-ui-${file.split('/').pop()}`;
  writeFileSync(destination,output);
  console.log(JSON.stringify({file,destination,changes:edits.length,missing:[...missing]},null,2));
}
