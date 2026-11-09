import type { DefaultBrowserStatus } from '../../services/accounts/setup-types';

/**
 * The row's status after asking again (the window got focus: the person may have chosen Acira in Windows' Default apps meanwhile).
 * The answer to a plain status question never says "requested", so while the browser is still not the default the earlier "requested" is kept:
 * the row goes on telling the person to choose Acira there. Once it is the default, the row says so and the request is over.
 */
export function refreshedStatus(previous: DefaultBrowserStatus | undefined, next: DefaultBrowserStatus | undefined): DefaultBrowserStatus | undefined {
  if (!next) return previous;
  if (next.isDefault || !previous?.requested) return next;
  return { ...next, requested: true };
}
