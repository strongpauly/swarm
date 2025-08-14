/*
▓█████▄  ██▀███           ▒█████  
▒██▀ ██▌▓██ ▒ ██▒        ▒██▒  ██▒
░██   █▌▓██ ░▄█ ▒        ▒██░  ██▒
░▓█▄   ▌▒██▀▀█▄          ▒██   ██░
░▒████▓ ░██▓ ▒██▒ ██▓    ░ ████▓▒░
 ▒▒▓  ▒ ░ ▒▓ ░▒▓░ ▒▓▒    ░ ▒░▒░▒░ 
 ░ ▒  ▒   ░▒ ░ ▒░ ░▒       ░ ▒ ▒░ 
 ░ ░  ░   ░░   ░  ░      ░ ░ ░ ▒  
   ░       ░       ░         ░ ░  
 ░                 ░              
 */

import {
	ANIM_TYPE_CIRCULAR,
	ANIM_TYPE_FLAG,
	ANIM_TYPE_FORMATION_SQUARE,
	ANIM_TYPE_RAND_SQUARE,
	ANIM_TYPE_SKITTER,
	ANIM_TYPE_SPIRAL,
	ANIM_TYPE_STOPNMOVE,
	GAMMA,
	MOD_NAME,
	SETTING_FADE_TIME,
	SETTING_HP_REDUCE,
	SETTING_HP_REDUCE_ATTRIBUTE_MAX,
	SETTING_HP_REDUCE_ATTRIBUTE_VALUE,
	SETTING_MIGRATED_TO,
	SETTING_STOP_TIME,
	SIGMA,
	SWARM_FLAG,
	SWARM_SIZE_FLAG,
	SWARM_SPEED_FLAG,
	THETA
} from "./constants.mjs";
import * as utils from "./utils.mjs";

function Lang(k) {
	return game.i18n.localize("SWARM." + k);
}

let swarm_socket;
Hooks.once("socketlib.ready", () => {
	// socketlib is activated, lets register our function moveAsGM
	swarm_socket = socketlib.registerModule(MOD_NAME);
	swarm_socket.register("wildcards", wildcards);
});

async function wildcards(token_id) {
	let tk = canvas.tokens.get(token_id);
	if (tk) {
		return await tk.actor.getTokenImages();
	} else {
		return [];
	}
}

function getHealthEstimate(token) {
	let reduceHP = game.settings.get(MOD_NAME, SETTING_HP_REDUCE);
	if (!reduceHP) return 1; // always return 100% health

	let currentProperty;
	let maxProperty;

	switch (game.system.id) {
		case "pf1":
		case "pf2e":
		case "dnd5e":
		case "D35E":
			currentProperty = "actor.system.attributes.hp.value";
			maxProperty = "actor.system.attributes.hp.max";
			break;
		case "wfrp4e":
			currentProperty = "actor.system.status.wounds.value";
			maxProperty = "actor.system.status.wounds.max";
			break;
		case "swade":
			currentProperty = "actor.system.wounds.value";
			maxProperty = "actor.system.wounds.max";
			break;
		default:
			currentProperty = game.settings.get(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_VALUE);
			maxProperty = game.settings.get(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_MAX);
			break;
	}
	if (!currentProperty || !maxProperty) {
		console.warn("No health estimate implemented");
		return 1;
	}
	try {
		const hpValue = foundry.utils.getProperty(token, currentProperty);
		const hpMax = foundry.utils.getProperty(token, maxProperty);
		if (typeof hpValue === "number" && typeof hpMax === "number") {
			switch (game.system.id) {
				case "pf1":
				case "pf2e":
				case "dnd5e":
				case "D35E":
				case "wfrp4e":
				default:
					return hpValue / hpMax;
				case "swade":
					return hpMax === 0 ? 1 : Math.max(hpMax - hpValue, 0) / Math.max(hpMax, 1);
			}
		}
	} catch (ex) {
		console.warn("Error estimating health");
		console.error(ex);
	}
	return 1;
}

/**
 * @type Record<string, Swarm>
 */
const SWARMS = {};
// TODO: Remove debug accessor
window.SWARMS = SWARMS;

