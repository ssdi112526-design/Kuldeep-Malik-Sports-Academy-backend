import { Prisma } from '@prisma/client';
import ApiError from '../utils/ApiError.js';

function friendlyPrismaMessage(err) {
  const raw = String(err?.message || '');
  if (/numeric field overflow|code:\s*"22003"|22P03|incorrect binary data format/i.test(raw)) {
    return 'One numeric value is invalid or too large. Please check amount or cost fields.';
  }
  if (/Unable to fit integer|INT4|2147483647/i.test(raw)) {
    return 'A number is too large for this field. Please enter a smaller value.';
  }
  if (/foreign key|RESTRICT|violates.*constraint/i.test(raw)) {
    return 'This record is linked to other data and cannot be deleted or changed that way.';
  }
  if (/value too long|varchar/i.test(raw)) {
    return 'One of the text fields is too long. Please shorten it and try again.';
  }
  if (/Invalid `prisma\.|PrismaClient|ConnectorError|PostgresError/i.test(raw)) {
    return 'Could not save. Please check your input and try again.';
  }
  return null;
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || [];

  // Always keep technical detail in logs (production included)
  if (!(err instanceof ApiError) || statusCode >= 500 || /prisma|postgres|connector/i.test(String(err.message || ''))) {
    console.error('[API Error]', {
      path: req.originalUrl,
      method: req.method,
      statusCode,
      message: err.message,
      code: err.code,
      meta: err.meta,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      statusCode = 400;
      const field = err.meta?.target?.[0] || 'field';
      message = `${field} already exists`;
    } else if (err.code === 'P2025') {
      statusCode = 404;
      message = 'Record not found';
    } else if (err.code === 'P2023') {
      statusCode = 400;
      message = 'Invalid ID format';
    } else {
      statusCode = 400;
      message = friendlyPrismaMessage(err) || 'Could not complete this request. Please check your input.';
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Validation failed. Please check required fields and try again.';
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError || err?.name === 'PrismaClientUnknownRequestError') {
    statusCode = 400;
    message = friendlyPrismaMessage(err) || 'Could not save. Please check your input and try again.';
  }

  const sanitized = friendlyPrismaMessage(err);
  if (sanitized && /Invalid `prisma\.|PrismaClient|ConnectorError|PostgresError|invocation:/i.test(message)) {
    statusCode = statusCode === 500 ? 400 : statusCode;
    message = sanitized;
  }

  if (/Transaction already closed|expired transaction|transaction.*timeout/i.test(String(err.message || ''))) {
    statusCode = 503;
    message = 'Server is busy. Please scan the new QR code again.';
    err.code = err.code || 'TRANSACTION_TIMEOUT';
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(err.code ? { code: err.code } : {}),
    errors,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

export const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export default errorHandler;
