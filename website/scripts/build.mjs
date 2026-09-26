import {mkdir,rm,cp,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {content} from '../src/content.mjs';
import {render} from '../src/template.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'dist');
const release=JSON.parse(await readFile(resolve(root,'release.json'),'utf8'));
await rm(out,{recursive:true,force:true});
await mkdir(resolve(out,'assets'),{recursive:true});
await cp(resolve(root,'public'),out,{recursive:true});
await cp(resolve(root,'src/style.css'),resolve(out,'assets/style.css'));
const js=await Bun.build({entrypoints:[resolve(root,'src/main.js')],outdir:resolve(out,'assets'),minify:true,target:'browser'});
if(!js.success)throw new Error(js.logs.join('\n'));
for(const c of Object.values(content)){
  const base=c.lang==='en'?'en':'';
  await mkdir(resolve(out,base),{recursive:true});
  for(const page of ['home','download','privacy','support']){
    await writeFile(resolve(out,base,page==='home'?'index.html':`${page}.html`),render(c,page,release));
  }
}
const urls=['/','/en','/download','/en/download','/privacy','/en/privacy','/support','/en/support'];
await writeFile(resolve(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(p=>`<url><loc>https://datolens.victoriano.me${p}</loc></url>`).join('')}</urlset>`);
await writeFile(resolve(out,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: https://datolens.victoriano.me/sitemap.xml\n');
await writeFile(resolve(out,'404.html'),'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>404 — Datolens</title><style>body{font:18px system-ui;background:#fafaf7;max-width:600px;margin:15vh auto;padding:24px}h1{font-size:48px}a{color:#2862ef}</style><h1>Por aquí no era.<br>Nothing here yet.</h1><p><a href="/">Volver a Datolens / Back to Datolens →</a></p></html>');
console.log(`Built ${urls.length} pages, local fonts, JS and CSS → ${out}`);