// class SwarmContainer extends PIXI.Container {
// 	constructor(token, document) {
// 		super();
// 		this.token = token;
// 		this.document = document;
// 	}

// 	get name() {
// 		return `Swarm.${this.token.id}`;
// 	}

// 	get alpha() {
// 		return this.token.isVisible ? this.document.alpha : 0;
// 	}

// 	set alpha(_v) {}

// 	get sortLayer() {
// 		return this.token.mesh.sortLayer;
// 	}
// }

class SwarmContainer extends PrimarySpriteMesh {
	_render(_renderer) {
		// Base Sprite shouldn't be rendered
	}

	get rotation() {
		return 0;
	}

	set rotation(_v) {}

	get angle() {
		return 0;
	}

	set angle(_v) {}
}

export default class Swarm {
	constructor(token, document = token.document) {
		const number = document.getFlag(MOD_NAME, SWARM_SIZE_FLAG);
		this.t = 0;
		this.token = token;
		this.document = document;
		this.currentHPPercent = this.calculateHPPercent(); // Calculate current HP percent
		this.number = this.determineVisibleSprites(this.currentHPPercent, number); // Determine initial number of visible sprites
		this.maxSprites = number; // Store the maximum number of sprites
		this.sprites = [];
		this.dest = [];
		this.speeds = [];
		this.offsets = [];
		this.waiting = [];
		// const swarm = (this.layer = new SwarmContainer(token, document));
		this.layer = token.mesh;
		token.swarm = this;

		// this.randomRotation = true;
		this.faded = document.hidden;
		this.visible = this.faded ? 0 : this.number;

		// Object.defineProperty(token.mesh, "alpha", {
		// 	get() {
		// 		return 0;
		// 	},
		// 	set(_v) {},
		// 	configurable: true,
		// 	enumerable: true
		// });

		// if (this.token._TMFXgetSprite && !this.token._old_TMFXgetSprite) {
		// 	// Override sprite for Token Magic
		// 	this.token._old_TMFXgetSprite = this.token._TMFXgetSprite;
		// 	this.token._TMFXgetSprite = function () {
		// 		return swarm;
		// 	}.bind(this.token);
		// 	// Re set filters on new sprite
		// 	if (typeof TokenMagic !== "undefined") {
		// 		setTimeout(() => {
		// 			TokenMagic._singleLoadFilters(this.token);
		// 		}, 0);
		// 	}
		// }

		// canvas.primary.addChild(this.layer);

		this.setElevation(document.elevation);
		this.setSort(this.token.sort ?? 0);

		this.created = false;

		this.tick = new PIXI.Ticker();
		const anim = document.getFlag(MOD_NAME, ANIM_TYPE_FLAG);
		this.setDestinations = this.circular;
		switch (anim) {
			case ANIM_TYPE_CIRCULAR:
				this.setDestinations = this.circular;
				break;
			case ANIM_TYPE_RAND_SQUARE:
				this.setDestinations = this.randSquare;
				break;
			case ANIM_TYPE_SPIRAL:
				this.setDestinations = this.spiral;
				break;
			case ANIM_TYPE_SKITTER:
				this.setDestinations = this.skitter;
				break;
			case ANIM_TYPE_STOPNMOVE:
				this.setDestinations = this.stopMoveStop;
				break;
			case ANIM_TYPE_FORMATION_SQUARE:
				this.setDestinations = this.formSquare;
				// this.randomRotation = false;
				break;
		}
		this.tick.add(this.anim.bind(this));
		this.tick.start();
		this.token.refresh();
		Hooks.call("createSwarm", this);
	}

