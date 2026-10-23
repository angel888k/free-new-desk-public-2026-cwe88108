import { spawn } from 'node:child_process';

export interface JavaRuntimeInfo { command: string; major: number; version: string; }

// 2026-08 CPU baseline: https://learn.microsoft.com/en-us/java/openjdk/release-notes
const JAVA_SECURITY_BASELINES: Readonly<Record<number, readonly number[]>> = {
  17: [17, 0, 20, 1],
  21: [21, 0, 12, 1],
  25: [25, 0, 4, 1]
};
const JAVA_UPDATE_HELP = '请更新到 Java 17.0.20.1、21.0.12.1 或 25.0.4.1 及同 LTS 系列后续补丁，并设置 FREE_NEW_DESK_JAVA';

export function parseJavaRuntimeVersion(output: string): Pick<JavaRuntimeInfo, 'major' | 'version'> {
  const version = /(?:java|openjdk) version "([^"]+)"/i.exec(output)?.[1];
  if (!version) throw new Error('[SRC_JAVA_NOT_FOUND] 无法识别 Java Runtime 版本');
  const numeric = /^(\d+(?:\.\d+){0,3})(?:\+\d+[\w.+-]*)?(?:-LTS)?$/.exec(version)?.[1];
  if (!numeric) throw new Error(`[SRC_JAVA_NOT_FOUND] Java ${version} 不是受支持的正式 LTS Runtime；${JAVA_UPDATE_HELP}`);
  const parts = numeric.split('.').map(Number);
  const major = parts[0]!;
  const baseline = JAVA_SECURITY_BASELINES[major];
  if (!baseline) throw new Error(`[SRC_JAVA_NOT_FOUND] Java ${version} 不在已核查的 LTS Runtime 范围；${JAVA_UPDATE_HELP}`);
  const comparison = baseline.map((minimum, index) => (parts[index] ?? 0) - minimum).find(value => value !== 0) ?? 0;
  if (comparison < 0) throw new Error(`[SRC_JAVA_NOT_FOUND] Java ${version} 低于本应用的安全基线；${JAVA_UPDATE_HELP}`);
  return { major, version };
}

export async function probeJavaRuntime(command = process.env.FREE_NEW_DESK_JAVA?.trim() || 'java', timeoutMs = 5_000): Promise<JavaRuntimeInfo> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    const child = spawn(command, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error: Error | null, value?: JavaRuntimeInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('[SRC_JAVA_NOT_FOUND] Java Runtime 版本检查超时'));
    }, timeoutMs);
    const consume = (chunk: string) => {
      output += chunk;
      if (output.length > 16 * 1024) {
        child.kill();
        finish(new Error('[SRC_JAVA_NOT_FOUND] Java Runtime 版本输出超出限制'));
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', () => finish(new Error(`[SRC_JAVA_NOT_FOUND] 未找到安全 Java Runtime；${JAVA_UPDATE_HELP}`)));
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error(`[SRC_JAVA_NOT_FOUND] Java Runtime 启动失败（exit ${code ?? 'unknown'}）`));
      try {
        finish(null, { command, ...parseJavaRuntimeVersion(output) });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
