// Field lists requested from graph.instagram.com and the shapes this server relies on. Responses are passed
// through as-is otherwise, so new fields Meta adds are not lost.

export const PROFILE_FIELDS =
  "id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website";

export const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_comment_enabled,shortcode";

export const CHILD_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp";

export const COMMENT_FIELDS = "id,text,timestamp,username,like_count,hidden,parent_id,from";

export interface Media {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  [key: string]: unknown;
}

export const CONTAINER_STATUSES = ["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export interface Container {
  id: string;
  status_code?: ContainerStatus;
  status?: string; // human-readable detail, e.g. the error reason
}

export interface InsightValue {
  name: string;
  period?: string;
  title?: string;
  values?: { value: unknown; end_time?: string }[];
  total_value?: { value?: unknown; breakdowns?: unknown[] };
}

// Media insight metrics for the Instagram Login path. `impressions`/`plays` were deprecated by Meta in favour of `views`.
export const DEFAULT_MEDIA_METRICS: Record<"FEED" | "REELS" | "STORY", string[]> = {
  FEED: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"],
  REELS: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
  STORY: ["views", "reach", "replies", "shares", "total_interactions", "navigation"],
};

export const DEFAULT_ACCOUNT_METRICS = ["views", "reach", "accounts_engaged", "total_interactions", "profile_links_taps"];