	async createSprites(number) {
		const use_random_image = this.token.actor.prototypeToken.randomImg;
		const hidden = this.document.hidden;

		let images = [];
		if (use_random_image) {
			images = await swarm_socket.executeAsGM("wildcards", this.token.id);
		} else {
			images.push(this.document.texture.src);
		}

		const anim = this.document.getFlag(MOD_NAME, ANIM_TYPE_FLAG);

		for (let i = 0; i < number; ++i) {
			// waiting times, only used for stop-move
			this.waiting.push(0);
			// Random offset
			this.offsets.push(Math.random() * 97);
			// Pick an image from the list at random
			let img = images[Math.floor(Math.random() * images.length)];
			const sprite = PIXI.Sprite.from(img);
			sprite.anchor.set(0.5);

			// Sprites initial position, a random position within this tokens area
			sprite.x = Math.random() * this.token.w - this.token.w / 2;
			sprite.y = Math.random() * this.token.h - this.token.h / 2;
			// Hidden initially?
			sprite.alpha = hidden ? 0 : 1;

			// Start off at scale 0 before image is loaded
			sprite.scale.x = 0;
			sprite.scale.y = 0;

			// A callback to start the video
			const start = () => {
				// Check if the texture selected is a video, and potentially start it
				const src = sprite.texture.baseTexture.resource.source;
				src.loop = true;
				src.muted = true; // Autostarting videos must explicitly be muted (chrome restriction)
				if (src.play) src.play();
			};
			if (sprite.texture.baseTexture.valid) {
				start();
			} else {
				sprite.texture.baseTexture.on("loaded", start);
			}
			// Set the initial destination to its initial position
			this.dest.push({ x: sprite.x, y: sprite.y });
			this.sprites.push(sprite);
			let sf = this.document.getFlag(MOD_NAME, SWARM_SPEED_FLAG);
			if (sf === undefined) sf = 1;

			switch (anim) {
				case ANIM_TYPE_RAND_SQUARE:
					sf *= 0.5;
					break;
				case ANIM_TYPE_SPIRAL:
					sf *= 1.2;
					break;
				case ANIM_TYPE_SKITTER:
				case ANIM_TYPE_CIRCULAR:
				case ANIM_TYPE_STOPNMOVE:
				case ANIM_TYPE_FORMATION_SQUARE:
				default:
					break;
			}

			// Add 50% of the speed as variability on each sprites speed
			this.speeds.push(sf * 0.5 + sf * Math.random() * 0.5);
			// Add this sprite to the correct layer
			this.layer.addChild(sprite);
		}
	}

	calculateHPPercent() {
		return getHealthEstimate(this.token);
	}

	determineVisibleSprites(hpPercent, maxNumber) {
		// No sprites when hp zero
		if (hpPercent <= 0) return 0;
		const minSprites = 1;
		return Math.max(minSprites, Math.round(hpPercent * maxNumber));
	}

	determineStep(ms) {
		const fd = game.settings.get(MOD_NAME, SETTING_FADE_TIME);
		const count = Math.abs(this.visible - this.number);
		// step, corresponding to the module setting "fade time", also, prevent division by zero
		return fd == 0 ? count : (ms * count) / (fd * 1000);
	}

