// Changing the account currency (audit B10). Expenses carry no currency of their own, so a change
// relabels every past amount: the account route asks for a confirmation first while any exist.

/** The code of `PATCH /api/account`'s refusal of an unconfirmed change that would relabel past expenses. */
export const CURRENCY_RELABEL = "currency_relabel";

/** "Your 214 past expenses will be shown as USD; amounts aren't converted." */
export function currencyRelabelMessage(count: number, currency: string) {
  const expenses = count === 1 ? "past expense" : `${count} past expenses`;
  return `Your ${expenses} will be shown as ${currency}; amounts aren't converted.`;
}
