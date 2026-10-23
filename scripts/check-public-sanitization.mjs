import { readdir,readFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const skip=new Set(['.git','node_modules','dist','.packaging','build','coverage']);
const privateRepo=['cwe88108','free-new-desk'].join('/');
const publicRepo=privateRepo+'-public';
const forbidden=[privateRepo,'D:'+String.raw`\\workbuddy\\free-new-desk\\free-new-desk-V1.4.16-57f0f2e`,'C:'+String.raw`\\Users\\cwe88`,'cwe8810888'+'@gmail.com','chen'+'yz'];
const textExtensions=new Set(['.md','.mjs','.cjs','.js','.ts','.cts','.mts','.vue','.json','.yml','.yaml','.ps1','.cpp','.h','.hpp','.cmake','.txt']);
const violations=[];
// These byte-pinned, already-public upstream fixtures contain crypto parser markers
// and published demonstration keys, never deployment credentials; they are not packaged.
const upstreamCryptoFixtures=new Set(['18bab373dfa67a4956f25f273fafb3e5b6b9fdf7bafb21acf0f6264b474900f5','67f4f6b460db1ec7ef50585953ce826c5263ca91d72958490ef4702b4e154fe1']);

async function inspect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isDirectory()){if(!skip.has(entry.name))await inspect(path.join(directory,entry.name));continue;}
    const file=path.join(directory,entry.name);
    if(!textExtensions.has(path.extname(entry.name))&&!['LICENSE','README.md'].includes(entry.name))continue;
    const value=await readFile(file,'utf8');
    if(/(?:[A-Za-z]:[\\/](?:Users[\\/](?!Public[\\/])[^\\/\s"']+|workbuddy)[\\/])/i.test(value)&&!file.endsWith('check-public-sanitization.mjs'))violations.push(`${path.relative(root,file)} contains a local personal path`);
    for(const match of value.matchAll(/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g)){
      const publicCryptoExample=match[0].startsWith('-----')&&path.relative(root,file).replaceAll('\\','/').startsWith('tests/fixtures/drpy2/qist-3.9.52beta3/')&&upstreamCryptoFixtures.has(createHash('sha256').update(value).digest('hex'));
      if(!publicCryptoExample&&!/SYNTHETIC|CANARY|EXAMPLE|TEST/.test(match[0]))violations.push(`${path.relative(root,file)} contains a possible credential`);
    }
    for(const needle of forbidden){
      let offset=value.indexOf(needle);
      while(offset>=0){
        const publicReference=needle===privateRepo&&value.slice(offset,offset+publicRepo.length)===publicRepo;
        if(!publicReference)violations.push(`${path.relative(root,file)} contains a private reference`);
        offset=value.indexOf(needle,offset+needle.length);
      }
    }
  }
}

const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(manifest.private===true)violations.push('package.json still marks this package private');
if(manifest.build?.appId!=='org.free-new-desk.desktop')violations.push('package.json does not use the public application identifier');
await inspect(root);
if(violations.length)throw new Error(`Public sanitization failed:\n${violations.join('\n')}`);
console.log('Public sanitization passed.');
