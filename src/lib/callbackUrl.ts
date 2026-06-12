import { config } from './config';

export const isCallbackUrlAllowed = (url: string): boolean => {
  const { urlAllowlist } = config.callback;
  if (!urlAllowlist) return true;
  return urlAllowlist.test(url);
};
