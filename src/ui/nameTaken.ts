/** The name in `names` that `name` repeats, ignoring spaces round it and letter case, or undefined: two search engines or two profiles
 *  called "Google" and "google " read the same in every list and menu, so the second one is refused with a message naming the first. */
export const takenName = (name: string, names: readonly string[]): string | undefined => {
  const key = name.trim().toLocaleLowerCase();
  return key ? names.find((other) => other.trim().toLocaleLowerCase() === key) : undefined;
};
export const nameTaken = (name: string, names: readonly string[]): boolean => takenName(name, names) !== undefined;
