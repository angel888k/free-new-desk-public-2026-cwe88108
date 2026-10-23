import type {SourceContext} from '@free-new-desk/contracts';

export function authorizeSourceProxyResult(value:unknown,context:SourceContext|undefined):unknown{
  if(!value||typeof value!=='object'||!context?.proxyBaseUrl||!context.proxyToken)return value;
  const result=value as Record<string,unknown>;if(typeof result.url!=='string')return value;
  try{
    const base=new URL(context.proxyBaseUrl),target=new URL(result.url);
    if(target.origin!==base.origin||target.pathname!==`${base.pathname.replace(/\/$/,'')}/proxy`)return value;
    return{...result,headers:{...(result.headers&&typeof result.headers==='object'?result.headers as Record<string,unknown>:{}),Authorization:`Bearer ${context.proxyToken}`}};
  }catch{return value;}
}
