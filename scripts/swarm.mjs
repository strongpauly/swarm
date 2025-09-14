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
	DEFAULT_ANIMATION,
	DEFAULT_SWARM_SIZE,
	DEFAULT_SWARM_SPEED,
	GAMMA,
	MOD_NAME,
	SETTING_FADE_TIME,
	SETTING_HP_REDUCE,
	SETTING_HP_REDUCE_ATTRIBUTE_MAX,
	SETTING_HP_REDUCE_ATTRIBUTE_VALUE,
	SETTING_STOP_TIME,
	SIGMA,
	SWARM_FLAG,
	SWARM_SIZE_FLAG,
	SWARM_SPEED_FLAG,
	THETA
} from "./constants.mjs";
import * as utils from "./utils.mjs";

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

class SwarmMesh extends PrimarySpriteMesh {
	_render(_renderer) {
		// Base Sprite shouldn't be rendered
	}

	// Override rotation and angle
	// Swarms can't face a direction (except formSquare, but this is handled by the Swarm)
	get rotation() {
		return 0;
	}

	set rotation(_v) {}

	get angle() {
		return 0;
	}

	set angle(_v) {}
}

export class Swarm {
	constructor(object, document = object.document) {
		const number = document.getFlag(MOD_NAME, SWARM_SIZE_FLAG) ?? DEFAULT_SWARM_SIZE;
		this.t = 0;
		this.object = object;
		this.document = document;
		this.useRandomImage = this.object?.actor?.prototypeToken?.randomImg;
		this.currentHPPercent = this.calculateHPPercent(); // Calculate current HP percent
		this.number = this.determineVisibleSprites(this.currentHPPercent, number); // Determine initial number of visible sprites
		this.maxSprites = number; // Store the maximum number of sprites
		this.sprites = [];
		this.dest = [];
		this.speeds = [];
		this.offsets = [];
		this.waiting = [];
		this.isTile = object instanceof foundry.canvas.placeables.Tile;

		if (!object.swarmMesh) {
			object.swarmMesh = new SwarmMesh(object, document);
			object.swarmMesh.position.set(object.center.x, object.center.y);
			object.swarmMesh.pivot.set(0.5, 0.5);
			object.originalMesh = object.mesh;
			object.mesh = object.swarmMesh;
		} else if (object.mesh !== object.swarmMesh) {
			if (!object.originalMesh) {
				object.originalMesh = object.mesh;
			}
			object.mesh = object.swarmMesh;
		}

		if (canvas.primary.children.includes(object.originalMesh)) {
			canvas.primary.removeChild(object.originalMesh);
		}

		this.layer = object.swarmMesh;

		if (!canvas.primary.children.includes(object.swarmMesh)) {
			canvas.primary.addChild(object.swarmMesh);
		}
		object.swarm = this;

		// this.randomRotation = true;
		this.faded = document.hidden;
		this.visible = this.faded ? 0 : this.number;

		this.setElevation(document.elevation);
		this.setSort(this.object.sort ?? 0);

		this.created = false;

		this.tick = new PIXI.Ticker();
		const anim = document.getFlag(MOD_NAME, ANIM_TYPE_FLAG) ?? DEFAULT_ANIMATION;
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
		Hooks.call("createSwarm", this);
	}

	/**
	 * Return object-local (unscaled) dimensions that compensate for the object mesh scale.
	 * Use these for position/destination math so object.scale only changes visual size.
	 * @returns {{w:number,h:number,scaleX:number,scaleY:number}}
	 */
	_getLocalSize() {
		const mesh = this.object?.mesh;
		const scaleX = mesh?.scale?.x ?? 1;
		const scaleY = mesh?.scale?.y ?? scaleX;
		// object.w / scaleX gives the local coordinate width such that after parent-scaling
		// worldWidth = localWidth * scaleX === this.object.w (old behaviour).
		return {
			w: (this.isTile ? this.object.bounds.width : this.object.w) / scaleX,
			h: (this.isTile ? this.object.bounds.height : this.object.h) / scaleY,
			scaleX,
			scaleY
		};
	}