	/**
	 * The main animation callback for this swarm
	 * @param {Number} t Time fraction of the current fps
	 */
	anim(t) {
		if (!this.token.width || !this.token.height) {
			return;
		}
		if (!this.created) {
			this.createSprites(this.maxSprites); // Use maxSprites instead of number
		}

		t = Math.min(t, 2.0); // Cap frame skip to two frames
		// Milliseconds elapsed, as calculated using the "time" fraction and current fps
		const ms = t * 1000 * (1.0 / this.tick.FPS);

		const getScale = (sprite) => {
			if (!sprite.texture.valid) {
				return;
			}
			// Get the largest dimension, and scale around that
			const smax = Math.max(sprite.texture.width, sprite.texture.height);
			const x = (this.document.texture.scaleX * canvas.grid.size) / smax;
			const y = (this.document.texture.scaleY * canvas.grid.size) / smax;
			return { x, y };
		};

		let updateSprites = this.tint != this.document.texture.tint;

		const currentHPPercent = this.calculateHPPercent();
		if (currentHPPercent !== this.currentHPPercent || !this.created) {
			this.currentHPPercent = currentHPPercent;
			this.number = this.determineVisibleSprites(currentHPPercent, this.maxSprites);
			this.step = this.determineStep(ms);
			updateSprites = true;
		}

		if (this.step === null) {
			this.step = this.determineStep(ms);
		}

		if (Math.round(this.visible) !== this.number) {
			updateSprites = true;
			if (this.visible > this.number) {
				this.visible -= this.step;
				if (this.visible < this.number) {
					this.visible = this.number;
				}
			} else {
				this.visible += this.step;
				if (this.visible > this.number) {
					this.visible = this.number;
				}
			}
		}

		if (!updateSprites && this.sprites.length) {
			if (typeof this.scale === "undefined") {
				updateSprites = true;
			} else {
				const scale = getScale(this.sprites[0]);
				updateSprites = scale && (this.scale.x !== scale.x || this.scale.y !== scale.y);
			}
		}

		if (updateSprites) {
			const remaining = Math.round(this.maxSprites - this.visible);
			this.sprites.forEach((sprite, i) => {
				sprite.alpha = i >= remaining ? 1 : this.faded && game.user.isGM ? 0.2 : 0;
				const newScale = getScale(sprite);
				if (newScale) {
					this.scale = newScale;
					sprite.scale.x = this.scale.x;
					sprite.scale.y = this.scale.y;
				}
				if (this.document.texture.tint) {
					this.tint = sprite.tint = this.document.texture.tint;
				}
			});
		}

		// Calling the animation specific method, set_destination
		this.setDestinations(ms);
		// Calling the generic move method
		this.move(ms);
		this.created = true;
		// Keep rotation
		// if (!this.randomRotation){
		//     this.rotation(this.token.document.rotation);
		// }
	}

	/**
	 * @param {boolean} hidden
	 */
	hide(hidden) {
		this.faded = hidden;
		// Clear step to be recalcuated on next tick
		this.step = null;
		if (hidden) {
			this.number = 0;
		} else {
			this.number = this.determineVisibleSprites(this.currentHPPercent, this.maxSprites);
		}
	}

	/**
	 * @param {number} elevation
	 */
	setElevation(elevation) {
		this.layer.elevation = elevation || 0;
	}

	setSort(sort) {
		this.layer.sort = sort;
	}

	destroy() {
		Hooks.call("preDestroySwarm", this);
		for (let s of this.sprites) {
			s.destroy();
		}
		this.tick.destroy();
		// Object.defineProperty(this.token.mesh, "alpha", {
		// 	value: this.document.alpha,
		// 	configurable: true,
		// 	enumerable: true,
		// 	writable: true
		// });
		// if (this.token._old_TMFXgetSprite) {
		// 	this.token._TMFXgetSprite = this.token._old_TMFXgetSprite.bind(this.token);
		// 	delete this.token._old_TMFXgetSprite;
		// 	// Re set filters on new sprite
		// 	if (typeof TokenMagic !== "undefined") {
		// 		TokenMagic._singleLoadFilters(this.token);
		// 	}
		// }
		// this.layer.destroy();
		Hooks.call("destroySwarm", this);
	}

	skitter(ms) {
		this.stopMoveStop(ms);

		const pcs = canvas.tokens.placeables.filter((t) => t.actor.hasPlayerOwner);
		if (!pcs.length) return;

		const pcp = pcs.map((t) => t.center);
		const occ = pcs.map((t) => (0.55 * t.w) ** 2);

		for (let i = 0; i < this.sprites.length; ++i) {
			const s = this.sprites[i];
			// sprite's global position: convert from center-relative local -> global using token.center
			const sp = { x: s.x + this.token.center.x, y: s.y + this.token.center.y };

			const dists2 = pcp.map((p) => (sp.x - p.x) ** 2 + (sp.y - p.y) ** 2);
			const smallest = utils.argMin(dists2);

			if (dists2[smallest] < occ[smallest]) {
				// We are "inside" a player
				const out = utils.vSub(sp, pcp[smallest]);
				if (out.x ** 2 + out.y ** 2 > THETA) {
					const shortest_direction_out_normed = utils.vNorm(out);
					const distance_left_out = 0.1 + Math.sqrt(occ[smallest]) - Math.sqrt(dists2[smallest]);
					const newDestGlobal = utils.vAdd(
						sp,
						utils.vMult(shortest_direction_out_normed, 1.5 * distance_left_out)
					);
					// convert back to local coordinates relative to token center
					this.dest[i] = {
						x: newDestGlobal.x - this.token.center.x,
						y: newDestGlobal.y - this.token.center.y
					};
				}
			}
		}
	}

