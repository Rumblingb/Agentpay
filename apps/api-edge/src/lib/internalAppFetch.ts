import type { Env } from '../types';

export type InternalAppFetcher = (
  request: Request,
  env: Env,
  executionCtx: ExecutionContext | undefined,
) => Promise<Response>;

let internalAppFetcher: InternalAppFetcher | null = null;

export function setInternalAppFetcher(fetcher: InternalAppFetcher) {
  internalAppFetcher = fetcher;
}

export function getInternalAppFetcher(): InternalAppFetcher | null {
  return internalAppFetcher;
}
