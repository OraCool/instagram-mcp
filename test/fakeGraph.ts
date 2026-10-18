// In-memory stand-in for graph.instagram.com: routes "<METHOD> <path>" to handlers and records every request.
// All ids, usernames and texts are invented.

export interface RecordedRequest {
  method: string;
  path: string; // without host and API version
  params: Record<string, string>;
  body: any;
  authorization?: string;
}

export type Handler = (req: RecordedRequest) => unknown | Response;

export function fakeGraph(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const req: RecordedRequest = {
      method: init.method ?? "GET",
      path: url.pathname.replace(/^\/v\d+\.\d+/, ""),
      params: Object.fromEntries(url.searchParams),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      authorization: (init.headers as Record<string, string> | undefined)?.Authorization,
    };
    requests.push(req);
    const handler = routes[`${req.method} ${req.path}`];
    if (!handler) {
      return new Response(JSON.stringify({ error: { message: `No route ${req.method} ${req.path}`, code: 100 } }), { status: 400 });
    }
    const result = handler(req);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

export const ME = { id: "17841400000000001", user_id: "17841400000000001", username: "demo.studio", account_type: "BUSINESS" };
