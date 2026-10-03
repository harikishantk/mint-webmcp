/** Default is fill-only; submit only when explicitly confirmed. */
export function shouldSubmitForm(args: Record<string, unknown>): boolean {
  if (args.confirmSubmit === true) return true;
  if (args.autoSubmit === true) return true;
  return false;
}

export function stripSubmitFlags(args: Record<string, unknown>): Record<string, unknown> {
  const { autoSubmit: _a, confirmSubmit: _c, ...rest } = args;
  return rest;
}
