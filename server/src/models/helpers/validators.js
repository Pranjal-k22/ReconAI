export const isSafeInteger = (value) => {
  if (value === null || value === undefined) return true;
  return Number.isSafeInteger(value);
};

export const isNonNegativeSafeInteger = (value) => {
  if (value === null || value === undefined) return true;
  return Number.isSafeInteger(value) && value >= 0;
};
