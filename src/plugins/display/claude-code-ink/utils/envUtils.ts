export function isEnvTruthy(v: unknown): boolean {
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return !!v;
}
