import {
  CanActivate,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Features } from '../config/features';

export class FeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED';
  constructor(
    public readonly feature: string,
    message?: string,
  ) {
    super(message || `${feature} is not available in this deployment.`);
  }
}

export function throwNotAvailableInMode(): never {
  throw new NotFoundException();
}

/**
 * The sentence a person reads for a feature turned off, when the feature's code would mean nothing
 * to them (the code stays in `feature`). The others keep the generic sentence.
 */
const FEATURE_DISABLED_MESSAGES: Readonly<Record<string, string>> = {
  vulnerabilityFeed: 'Vulnerability tracking is turned off in this deployment.',
};

export function throwFeatureDisabled(feature: string): never {
  throw new ForbiddenException({
    code: 'FEATURE_DISABLED',
    feature,
    message: FEATURE_DISABLED_MESSAGES[feature] ?? `${feature} is not available in this deployment.`,
  });
}

@Injectable()
export class MultiTenantOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (Features.SINGLE_TENANT) throw new NotFoundException();
    return true;
  }
}
