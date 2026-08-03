import {
  HUB_AGGREGATION_WINDOW_MS,
  type HubAggregationWindow,
  type HubContextItem,
} from '@jericho/shared';

export interface HubAggregationSources {
  listTranscripts(since: string, until: string): Promise<HubContextItem[]>;
  listRepos(since: string, until: string): Promise<HubContextItem[]>;
  listPullRequests(since: string, until: string): Promise<HubContextItem[]>;
  listLinear(since: string, until: string): Promise<HubContextItem[]>;
  listOpportunities(since: string, until: string): Promise<HubContextItem[]>;
  listTasks(since: string, until: string): Promise<HubContextItem[]>;
  listHeartbeats(since: string, until: string): Promise<HubContextItem[]>;
}

/**
 * Read-only 72-hour context aggregator. Degrades missing providers instead of
 * inventing data. Opportunities are ranked by signal descending.
 */
export async function aggregateHubWindow(
  sources: HubAggregationSources,
  until: string,
): Promise<HubAggregationWindow> {
  const untilMs = Date.parse(until);
  if (!Number.isFinite(untilMs)) {
    throw new TypeError('aggregateHubWindow until must be a valid timestamp');
  }
  const since = new Date(untilMs - HUB_AGGREGATION_WINDOW_MS).toISOString();
  const degradedProviders: string[] = [];

  async function load(
    name: string,
    loader: () => Promise<HubContextItem[]>,
  ): Promise<HubContextItem[]> {
    try {
      return await loader();
    } catch {
      degradedProviders.push(name);
      return [];
    }
  }

  const [transcripts, repos, prs, linear, opportunities, tasks, heartbeats] = await Promise.all([
    load('transcripts', () => sources.listTranscripts(since, until)),
    load('repos', () => sources.listRepos(since, until)),
    load('prs', () => sources.listPullRequests(since, until)),
    load('linear', () => sources.listLinear(since, until)),
    load('opportunities', () => sources.listOpportunities(since, until)),
    load('tasks', () => sources.listTasks(since, until)),
    load('heartbeats', () => sources.listHeartbeats(since, until)),
  ]);

  const rankedOpportunities = [...opportunities].sort(
    (a, b) => (b.signal ?? 0) - (a.signal ?? 0),
  );

  const items = [
    ...filterWindow(transcripts, since, until, 'transcript'),
    ...filterWindow(repos, since, until, 'repo'),
    ...filterWindow(prs, since, until, 'pr'),
    ...filterWindow(linear, since, until, 'linear'),
    ...filterWindow(rankedOpportunities, since, until, 'opportunity'),
    ...filterWindow(tasks, since, until, 'task'),
    ...filterWindow(heartbeats, since, until, 'heartbeat'),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const counts: HubAggregationWindow['counts'] = {
    transcript: 0,
    repo: 0,
    pr: 0,
    linear: 0,
    opportunity: 0,
    task: 0,
    heartbeat: 0,
  };
  for (const item of items) counts[item.category] += 1;

  return {
    windowMs: HUB_AGGREGATION_WINDOW_MS,
    since,
    until,
    items,
    counts,
    degradedProviders,
  };
}

function filterWindow(
  items: readonly HubContextItem[],
  since: string,
  until: string,
  category: HubContextItem['category'],
): HubContextItem[] {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  return items
    .filter((item) => item.category === category)
    .filter((item) => {
      const at = Date.parse(item.occurredAt);
      return Number.isFinite(at) && at >= sinceMs && at <= untilMs;
    })
    .map((item) => ({ ...item }));
}

export function emptyAggregationSources(
  seed: readonly HubContextItem[] = [],
): HubAggregationSources {
  const byCategory = (category: HubContextItem['category']) =>
    async (since: string, until: string) =>
      seed.filter((item) => {
        if (item.category !== category) return false;
        const at = Date.parse(item.occurredAt);
        return at >= Date.parse(since) && at <= Date.parse(until);
      });

  return {
    listTranscripts: byCategory('transcript'),
    listRepos: byCategory('repo'),
    listPullRequests: byCategory('pr'),
    listLinear: byCategory('linear'),
    listOpportunities: byCategory('opportunity'),
    listTasks: byCategory('task'),
    listHeartbeats: byCategory('heartbeat'),
  };
}
