export const makeLoggerMock = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

type StatusCounts = {
  queued: number;
  inProgress: number;
  completed: number;
  failed: number;
  callbackPending: number;
};

// Matches the shape of repo.getPromptStatusCounts(); every field defaults to 0.
export const makeStatusCounts = (overrides: Partial<StatusCounts> = {}): StatusCounts => ({
  queued: 0,
  inProgress: 0,
  completed: 0,
  failed: 0,
  callbackPending: 0,
  ...overrides
});

// Structural, so it accepts any of the route sub-apps regardless of their Hono type parameters.
type RequestableApp = { request: (path: string, init?: RequestInit) => Promise<Response> };

export const postJson = (app: RequestableApp, body: unknown) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

// Builds `/?a=1&b=2`; undefined values are omitted so callers can pass optional params inline.
export const withQuery = (parameters: Record<string, string | number | undefined>) => {
  const entries = Object.entries(parameters).filter(([, value]) => value !== undefined);
  return `/?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
};
