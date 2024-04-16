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
const MOD_NAME = "swarm";
const SWARM_FLAG = "isSwarm";
const SWARM_SIZE_FLAG = "swarmSize";
const SWARM_SPEED_FLAG = "swarmSpeed";
const SWARM_IMAGE_FLAG = "swarmImage";

const ANIM_TYPE_FLAG = "animation";
const ANIM_TYPE_CIRCULAR = "circular";
const ANIM_TYPE_RAND_SQUARE = "random";
const ANIM_TYPE_SPIRAL = "spiral";
const ANIM_TYPE_SKITTER = "skitter";
const ANIM_TYPE_STOPNMOVE = "move_stop_move";
const ANIM_TYPE_FORMATION_SQUARE = "formation";
const ANIM_TYPES = [
	ANIM_TYPE_CIRCULAR,
	ANIM_TYPE_RAND_SQUARE,
	ANIM_TYPE_SPIRAL,
	ANIM_TYPE_SKITTER,
	ANIM_TYPE_STOPNMOVE,
	ANIM_TYPE_FORMATION_SQUARE
];

const OVER_FLAG = "swarmOverPlayers";
const SETTING_HP_REDUCE = "reduceSwarmWithHP";
const SETTING_HP_REDUCE_ATTRIBUTE_VALUE = "attributeHpValue";
const SETTING_HP_REDUCE_ATTRIBUTE_MAX = "attributeHpMax";
const SETTING_FADE_TIME = "fadeTime";
const SETTING_STOP_TIME = "stopTime";
const SETTING_MIGRATED_TO = "migratedTo";
const theta = 0.01;
const SIGMA = 5;
const GAMMA = 1000;
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

	switch (game.system.id) {
		case "pf1":
		case "pf2e":
		case "dnd5e":
		case "D35E":
			return token.actor.system.attributes.hp.value / token.actor.system.attributes.hp.max;
		default:
			let hpValue = Object.byString(token, game.settings.get(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_VALUE));
			let hpMax = Object.byString(token, game.settings.get(MOD_NAME, SETTING_HP_REDUCE_ATTRIBUTE_MAX));
			if (hpValue && hpMax) {
				return hpValue / hpMax;
			} else {
				console.warn("No health estimate implemented for system", game.system.id);
			}
	}
}

