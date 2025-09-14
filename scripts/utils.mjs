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

/**
 * @typedef {Object} Vector
 * @property {Number} x
 * @property {Number} y
 */

/**
 * @param {*} value prepended value
 * @param {Array} array
 * @returns {Array} new array with value prepended
 */
export function prepend(value, array) {
	var newArray = array.slice();
	newArray.unshift(value);
	return newArray;
}

/**
 * Negate a vector
 * @param {Vector} p
 * @returns {Vector}
 */
export function vNeg(p) {
	// Return -1*v
	return { x: -p.x, y: -p.y };
}
/**
 * Add two vectors
 * @param {Vector} p1
 * @param {Vector} p2
 * @returns {Vector}
 */
export function vAdd(p1, p2) {
	// Return the sum, p1 + p2
	return { x: p1.x + p2.x, y: p1.y + p2.y };
}
/**
 * Subtract one vector from another
 * @param {Vector} p1
 * @param {Vector} p2
 * @returns {Vector}
 */
export function vSub(p1, p2) {
	// Return the difference, p1-p2
	return { x: p1.x - p2.x, y: p1.y - p2.y };
}
/**
 * Multiply a vector, p, with a number, v
 * @param {Vector} p
 * @param {Number} v
 * @returns {Vector}
 */
export function vMult(p, v) {
	// Multiply vector p with value v
	return { x: p.x * v, y: p.y * v };
}
/**
 * The dot product of two vectors.
 * @param {Vector} p1
 * @param {Vector} p2
 * @returns {Number}
 */
export function vDot(p1, p2) {
	// Return the dot product of p1 and p2
	return p1.x * p2.x + p1.y * p2.y;
}
/**
 * The length of a vector, p
 * @param {Vector} p
 * @returns {Number}
 */
export function vLen(p) {
	// Return the length of the vector p
	return Math.sqrt(p.x ** 2 + p.y ** 2);
}
/**
 * Returns the normalized vector of p
 * @param {Vector} p
 * @returns {Vector}
 */
export function vNorm(p) {
	// Normalize the vector p, p/||p||
	return vMult(p, 1.0 / vLen(p));
}
/**
 * The angle matching the vector p
 * @param {Vector} p
 * @returns {Number}
 */
export function vAngle(p) {
	// The foundry compatible 'rotation angle' to point along the vector p
	return 90 + Math.toDegrees(Math.atan2(p.y, p.x));
}
/**
 * The angle matching the vector p
 * @param {Vector} p
 * @returns {Number} The foundry compatible 'rotation angle' to point along the vector p
 */
export function vRad(p) {
	return Math.atan2(p.y, p.x);
}

export class Vector {
	constructor(x, y) {
		this.x = x != null ? x : 0;
		this.y = y != null ? y : 0;
	}
	set(x, y) {
		this.x = x;
		this.y = y;
		return this;
	}
	equals(v, tolerance) {
		if (tolerance == null) {
			tolerance = 0.0000001;
		}
		return Math.abs(v.x - this.x) <= tolerance && Math.abs(v.y - this.y) <= tolerance;
	}
	add(v) {
		this.x += v.x;
		this.y += v.y;
		return this;
	}
	added(v) {
		return Vector.create(this.x + v.x, this.y + v.y);
	}
	sub(v) {
		this.x -= v.x;
		this.y -= v.y;
		return this;
	}
	subbed(v) {
		return Vector.create(this.x - v.x, this.y - v.y);
	}
	scale(f) {
		this.x *= f;
		this.y *= f;
		return this;
	}
	scaled(f) {
		return Vector.create(this.x * f, this.y * f);
	}
	distance(v) {
		var dx = v.x - this.x;
		var dy = v.y - this.y;
		return Math.sqrt(dx * dx + dy * dy);
	}
	squareDistance(v) {
		var dx = v.x - this.x;
		var dy = v.y - this.y;
		return dx * dx + dy * dy;
	}
	copy(v) {
		this.x = v.x;
		this.y = v.y;
		return this;
	}
	clone() {
		return new Vector(this.x, this.y);
	}
	dot(b) {
		return this.x * b.x + this.y * b.y;
	}
	normalize() {
		var len = this.length();
		if (len > 0) {
			this.scale(1 / len);
		}
		return this;
	}
	static create(x, y) {
		return new Vector(x, y);
	}
	static fromArray(a) {
		return new Vector(a[0], a[1]);
	}
}

export const argFact = (compareFn) => (array) => array.map((el, idx) => [el, idx]).reduce(compareFn)[1];
export const argMax = argFact((min, el) => (el[0] > min[0] ? el : min));
export const argMin = argFact((max, el) => (el[0] < max[0] ? el : max));
