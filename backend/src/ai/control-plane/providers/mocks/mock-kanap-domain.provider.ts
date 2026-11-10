import {
  AdapterResult,
  KanapDomainProvider,
  ProviderContext,
} from '../provider.types';
import {
  evidenceSeed,
  mockApplicability,
  mockHealth,
  ok,
} from './mock-provider.helpers';
import { PRODUCT_NAME } from '../../../../config/product';

export class MockKanapDomainProvider implements KanapDomainProvider {
  readonly kind = 'kanap_domain' as const;
  readonly providerKey = 'mock';

  async health(context: ProviderContext) {
    void context;
    return mockHealth(this.kind, this.providerKey);
  }

  async applicability(context: ProviderContext) {
    void context;
    return mockApplicability();
  }

  async resolveOperationalContext(
    context: ProviderContext,
    input: { assetId?: string | null; applicationId?: string | null },
  ): Promise<AdapterResult<{ summary: string }>> {
    void context;
    const data = {
      summary: `Mock ${PRODUCT_NAME} context for ${input.assetId ?? input.applicationId ?? 'unscoped object'}: SAP S/4HANA production application, criticality high, owner SAP Operations.`,
    };
    return ok(data, [
      evidenceSeed('kanap_domain:mock', 'operational_context', input.assetId ?? input.applicationId ?? 'unknown', data.summary, data),
    ]);
  }
}
