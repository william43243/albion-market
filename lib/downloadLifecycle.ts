export type DownloadLifecycleAction = 'screen-unmount' | 'explicit-cancel';

/** A model download survives navigation; only the user's cancel action stops it. */
export function shouldCancelDownload(action: DownloadLifecycleAction): boolean {
  return action === 'explicit-cancel';
}
