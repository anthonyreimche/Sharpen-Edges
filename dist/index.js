//#region src/model.ts
var e = {
	passes: 2,
	amount: 0,
	luminanceOnly: !1
}, t = {
	passes: {
		min: 1,
		max: 4
	},
	amount: {
		min: 0,
		max: 100
	}
}, n = t.passes.max, r = (e) => e.amount > 0 ? e.passes : 0, i = [
	1 / 8,
	1 / 3,
	1 / 3
], a = .001, o = [
	[0, 0],
	[-1, 0],
	[1, 0],
	[-2, 0],
	[2, 0],
	[0, -1],
	[0, 1],
	[0, -2],
	[0, 2],
	[-1, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-2, -2],
	[2, 2],
	[2, -2],
	[-2, 2]
], s = "sharpen-edges", c = `${s}.edges`, l = [
	"passes",
	"amount",
	"luminanceOnly"
], u = "draws", d = (e) => `${c}.${e}`, f = (e, n) => Math.min(Math.max(e, t[n].min), t[n].max);
function p(t) {
	let n = { ...e }, r = t[d("passes")];
	typeof r == "number" && Number.isFinite(r) && (n.passes = Math.round(f(r, "passes")));
	let i = t[d("amount")];
	typeof i == "number" && Number.isFinite(i) && (n.amount = f(i, "amount"));
	let a = t[d("luminanceOnly")];
	return typeof a == "boolean" && (n.luminanceOnly = a), n;
}
function m(e) {
	return {
		[d("passes")]: e.passes,
		[d("amount")]: e.amount,
		[d("luminanceOnly")]: e.luminanceOnly,
		[d(u)]: r(e)
	};
}
function h(e) {
	if (!l.some((t) => d(t) in e) && !(d("draws") in e)) return null;
	let t = r(p(e));
	return e[d("draws")] === t ? null : { [d(u)]: t };
}
var g = () => m(e), _, v;
function y(e) {
	v = e, _ = e.react;
}
//#endregion
//#region src/Panel.tsx
function b() {
	let { Slider: n } = v.components, { Stack: i, Toggle: a } = v.ui, o = v.develop.useParamScope(), s = p(o.getParams()), c = (e) => {
		let t = {
			...p(o.getParams()),
			...e
		}, [n] = Object.keys(e);
		o.setParams({
			[d(n)]: t[n],
			[d(u)]: r(t)
		});
	};
	return /* @__PURE__ */ _.createElement(i, {
		gap: 6,
		style: { padding: 8 }
	}, /* @__PURE__ */ _.createElement(n, {
		label: "Iterations",
		value: s.passes,
		min: t.passes.min,
		max: t.passes.max,
		step: 1,
		defaultValue: e.passes,
		onChange: (e) => c({ passes: e }),
		onCommit: () => o.commit("Sharpen Edges: iterations")
	}), /* @__PURE__ */ _.createElement(n, {
		label: "Amount",
		value: s.amount,
		min: t.amount.min,
		max: t.amount.max,
		step: 1,
		defaultValue: e.amount,
		onChange: (e) => c({ amount: e }),
		onCommit: () => o.commit("Sharpen Edges: amount")
	}), /* @__PURE__ */ _.createElement(a, {
		label: "Luminance only",
		checked: s.luminanceOnly,
		onChange: (e) => {
			c({ luminanceOnly: e }), o.commit("Sharpen Edges: luminance only");
		}
	}));
}
//#endregion
//#region src/glsl.ts
function x(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, ".0") : `${t}.0`;
}
var S = x;
o.length;
var C = [
	"v",
	"W1",
	"E1",
	"W2",
	"E2",
	"N1",
	"S1",
	"N2",
	"S2",
	"NW",
	"SE",
	"NE",
	"SW",
	"NW2",
	"SE2",
	"NE2",
	"SW2"
], w = (e) => o.map((t, n) => `t${n}.${e}`).join(", "), T = `
// Color::XYZ2Lab on the sRGB working matrix: RGB to (L*, a*, b*).
vec3 seLab(vec3 rgb) {
  const mat3 toXyz = mat3(0.4360747, 0.2225045, 0.0139322, 0.3850649, 0.7168786, 0.0971045, 0.1430804, 0.0606169, 0.7141733);
  const float eps = ${S(216 / 24389)};
  const float kappa = ${S(24389 / 27)};
  vec3 xyz = toXyz * rgb;
  vec3 t = vec3(xyz.x / 0.9642, xyz.y, xyz.z / 0.8249);
  vec3 f = vec3(
    t.x > eps ? pow(t.x, 1.0 / 3.0) : (kappa * t.x + 16.0) / 116.0,
    t.y > eps ? pow(t.y, 1.0 / 3.0) : (kappa * t.y + 16.0) / 116.0,
    t.z > eps ? pow(t.z, 1.0 / 3.0) : (kappa * t.z + 16.0) / 116.0);
  float L = t.y > eps ? 116.0 * f.y - 16.0 : kappa * t.y;
  return vec3(L, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
// Color::Lab2XYZ, then the inverse working matrix: (L*, a*, b*) to RGB.
vec3 seRgb(vec3 lab) {
  const mat3 fromXyz = mat3(3.1338561, -0.9787684, 0.0719453, -1.6168667, 1.9161415, -0.2289914, -0.4906146, 0.0334540, 1.4052427);
  const float kappa = ${S(24389 / 27)};
  float fy = (lab.x + 16.0) / 116.0;
  float fx = 0.002 * lab.y + fy;
  float fz = fy - 0.005 * lab.z;
  float x = (fx > ${S(6 / 29)} ? fx * fx * fx : (116.0 * fx - 16.0) / kappa) * 0.9642;
  float z = (fz > ${S(6 / 29)} ? fz * fz * fz : (116.0 * fz - 16.0) / kappa) * 0.8249;
  float y = lab.x > 8.0 ? fy * fy * fy : lab.x / kappa;
  return fromXyz * vec3(x, y, z);
}
// What a half-float store should do to a value, whichever back end stores it:
// round to the nearest half (a value that already is one stores exactly).
float seUlp(float v) {
  highp int e = ((floatBitsToInt(v) >> 23) & 255) - 127;
  return intBitsToFloat((max(e - 10, -24) + 127) << 23);
}
float seHalfRound(float v) {
  float x = clamp(v, -65504.0, 65504.0);
  float q = seUlp(x);
  return roundEven(x / q) * q;
}
vec3 seHalf(vec3 v) { return vec3(seHalfRound(v.x), seHalfRound(v.y), seHalfRound(v.z)); }
vec4 seHalf4(vec4 v) { return vec4(seHalf(v.xyz), seHalfRound(v.w)); }
`, E = `${T}
// The carried state (L* hi, L* lo, a*, b*) / 100 as (L*, a*, b*).
vec3 seState(vec4 s) {
  return vec3(s.x + s.y, s.z, s.w) * ${S(100)};
}
// A texel in L*, a*, b*: converted from RGB on the first draw, else the carried state.
vec3 seTap(ivec2 t) {
  vec4 s = fetchPrev4(t);
  return uPassIndex == 0 ? seLab(s.rgb) : seState(s);
}
float seSqr(float v) { return v * v; }
float seIntp(float a, float b, float c) { return a * (b - c) + c; }
// One direction's estimate: the two sides' neighbours a and b (a2, b2 one
// further out), the pair p across the line and the pair q across it two out.
float seCandidate(float v, float contrast, float a, float a2, float b, float b2, float p1, float p2, float q1, float q2) {
  if (!(v < max(a, b) && v > min(a, b))) return v;
  float f1 = abs(a2 - a);
  float f2 = a - v;
  float f3 = (a - p1) * (a - p2);
  float f4 = sqrt(abs((a - q1) * (a - q2)));
  float difA = f1 * seSqr(f2 * f3) * f4;
  if (!(difA > 0.0)) return v;
  f1 = abs(b2 - b);
  f2 = b - v;
  f3 = (b - p1) * (b - p2);
  f4 = sqrt(abs((b - q1) * (b - q2)));
  float difB = f1 * seSqr(f2 * f3) * f4;
  if (!(difB > 0.0)) return v;
  return seIntp(contrast, (a * difB + b * difA) / (difA + difB), v);
}
// MLsharpen's inner loop for one channel: its 17 values (the order of TAPS),
// the channel's contrast gain, and the amount as a fraction and a third of it.
float seEdge(${C.map((e) => `float ${e}`).join(", ")}, float gain, float amount, float amountBy3) {
  float wH = ${S(a)} + abs(E1 - W1);
  float wV = ${S(a)} + abs(S1 - N1);
  float s = 2.0 / (2.0 + abs(wH - wV));
  float wD1 = ${S(a)} + abs(SE - NW) * s;
  float wD2 = ${S(a)} + abs(SW - NE) * s;
  s = wD1;
  wD1 /= wD2;
  wD2 /= s;
  float contrast = min(sqrt(seSqr(E1 - W1) + seSqr(S1 - N1)) * gain, 1.0);
  float lumH = seCandidate(v, contrast, W1, W2, E1, E2, N1, S1, N2, S2);
  float lumV = seCandidate(v, contrast, N1, N2, S1, S2, W1, E1, W2, E2);
  float lumD1 = seCandidate(v, contrast, NW, NW2, SE, SE2, NE, SW, NE2, SW2);
  float lumD2 = seCandidate(v, contrast, SW, SW2, NE, NE2, NW, SE, NW2, SE2);
  // Not to sharpen diagonals too much: a third of the amount where one axis is much flatter.
  float lo = min(wH, wV);
  float hi = max(wH, wV);
  float weight = lo > 0.05 * hi ? (lo < 0.45 * hi ? amountBy3 : amount) : amount;
  return seIntp(weight, (lumH * wH + lumV * wV + lumD1 * wD1 + lumD2 * wD2) / (wH + wV + wD1 + wD2), v);
}
`, D = `
ivec2 size = ivec2(floor(1.0 / uTexel + 0.5));
ivec2 px = ivec2(gl_FragCoord.xy);
vec3 own = uPassIndex == 0 ? seLab(c.rgb) : seState(c);
vec3 result = own;
if (px.x >= 2 && px.y >= 2 && px.x < size.x - 2 && px.y < size.y - 2) {
  ${o.map(([e, t], n) => `vec3 t${n} = seTap(px + ivec2(${e}, ${t}));`).join("\n  ")}
  float am = amount / 100.0;
  float am3 = amount / 300.0;
  float l = seEdge(${w("x")}, ${S(i[0])}, am, am3);
  if (own.x < ${S(92)}) result.x = abs(l);
  if (!luminanceOnly) {
    result.y = seEdge(${w("y")}, ${S(i[1])}, am, am3);
    result.z = seEdge(${w("z")}, ${S(i[2])}, am, am3);
  }
}
vec3 state = result / ${S(100)};
if (uPassIndex == uPassCount - 1) {
  c = vec4(state, 0.0);
} else {
  float hi = seHalfRound(state.x);
  c = vec4(hi, state.x - hi, state.y, state.z);
}
c = seHalf4(c);
`, O = "\n// What the host's store did to the stage's input, in the host's own rounding: the passes read that texture.\nvec3 seStored(vec3 v) {\n  vec2 xy = unpackHalf2x16(packHalf2x16(v.xy));\n  return vec3(xy, unpackHalf2x16(packHalf2x16(vec2(v.z, 0.0))).x);\n}\n", k = `
if (draws > 0) {
  vec3 held = seHalf(seLab(seStored(c)) / ${S(100)}) * ${S(100)};
  c += seRgb(stageResult * ${S(100)}) - seRgb(held);
}
`, A = ["amount", "luminanceOnly"], j = ["passes"], M = {
	passes: {
		key: "passes",
		glslType: "int",
		default: e.passes,
		range: {
			...t.passes,
			step: 1
		},
		label: "Iterations"
	},
	amount: {
		key: "amount",
		glslType: "float",
		default: e.amount,
		range: {
			...t.amount,
			step: 1
		},
		label: "Amount"
	},
	luminanceOnly: {
		key: "luminanceOnly",
		glslType: "bool",
		default: e.luminanceOnly,
		label: "Luminance only"
	}
}, N = {
	key: u,
	glslType: "int",
	default: 0
};
function P() {
	return {
		id: c,
		name: "Sharpen Edges",
		phase: "display-adjust",
		priority: 120,
		reads: "current",
		space: {
			encoding: "linear",
			primaries: "rec709"
		},
		glsl: k,
		helpers: T + O,
		uniforms: [
			...j.map((e) => M[e]),
			...A.map((e) => M[e]),
			N
		],
		passes: [{
			channels: 4,
			glsl: D,
			helpers: E,
			iterations: {
				key: u,
				max: n
			},
			uniforms: A.map((e) => M[e])
		}],
		dormantWhen: { amount: 0 },
		mask: { maskable: !0 }
	};
}
//#endregion
//#region src/index.tsx
var F = `${s}.panel`, I = null;
function L() {
	let e = v.stores.useDevelopStore.getState();
	e.setDynParams(g()), e.commitEdit("Sharpen Edges reset");
}
function R(e) {
	y(e), e.registerProcessingStage(P()), e.registerPanel({
		id: F,
		title: "Sharpen Edges",
		component: b,
		defaultDock: {
			module: "develop",
			direction: "right",
			width: 280
		},
		onReset: L,
		mask: {
			component: b,
			owns: [...l.map(d), d(u)]
		}
	}), I?.(), I = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.params.masks !== t.params.masks) for (let n of e.params.masks) {
			if (t.params.masks.some((e) => e.id === n.id && e.bag === n.bag)) continue;
			let r = n.bag ? h(n.bag) : null;
			r && e.updateMaskBag(n.id, r);
		}
		if (e.paramBag === t.paramBag) return;
		let n = h(e.paramBag);
		n && e.setDynParams(n);
	});
}
function z() {
	I?.(), I = null;
}
//#endregion
export { F as PANEL_ID, R as activate, z as deactivate };

//# sourceMappingURL=index.js.map