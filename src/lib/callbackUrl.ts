import { config } from './config';

export const isCallbackUrlAllowed = (url: string): boolean => {
  const { urlAllowlist } = config.callback;
  if (!urlAllowlist) return true;
  return urlAllowlist.test(url);
};

// 405/501 mean the host is reachable but does not implement HEAD, which says nothing about whether
// the POST will succeed — treat those as available. Any other non-2xx is a genuine signal that the
// endpoint will not accept the callback either.
const HEAD_UNSUPPORTED_STATUSES = new Set([405, 501]);

export const checkCallbackAvailability = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return response.ok || HEAD_UNSUPPORTED_STATUSES.has(response.status);
  } catch {
    return false;
  }
};