const SWARMS = {};
// TODO: Remove debug accessor
window.SWARMS = SWARMS;

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
		this.ofsets = [];
		this.waiting = [];
		this.layer = new PIXI.Container();

		// this.randomRotation = true;
		this.faded = document.hidden;
		this.visible = this.faded ? 0 : this.number;
		this.spriteAlpha = document.alpha;

		const swarm = this;

		Object.defineProperty(document, "alpha", {
			get() {
				return 0;
			},
			set(v) {
				if (!document.hidden) {
					swarm.spriteAlpha = v;
				}
			},
			configurable: true,
			enumerable: true
		});
		token.alpha = 0;

		this.layer.elevation = document.getFlag(MOD_NAME, OVER_FLAG) ? 10000 : 0;
		this.layer.sort = 120; // Above tiles at 100
		this.layer.alpha = token.isVisible ? this.spriteAlpha : 0;
		canvas.primary.addChild(this.layer);

		this.created = false;

		this.tick = new PIXI.Ticker();
		const anim = document.getFlag(MOD_NAME, ANIM_TYPE_FLAG);
		this.set_destinations = this.circular;
		switch (anim) {
			case ANIM_TYPE_CIRCULAR:
				this.set_destinations = this.circular;
				break;
			case ANIM_TYPE_RAND_SQUARE:
				this.set_destinations = this.randSquare;
				break;
			case ANIM_TYPE_SPIRAL:
				this.set_destinations = this.spiral;
				break;
			case ANIM_TYPE_SKITTER:
				this.set_destinations = this.skitter;
				break;
			case ANIM_TYPE_STOPNMOVE:
				this.set_destinations = this.stopMoveStop;
				break;
			case ANIM_TYPE_FORMATION_SQUARE:
				this.set_destinations = this.formSquare;
				// this.randomRotation = false;
				break;
		}
		this.tick.add(this.anim.bind(this));
		this.tick.start();
		Hooks.call("createSwarm", this);
	}

	async createSprites(number) {
		const use_random_image = this.token.actor.prototypeToken.randomImg;
		const hidden = this.document.hidden;

		const images = [];
		if (use_random_image) {
			images = await swarm_socket.executeAsGM("wildcards", token.id);
		} else {
			images.push(this.document.texture.src);
		}

		for (let i = 0; i < number; ++i) {
			// waiting times, only used for stop-move
			this.waiting.push(0);
			// Random offset
			this.ofsets.push(Math.random() * 97);
			// Pick an image from the list at random
			let img = images[Math.floor(Math.random() * images.length)];
			let s = PIXI.Sprite.from(img);
			s.anchor.set(0.5);

			// Sprites initial position, a random position within this tokens area
			s.x = this.token.x + Math.random() * this.token.w;
			s.y = this.token.y + Math.random() * this.token.h;
			// Hidden initially?
			s.alpha = hidden ? 0 : 1;

			// A callback to start the video
			const start = () => {
				// Check if the texture selected is a video, and potentially start it
				const src = s.texture.baseTexture.resource.source;
				src.loop = true;
				src.muted = true; // Autostarting videos must explicitly be muted (chrome restriction)
				if (src.play) src.play();
			};
			if (s.texture.baseTexture.valid) {
				start();
			} else {
				s.texture.baseTexture.on("loaded", start);
			}
			// Set the initial destination to its initial position
			this.dest.push({ x: s.x, y: s.y });
			this.sprites.push(s);
			let sf = this.document.getFlag(MOD_NAME, SWARM_SPEED_FLAG);
			if (sf === undefined) sf = 1;
			// Add 50% of the speed as variability on each sprites speed
			this.speeds.push(sf * 0.5 + sf * Math.random() * 0.5);
			// Add this sprite to the correct layer
			this.layer.addChild(s);
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
		if (!this.created) {
			this.createSprites(this.maxSprites); // Use maxSprites instead of number
		}

		t = Math.min(t, 2.0); // Cap frame skip to two frames
		// Milliseconds elapsed, as calculated using the "time" fraction and current fps
		const ms = t * 1000 * (1.0 / this.tick.FPS);

		const getScale = (s) => {
			// Get the largest dimension, and scale around that
			const smax = Math.max(s.texture.width, s.texture.height);
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
				updateSprites = this.scale.x !== scale.x || this.scale.y !== scale.y;
			}
			if (!updateSprites) {
				updateSprites = this.sprites[0].spriteAlpha !== this.spriteAlpha;
			}
		}

		if (updateSprites) {
			const remaining = Math.round(this.maxSprites - this.visible);
			this.sprites.forEach((s, i) => {
				s.alpha = i >= remaining ? this.spriteAlpha : this.faded && game.user.isGM ? this.spriteAlpha * 0.2 : 0;
				s.spriteAlpha = this.spriteAlpha;
				this.scale = getScale(s);
				s.scale.x = this.scale.x;
				s.scale.y = this.scale.y;
				if (this.document.texture.tint) {
					this.tint = s.tint = this.document.texture.tint;
				}
			});
		}

		// Calling the animation specific method, set_destination
		this.set_destinations(ms);
		// Calling the generic move method
		this.move(ms);
		this.created = true;
		// Keep rotation
		// if (!this.randomRotation){
		//     this.rotation(this.token.document.rotation);
		// }
	}

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

	destroy() {
		Hooks.call("preDestroySwarm", this);
		for (let s of this.sprites) {
			s.destroy();
		}
		this.tick.destroy();
		this.layer.destroy();
		Object.defineProperty(this.document, "alpha", {
			value: this.spriteAlpha,
			configurable: true,
			enumerable: true,
			writable: true
		});
		Hooks.call("destroySwarm", this);
	}

	skitter(ms) {
		this.stopMoveStop(ms);

		let pcs = canvas.tokens.placeables.filter((t) => t.actor.hasPlayerOwner);
		let pcp = pcs.map((t) => t.center);
		let occ = pcs.map((t) => (0.55 * t.w) ** 2);

		if (pcs.length > 0) {
			for (let i = 0; i < this.sprites.length; ++i) {
				let s = this.sprites[i];
				let sp = { x: s.x, y: s.y };
				let dists2 = pcp.map((p) => {
					return (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
				});
				let smallest = utils.argMin(dists2);
				if (dists2[smallest] < occ[smallest]) {
					// We are "inside" a player
					let out = utils.vSub(sp, pcp[smallest]);
					if (out.x ** 2 + out.y ** 2 > theta) {
						let shortest_direction_out_normed = utils.vNorm(out);
						let distance_left_out = 0.1 + Math.sqrt(occ[smallest]) - Math.sqrt(dists2[smallest]);
						this.dest[i] = utils.vAdd(
							sp,
							utils.vMult(shortest_direction_out_normed, 1.5 * distance_left_out)
						);
					}
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
					let x = this.token.x + Math.random() * this.token.w;
					let y = this.token.y + Math.random() * this.token.h;
					this.dest[i] = { x: x, y: y };
					this.waiting[i] = Math.random() * game.settings.get(MOD_NAME, SETTING_STOP_TIME) * 1000;
				} else {
					this.waiting[i] -= ms;
				}
			}
		}
	}

	formSquare(ms) {
		//Calculate length and width
		let a = Math.ceil(Math.sqrt(this.sprites.length)); //Number of rows
		let b = Math.ceil(this.sprites.length / a); //Vertical number
		let c = a - (a * b - this.sprites.length); //last row
		let angle = this.token.document.rotation * (Math.PI / 180);
		let center = this.token.center;

		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			// Calculate the coordinate position in a square matrix
			let x = this.token.x + (this.token.w / a) * (((i - c) % a) + 0.5);
			let y = this.token.y + (this.token.h / b) * (Math.floor((i - c) / a) + 1.5);
			// separate treatment for the first row
			if (c > 0 && i < c) {
				x = this.token.x + (this.token.w / c) * ((i % c) + 0.5);
			}

			//Rotate the square matrix following the token direction
			let x3 = (x - center.x) * Math.cos(angle) - (y - center.y) * Math.sin(angle) + center.x;
			let y3 = (x - center.x) * Math.sin(angle) + (y - center.y) * Math.cos(angle) + center.y;
			x = x3;
			y = y3;

			//Turn to the direction of the token when it is close enough to where it should be in the square.
			let d = utils.vSub({ x: x, y: y }, { x: s.x, y: s.y });
			let len = utils.vLen(d);
			if (len < SIGMA) {
				s.rotation = angle;
			} else {
				this.dest[i] = { x: x, y: y };
			}
		}
	}

	randSquare(ms) {
		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });
			let len = utils.vLen(d);
			if (len < SIGMA || len > GAMMA) {
				let x = this.token.x + Math.random() * this.token.w;
				let y = this.token.y + Math.random() * this.token.h;
				this.dest[i] = { x: x, y: y };
			}
		}
	}
	spiral(ms) {
		this.t += ms / 30;
		let rx = 0.5 * this.token.w;
		let ry = 0.5 * this.token.h;
		for (let i = 0; i < this.sprites.length; ++i) {
			let t = this.speeds[i] * this.t * 0.02 + this.ofsets[i];
			let x = Math.cos(t);
			let y = 0.4 * Math.sin(t);

			let ci = Math.cos(t / (2 * Math.E));
			let si = Math.sin(t / (2 * Math.E));
			this.dest[i] = {
				x: rx * (ci * x - si * y) + this.token.center.x,
				y: ry * (si * x + ci * y) + this.token.center.y
			};
		}
	}
	circular(ms) {
		this.t += ms / 30;
		let _rx = 1 * 0.5 * this.token.w;
		let _ry = 1 * 0.5 * this.token.h;

		for (let i = 0; i < this.sprites.length; ++i) {
			let t = this.t * 0.02 + this.ofsets[i];
			let rY =
				1 *
				(0.5 + 0.5 * (1.0 * Math.sin(t * 0.3) + 0.3 * Math.sin(2 * t + 0.8) + 0.26 * Math.sin(3 * t + 0.8)));
			let x = Math.cos(t * this.speeds[i]);
			let y = rY * Math.sin(t * this.speeds[i]);

			let ci = Math.cos(this.ofsets[i]);
			let si = Math.sin(this.ofsets[i]);
			let rx = _rx * (ci * x - si * y);
			let ry = _ry * (si * x + ci * y);

			this.dest[i] = {
				x: rx + this.token.center.x,
				y: ry + this.token.center.y
			};
		}
	}

	move(ms) {
		for (let i = 0; i < this.sprites.length; ++i) {
			let s = this.sprites[i];
			let d = utils.vSub(this.dest[i], { x: s.x, y: s.y });

			if (d.x ** 2 + d.y ** 2 > theta) {
				let mv = utils.vNorm(d);
				mv = utils.vMult(mv, 0.05 * ms * this.speeds[i] * 4);
				if (mv.x ** 2 + mv.y ** 2 > d.x ** 2 + d.y ** 2) {
					mv = d;
				}
				s.x += mv.x;
				s.y += mv.y;
				s.rotation = -Math.PI / 2 + utils.vRad(d);
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

function hideSwarmOnToken(token, hide) {
	if (token.id in SWARMS) {
		SWARMS[token.id].hide(hide);
	}
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
		if (swarmNeedsRefresh(changes) && document.object) {
			createSwarmOnToken(document.object);
		}
		if (changes.hidden != undefined) {
			hideSwarmOnToken(document, changes.hidden);
		}
	}
});

Hooks.on("renderTokenConfig", (renderConfig) => {
	const document = renderConfig.token;
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
		if (closeConfig.token.id === document.id) {
			Hooks.off("drawToken", onDrawToken);
			const { token: document } = closeConfig;
			const token = document.object;
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

// Create token
Hooks.on("createToken", (token, options, user_id) => {
	if (token.getFlag(MOD_NAME, SWARM_FLAG) === true) {
		createSwarmOnToken(token.object);
	}
});

Hooks.on("ready", async () => {
	if (game.settings.get(MOD_NAME, SETTING_MIGRATED_TO) < 11.0) {
		ui.notifications.notify(`Migrating to Swarms version 11.  Please don't refresh your browser.`);
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
			`Migration to Swarms version 11 complete. Updated ${actors.length} actor(s) and ${tokenCount} token(s).`
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

Hooks.on("sightRefresh", (canvasVisibility) => {
	if (canvasVisibility.tokenVision) {
		const swarmedTokens = getSwarmingTokens();
		for (let t of swarmedTokens) {
			const swarm = SWARMS[t.id];
			if (swarm) {
				// Swarm might not exist if just been updated
				swarm.layer.alpha = t.isVisible ? swarm.spriteAlpha : 0;
			}
		}
	}
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

	game.settings.register(MOD_NAME, SETTING_MIGRATED_TO, {
		name: "Migrations",
		scope: "world",
		config: false,
		type: Number,
		default: 0
	});
});

/*
 █████  █████ █████
░░███  ░░███ ░░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░███   ░███  ░███ 
░░████████   █████
 ░░░░░░░░   ░░░░░  */

function createLabel(text) {
	const label = document.createElement("label");
	label.textContent = text;
	return label;
}

function dropDownConfig(parent, app, flag_name, title, values, default_value = null) {
	let flags = app.token.flags;
	if (flags === undefined) flags = app.token.data.flags;

	let cur = flags?.[MOD_NAME]?.[flag_name];
	//parent.append(createLabel(title));
	const input = document.createElement("select");
	input.name = "flags." + MOD_NAME + "." + flag_name;
	input.style.width = "50px";

	for (let o of values) {
		let opt = document.createElement("option");
		opt.innerText = o;
		if (cur === o) opt.classList.add("selected");
		input.append(opt);
	}
	input.value = cur;

	parent.append(input);
}

function textBoxConfig(
	parent,
	app,
	flag_name,
	title,
	type = "number",
	placeholder = null,
	default_value = null,
	step = null
) {
	let flags = app.token.flags;
	if (flags === undefined) flags = app.token.data.flags;

	parent.append(createLabel(title));
	const input = document.createElement("input");
	input.name = "flags." + MOD_NAME + "." + flag_name;
	input.type = type;
	if (step) input.step = step;
	if (placeholder) input.placeholder = placeholder;

	if (flags?.[MOD_NAME]?.[flag_name]) {
		input.value = flags?.[MOD_NAME]?.[flag_name];
	} else if (default_value != null) {
		input.value = default_value;
	}
	parent.append(input);
}

function createCheckBox(app, fields, data_name, title, hint) {
	const label = document.createElement("label");
	label.textContent = title;
	const input = document.createElement("input");
	input.name = "flags." + MOD_NAME + "." + data_name;
	input.type = "checkbox";
	input.title = hint;

	if (app.token.getFlag(MOD_NAME, data_name)) {
		input.checked = "true";
	}

	fields.append(label);
	fields.append(input);
}
function imageSelector(app, flag_name, title) {
	let data_path = "flags." + MOD_NAME + "." + flag_name;

	let flags = app.token.flags;
	if (flags === undefined) flags = app.token.data.flags;

	let grp = document.createElement("div");
	grp.classList.add("form-group");
	let label = document.createElement("label");
	label.innerText = title;
	let fields = document.createElement("div");
	fields.classList.add("form-fields");

	const button = document.createElement("button");
	button.classList.add("file-picker");
	button.type = "button";
	button.title = "Browse Files";
	button.tabindex = "-1";
	button.dataset.target = data_path;
	button["data-type"] = "imagevideo";
	button["data-target"] = data_path;

	button.onclick = app._activateFilePicker.bind(app);

	let bi = document.createElement("i");
	bi.classList.add("fas");
	bi.classList.add("fa-file-import");
	bi.classList.add("fa-fw");

	const inpt = document.createElement("input");
	inpt.name = data_path;
	inpt.classList.add("image");
	inpt.type = "text";
	inpt.title = title;
	inpt.placeholder = "path/image.png";
	// Insert the flags current value into the input box
	if (flags?.[MOD_NAME]?.[flag_name]) {
		inpt.value = flags?.[MOD_NAME]?.[flag_name];
	}

	button.append(bi);

	grp.append(label);
	grp.append(fields);

	fields.append(button);
	fields.append(inpt);
	return grp;
}

// Hook into the token config render
Hooks.on("renderTokenConfig", (app, html) => {
	if (!game.user.isGM) return;

	// Create a new form group
	const formGroup = document.createElement("div");
	formGroup.classList.add("form-group");
	formGroup.classList.add("slim");

	// Create a label for this setting
	const label = document.createElement("label");
	label.textContent = "Swarm";
	formGroup.prepend(label);

	// Create a form fields container
	const formFields = document.createElement("div");
	formFields.classList.add("form-fields");
	formGroup.append(formFields);

	createCheckBox(app, formFields, SWARM_FLAG, "", "");
	createCheckBox(app, formFields, OVER_FLAG, "Over", "Check if the swarm should be placed over players.");
	textBoxConfig(formFields, app, SWARM_SIZE_FLAG, "Count", "number", 20, 20, 1);
	textBoxConfig(formFields, app, SWARM_SPEED_FLAG, "Speed", "number", 1.0, 1.0, 0.1);
	dropDownConfig(formFields, app, ANIM_TYPE_FLAG, "anim", ANIM_TYPES, ANIM_TYPE_CIRCULAR);

	// Add the form group to the bottom of the Identity tab
	html[0].querySelector("div[data-tab='character']").append(formGroup);

	// Add difference swarm image
	//const swarmImage = imageSelector(app, SWARM_IMAGE_FLAG, "Token for Swarm mobs");
	// And add the token image selectors to the 'apperance' tab
	//html[0].querySelector("div[data-tab='appearance']").append(swarmImage);

	// Set the apps height correctly
	app.setPosition();
});
