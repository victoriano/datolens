import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../dist');
const server=Bun.serve({hostname:'127.0.0.1',port:4178,async fetch(request){
  let pathname;
  try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Bad request',{status:400});}
  const candidate=resolve(root,'.'+pathname);
  if(candidate!==root&&!candidate.startsWith(root+'/'))return new Response('Forbidden',{status:403});
  for(const path of [candidate,candidate+'.html',resolve(candidate,'index.html')]){
    const f=Bun.file(path);
    if(await f.exists()&&f.size)return new Response(f,{headers:{'Cache-Control':'no-store'}});
  }
  return new Response(Bun.file(resolve(root,'404.html')),{status:404});
}});
console.log(`Datolens website → ${server.url}`);
