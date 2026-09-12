export function investmentAssetKey(accountId: string, instrument: string, currency: string) {
  return JSON.stringify([accountId, instrument, currency]);
}

export function investmentDetailId(accountId: string) {
  return `investment-detail-${accountId}`;
}
