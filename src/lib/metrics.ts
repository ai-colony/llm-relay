type Labels = Record<string, string>;

type ScalarEntry = { help: string; values: Map<string, { labels: Labels; value: number }> };
type HistogramEntry = {
  help: string;
  buckets: number[];
  values: Map<string, { labels: Labels; bucketCounts: number[]; sum: number; count: number }>;
};

const counters = new Map<string, ScalarEntry>();
const gauges = new Map<string, ScalarEntry>();
const histograms = new Map<string, HistogramEntry>();

const DEFAULT_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];

const serializeLabels = (labels: Labels): string => {
  const keys = Object.keys(labels).toSorted((a, b) => a.localeCompare(b));
  if (keys.length === 0) return '';
  return `{${keys.map((key) => `${key}="${labels[key]}"`).join(',')}}`;
};

export const incCounter = (name: string, help: string, labels: Labels = {}, value = 1): void => {
  const entry = counters.get(name) ?? { help, values: new Map() };
  const key = serializeLabels(labels);
  const current = entry.values.get(key)?.value ?? 0;
  entry.values.set(key, { labels, value: current + value });
  counters.set(name, entry);
};

export const setGauge = (name: string, help: string, value: number, labels: Labels = {}): void => {
  const entry = gauges.get(name) ?? { help, values: new Map() };
  entry.values.set(serializeLabels(labels), { labels, value });
  gauges.set(name, entry);
};

export const observeHistogram = (
  name: string,
  help: string,
  labels: Labels = {},
  valueSeconds: number,
  buckets: number[] = DEFAULT_DURATION_BUCKETS
): void => {
  const entry = histograms.get(name) ?? { help, buckets, values: new Map() };
  // The first observation fixes the bucket boundaries for this metric name; later calls must reuse
  // them, otherwise bucketCounts would be sized differently than renderMetrics() iterates them.
  const entryBuckets = entry.buckets;
  const key = serializeLabels(labels);
  const current = entry.values.get(key) ?? { labels, bucketCounts: entryBuckets.map(() => 0), sum: 0, count: 0 };

  for (const [index, bound] of entryBuckets.entries()) if (valueSeconds <= bound) current.bucketCounts[index] += 1;
  current.sum += valueSeconds;
  current.count += 1;

  entry.values.set(key, current);
  histograms.set(name, entry);
};

export type UpstreamMetricsSpec = {
  counter: { name: string; help: string };
  histogram: { name: string; help: string };
};

// Shared by the prompt worker and POST /chat/completions: both record a success/failure counter plus
// a duration histogram around a single upstream call.
export const recordUpstreamMetrics = (
  spec: UpstreamMetricsSpec,
  result: 'success' | 'failure',
  startedAtMs: number
): void => {
  incCounter(spec.counter.name, spec.counter.help, { result });
  observeHistogram(spec.histogram.name, spec.histogram.help, {}, (performance.now() - startedAtMs) / 1000);
};

export const renderMetrics = (): string => {
  const lines: string[] = [];

  for (const [type, registry] of [
    ['counter', counters],
    ['gauge', gauges]
  ] as const)
    for (const [name, entry] of registry) {
      lines.push(`# HELP ${name} ${entry.help}`, `# TYPE ${name} ${type}`);
      for (const { labels, value } of entry.values.values()) lines.push(`${name}${serializeLabels(labels)} ${value}`);
    }

  for (const [name, entry] of histograms) {
    lines.push(`# HELP ${name} ${entry.help}`, `# TYPE ${name} histogram`);
    for (const { labels, bucketCounts, sum, count } of entry.values.values()) {
      for (const [index, bound] of entry.buckets.entries())
        lines.push(`${name}_bucket${serializeLabels({ ...labels, le: String(bound) })} ${bucketCounts[index] ?? 0}`);
      lines.push(
        `${name}_bucket${serializeLabels({ ...labels, le: '+Inf' })} ${count}`,
        `${name}_sum${serializeLabels(labels)} ${sum}`,
        `${name}_count${serializeLabels(labels)} ${count}`
      );
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

export const resetMetrics = (): void => {
  counters.clear();
  gauges.clear();
  histograms.clear();
};
