/** Export-only redaction. Never mutate application data or source credentials. */
const restrictedKey=/^(?:password|passphrase|passwd|secret|token|accessToken|refreshToken|apiKey|authorization|proxyAuthorization|cookie|setCookie|credentials|credentialRef|headers|path|filePath|root|uncPath|endpoint|url|epg)$/i;

/** Keep the diagnostic structure while removing private paths, signed URLs and credentials. */
export function redactDiagnosticText(value:string):string{
  return value
    .replace(/\b(?:https?|rtsps?|smb):\/\/[^\s"'<>]+/gi,'[REDACTED_URL]')
    .replace(/\\\\[^\s"'\\]+\\[^\s"']+/g,'[REDACTED_PATH]')
    .replace(/\b[A-Za-z]:\\[^\s"']+/g,'[REDACTED_PATH]')
    .replace(/\b(authorization|proxy-authorization|cookie|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]');
}
export function redactDiagnosticArtifact(value:unknown):unknown{
  const seen=new WeakSet<object>();
  const walk=(item:unknown):unknown=>{
    if(typeof item==='string')return redactDiagnosticText(item);
    if(!item||typeof item!=='object')return item;
    if(seen.has(item))return'[REDACTED_CYCLE]';
    seen.add(item);
    if(Array.isArray(item))return item.map(walk);
    return Object.fromEntries(Object.entries(item as Record<string,unknown>).map(([key,entry])=>[key,restrictedKey.test(key)?'[REDACTED]':walk(entry)]));
  };
  return walk(value);
}
