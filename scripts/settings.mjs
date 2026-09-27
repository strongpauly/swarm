import { MOD_NAME } from "./constants.mjs";

/**
 * Caches this module's setting values. game.settings.get builds a Setting document (client scope) or scans every
 * world setting (world scope), which is too slow for the per-frame animation loop, so each value is read once and
 * then kept up to date by the setting's onChange.
 */
export class SettingsCache {
	static #values = new Map();

	/**
	 * @param {string} key
	 * @returns {any} The setting's current value
	 */
	static get(key) {
		if (!SettingsCache.#values.has(key)) SettingsCache.#values.set(key, game.settings.get(MOD_NAME, key));
		return SettingsCache.#values.get(key);
	}

	/**
	 * Build an onChange handler for a setting's registration that keeps the cached value current.
	 * @param {string} key
	 * @param {Function} [then] Called after the cached value is updated
	 * @returns {Function}
	 */
	static onChange(key, then) {
		return (value) => {
			SettingsCache.#values.set(key, value);
			then?.();
		};
	}
}
