const canvas = document.getElementById("snow");
const context = canvas?.getContext("2d", { alpha: true });

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let width = 0;
let height = 0;
let dpr = 1;
let flakes = [];
let frame = 0;
let lastTime = 0;
let running = false;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const random = (min, max) => min + Math.random() * (max - min);

/** One soft glowing flake, drawn once and reused for every snowflake. */
const buildSprite = () => {
	const size = 64;
	const sprite = document.createElement("canvas");
	sprite.width = size;
	sprite.height = size;
	const ctx = sprite.getContext("2d");
	if (!ctx)
		return null;
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, "rgba(255,255,255,1)");
	gradient.addColorStop(0.28, "rgba(255,255,255,0.92)");
	gradient.addColorStop(0.55, "rgba(214,240,255,0.4)");
	gradient.addColorStop(1, "rgba(214,240,255,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	return sprite;
};

const sprite = buildSprite();

const makeFlake = (spawnAnywhere) => {
	const depth = random(0.35, 1);
	return {
		x: random(-20, width + 20),
		y: spawnAnywhere ? random(-20, height) : random(-80, -10),
		r: random(0.9, 3.4) * depth + 0.5,
		depth,
		speed: random(16, 46) * depth + 8,
		sway: random(6, 26) * depth,
		swaySpeed: random(0.3, 0.9),
		phase: random(0, Math.PI * 2),
		alpha: random(0.35, 0.9) * (0.55 + depth * 0.45),
	};
};

const flakeCount = () => clamp(Math.round((width * height) / 8200), 60, 260);

const resize = () => {
	if (!canvas || !context)
		return;
	width = window.innerWidth;
	height = window.innerHeight;
	dpr = clamp(window.devicePixelRatio || 1, 1, 2);
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	context.setTransform(dpr, 0, 0, dpr, 0, 0);
	flakes = Array.from({ length: flakeCount() }, () => makeFlake(true));
	if (reducedMotion) draw(0);
};

const draw = (time) => {
	if (!context || !sprite)
		return;
	context.clearRect(0, 0, width, height);

	// Slow gust that pushes the whole field side to side.
	const wind = Math.sin(time * 0.00013) * 40;

	for (const flake of flakes) {
		context.globalAlpha = flake.alpha;
		const x = flake.x +
			wind * flake.depth +
			Math.sin(time * 0.001 * flake.swaySpeed + flake.phase) * flake.sway;
		const size = flake.r * 4.4;
		context.drawImage(sprite, x - size / 2, flake.y - size / 2, size, size);
	}
	context.globalAlpha = 1;
};

const tick = (time) => {
	if (!running) return;
	const dt = Math.min((time - lastTime) / 1000 || 0, 0.05);
	lastTime = time;

	const wind = Math.sin(time * 0.00013) * 14;

	for (const flake of flakes) {
		flake.y += flake.speed * dt;
		flake.x += (wind + Math.sin(time * 0.001 * flake.swaySpeed + flake.phase) * flake.sway * 0.35) * dt;

		if (flake.y - flake.r > height + 12) {
			Object.assign(flake, makeFlake(false));
		}
		if (flake.x < -40) flake.x = width + 40;
		else if (flake.x > width + 40) flake.x = -40;
	}

	draw(time);
	frame = requestAnimationFrame(tick);
};

const start = () => {
	if (running || reducedMotion || document.hidden || !context || !sprite) return;
	running = true;
	lastTime = performance.now();
	frame = requestAnimationFrame(tick);
};

const stop = () => {
	running = false;
	cancelAnimationFrame(frame);
};

let resizeTimer = 0;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(resize, 150);
});

document.addEventListener("visibilitychange", () => {
	if (document.hidden) stop();
	else start();
});

if (canvas && context && sprite) {
	resize();
	if (reducedMotion) draw(0);
	else start();
}

export const snow = { start, stop };
