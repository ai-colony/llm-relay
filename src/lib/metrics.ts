type Labels = Record<string, string>;

type CounterEntry = { help: string; values: Map<string, { labels: Labels; value: number }> };
type HistogramEntry = {
  help: string;
  buckets: number[];
  values: Map<string, { labels: Labels; bucketCounts: number[]; sum: number; count: number }>;
};

const counters = new Map<string, CounterEntry>();
const histograms = new Map<string, HistogramEntry>();

export const DEFAULT_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];

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

export const observeHistogram = (
  name: string,
  help: string,
  labels: Labels = {},
  valueSeconds: number,
  buckets: number[] = DEFAULT_DURATION_BUCKETS
): void => {
  const entry = histograms.get(name) ?? { help, buckets, values: new Map() };
  const key = serializeLabels(labels);
  const current = entry.values.get(key) ?? { labels, bucketCounts: buckets.map(() => 0), sum: 0, count: 0 };

  for (const [index, bound] of buckets.entries()) if (valueSeconds <= bound) current.bucketCounts[index] += 1;
  current.sum += valueSeconds;
  current.count += 1;

  entry.values.set(key, current);
  histograms.set(name, entry);
};

export const renderMetrics = (): string => {
  const lines: string[] = [];

  for (const [name, entry] of counters) {
    lines.push(`# HELP ${name} ${entry.help}`, `# TYPE ${name} counter`);
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
  histograms.clear();
};
