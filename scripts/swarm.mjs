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

/** Ease-out with slight overshoot — snappy shift then settle. */
function _easeOutBack(p) {
	const q = p - 1;
	return 1 + 1.4 * q * q * q + q * q;
}

/**
 * Whether Foundry v14+ API is available.
 */
const IS_V14 = !!foundry.canvas?.primary?.PrimaryCanvasContainer;

class SwarmMesh extends PrimarySpriteMesh {
	constructor(object, document) {
		if (IS_V14) {
			// v14: PrimarySpriteMesh expects {name, object, texture, shaderClass}
			super({
				object,
				name: `swarm.${object.objectId ?? object.id}`,
				texture: object.texture ?? PIXI.Texture.EMPTY
			});
		} else {
			super(object, document);
		}
		// Prevent culling from skipping child rendering when the mesh itself draws nothing
		this.cullable = false;
	}

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

		// Cache settings and lookups that don't change per frame
		this._isGM = game.user.isGM;
		this._gridSize = game.canvas.grid.size;
		this._fadeTime = game.settings.get(MOD_NAME, SETTING_FADE_TIME);
		this._stopTime = game.settings.get(MOD_NAME, SETTING_STOP_TIME);
		this._isTeleport = !this.isTile && CONFIG.Token.movement.actions[this.document.movementAction]?.teleport;
		this._localSize = { w: 0, h: 0, scaleX: 0, scaleY: 0 };
		this._scaleCompensation = 1;

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
		// Track the mesh's world position to detect movement between frames
		this.lastWorldPos = { x: this.layer.position.x, y: this.layer.position.y };

		if (!canvas.primary.children.includes(object.swarmMesh)) {
			canvas.primary.addChild(object.swarmMesh);
		}
		// Update the Map entry so the tracked mesh has a valid parent/transform
		const meshMap = this.isTile ? canvas.primary.tiles : canvas.primary.tokens;
		if (meshMap) meshMap.set(object.objectId, object.swarmMesh);
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
	 * Update cached object-local (unscaled) dimensions that compensate for the object mesh scale.
	 * Only recalculates when scale has changed.
	 */
	_updateLocalSize() {
		const mesh = this.object?.mesh;
		const scaleX = mesh?.scale?.x ?? 1;
		const scaleY = mesh?.scale?.y ?? scaleX;
		if (scaleX === this._localSize.scaleX && scaleY === this._localSize.scaleY) return;
		this._localSize.w = (this.isTile ? this.object.bounds.width : this.object.w) / scaleX;
		this._localSize.h = (this.isTile ? this.object.bounds.height : this.object.h) / scaleY;
		this._localSize.scaleX = scaleX;
		this._localSize.scaleY = scaleY;

		// Cache scale compensation so move() and destination methods don't recompute per tick.
		const docScaleX = Math.abs(this.object?.document?.texture?.scaleX ?? 1);
		const docScaleY = Math.abs(this.object?.document?.texture?.scaleY ?? docScaleX);
		this._scaleCompensation = 1 / Math.max(0.01, (docScaleX + docScaleY) / 2);
	}

	/**
	 * Return object-local (unscaled) dimensions that compensate for the object mesh scale.
	 * Use these for position/destination math so object.scale only changes visual size.
	 * @returns {{w:number,h:number,scaleX:number,scaleY:number}}
	 */
	_getLocalSize() {
		return this._localSize;
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
				case ANIM_TYPE_CIRCULAR:
				case ANIM_TYPE_SPIRAL:
					sf *= 1.2;
					break;
				case ANIM_TYPE_SKITTER:
				case ANIM_TYPE_STOPNMOVE:
				case ANIM_TYPE_FORMATION_SQUARE:
				default:
					break;
			}