	stopMoveStop(ms) {
		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });
			if (d.x ** 2 + d.y ** 2 < SIGMA) {
				if (this.waiting[i] <= 0) {
					this.dest[i] = {
						x: Math.random() * this.token.w - this.token.w / 2,
						y: Math.random() * this.token.h - this.token.h / 2
					};
					this.waiting[i] = Math.random() * game.settings.get(MOD_NAME, SETTING_STOP_TIME) * 1000;
				} else {
					this.waiting[i] -= ms;
				}
			}
		}
	}

	formSquare(ms) {
		//Calculate length and width
		const rows = Math.ceil(Math.sqrt(this.sprites.length)); //Number of rows
		const columns = Math.ceil(this.sprites.length / rows); // Vertical number
		const lastRow = rows - (rows * columns - this.sprites.length); //last row
		const angle = this.token.document.rotation * (Math.PI / 180);
		const localCenter = { x: this.token.w / 2, y: this.token.h / 2 };

		for (let i = 0; i < this.sprites.length; ++i) {
			const sprite = this.sprites[i];
			// Calculate the coordinate position in a square matrix (top-left style)
			let x = (this.token.w / rows) * (((i - lastRow) % rows) + 0.5);
			let y = (this.token.h / columns) * (Math.floor((i - lastRow) / rows) + 1.5);

			if (lastRow > 0 && i < lastRow) {
				x = (this.token.w / lastRow) * ((i % lastRow) + 0.5);
			}

			// Rotate the square matrix following the token direction (still computed top-left based)
			const destX = (x - localCenter.x) * Math.cos(angle) - (y - localCenter.y) * Math.sin(angle) + localCenter.x;
			const destY = (x - localCenter.x) * Math.sin(angle) + (y - localCenter.y) * Math.cos(angle) + localCenter.y;

			// Convert the destination into center-relative coordinates
			const dest = { x: destX - localCenter.x, y: destY - localCenter.y };

			// Turn to the direction of the token when it is close enough to where it should be in the square.
			const d = utils.vSub(dest, { x: sprite.x, y: sprite.y });
			const len = utils.vLen(d);
			if (len < SIGMA) {
				sprite.rotation = angle;
			} else {
				this.dest[i] = dest;
			}
		}
	}

	randSquare(ms) {
		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });
			let len = utils.vLen(d);
			if (len < SIGMA || len > GAMMA) {
				this.dest[i] = {
					x: Math.random() * this.token.w - this.token.w / 2,
					y: Math.random() * this.token.h - this.token.h / 2
				};
			}
		}
	}

	spiral(ms) {
		this.t += ms / 30;
		const rx = 0.5 * this.token.w;
		const ry = 0.5 * this.token.h;
		for (let i = 0; i < this.sprites.length; ++i) {
			const t = this.speeds[i] * this.t * 0.02 + this.offsets[i];
			const x = Math.cos(t);
			const y = 0.4 * Math.sin(t);

			const angle = t / (2 * Math.E);
			const ci = Math.cos(angle);
			const si = Math.sin(angle);

			const final_x = rx * x * ci - ry * y * si;
			const final_y = rx * x * si + ry * y * ci;

			// NEW: final_x/final_y are already center-relative; keep them that way
			this.dest[i] = {
				x: final_x,
				y: final_y
			};
		}
	}

	circular(ms) {
		this.t += ms / 30;
		const _rx = 0.5 * this.token.w;
		const _ry = 0.5 * this.token.h;

		for (let i = 0; i < this.sprites.length; ++i) {
			const t = this.t * 0.02 + this.offsets[i];
			const rY = 0.5 + 0.5 * (Math.sin(t * 0.3) + 0.3 * Math.sin(2 * t + 0.8) + 0.26 * Math.sin(3 * t + 0.8));
			const x = Math.cos(t * this.speeds[i]);
			const y = rY * Math.sin(t * this.speeds[i]);

			const ci = Math.cos(this.offsets[i]);
			const si = Math.sin(this.offsets[i]);

			const final_x = _rx * x * ci - _ry * y * si;
			const final_y = _rx * x * si + _ry * y * ci;

			this.dest[i] = {
				x: final_x,
				y: final_y
			};
		}
	}

	move(ms) {
		for (let i = 0; i < this.sprites.length; ++i) {
			const sprite = this.sprites[i];
			const destination = this.dest[i];
			const diff = utils.vSub(destination, { x: sprite.x, y: sprite.y });

			if (diff.x ** 2 + diff.y ** 2 > THETA) {
				let mv = utils.vNorm(diff);
				mv = utils.vMult(mv, 0.05 * ms * this.speeds[i] * 4);
				if (mv.x ** 2 + mv.y ** 2 > diff.x ** 2 + diff.y ** 2) {
					mv = diff;
				}
				sprite.x += mv.x;
				sprite.y += mv.y;
				sprite.rotation = -Math.PI / 2 + utils.vRad(diff);
			}
		}
	}
}

