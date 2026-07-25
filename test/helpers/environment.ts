// Applies env vars, runs the callback, then restores the previous values (including unsetting vars
// that were not present before). A value of undefined unsets the variable for the duration of the
// callback. Pair with vi.resetModules() so src/lib/config.ts re-reads the values.
export const withEnvironment = async <T>(
  variables: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const saved = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };

  apply(variables);
  try {
    return await run();
  } finally {
    apply(saved);
  }
};
