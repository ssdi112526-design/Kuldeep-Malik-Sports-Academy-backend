class ApiError extends Error {
  constructor(statusCode, message, errorsOrCode = [], code) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    if (typeof errorsOrCode === 'string') {
      this.errors = [];
      this.code = errorsOrCode;
    } else {
      this.errors = errorsOrCode || [];
      this.code = code || null;
    }
  }
}

export default ApiError;
