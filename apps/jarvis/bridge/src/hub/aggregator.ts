import {
  HUB_AGGREGATION_WINDOW_MS,
  type HubAggregateItem,
  type HubAggregationWindow,
} from '@jericho/shared';

export interface HubAggregationSources {
  listTranscripts(since: string, until: string): Promise<HubAggregateItem[]>;
  listRepos(since: string, until: string): Promise<HubAggregateItem[]>;
  listPullRequests(since: string, until: string): Promise<HubAggregateItem[]>;
  listLinear(since: string, until: string): Promise<HubAggregateItem[]>;
  listOpportunities(since: string, until: string): Promise<HubAggregateItem[]>;
  listTasks(since: string, until: string): Promise<HubAggregateItem[]>;
}

/**
 * Aggregate the last 72 hours of transcript, repo, PR, Linear, opportunity,
 * and task signals through injected fake services only.
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

  const [transcripts, repos, prs, linear, opportunities, tasks] = await Promise.all([
    sources.listTranscripts(since, until),
    sources.listRepos(since, until),
    sources.listPullRequests(since, until),
    sources.listLinear(since, until),
    sources.listOpportunities(since, until),
    sources.listTasks(since, until),
  ]);

  const items = [
    ...filterWindow(transcripts, since, until, 'transcript'),
    ...filterWindow(repos, since, until, 'repo'),
    ...filterWindow(prs, since, until, 'pr'),
    ...filterWindow(linear, since, until, 'linear'),
    ...filterWindow(opportunities, since, until, 'opportunity'),
    ...filterWindow(tasks, since, until, 'task'),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const counts: HubAggregationWindow['counts'] = {
    transcript: 0,
    repo: 0,
    pr: 0,
    linear: 0,
    opportunity: 0,
    task: 0,
  };
  for (const item of items) counts[item.category] += 1;

  return {
    windowMs: HUB_AGGREGATION_WINDOW_MS,
    since,
    until,
    items,
    counts,
  };
}

function filterWindow(
  items: readonly HubAggregateItem[],
  since: string,
  until: string,
  category: HubAggregateItem['category'],
): HubAggregateItem[] {
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

/** Empty in-memory aggregator for tests that only need structure. */
export function emptyAggregationSources(
  seed: readonly HubAggregateItem[] = [],
): HubAggregationSources {
  const byCategory = (category: HubAggregateItem['category']) =>
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
  };
}
