export async function execFileNoThrow(
  _cmd: string,
  _args?: string[],
  _opts?: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number; code: number }> {
  return { stdout: '', stderr: '', exitCode: 0, code: 0 };
}
