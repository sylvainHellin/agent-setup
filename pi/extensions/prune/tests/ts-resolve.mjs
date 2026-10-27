// Node's type stripping loads .ts files but never maps a `./x.js` specifier to
// `./x.ts`, which is how smart-compact's sources import each other (pi's jiti
// and tsc both do the mapping). This hook adds it for the test run only.
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
			return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
		}
	},
});
