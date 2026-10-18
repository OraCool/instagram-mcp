import type { InstagramClient, Params } from "./client.js";
import type { Container, ContainerStatus } from "./types.js";

// Publishing is two-step: POST /<IG_ID>/media creates a container (Meta downloads the media from a public URL),
// then POST /<IG_ID>/media_publish once the container's status_code is FINISHED. Containers expire after 24h.
// Meta suggests polling about once a minute for up to 5 minutes; MCP tool calls should not block that long, so the
// wait is bounded and an unfinished container is returned for ig_publish_container to finish later.

export interface WaitOptions {
  waitSeconds: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type PublishResult =
  | { status: "published"; media_id: string; container_id: string; permalink?: string }
  | { status: "pending"; container_id: string; container_status?: ContainerStatus; hint: string };

const TERMINAL_FAILURES: ContainerStatus[] = ["ERROR", "EXPIRED"];

export async function createContainer(client: InstagramClient, igId: string, params: Params): Promise<string> {
  const { id } = await client.post<{ id: string }>(`/${igId}/media`, params);
  return id;
}

export async function getContainer(client: InstagramClient, containerId: string): Promise<Container> {
  return client.get<Container>(`/${containerId}`, { fields: "id,status_code,status" });
}

/** Polls until FINISHED (true) or the wait runs out (false); throws on ERROR/EXPIRED or an already-published container. */
export async function waitForContainer(
  client: InstagramClient,
  containerId: string,
  { waitSeconds, intervalMs = 5_000, sleep = defaultSleep }: WaitOptions,
): Promise<{ ready: boolean; status?: ContainerStatus }> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const container = await getContainer(client, containerId);
    const status = container.status_code;
    if (status === "FINISHED") return { ready: true, status };
    if (status === "PUBLISHED") throw new Error(`Container ${containerId} is already published`);
    if (status && TERMINAL_FAILURES.includes(status)) {
      throw new Error(`Container ${containerId} failed with ${status}${container.status ? `: ${container.status}` : ""}`);
    }
    if (Date.now() + intervalMs > deadline) return { ready: false, status };
    await sleep(intervalMs);
  }
}

export async function publishContainer(client: InstagramClient, igId: string, containerId: string): Promise<PublishResult> {
  const { id } = await client.post<{ id: string }>(`/${igId}/media_publish`, { creation_id: containerId });
  // The permalink is a convenience; a failed lookup must not hide that the post went live.
  const permalink = await client
    .get<{ permalink?: string }>(`/${id}`, { fields: "permalink" })
    .then((m) => m.permalink)
    .catch(() => undefined);
  return { status: "published", media_id: id, container_id: containerId, permalink };
}

export async function waitAndPublish(
  client: InstagramClient,
  igId: string,
  containerId: string,
  wait: WaitOptions,
): Promise<PublishResult> {
  const { ready, status } = await waitForContainer(client, containerId, wait);
  if (!ready) {
    return {
      status: "pending",
      container_id: containerId,
      container_status: status,
      hint: "Media is still processing. Call ig_publish_container with this container_id later (containers expire after 24h).",
    };
  }
  return publishContainer(client, igId, containerId);
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
