let idCounter = 0;

/** Id for a synced record; the random part keeps ids unique across phones, since shared trips mix records from several members. */
export function nextRecordId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
