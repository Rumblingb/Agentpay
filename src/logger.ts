import { pino, type Logger as PinoLogger } from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

// Wrapper that accepts both pino-style (metadata, message) and legacy
// (message, metadata) call orders to avoid widespread edits across the codebase.
function wrapLogger(logger: PinoLogger): any {
  const handler: ProxyHandler<any> = {
    get(target, prop: string) {
      const orig = (target as any)[prop];
      if (typeof orig !== 'function') return orig;
      return (...args: any[]) => {
        // If caller used (message: string, meta: object), reorder to (meta, message)
        if (typeof args[0] === 'string' && args[1] && typeof args[1] === 'object') {
          return orig.call(target, args[1], args[0], ...args.slice(2));
        }
        return orig.apply(target, args);
      };
    },
  };

  return new Proxy(logger, handler);
}

export const logger: any = wrapLogger(baseLogger);
