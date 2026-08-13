import asyncHandler from '../utils/asyncHandler.js';
import {
  getMediaRestoreStatus,
  restoreMissingMedia,
} from '../utils/mediaBlobStore.js';

export const mediaStatus = asyncHandler(async (_req, res) => {
  const data = await getMediaRestoreStatus();
  res.json({ success: true, data });
});

export const mediaRestore = asyncHandler(async (req, res) => {
  const mode = String(req.body?.mode || req.query?.mode || 'referenced').toLowerCase();
  const onlyReferenced = mode !== 'all';

  console.log(`[media-blob] admin restore requested (mode=${onlyReferenced ? 'referenced' : 'all'}) by user=${req.user?.id || 'unknown'}`);
  const data = await restoreMissingMedia({ onlyReferenced });

  res.json({
    success: true,
    message: `Media restore finished — restored ${data.restored}, available ${data.alreadyAvailable}, failed ${data.failed}`,
    data: {
      totalChecked: data.checked,
      alreadyAvailable: data.alreadyAvailable,
      restored: data.restored,
      failed: data.failed,
      mode: onlyReferenced ? 'referenced' : 'all',
    },
  });
});