	async createSprites(number) {
		const hidden = this.document.hidden;

		let images = [];
		if (this.useRandomImage) {
			images = await swarm_socket.executeAsGM("wildcards", this.object.id);
		} else {
			images.push(this.document.texture.src);
		}

		const anim = this.document.getFlag(MOD_NAME, ANIM_TYPE_FLAG) ?? DEFAULT_ANIMATION;

		const { w: localW, h: localH } = this._getLocalSize();

		for (let i = 0; i < number; ++i) {
			// waiting times, only used for stop-move
			this.waiting.push(0);
			// Random offset
			this.offsets.push(Math.random() * 97);
			// Pick an image from the list at random
			let img = images[Math.floor(Math.random() * images.length)];
			const sprite = PIXI.Sprite.from(img);
			sprite.anchor.set(0.5);

			// Sprites initial position, a random position within this objects area
			sprite.x = Math.random() * localW - localW / 2;
			sprite.y = Math.random() * localH - localH / 2;
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
			let sf = this.document.getFlag(MOD_NAME, SWARM_SPEED_FLAG) ?? DEFAULT_SWARM_SPEED;

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
			// Add this sprite to the SwarmMesh
			this.layer.addChild(sprite);
		}
	}

	calculateHPPercent() {
		return getHealthEstimate(this.object);
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

	#getScale(sprite) {
		if (!sprite?.texture?.valid) return;

		// 1) Texture dimensions (protect against zero)
		const texW = Math.max(1, sprite.texture.width);
		const texH = Math.max(1, sprite.texture.height);
		const smax = Math.max(texW, texH);

		// 2) Set DESIRED_WORLD_SIZE_PX to the canvas grid size.
		const DESIRED_WORLD_SIZE_PX = game.canvas.grid.size;

		// 3) The base scale that would make the texture's largest side equal DESIRED_WORLD_SIZE_PX.
		const baseScale = DESIRED_WORLD_SIZE_PX / smax;

		// 4) Token scale (the only thing we want to *allow* to change sprite size).
		let docScaleX = this.object?.document?.texture?.scaleX ?? 1;
		let docScaleY = this.object?.document?.texture?.scaleY ?? docScaleX;

		// 4.5) Square docScale to allow for greater range of values.
		docScaleX = docScaleX * docScaleX;
		docScaleY = docScaleY * docScaleY;

		// 5) The scale already applied by the container / object mesh that we must undo.
		//    This is typically the mesh/container scale that Foundry assigns.
		const containerScaleX = (this.object?.mesh?.scale?.x ?? 1) || 1;
		const containerScaleY = (this.object?.mesh?.scale?.y ?? containerScaleX) || 1;

		// Defensive guards (avoid division by zero)
		const safeContainerX = Math.abs(containerScaleX) > 1e-6 ? containerScaleX : 1;
		const safeContainerY = Math.abs(containerScaleY) > 1e-6 ? containerScaleY : 1;

		// 6) Final per-axis sprite-local scale:
		//    baseScale   -> makes texture fit desired world size
		//    * docScale  -> allow object.document.scale to affect final visual size
		//    / container -> undo already-applied container scaling
		const finalX = baseScale * (docScaleX / safeContainerX);
		const finalY = baseScale * (docScaleY / safeContainerY);

		// 7) Clamps so extremely tiny/huge textures don't produce absurd values.
		const MIN = 1e-4;
		const MAX = 100;
		return {
			x: Math.max(MIN, Math.min(MAX, finalX)),
			y: Math.max(MIN, Math.min(MAX, finalY))
		};
	}

