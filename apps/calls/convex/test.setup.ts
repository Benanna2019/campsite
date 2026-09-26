// Every Convex module, for convex-test. Test files are excluded so they are
// never loaded as functions.
export const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./test.setup.ts'])
