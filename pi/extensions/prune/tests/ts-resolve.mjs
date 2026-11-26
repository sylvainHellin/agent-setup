// Node's type stripping loads .ts files but never maps a `./x.js` specifier to
// `./x.ts`, which is how smart-compact's sources import each other (pi's jiti
// and tsc both do the mapping). This hook adds it for the test run only.
// It also resolves the two runtime packages index.ts imports the way
// tsconfig.json's `paths` do (both from pi's install through the
// extensions/node_modules link), so tests can load the extension itself.
import { registerHooks } from "node:module";

const extensions = new URL("../../", import.meta.url);
const PACKAGES = {
	"@earendil-works/pi-tui": new URL(
		"node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js",
		extensions,
	).href,
	typebox: new URL("node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/", extensions).href,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
			if (specifier === "typebox") return nextResolve("typebox", { ...context, parentURL: PACKAGES.typebox });
			if (specifier in PACKAGES) return nextResolve(PACKAGES[specifier], context);
			if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
			return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
		}
	},
});