	/**
	 * The main animation callback for this swarm
	 * @param {Number} t Time fraction of the current fps
	 */
	anim(t) {
		if (!this.object.texture.valid) {
			return;
		}
		if (!this.created) {
			this.createSprites(this.maxSprites); // Use maxSprites instead of number
		}

		t = Math.min(t, 2.0); // Cap frame skip to two frames
		// Milliseconds elapsed, as calculated using the "time" fraction and current fps
		const ms = t * 1000 * (1.0 / this.tick.FPS);

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
				const scale = this.#getScale(this.sprites[0]);
				updateSprites = scale && (this.scale.x !== scale.x || this.scale.y !== scale.y);
			}
		}

		if (updateSprites && this.sprites.length > 0) {
			const remaining = Math.round(this.maxSprites - this.visible);

			this.scale = this.#getScale(this.sprites[0]);
			let getScale = () => this.scale;
			if (this.useRandomImage) {
				// Calculate scale for each sprite
				getScale = (sprite) => this.#getScale(sprite);
			}

			this.sprites.forEach((sprite, i) => {
				sprite.alpha = i >= remaining ? 1 : this.faded && game.user.isGM ? 0.2 : 0;
				const scale = getScale(sprite);
				if (scale) {
					sprite.scale.set(scale.x, scale.y);
				}
				if (this.document.texture.tint) {
					this.tint = sprite.tint = this.document.texture.tint;
				}
			});
		}

		// Calling the animation specific method, setDestinations
		this.setDestinations(ms);
		// Calling the generic move method
		this.move(ms);
		this.created = true;
		// Keep rotation
		// if (!this.randomRotation){
		//     this.rotation(this.object.document.rotation);
		// }
		this.showDebug(ms);
	}

	showDebug(ms) {
		if (!CONFIG.debug.canvas.primary.swarms) {
			return;
		}
		if (!this.debug) {
			this.debug = {};
		}
		if (!this.debug.tl) {
			this.debug.tl = new PIXI.Text("TL", {
				fontSize: 72,
				align: "center",
				x: 0,
				y: 0
			});
			this.layer.addChild(this.debug.tl);
		}
		if (!this.debug.br) {
			const { w, h } = this._getLocalSize();
			this.debug.br = new PIXI.Text("", {
				fontSize: 72,
				align: "center",
				x: w,
				y: h
			});
			this.layer.addChild(this.debug.br);
		}
		if (!this.debug.destinations) {
			this.debug.destinations = this.dest.map(({ x, y }, i) => {
				const text = new PIXI.Text(`d${i}`, {
					fontSize: 72,
					align: "center",
					x,
					y
				});
				this.layer.addChild(text);
				return text;
			});
		} else {
			this.debug.destinations.forEach((d, i) => {
				d.x = this.dest[i].x;
				d.y = this.dest[i].y;
			});
		}
		this.debug.br.text = `Speed:${this.speeds[0].toFixed(3)}, ${ms.toFixed(3)}ms`;
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
		delete this.object.swarm;
		Hooks.call("destroySwarm", this);
	}

	restoreOriginal() {
		this.destroy();
		if (this.object.mesh === this.object.originalMesh) {
			return;
		}
		canvas.primary.removeChild(this.object.mesh);
		this.object.mesh = this.object.originalMesh;
		canvas.primary.addChild(this.object.mesh);
		this.object.refresh();
	}

	skitter(ms) {
		this.stopMoveStop(ms);

		// See if there are pcs that we should stick to.
		const pcs = canvas.tokens.placeables.filter((t) => t.actor.hasPlayerOwner);
		if (!pcs.length) return;

		const pcp = pcs.map((t) => t.center);
		const occ = pcs.map((t) => (0.55 * t.w) ** 2);

		for (let i = 0; i < this.sprites.length; ++i) {
			const s = this.sprites[i];
			// sprite's global position: convert from center-relative local -> global using object.center
			const sp = { x: s.x + this.object.center.x, y: s.y + this.object.center.y };

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
					// convert back to local coordinates relative to object center
					this.dest[i] = {
						x: newDestGlobal.x - this.object.center.x,
						y: newDestGlobal.y - this.object.center.y
					};
				}
			}
		}
	}

	stopMoveStop(ms) {
		const { w: localW, h: localH } = this._getLocalSize();

		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });
			if (d.x ** 2 + d.y ** 2 < SIGMA) {
				if (this.waiting[i] <= 0) {
					this.dest[i] = {
						x: Math.random() * localW - localW / 2,
						y: Math.random() * localH - localH / 2
					};
					this.waiting[i] = Math.random() * game.settings.get(MOD_NAME, SETTING_STOP_TIME) * 1000;
				} else {
					this.waiting[i] -= ms;
				}
			}
		}
	}

	formSquare(ms) {
		// Number of sprites
		const n = this.sprites.length;

		// Compute a compact grid: cols x rows
		const cols = Math.ceil(Math.sqrt(n));
		const rows = Math.ceil(n / cols);

		const angle = this.object.document.rotation * (Math.PI / 180);
		const { w: localW, h: localH } = this._getLocalSize();
		const center = { x: localW / 2, y: localH / 2 };

		const cellW = localW / cols;
		const cellH = localH / rows;

		for (let i = 0; i < n; ++i) {
			const sprite = this.sprites[i];

			// Row/column in logical grid (top-left origin)
			const row = Math.floor(i / cols);
			const indexInRow = i - row * cols;

			// If this is the last row and it's not full, center the items in that row
			const itemsInThisRow = row === rows - 1 ? n - (rows - 1) * cols : cols;
			const rowOffsetX = (localW - itemsInThisRow * cellW) / 2;

			// Position in top-left local coordinates (0..localW, 0..localH)
			const x = rowOffsetX + (indexInRow + 0.5) * cellW;
			const y = (row + 0.5) * cellH;

			// Rotate around the object center:
			// translate to center, rotate, translate back
			const tx = x - center.x;
			const ty = y - center.y;
			const cosA = Math.cos(angle);
			const sinA = Math.sin(angle);
			const rx = tx * cosA - ty * sinA;
			const ry = tx * sinA + ty * cosA;
			const dest = { x: rx, y: ry };

			// Use utils for distance check / rotation snapping
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
		const { w: localW, h: localH } = this._getLocalSize();

		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });
			let len = utils.vLen(d);
			if (len < SIGMA || len > GAMMA) {
				this.dest[i] = {
					x: Math.random() * localW - localW / 2,
					y: Math.random() * localH - localH / 2
				};
			}
		}
	}

	spiral(ms) {
		this.t += ms / 30;
		const { w: localW, h: localH } = this._getLocalSize();
		const rx = 0.5 * localW;
		const ry = 0.5 * localH;
		for (let i = 0; i < this.sprites.length; ++i) {
			const t = this.speeds[i] * this.t * 0.02 + this.offsets[i];
			const x = Math.cos(t);
			const y = 0.4 * Math.sin(t);

			const angle = t / (2 * Math.E);
			const ci = Math.cos(angle);
			const si = Math.sin(angle);

			const final_x = rx * x * ci - ry * y * si;
			const final_y = rx * x * si + ry * y * ci;

			this.dest[i] = {
				x: final_x,
				y: final_y
			};
		}
	}

	circular(ms) {
		this.t += ms / 30;
		const { w: localW, h: localH } = this._getLocalSize();

		const _rx = 0.5 * localW;
		const _ry = 0.5 * localH;

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
		// Base desired world speed (pixels per millisecond) *before per-sprite variation.
		const BASE_WORLD_SPEED_PX_PER_MS = 0.12;

		// Determine the effective parent/world scale that will multiply the sprite's local scale
		const parent = this.object?.swarmMesh;
		let parentScaleX = 1;
		let parentScaleY = 1;
		if (parent) {
			try {
				// Ensure transform is current
				if (typeof parent.updateTransform === "function") parent.updateTransform();
			} catch (e) {
				/* ignore */
			}
			const m = parent.worldTransform;
			if (m) {
				parentScaleX = Math.hypot(m.a || 0, m.b || 0) || 1;
				parentScaleY = Math.hypot(m.c || 0, m.d || 0) || parentScaleX;
			} else {
				parentScaleX = (parent.scale?.x ?? 1) || 1;
				parentScaleY = (parent.scale?.y ?? parentScaleX) || 1;
			}
		}
		// Use average scale for converting magnitude
		const parentScale = (parentScaleX + parentScaleY) / 2 || 1;

		for (let i = 0; i < this.sprites.length; ++i) {
			const sprite = this.sprites[i];
			const destination = this.dest[i];
			const diff = utils.vSub(destination, { x: sprite.x, y: sprite.y });

			const diffLenSq = diff.x ** 2 + diff.y ** 2;
			if (diffLenSq > THETA) {
				// Normalised direction in local coordinates
				const dir = utils.vNorm(diff);

				// Desired world speed for this sprite (px / ms)
				const worldSpeed = BASE_WORLD_SPEED_PX_PER_MS * this.speeds[i];

				// Convert world speed into local units (local units / ms)
				const localSpeed = worldSpeed / parentScale;

				// Movement vector in local units for this frame
				let mv = utils.vMult(dir, localSpeed * ms);

				// Don't overshoot
				const mvLenSq = mv.x ** 2 + mv.y ** 2;
				if (mvLenSq > diffLenSq) {
					mv = diff;
				}
				sprite.x += mv.x;
				sprite.y += mv.y;
				sprite.rotation = -Math.PI / 2 + utils.vRad(diff);
			}
		}
	}
}

