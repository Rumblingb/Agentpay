/**
 * ESM-safe CLI entry detection.
 *
 * npm 0.2.0 used `require.main === module` inside a `"type": "module"`
 * package. That is always false, so `npx -y @agentpayxyz/mcp-server`
 * printed the missing-key warning and exited 0 without opening stdio.
 */

export function isExecutedAsCliEntry(metaUrl: string, argv1?: string): boolean {
  if (!metaUrl || !argv1) return false;
  const normalizedArgv = argv1.replace(/\\/g, '/');
  const normalizedMeta = metaUrl.replace(/\\/g, '/');
  const base = normalizedArgv.split('/').pop();
  if (!base) return false;
  return (
    normalizedMeta.endsWith(normalizedArgv)
    || normalizedMeta.endsWith(`/${base}`)
    || normalizedMeta.endsWith(encodeURI(normalizedArgv))
    || normalizedMeta.endsWith(`/${encodeURI(base)}`)
  );
}
