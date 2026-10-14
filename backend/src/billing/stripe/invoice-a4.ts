/**
 * Stripe renders invoice PDFs in Letter by default. KANAP invoices are A4: the rendering
 * option is accepted on a draft and on an already finalized or paid invoice, so this runs
 * wherever KANAP meets an invoice (before finalizing its own drafts, and on the
 * `invoice.created` / `invoice.finalized` webhooks). It never blocks billing: a Stripe
 * error is logged and the invoice is returned as it was.
 */
export async function ensureInvoiceA4(
  client: any,
  invoice: any,
  logger: { warn: (message: string) => unknown },
): Promise<any> {
  const invoiceId = typeof invoice?.id === 'string' ? invoice.id : null;
  if (!client || !invoiceId) return invoice;
  if (invoice.rendering?.pdf?.page_size === 'a4') return invoice;
  try {
    const updated = await client.invoices.update(invoiceId, { rendering: { pdf: { page_size: 'a4' } } });
    return updated ?? invoice;
  } catch (error) {
    logger.warn(`Unable to set the A4 PDF format on invoice ${invoiceId}: ${(error as Error)?.message ?? String(error)}`);
    return invoice;
  }
}
