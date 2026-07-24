import { Prisma } from '@prisma/client';
import ApiError from '../utils/ApiError.js';

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || [];

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
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Validation failed';
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

export const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export default errorHandler;
