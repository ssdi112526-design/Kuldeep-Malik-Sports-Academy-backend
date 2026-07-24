/** Map Prisma `id` → `_id` so the existing admin UI keeps working. */
export function withId(doc) {
  if (!doc) return doc;
  const { id, password, ...rest } = doc;
  return { ...rest, id, _id: id };
}

export function withIds(docs = []) {
  return docs.map(withId);
}
