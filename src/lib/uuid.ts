export function uuid() {
  if (
    typeof crypto !== "undefined"
    && typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    Date.now().toString(36)
    + Math.random().toString(36).substring(2, 10)
  );
}
