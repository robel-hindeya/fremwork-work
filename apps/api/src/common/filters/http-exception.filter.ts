import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';

@Catch()
export class FremworkExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = `req_${randomBytes(4).toString('hex')}`;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal';
    let message = 'An unexpected server error occurred.';
    let field: string | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const anyRes = res as any;
        message = anyRes.message || exception.message;
        code = anyRes.code || this.mapStatusToCode(status);
        field = anyRes.field;

        // If class-validator array
        if (Array.isArray(anyRes.message)) {
          message = anyRes.message.join('; ');
          code = 'validation_failed';
        }
      }
    } else {
      // Unexpected errors may carry internal details (SQL, hostnames, keys); log them, never return them.
      this.logger.error(`${request.method} ${request.path} ${requestId}: ${exception instanceof Error ? exception.stack || exception.message : String(exception)}`);
    }

    if (response.headersSent) {
      // A streamed response (SSE) already started; just close it.
      response.end();
      return;
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(field ? { field } : {}),
        request_id: requestId,
      },
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'unauthenticated';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
      case HttpStatus.BAD_REQUEST:
        return 'validation_failed';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limited';
      case HttpStatus.PAYMENT_REQUIRED:
        return 'usage_limit';
      case HttpStatus.NOT_IMPLEMENTED:
        return 'not_implemented';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'unavailable';
      default:
        return 'internal';
    }
  }
}
