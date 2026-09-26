#!/usr/bin/env python3
"""Add only the Datolens DNS records. Existing records are never replaced."""
import argparse, json, subprocess, urllib.request, urllib.parse, pathlib, sys

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--type',choices=['CNAME','TXT'],required=True)
p.add_argument('--value',required=True)
a=p.parse_args()
name='datolens.victoriano.me' if a.type=='CNAME' else '_vercel.victoriano.me'
if a.type=='TXT' and not a.value.startswith('vc-domain-verify=datolens.victoriano.me,'):
    sys.exit('Refusing a verification record for a different domain.')
if a.type=='CNAME' and not (a.value.rstrip('.').endswith('.vercel-dns.com') or a.value.rstrip('.').endswith('.vercel-dns-017.com') or a.value.rstrip('.')=='cname.vercel-dns.com'):
    sys.exit('Unexpected Vercel CNAME target; review the current recommendation first.')
wrapper=pathlib.Path.home()/'Code/victorianoAI/.agents/skills/1password/scripts/op-service-account.sh'
item=json.loads(subprocess.check_output([str(wrapper),'item','get','7yrnvuk7x557mxvbq3j5okotba','--vault','bpkoprt5zybtvcopj62bdczrga','--format=json']))
token=next(f['value'] for f in item['fields'] if f['id']=='credential')
headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
def request(path,body=None):
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,headers=headers,data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req,timeout=30) as response:
        data=json.load(response)
    if not data.get('success'):sys.exit('Cloudflare API did not confirm success.')
    return data['result']
zone=request('/zones?name=victoriano.me')
if len(zone)!=1:sys.exit('Expected exactly one victoriano.me DNS zone.')
base='/zones/'+zone[0]['id']+'/dns_records'
records=request(base+'?name='+urllib.parse.quote(name))
same=[r for r in records if r['type']==a.type and r['content'].rstrip('.')==a.value.rstrip('.')]
if same:
    print(json.dumps({'state':'already_present','name':name,'type':a.type,'content':a.value}));sys.exit(0)
if a.type=='CNAME' and records:sys.exit('Existing Datolens DNS record differs; refusing to overwrite.')
record=request(base,{'type':a.type,'name':name,'content':a.value,'ttl':1,**({'proxied':False} if a.type=='CNAME' else {})})
verified=request(base+'?name='+urllib.parse.quote(name))
if not any(r['id']==record['id'] and r['content']==record['content'] for r in verified):sys.exit('DNS write could not be read back.')
print(json.dumps({'state':'created_and_verified','name':record['name'],'type':record['type'],'content':record['content'],'id':record['id']}))