function deleteSwarmOnToken(token) {
	const swarm = SWARMS[token.id];
	if (swarm) {
		swarm.destroy();
		delete SWARMS[token.id];
	}
}

function createSwarmOnToken(token, document) {
	deleteSwarmOnToken(token);
	Hooks.call("preCreateSwarm", token, document);
	SWARMS[token.id] = new Swarm(token, document);
}

/**
 * @param {*} changes
 * @returns If any swarm related flag was in this update
 */
const swarmNeedsRefresh = (changes) => {
	if (!changes) {
		return false;
	}
	if (changes.flags?.[MOD_NAME]) {
		return true;
	}
	if (typeof changes.alpha === "number") {
		return true;
	}
	if (changes.texture) {
		return true;
	}
	return false;
};

Hooks.on("preUpdateToken", (document, changes) => {
	if (swarmNeedsRefresh(changes)) {
		deleteSwarmOnToken(document);
	}
});

Hooks.on("updateToken", (document, changes) => {
	if (document.flags?.[MOD_NAME]?.[SWARM_FLAG]) {
		const swarm = SWARMS[document.id];
		if (!swarm || (swarmNeedsRefresh(changes) && document.object)) {
			createSwarmOnToken(document.object);
		} else {
			if (changes.hidden != undefined) {
				swarm.hide(changes.hidden);
			}
			if (changes.elevation !== undefined) {
				swarm.setElevation(changes.elevation);
			}
			if (changes.sort !== undefined) {
				swarm.setSort(changes.sort);
			}
		}
	}
});

Hooks.on("refreshToken", (token) => {
	if (token.document.getFlag(MOD_NAME, SWARM_FLAG) === true && !SWARMS[token.id] && token.mesh) {
		createSwarmOnToken(token);
	}
});

Hooks.on("renderTokenConfig", (renderConfig) => {
	const document = renderConfig.token ?? renderConfig.document;
	const onDrawToken = (token) => {
		if (token.document.id === document.id) {
			deleteSwarmOnToken(token);
			if (token.document.flags?.[MOD_NAME]?.[SWARM_FLAG]) {
				createSwarmOnToken(token);
			}
		}
	};
	Hooks.on("drawToken", onDrawToken);
	Hooks.once("closeTokenConfig", (closeConfig) => {
		const closingDocument = closeConfig.token ?? closeConfig.document;
		if (closingDocument.id === document.id) {
			Hooks.off("drawToken", onDrawToken);
			const token = closingDocument.object;
			if (token) {
				deleteSwarmOnToken(token);
				if (document.flags?.[MOD_NAME]?.[SWARM_FLAG]) {
					createSwarmOnToken(token, document);
				}
			}
		}
	});
});

// Delete token
Hooks.on("deleteToken", (token, options, user_id) => {
	if (token.id in SWARMS) {
		SWARMS[token.id].destroy();
		delete SWARMS[token.id];
	}
});