			// Add 50% of the speed as variability on each sprites speed
			this.speeds.push(sf * 5 + sf * Math.random() * 0.5);
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
		const count = Math.abs(this.visible - this.number);
		// step, corresponding to the module setting "fade time", also, prevent division by zero
		return this._fadeTime == 0 ? count : (ms * count) / (this._fadeTime * 1000);
	}

	#getScale(sprite) {
		if (!sprite?.texture?.valid) return;

		// 1) Texture dimensions (protect against zero)
		const texW = Math.max(1, sprite.texture.width);
		const texH = Math.max(1, sprite.texture.height);
		const smax = Math.max(texW, texH);

		// 2) Set DESIRED_WORLD_SIZE_PX to the canvas grid size.
		const DESIRED_WORLD_SIZE_PX = this._gridSize;

		// 3) The base scale that would make the texture's largest side equal DESIRED_WORLD_SIZE_PX.
		const baseScale = DESIRED_WORLD_SIZE_PX / smax;

		// 4) Token scale (the only thing we want to *allow* to change sprite size).
		let docScaleX = this.object?.document?.texture?.scaleX ?? 1;
		let docScaleY = this.object?.document?.texture?.scaleY ?? docScaleX;

		// 4.5) Square docScale to allow for greater range of values.
		if (docScaleX < 1 || docScaleY < 1) {
			docScaleX = docScaleX * docScaleX;
			docScaleY = docScaleY * docScaleY;
		}

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
		if (!this.object.texture?.valid) {
			return;
		}

		// Update cached local size (only recalculates when scale changes)
		this._updateLocalSize();

		if (!this.created) {
			this.createSprites(this.maxSprites); // Use maxSprites instead of number
		}

		t = Math.min(t, 2.0); // Cap frame skip to two frames
		// Milliseconds elapsed, as calculated using the "time" fraction and an optimistic 60fps
		const ms = t * 1000 * (1.0 / 60);

		// Movement compensation: make sprites trail behind during token movement
		const curX = this.layer.position.x;
		const curY = this.layer.position.y;
		const worldDeltaX = curX - this.lastWorldPos.x;
		const worldDeltaY = curY - this.lastWorldPos.y;

		if (!this._isTeleport && (worldDeltaX !== 0 || worldDeltaY !== 0)) {
			// Skip compensation for large jumps (delta > 2x token size)
			const maxDelta = (this.isTile ? this.object.bounds.width : this.object.w) * 2;
			if (worldDeltaX * worldDeltaX + worldDeltaY * worldDeltaY < maxDelta * maxDelta) {
				const scaleX = this.layer.scale.x || 1;
				const scaleY = this.layer.scale.y || 1;
				const localOffsetX = -worldDeltaX / scaleX;
				const localOffsetY = -worldDeltaY / scaleY;

				for (let i = 0; i < this.sprites.length; ++i) {
					this.sprites[i].x += localOffsetX;
					this.sprites[i].y += localOffsetY;
				}
			}
		}
		this.lastWorldPos.x = curX;
		this.lastWorldPos.y = curY;

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

			for (let i = 0; i < this.sprites.length; ++i) {
				const sprite = this.sprites[i];
				const hpVisible = i >= remaining;
			const hpMissing = i < this.maxSprites - this.number;
			sprite.alpha = hpVisible ? 1 : this.faded && this._isGM && !hpMissing ? 0.2 : 0;
				const scale = getScale(sprite);
				if (scale) {
					sprite.scale.set(scale.x, scale.y);
				}
				if (this.document.texture.tint) {
					this.tint = sprite.tint = this.document.texture.tint;
				}
			}
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
		} else {
			this.debug.tl.x = 0;
			this.debug.tl.y = 0;
		}
		const { w, h } = this._getLocalSize();
		if (!this.debug.br) {
			this.debug.br = new PIXI.Text("", {
				fontSize: 72,
				align: "center",
				x: w,
				y: h
			});
			this.layer.addChild(this.debug.br);
		} else {
			this.debug.br.x = w;
			this.debug.br.y = h;
		}
		const drawLine = (line, i) => {
			const sprite = this.sprites[i];
			const { x, y } = this.dest[i];
			line.clear();
			line.lineStyle(4, 0xffd900, 1);
			line.moveTo(sprite.x, sprite.y);
			line.lineTo(x, y);
			line.endFill();
		};
		if (!this.debug.destinations) {
			this.debug.destinations = this.dest.map(({ x, y }, i) => {
				const text = new PIXI.Text(`d${i}`, {
					fontSize: 72,
					align: "center",
					x,
					y
				});
				this.layer.addChild(text);
				const line = new PIXI.Graphics();
				drawLine(line, i);
				this.layer.addChild(line);
				return { text, line };
			});
		} else {
			this.debug.destinations.forEach(({ text, line }, i) => {
				const { x, y } = this.dest[i];
				text.x = x;
				text.y = y;
				drawLine(line, i);
			});
		}
		this.debug.br.text = `Speed:${this.speeds[0].toFixed(3)}, ${ms.toFixed(3)}ms`;
	}

	/**
	 * @param {boolean} hidden
	 */
	hide(hidden) {
		this.faded = hidden;
		if (hidden) {
			this.number = 0;
		} else {
			this.number = this.determineVisibleSprites(this.currentHPPercent, this.maxSprites);
		}
		// Apply immediately — no gradual fade for hide/show toggle
		this.visible = this.number;
		this.step = null;
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
		// Restore the Map entry so tracked mesh has a valid parent/transform
		const objectId = this.object.objectId;
		if (this.isTile) {
			if (canvas.primary.tiles) canvas.primary.tiles.set(objectId, this.object.mesh);
		} else {
			if (canvas.primary.tokens) canvas.primary.tokens.set(objectId, this.object.mesh);
		}
		this.object.refresh();
	}

	skitter(ms) {
		this.stopMoveStop(ms);

		// See if there are pcs that we should stick to.
		const pcs = canvas.tokens.placeables.filter((t) => t.actor.hasPlayerOwner);
		if (!pcs.length) return;

		const pcp = pcs.map((t) => t.center);
		const occ = pcs.map((t) => (0.55 * t.w) ** 2);
		const centerX = this.object.center.x;
		const centerY = this.object.center.y;

		for (let i = 0; i < this.sprites.length; ++i) {
			const s = this.sprites[i];
			// sprite's global position: convert from center-relative local -> global using object.center
			const spx = s.x + centerX;
			const spy = s.y + centerY;

			// Find nearest PC (inline argMin)
			let smallest = 0;
			let smallestDist2 = (spx - pcp[0].x) ** 2 + (spy - pcp[0].y) ** 2;
			for (let j = 1; j < pcp.length; ++j) {
				const d2 = (spx - pcp[j].x) ** 2 + (spy - pcp[j].y) ** 2;
				if (d2 < smallestDist2) {
					smallestDist2 = d2;
					smallest = j;
				}
			}

			if (smallestDist2 < occ[smallest]) {
				// We are "inside" a player
				const outX = spx - pcp[smallest].x;
				const outY = spy - pcp[smallest].y;
				const outLenSq = outX * outX + outY * outY;
				if (outLenSq > THETA) {
					const outLen = Math.sqrt(outLenSq);
					const normX = outX / outLen;
					const normY = outY / outLen;
					const distance_left_out = 0.1 + Math.sqrt(occ[smallest]) - Math.sqrt(smallestDist2);
					const push = 1.5 * distance_left_out;
					// convert back to local coordinates relative to object center
					this.dest[i].x = spx + normX * push - centerX;
					this.dest[i].y = spy + normY * push - centerY;
				}
			}
		}
	}

	stopMoveStop(ms) {
		const { w: localW, h: localH } = this._getLocalSize();

		for (let i = 0; i < this.sprites.length; ++i) {
			const s = this.sprites[i];
			const dx = this.dest[i].x - s.x;
			const dy = this.dest[i].y - s.y;
			if (dx * dx + dy * dy < SIGMA) {
				if (this.waiting[i] <= 0) {
					this.dest[i].x = Math.random() * localW - localW / 2;
					this.dest[i].y = Math.random() * localH - localH / 2;
					this.waiting[i] = Math.random() * this._stopTime * 1000;
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
		const centerX = localW / 2;
		const centerY = localH / 2;

		const cellW = localW / cols;
		const cellH = localH / rows;
		const cosA = Math.cos(angle);
		const sinA = Math.sin(angle);

		// Reuse cached grid arrays — only reallocate when sprite count changes
		if (!this._formGrid || this._formGrid.length !== n) {
			this._formGrid = new Array(n);
			for (let i = 0; i < n; ++i) this._formGrid[i] = { x: 0, y: 0 };
			this._formAssigned = new Array(n);
			this._formGridAssign = new Array(n);
			this._formGridAngle = -Infinity;
			this._formGridW = -1;
			this._formGridH = -1;
		}
		const gridPositions = this._formGrid;
		const assigned = this._formAssigned;
		const gridAssignments = this._formGridAssign;

		// Recompute grid positions only when angle or dimensions change
		if (angle !== this._formGridAngle || localW !== this._formGridW || localH !== this._formGridH) {
			this._formGridAngle = angle;
			this._formGridW = localW;
			this._formGridH = localH;
			for (let i = 0; i < n; ++i) {
				const row = Math.floor(i / cols);
				const indexInRow = i - row * cols;
				const itemsInThisRow = row === rows - 1 ? n - (rows - 1) * cols : cols;
				const rowOffsetX = (localW - itemsInThisRow * cellW) / 2;
				const tx = rowOffsetX + (indexInRow + 0.5) * cellW - centerX;
				const ty = (row + 0.5) * cellH - centerY;
				gridPositions[i].x = tx * cosA - ty * sinA;
				gridPositions[i].y = tx * sinA + ty * cosA;
			}
		}

		// Initialize independent shuffle slots — each has its own cooldown so they never synchronize
		const slotCount = Math.max(1, Math.floor(n / 12));
		if (!this._formShuffleSlots) {
			this._formShuffleSlots = [];
			for (let j = 0; j < slotCount; j++) {
				this._formShuffleSlots.push({
					cooldown: 6000 + Math.random() * 12000,
					index: -1,
					timer: 0,
					baseX: 0,
					baseY: 0
				});
			}
		}
		const slots = this._formShuffleSlots;
		while (slots.length < slotCount) {
			slots.push({ cooldown: 6000 + Math.random() * 12000, index: -1, timer: 0, baseX: 0, baseY: 0 });
		}

		// Check active shuffle indices directly from slots (avoids Set allocation)
		// Assign each sprite to the nearest available grid position
		// Visible sprites get front positions, invisible sprites get the rest
		for (let i = 0; i < n; ++i) assigned[i] = false;
		let settledCount = 0;
		const visibleCount = Math.round(this.visible);
		const backStart = Math.max(0, n - visibleCount);

		// Two passes: visible sprites assigned to back (bottom/front-facing) grid positions first,
		// then invisible sprites assigned to remaining top positions
		for (let pass = 0; pass < 2; ++pass) {
			for (let i = 0; i < n; ++i) {
				const sprite = this.sprites[i];
				const isVisible = sprite.alpha === 1;
				if (pass === 0 && !isVisible) continue;
				if (pass === 1 && isVisible) continue;

				let bestIdx = -1;
				let bestDistSq = Infinity;
				const searchStart = pass === 0 ? backStart : 0;
				const searchEnd = pass === 0 ? n : backStart;
				for (let j = searchStart; j < searchEnd; ++j) {
					if (assigned[j]) continue;
					const dx = gridPositions[j].x - sprite.x;
					const dy = gridPositions[j].y - sprite.y;
					const distSq = dx * dx + dy * dy;
					if (distSq < bestDistSq) {
						bestDistSq = distSq;
						bestIdx = j;
					}
				}
				// If preferred range is full (e.g. GM view where all sprites have alpha > 0),
				// spill into the complementary range
				if (bestIdx === -1) {
					const fallbackStart = pass === 0 ? 0 : backStart;
					const fallbackEnd = pass === 0 ? backStart : n;
					for (let j = fallbackStart; j < fallbackEnd; ++j) {
						if (assigned[j]) continue;
						const dx = gridPositions[j].x - sprite.x;
						const dy = gridPositions[j].y - sprite.y;
						const distSq = dx * dx + dy * dy;
						if (distSq < bestDistSq) {
							bestDistSq = distSq;
							bestIdx = j;
						}
					}
				}
				assigned[bestIdx] = true;
				gridAssignments[i] = bestIdx;

				// Skip normal destination for actively shuffling sprites
				let isShuffling = false;
				for (let s = 0; s < slots.length; ++s) {
					if (slots[s].index === i) {
						isShuffling = true;
						break;
					}
				}
				if (isShuffling) {
					sprite.rotation = angle;
					settledCount++;
					continue;
				}

				if (bestDistSq < SIGMA) {
					sprite.rotation = angle;
					settledCount++;
				} else {
					this.dest[i].x = gridPositions[bestIdx].x;
					this.dest[i].y = gridPositions[bestIdx].y;
				}
			}
		}

		// Process each shuffle slot independently
		const isSettled = settledCount >= n * 0.8;
		const baseDist = Math.min(cellW, cellH);

		for (let si = 0; si < slots.length; ++si) {
			const slot = slots[si];
			// Idle slot — tick its own cooldown independently
			if (slot.index === -1) {
				if (!isSettled) {
					slot.cooldown = 8000 + Math.random() * 10000;
					continue;
				}
				slot.cooldown -= ms;
				if (slot.cooldown > 0) continue;

				// Pick a random sprite not already shuffling via rejection sampling
				let idx;
				let attempts = n;
				do {
					idx = Math.floor(Math.random() * n);
					let taken = false;
					for (let s = 0; s < slots.length; ++s) {
						if (slots[s].index === idx) {
							taken = true;
							break;
						}
					}
					if (!taken) break;
					idx = -1;
				} while (--attempts > 0);
				if (idx === -1) {
					slot.cooldown = 1000;
					continue;
				}
				slot.index = idx;
				slot.timer = 0;
				const gi = gridAssignments[idx];
				slot.baseX = gridPositions[gi].x;
				slot.baseY = gridPositions[gi].y;

				// Randomize this shuffle's character, scaled by swarm speed
				const sf = this.document.getFlag(MOD_NAME, SWARM_SPEED_FLAG) ?? DEFAULT_SWARM_SPEED;
				const pace = 1 / Math.max(0.1, sf);
				slot.dist = baseDist * (0.08 + Math.random() * 0.14);
				slot.dir = Math.random() < 0.5 ? 1 : -1;
				const snap1 = (160 + Math.random() * 140) * pace;
				const hold1 = (300 + Math.random() * 300) * pace;
				const cross = (200 + Math.random() * 200) * pace;
				const hold2 = (300 + Math.random() * 300) * pace;
				const snap2 = (160 + Math.random() * 140) * pace;
				// Pre-compute phase endpoints
				slot.p1 = snap1;
				slot.p2 = snap1 + hold1;
				slot.p3 = snap1 + hold1 + cross;
				slot.p4 = snap1 + hold1 + cross + hold2;
				slot.p5 = snap1 + hold1 + cross + hold2 + snap2;
			}

			// Active slot — animate the shuffle
			if (slot.index >= 0) {
				// Cancel if formation starts moving
				if (!isSettled) {
					this.dest[slot.index].x = slot.baseX;
					this.dest[slot.index].y = slot.baseY;
					slot.index = -1;
					slot.cooldown = 8000 + Math.random() * 10000;
					continue;
				}

				const t = slot.timer;
				slot.timer += ms;

				let offset = 0;
				if (t < slot.p1) {
					offset = -_easeOutBack(t / slot.p1);
				} else if (t < slot.p2) {
					offset = -1;
				} else if (t < slot.p3) {
					offset = -1 + 2 * _easeOutBack((t - slot.p2) / (slot.p3 - slot.p2));
				} else if (t < slot.p4) {
					offset = 1;
				} else if (t < slot.p5) {
					offset = 1 - _easeOutBack((t - slot.p4) / (slot.p5 - slot.p4));
				}
				offset *= slot.dir;

				if (t >= slot.p5) {
					this.sprites[slot.index].x = slot.baseX;
					this.sprites[slot.index].y = slot.baseY;
					this.dest[slot.index].x = slot.baseX;
					this.dest[slot.index].y = slot.baseY;
					slot.index = -1;
					slot.cooldown = 8000 + Math.random() * 10000;
				} else {
					const d = offset * slot.dist;
					this.sprites[slot.index].x = slot.baseX + cosA * d;
					this.sprites[slot.index].y = slot.baseY + sinA * d;
					this.dest[slot.index].x = this.sprites[slot.index].x;
					this.dest[slot.index].y = this.sprites[slot.index].y;
				}
			}
		}
	}

	randSquare(ms) {
		const { w: localW, h: localH } = this._getLocalSize();

		// Scale the "too far" threshold so it accounts for the larger local coordinate
		// space at small document texture scales, preventing constant destination reassignment.
		const gamma = GAMMA * this._scaleCompensation;
		const gammaSq = gamma * gamma;

		for (let i = 0; i < this.sprites.length; ++i) {
			const s = this.sprites[i];
			const dx = this.dest[i].x - s.x;
			const dy = this.dest[i].y - s.y;
			const lenSq = dx * dx + dy * dy;
			if (lenSq < SIGMA * SIGMA || lenSq > gammaSq) {
				this.dest[i].x = Math.random() * localW - localW / 2;
				this.dest[i].y = Math.random() * localH - localH / 2;
			}
		}
	}

	/**
	 * Calculates sprite destinations to create a spiral animation.
	 * @param {number} ms - Milliseconds elapsed since the last frame.
	 */
	spiral(ms) {
		// Update a shared time variable for the animation.
		// 'ms / 30' scales the time progression.
		this.t += ms / 30;

		// Get the local dimensions of the swarm's bounding box.
		const { w: localW, h: localH } = this._getLocalSize();

		// Calculate the x and y radii for the spiral, based on the bounding box size.
		const rx = 0.5 * localW;
		const ry = 0.5 * localH;

		// Loop through each sprite to calculate its next destination.
		for (let i = 0; i < this.sprites.length; ++i) {
			// Calculate a unique time-based value for this sprite.
			// This uses the sprite's individual speed and a random offset to
			// make each sprite's movement slightly different.
			const t = this.speeds[i] * this.t * 0.002 + this.offsets[i];

			// Determine the sprite's position on a flattened ellipse.
			// 'y' is scaled by 0.4, making the ellipse wider than it is tall.
			const x = Math.cos(t);
			const y = 0.4 * Math.sin(t);

			// Calculate a rotation angle for the entire elliptical path.
			// This makes the whole spiral appear to rotate over time.
			const angle = t / (2 * Math.E);
			const ci = Math.cos(angle); // cosine of the rotation angle
			const si = Math.sin(angle); // sine of the rotation angle

			// Apply the rotation to the sprite's elliptical coordinates and scale by the radii.
			// This is a standard 2D rotation transformation.
			const final_x = rx * x * ci - ry * y * si;
			const final_y = rx * x * si + ry * y * ci;

			// Set the calculated position as the new destination for this sprite.
			// The separate `move()` function will handle the animation toward this point.
			this.dest[i].x = final_x;
			this.dest[i].y = final_y;
		}
	}

	circular(ms) {
		this.t += ms / 30;
		const { w: localW, h: localH } = this._getLocalSize();

		const _rx = 0.5 * localW;
		const _ry = 0.5 * localH;

		for (let i = 0; i < this.sprites.length; ++i) {
			const t = this.t * 0.002 + this.offsets[i];
			const rY = 0.5 + 0.5 * (Math.sin(t * 0.3) + 0.3 * Math.sin(2 * t + 0.8) + 0.26 * Math.sin(3 * t + 0.8));
			const x = Math.cos(t * this.speeds[i]);
			const y = rY * Math.sin(t * this.speeds[i]);

			const ci = Math.cos(this.offsets[i]);
			const si = Math.sin(this.offsets[i]);

			const final_x = _rx * x * ci - _ry * y * si;
			const final_y = _rx * x * si + _ry * y * ci;

			this.dest[i].x = final_x;
			this.dest[i].y = final_y;
		}
	}

	move(ms) {
		// Base desired world speed (pixels per millisecond) *before per-sprite variation.
		const BASE_WORLD_SPEED_PX_PER_MS = 0.3;
		const scaleCompensation = this._scaleCompensation;
		for (let i = 0; i < this.sprites.length; ++i) {
			const sprite = this.sprites[i];
			const dest = this.dest[i];
			const dx = dest.x - sprite.x;
			const dy = dest.y - sprite.y;
			const distSq = dx * dx + dy * dy;
			if (distSq > THETA) {
				const dist = Math.sqrt(distSq);
				const speed = BASE_WORLD_SPEED_PX_PER_MS * this.speeds[i] * ms * scaleCompensation;
				if (speed * speed >= distSq) {
					sprite.x = dest.x;
					sprite.y = dest.y;
				} else {
					const factor = speed / dist;
					sprite.x += dx * factor;
					sprite.y += dy * factor;
				}
				sprite.rotation = -Math.PI / 2 + Math.atan2(dy, dx);
			}
		}
	}
}

function createSwarm(object) {
	object.swarm?.destroy();
	if (!object.texture?.valid) {
		return;
	}
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
	const pcg = foundry?.canvas?.groups?.PrimaryCanvasGroup
		? "foundry.canvas.groups.PrimaryCanvasGroup"
		: "PrimaryCanvasGroup";

	libWrapper.register(
		MOD_NAME,
		`${pcg}.prototype.addToken`,
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
		`${pcg}.prototype.addTile`,
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
