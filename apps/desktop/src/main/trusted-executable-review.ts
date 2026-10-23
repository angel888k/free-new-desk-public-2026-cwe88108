import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {ExecutableReview,ExecutableTrustStatus,SourceConfig} from '@free-new-desk/contracts';
import {executableConfigDigest,readExecutableApproval,requiresExecutableApproval,revokeExecutableApproval,writeExecutableApproval} from '@free-new-desk/source-engine/dist/executable-trust.js';

interface ReviewDependencies{
  storeDir:string;findSource:(sourceId:string)=>SourceConfig|undefined;
  prepare:(config:SourceConfig)=>Promise<ExecutableReview>;
  choosePath:(name:string)=>Promise<string|undefined>;
  confirm:(detail:string)=>Promise<boolean>;
  reset:(sourceId:string)=>Promise<void>;
}
interface PendingReview{digest:string;configDigest:string;path:string;}
export class TrustedExecutableReview{
  readonly #pending=new Map<string,PendingReview>();readonly #busy=new Set<string>();
  constructor(private readonly deps:ReviewDependencies){}
  #source(id:string):SourceConfig{const config=this.deps.findSource(id);if(!config)throw new Error('来源不存在或已删除');if(!requiresExecutableApproval(config))throw new Error('此来源使用内置声明式接口，不需要外部代码授权');return config;}
  async #run<T>(id:string,action:()=>Promise<T>):Promise<T>{if(this.#busy.has(id))throw new Error('此来源的审核操作正在进行');this.#busy.add(id);try{return await action();}finally{this.#busy.delete(id);}}
  async statuses(sources:SourceConfig[]):Promise<ExecutableTrustStatus[]>{return Promise.all(sources.map(async config=>{const required=requiresExecutableApproval(config),approval=required?await readExecutableApproval(this.deps.storeDir,config.id):undefined,pending=this.#pending.get(config.id);const valid=approval?.configDigest===executableConfigDigest(config);return{sourceId:config.id,required,approved:required&&valid,...(valid&&approval?{approvedAt:approval.approvedAt,digest:approval.digest}:{}),reviewReady:pending?.configDigest===executableConfigDigest(config)};}));}
  async review(id:string):Promise<{canceled:boolean;path?:string;digest?:string}>{return this.#run(id,async()=>{
    this.#pending.delete(id);const source=this.#source(id),review=await this.deps.prepare(source),chosen=await this.deps.choosePath(source.name);if(!chosen)return{canceled:true};
    const artifactDir=`${chosen}.artifacts`;await mkdir(artifactDir,{recursive:true});const rows:string[]=[];
    for(const[index,artifact]of review.artifacts.entries()){const basename=artifact.relativePath?path.basename(artifact.relativePath):path.basename(artifact.location.split('?')[0]??'code.js'),filename=`${index+1}-${basename.replace(/[^a-z0-9_.-]/gi,'_')||'code.js'}`,target=path.join(artifactDir,filename);await writeFile(target,Buffer.from(artifact.content,artifact.encoding));rows.push(`| ${artifact.role} | ${JSON.stringify(artifact.location).replaceAll('|','\\|')} | ${artifact.size} | ${artifact.sha256} | ${filename} |`);}
    const text=`# 可执行来源代码审核包\n\n来源：${JSON.stringify(source.name)}\n\n来源 ID：${JSON.stringify(source.id)}\n\n版本：${review.revision}\n\n配置摘要：${review.configDigest}\n\n完整包 SHA-256：${review.digest}\n\n生成时间：${review.preparedAt}\n\n## 审核方式\n\n本文件只是待审核材料，不代表代码安全或已经授权。实际脚本、规则、依赖及 JAR 字节保存在同名 .artifacts 文件夹。逐项阅读脚本；JAR 需检查或反编译其类文件。审批会允许这些代码以当前 Windows 用户权限运行，Node VM 不是安全沙箱。检查文件、进程、网络访问，以及由远程响应生成/执行代码的行为。只批准你已审核并明确信任的版本。代码或执行配置更新后需要重新审核。\n\n| 角色 | 位置 | 字节数 | SHA-256 | 审核文件 |\n| --- | --- | ---: | --- | --- |\n${rows.join('\n')}\n`;
    await writeFile(chosen,text,'utf8');if(executableConfigDigest(this.#source(id))!==review.configDigest)throw new Error('审核期间配置已变化，请重新导出审核包');this.#pending.set(id,{digest:review.digest,configDigest:review.configDigest,path:chosen});return{canceled:false,path:chosen,digest:review.digest};
  });}
  async approve(id:string):Promise<{approved:boolean;digest?:string}>{return this.#run(id,async()=>{
    const pending=this.#pending.get(id);if(!pending)throw new Error('请先导出当前版本代码，完成审核后再批准');const current=await this.deps.prepare(this.#source(id));
    if(current.digest!==pending.digest||current.configDigest!==pending.configDigest){this.#pending.delete(id);await this.invalidate(id);throw new Error('代码或配置已变化，旧审核包失效。请重新导出并审核');}
    const detail=`来源：${current.name}\n审核包：${pending.path}\nSHA-256：${current.digest}\n\n批准后，外部代码可以读取/修改当前用户文件、启动进程并访问网络。VM 不是安全沙箱。请确认已审核上述包内全部代码及远程执行行为，并信任其作者。`;
    if(!await this.deps.confirm(detail))return{approved:false};
    // Re-read after the native dialog. A renderer cannot submit an approval digest or bypass this comparison.
    const final=await this.deps.prepare(this.#source(id));if(final.digest!==current.digest||final.configDigest!==current.configDigest){this.#pending.delete(id);await this.invalidate(id);throw new Error('确认期间代码或配置已变化，请重新审核');}
    await writeExecutableApproval(this.deps.storeDir,final);this.#pending.delete(id);await this.deps.reset(id);return{approved:true,digest:final.digest};
  });}
  async invalidate(id:string):Promise<void>{this.#pending.delete(id);await revokeExecutableApproval(this.deps.storeDir,id);await this.deps.reset(id);}
  async revoke(id:string):Promise<void>{return this.#run(id,()=>this.invalidate(id));}
}
