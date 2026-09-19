export function returnAmount(lineTotalCents, soldQuantity, returnedQuantity, priorQuantity, priorRefundCents) {
  if (![lineTotalCents, soldQuantity, returnedQuantity, priorQuantity, priorRefundCents].every(Number.isSafeInteger)
    || lineTotalCents < 0 || soldQuantity < 1 || returnedQuantity < 1 || priorQuantity < 0
    || priorQuantity + returnedQuantity > soldQuantity || priorRefundCents < 0 || priorRefundCents > lineTotalCents) {
    throw new Error('Invalid return quantity.');
  }
  // Allocate rounding to the last unit so partial returns always sum to the paid line total.
  return priorQuantity + returnedQuantity === soldQuantity
    ? lineTotalCents - priorRefundCents
    : Math.floor(lineTotalCents * returnedQuantity / soldQuantity);
}
