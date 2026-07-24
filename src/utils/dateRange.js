import ApiError from './ApiError.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayBounds(offsetDays = 0) {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const start = new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + offsetDays)
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    gte: new Date(start.getTime() - IST_OFFSET_MS),
    lte: new Date(end.getTime() - IST_OFFSET_MS),
  };
}

export function startOfIstToday() {
  return istDayBounds(0).gte;
}

export function buildDateRangeFilter(dateFilter, startDate, endDate) {
  if (!dateFilter) return null;

  switch (dateFilter) {
    case 'today':
      return istDayBounds(0);
    case 'yesterday':
      return istDayBounds(-1);
    case 'week': {
      const nowIst = new Date(Date.now() + IST_OFFSET_MS);
      const dayOfWeek = nowIst.getUTCDay();
      return {
        gte: istDayBounds(-dayOfWeek).gte,
        lte: istDayBounds(0).lte,
      };
    }
    case 'month': {
      const nowIst = new Date(Date.now() + IST_OFFSET_MS);
      const startOfMonth = new Date(
        Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1)
      );
      return {
        gte: new Date(startOfMonth.getTime() - IST_OFFSET_MS),
        lte: istDayBounds(0).lte,
      };
    }
    case 'custom': {
      if (!startDate || !endDate) {
        throw new ApiError(400, 'Custom date filter requires both startDate and endDate');
      }
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new ApiError(400, 'Invalid startDate or endDate');
      }
      end.setUTCHours(23, 59, 59, 999);
      return { gte: start, lte: end };
    }
    default:
      throw new ApiError(400, 'Invalid dateFilter value');
  }
}