function createSwarm(object) {
	object.swarm?.destroy();
	Hooks.call("preCreateSwarm", object);
	object.swarm = new Swarm(object);
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

Hooks.on("updateToken", (document, changes) => {
	if (document.getFlag(MOD_NAME, SWARM_FLAG)) {
		const swarm = document.object?.swarm;
		if (!swarm || (swarmNeedsRefresh(changes) && document.object)) {
			createSwarm(document.object);
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
	} else if (document.object?.swarm) {
		document.object.swarm.restoreOriginal();
	}
});

/**
 * Options for refreshing token visuals.
 * @typedef {Object} TokenRefreshOptions
 * @property {boolean} [refreshBars]
 * @property {boolean} [refreshBorder]
 * @property {boolean} [refreshEffects]
 * @property {boolean} [refreshElevation]
 * @property {boolean} [refreshMesh]
 * @property {boolean} [refreshNameplate]
 * @property {boolean} [refreshPosition]
 * @property {boolean} [refreshRingVisuals]
 * @property {boolean} [refreshRotation]
 * @property {boolean} [refreshRuler]
 * @property {boolean} [refreshShader]
 * @property {boolean} [refreshShape]
 * @property {boolean} [refreshSize]
 * @property {boolean} [refreshState]
 * @property {boolean} [refreshTarget]
 * @property {boolean} [refreshTooltip]
 * @property {boolean} [refreshTurnMarker]
 * @property {boolean} [refreshVisibility]
 */

Hooks.on(
	"refreshToken",
	/**
	 * @param {Token} token
	 * @param {TokenRefreshOptions} changes
	 */
	function swarmsRefreshToken(token, changes) {
		if (token.document.getFlag(MOD_NAME, SWARM_FLAG)) {
			if (!token.swarm || changes.refreshMesh) {
				createSwarm(token);
			}
		} else if (token.swarm && token.originalMesh) {
			token.swarm.restoreOriginal();
		}
	}
);

Hooks.on(
	"destroyToken",
	/**
	 * @param {Token} token
	 */
	function swarmsDestroyToken(token) {
		if (token.mesh instanceof SwarmMesh) {
			canvas.primary.removeChild(token.mesh);
		}
		token.swarm?.destroy();
	}
);

Hooks.on("updateTile", function updateTile(document, changes) {
	if (document.getFlag(MOD_NAME, SWARM_FLAG)) {
		const swarm = document.object?.swarm;
		if (!swarm || (swarmNeedsRefresh(changes) && document.object)) {
			createSwarm(document.object);
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
	} else if (document.object?.swarm) {
		document.object.swarm.restoreOriginal();
	}
});

/**
 * Options for refreshing tile visuals.
 * @typedef {Object} TileRefreshOptions
 * @property {boolean} [refreshElevation]
 * @property {boolean} [refreshFrame]
 * @property {boolean} [refreshMesh]
 * @property {boolean} [refreshPerception]
 * @property {boolean} [refreshPosition]
 * @property {boolean} [refreshRotation]
 * @property {boolean} [refreshSize]
 * @property {boolean} [refreshState]
 * @property {boolean} [refreshVideo]
 */

Hooks.on(
	"refreshTile",
	/**
	 * @param {Tile} token
	 * @param {TileRefreshOptions} changes
	 */
	function swarmsRefreshTile(tile, changes) {
		if (tile.document.getFlag(MOD_NAME, SWARM_FLAG)) {
			if (!tile.swarm || changes.refreshMesh) {
				createSwarm(tile);
			}
		} else if (tile.swarm && tile.originalMesh) {
			tile.swarm.restoreOriginal();
		}
	}
);

Hooks.on("destroyTile", function swarmsDestroyTile(tile) {
	if (tile.mesh instanceof SwarmMesh) {
		canvas.primary.removeChild(tile.mesh);
	}
	tile.swarm?.destroy();
});

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

	libWrapper.register(
		MOD_NAME,
		"PrimaryCanvasGroup.prototype.addToken",
		// Creates a mesh for the token and adds to the canvas groups children.
		// What is returned will be set as token.mesh
		function swarmsAddToken(wrapped, token) {
			token.originalMesh = wrapped(token);
			if (!token.document.getFlag(MOD_NAME, SWARM_FLAG)) {
				return token.originalMesh;
			}
			token.swarmMesh = new SwarmMesh(token, token.document);
			this.addChild(token.swarmMesh);
			return token.swarmMesh;
		}
	);

	libWrapper.register(
		MOD_NAME,
		"PrimaryCanvasGroup.prototype.addTile",
		// Creates a mesh for the tile and adds to the canvas groups children.
		// What is returned will be set as tile.mesh
		function swarmsAddTile(wrapped, tile) {
			tile.originalMesh = wrapped(tile);
			if (!tile.document.getFlag(MOD_NAME, SWARM_FLAG)) {
				return tile.originalMesh;
			}
			tile.swarmMesh = new SwarmMesh(tile, tile.document);
			this.addChild(tile.swarmMesh);
			return tile.swarmMesh;
		}
	);

	CONFIG.debug.canvas.primary.swarms = false;
});
