// Text transforms must finish inside the caller's total request deadline.
export async function readTextBody(response:Response,signal:AbortSignal,maxBytes:number):Promise<string>{
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes){
    await response.body?.cancel();throw new Error(`Proxy text exceeds ${maxBytes} byte safety limit`);
  }
  if(signal.aborted){await response.body?.cancel();throw signal.reason;}
  if(!response.body)return'';
  const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,text='';
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>undefined);};
  signal.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      const part=await reader.read();
      if(signal.aborted)throw signal.reason;
      if(part.done)return text+decoder.decode();
      total+=part.value.byteLength;
      if(total>maxBytes)throw new Error(`Proxy text exceeds ${maxBytes} byte safety limit`);
      text+=decoder.decode(part.value,{stream:true});
    }
  }finally{
    signal.removeEventListener('abort',abort);
    await reader.cancel().catch(()=>undefined);
  }
}
