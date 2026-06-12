import { config } from './config';

export const isCallbackUrlAllowed = (url: string): boolean => {
  const { urlAllowlist } = config.callback;
  if (!urlAllowlist) return true;
  return urlAllowlist.test(url);
};

export const checkCallbackAvailability = async (url: string): Promise<boolean> => {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
};
