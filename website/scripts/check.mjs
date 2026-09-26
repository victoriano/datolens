import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dir,'..');
const dist=resolve(root,'dist');
let checks=0;
function check(value,message){if(!value)throw new Error(message);checks++;}
const paths=['index.html','en/index.html','download.html','en/download.html','privacy.html','en/privacy.html','support.html','en/support.html'];
for(const path of paths){
  const html=await readFile(resolve(dist,path),'utf8');
  check((html.match(/<h1[ >]/g)||[]).length===1,`${path}: exactly one H1`);
  check(html.includes('<link rel="canonical"'),`${path}: canonical`);
  check(html.includes('hreflang="en"')&&html.includes('hreflang="es"'),`${path}: hreflang`);
  check(!/TODO|PLACEHOLDER|href="#"/.test(html),`${path}: placeholder link`);
  check(html.includes('<html lang="'+(path.startsWith('en/')?'en':'es')+'"'),`${path}: language`);
  for(const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)){
    const url=match[1];let found=false;
    for(const candidate of [url,url+'.html',url.replace(/\/$/,'')+'/index.html']){
      try{if((await stat(resolve(dist,'.'+candidate))).isFile()){found=true;break;}}catch{}
    }
    check(found,`${path}: missing local link ${url}`);
  }
}
const release=JSON.parse(await readFile(resolve(root,'release.json'),'utf8'));
const download=await readFile(resolve(dist,'.'+release.url));
check(download.length===release.bytes,'Download byte length');
check(createHash('sha256').update(download).digest('hex')===release.sha256,'Download checksum');
check((await readFile(resolve(dist,'downloads/SHA256SUMS.txt'),'utf8')).includes(release.sha256),'Public checksum');
check(release.notarized===true&&release.format==='ZIP'&&release.appStoreUrl===null,'Notarized direct beta; store not released');
const og=await readFile(resolve(dist,'og.jpg'));
check(og[0]===0xff&&og[1]===0xd8,'Open Graph image is JPEG');
let ogWidth=0,ogHeight=0;
for(let offset=2;offset<og.length;){
  if(og[offset]!==0xff)break;
  const marker=og[offset+1],length=og.readUInt16BE(offset+2);
  if([0xc0,0xc1,0xc2].includes(marker)){ogHeight=og.readUInt16BE(offset+5);ogWidth=og.readUInt16BE(offset+7);break;}
  offset+=2+length;
}
check(ogWidth===1200&&ogHeight===630,'Open Graph image size');
const files=await readdir(dist);
check(!files.includes('.env')&&!files.includes('src-tauri'),'No native source or secrets in public build');
console.log(`${checks} checks passed: 8 pages, local links, language, metadata, download bytes and SHA-256, social image.`);
