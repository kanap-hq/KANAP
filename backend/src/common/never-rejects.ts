import { Logger } from '@nestjs/common';
import { trackBackgroundWork } from './background-work';

/**
 * For work a request starts without awaiting it (a log line of its own, an e-mail): the
 * decorated method logs a failure as a warning and resolves instead of rejecting, so an
 * unawaited call never becomes an unhandled rejection (Node ends the process on one). Each
 * call is tracked as background work: a stop waits for it before it closes the pool
 * (graceful-shutdown.ts, main.ts). The class needs a `logger`.
 */
export function NeverRejects(): MethodDecorator {
  return (_target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    descriptor.value = function (this: { logger: Logger }, ...args: unknown[]) {
      return trackBackgroundWork((async () => {
        try {
          return await original.apply(this, args);
        } catch (error) {
          this.logger.warn(`${String(propertyKey)} failed: ${error instanceof Error ? error.message : error}`);
        }
      })());
    };
    return descriptor;
  };
}
