import {fork,type ChildProcess} from 'node:child_process';
// Reviewed code still has the user's OS privileges. This whitelist prevents accidental credential inheritance; it is not a sandbox.
export function executableEnvironment(node=false):NodeJS.ProcessEnv{const env:NodeJS.ProcessEnv={};const allow=new Set(['systemroot','windir','comspec','path','pathext','temp','tmp','lang','lc_all','lc_ctype','tz']);for(const[key,value]of Object.entries(process.env))if(value!==undefined&&allow.has(key.toLowerCase()))env[key]=value;if(node)env.ELECTRON_RUN_AS_NODE='1';return env;}
export function launchTrustedWorker(entry:string,execArgv:string[]):ChildProcess{return fork(entry,[],{stdio:['ignore','ignore','ignore','ipc'],execArgv,env:executableEnvironment(true)});}
