// Minimal ambient declaration to satisfy TypeScript in the dashboard build
// Avoids editing runtime code; this only provides a light typing shim.
declare module 'next/server' {
  // Very small subset used by our app route handlers.
  export type NextRequest = Request & {
    cookies: {
      get(name: string): { value: string } | undefined;
    };
    json(): Promise<any>;
  };

  export const NextResponse: {
    json(body: any, init?: { status?: number } & Record<string, any>): Response;
  };

  export default NextResponse;
}