const isSwarmingToken = (t) => !!t.document.getFlag(MOD_NAME, SWARM_FLAG);
const getSwarmingTokens = () => canvas.tokens.placeables.filter(isSwarmingToken);

Hooks.on("ready", async () => {
	if (game.settings.get(MOD_NAME, SETTING_MIGRATED_TO) < 11.0) {
		ui.notifications.notify(`Migrating Swarms.  Please don't refresh your browser.`);
		const actors = game.actors.filter(
			(a) => a.prototypeToken.getFlag(MOD_NAME, SWARM_FLAG) && a.prototypeToken.alpha === 0
		);
		if (actors.length) {
			await Promise.all(actors.map(async (actor) => await actor.prototypeToken.update({ alpha: 1 })));
		}
		let tokenCount = 0;
		await Promise.all(
			game.scenes.map(async (scene) => {
				const tokens = scene.tokens.filter((token) => token.getFlag(MOD_NAME, SWARM_FLAG) && token.alpha === 0);
				if (tokens.length) {
					await Promise.all(tokens.map(async (token) => await token.update({ alpha: 1 })));
					tokenCount += tokens.length;
				}
			})
		);
		await game.settings.set(MOD_NAME, SETTING_MIGRATED_TO, 11.0);
		ui.notifications.notify(
			`Swarms Migration complete. Updated ${actors.length} actor(s) and ${tokenCount} token(s).`
		);
	}
});

Hooks.on("canvasReady", () => {
	// Scene loaded.
	for (let s of getSwarmingTokens()) {
		createSwarmOnToken(s);
	}
});

//Only in V10+
Hooks.on("canvasTearDown", (a, b) => {
	for (let key of Object.keys(SWARMS)) {
		SWARMS[key].destroy();
		delete SWARMS[key];
	}
});

// Hooks.on("sightRefresh", (canvasVisibility) => {
// 	if (canvasVisibility.tokenVision) {
// 		const swarmedTokens = getSwarmingTokens();
// 		for (let t of swarmedTokens) {
// 			const swarm = SWARMS[t.id];
// 			if (swarm) {
// 				// Swarm might not exist if just been updated
// 				// swarm.layer.alpha = t.isVisible ? swarm.document.alpha : 0;
// 			}
// 		}
// 	}
// });

// Settings:
Hooks.once("init", () => {
	game.settings.register(MOD_NAME, SETTING_HP_REDUCE, {
		name: "Reduce swarm with HP",
		hint: "Reduce the swarm as HP decreases, requires support for your system",
		scope: "world",
		config: true,
		type: Boolean,
		default: false
	});
	game.settings.register(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_VALUE, {
		name: "Attribute for Current HP",
		hint: "System dependent path to current hp Attribute of token (token.[...])",
		scope: "world",
		config: true,
		type: String,
		default: "actor.system.attributes.hp.value"
	});
	game.settings.register(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_MAX, {
		name: "Attribute for Max HP",
		hint: "System dependent path to max hp Attribute of token (token.[...])",
		scope: "world",
		config: true,
		type: String,
		default: "actor.system.attributes.hp.max"
	});
	game.settings.register(MOD_NAME, SETTING_FADE_TIME, {
		name: "Fade time",
		hint: "How long, in seconds, the fade in/out should take",
		scope: "world",
		config: true,
		type: Number,
		default: 2.0
	});
	game.settings.register(MOD_NAME, SETTING_STOP_TIME, {
		name: "Stop time",
		hint: "How long, in seconds, the stop in the stop move animation",
		scope: "world",
		config: true,
		type: Number,
		default: 5.0
	});

	game.settings.register(MOD_NAME, SETTING_MIGRATED_TO, {
		name: "Migrations",
		scope: "world",
		config: false,
		type: Number,
		default: 0
	});

	libWrapper.register(MOD_NAME, "PrimaryCanvasGroup.prototype.addToken", function (wrapped, token) {
		if (!token.document.getFlag(MOD_NAME, SWARM_FLAG)) {
			return wrapped(token);
		}
		const swarm = new SwarmContainer(token, token.document);
		this.addChild(swarm);
		return swarm;
	});
});
