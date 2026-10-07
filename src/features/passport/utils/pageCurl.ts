// Page curl: the page wraps round a cylinder along the fold. Per pixel, draw the page beneath with the
// curl's shadow, then the turning page's points that land here (front, then the back on top).
export const PAGE_CURL_SKSL = `
uniform shader page0;
uniform shader page1;
uniform shader page2;
uniform float2 res;
uniform float2 origin;
uniform float2 dir;
uniform float radius;
uniform float sel;
uniform float under;
uniform float visible;
uniform float warm;
uniform float shadow;
uniform float3 paper;
uniform float2 offset;

const float PI = 3.14159265;
const float BORDER = 0.2;
const float LIFT = 0.00035;

float shape(float2 p) {
  float2 q = p - res * 0.5;
  float r = q.x > 0.0 ? 28.0 : 8.0;
  float2 d = abs(q) - (res * 0.5 - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

half4 slot(float which, float2 p) {
  return which < 0.5 ? page0.eval(p) : which < 1.5 ? page1.eval(p) : page2.eval(p);
}

// Page colour at p with the leaf's rounded corners and hairline border; alpha 0 off the page.
half4 pageAt(float which, float2 p, bool front) {
  float sd = shape(p);
  float inside = clamp(0.5 - sd, 0.0, 1.0);
  if (inside <= 0.0) return half4(0.0);
  float border = inside - clamp(-0.5 - sd, 0.0, 1.0);
  half4 c = slot(which, p);
  float3 col = c.a > 0.0 ? c.rgb / c.a : paper;
  if (!front) {
    float3 ink = mix(float3(dot(col, float3(0.333))), col, 0.4);
    col = mix(paper, ink, 0.08) + (fract(sin(dot(floor(p * 0.7), float2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;
  }
  col = mix(col, float3(0.12, 0.14, 0.2), border * BORDER);
  return half4(half3(col) * inside, inside);
}

float outside(float2 p) {
  float2 o = max(-p, p - res);
  return max(max(o.x, o.y), 0.0);
}

half4 over(half4 top, half4 bottom) {
  return top + bottom * (1.0 - top.a);
}

// Parts of the page raised by z come toward the viewer, so they spread a little along the fold.
float2 lift(float2 xy, float z) {
  float2 q = xy - res * 0.5;
  float2 perp = float2(-dir.y, dir.x);
  return res * 0.5 + dir * dot(q, dir) + perp * (dot(q, perp) / (1.0 + z * LIFT));
}

half4 main(float2 pos) {
  if (visible < 0.5) {
    // At rest: transparent, but touch every snapshot so each is uploaded before its first curl.
    return (page0.eval(float2(1.0)) + page1.eval(float2(1.0)) + page2.eval(float2(1.0))) * (warm * 0.0001);
  }
  float2 xy = pos - offset;
  float R = radius;
  float d = dot(xy - origin, dir);
  half4 result = pageAt(under, xy, true);
  float near = clamp(1.0 - shape(xy) / 14.0, 0.0, 1.0);

  // Shadow on the page beneath: strong at the curl, fading over ~30% of the width, plus a thin contact line.
  if (d > 0.0) {
    float reach = clamp((d - R) / (res.x * 0.3), 0.0, 1.0);
    float soft = 0.55 * (1.0 - reach) * (1.0 - reach);
    float contact = d > R ? 0.35 * exp(-(d - R) / 4.0) : 0.35;
    result = over(half4(0.0, 0.0, 0.0, clamp(soft + contact, 0.0, 0.75) * shadow * near), result);
  }
  if (d >= R + 1.0) return result;
  half4 top = half4(0.0);

  float a = d > 0.0 ? asin(clamp(d / R, 0.0, 1.0)) : 0.0;
  float t = d > 0.0 ? d / R : 0.0;
  float2 front = d > 0.0 ? lift(xy, R * (1.0 - cos(a))) + dir * (R * a - d) : xy;
  float2 back = d > 0.0 ? lift(xy, R * (1.0 + cos(a))) + dir * (R * (PI - a) - d) : lift(xy, 2.0 * R) + dir * (PI * R - 2.0 * d);
  float rim = clamp(R - d + 0.5, 0.0, 1.0);

  // Front: occluded as it nears the fold, then turning away from the light up the roll.
  half4 f = pageAt(sel, front, true) * rim;
  float occlusion = d < 0.0 ? 1.0 - 0.22 * exp(d / (R * 0.8)) : 0.78;
  float roll = d > 0.0 ? mix(1.0, 0.45, t * t) : 1.0;
  float o = outside(back);
  float castShade = o > 0.0 ? 0.45 * exp(-o / (R * 0.35)) * shadow : 0.0;
  f.rgb *= occlusion * roll * (1.0 - castShade);
  top = f;

  // Back: lit flat, a specular band near the top of the roll, darkening at the silhouette.
  half4 b = pageAt(sel, back, false) * rim;
  if (b.a > 0.0) {
    float light = d > 0.0 ? mix(0.97, 0.66, smoothstep(0.55, 1.0, t)) : 0.97 - 0.08 * exp(d / (R * 0.8));
    float spec = d > 0.0 ? 0.045 * exp(-pow((t - 0.45) / 0.18, 2.0)) : 0.0;
    b.rgb = b.rgb * light + half3(spec) * b.a;
    top = over(b, top);
  }
  // Past the spine the turned page fades out within a few points and as the turn completes.
  if (xy.x < 0.0) top *= clamp(shadow, 0.0, 1.0) * clamp(1.0 + xy.x / (res.x * 0.07), 0.0, 1.0);
  return over(top, result);
}
`;

export interface FoldGeometry {
  origin: [number, number];
  dir: [number, number];
  radius: number;
}

/** Fold for a turn `progress` (0 flat, 1 gone); `tilt` (-1 top … 1 bottom corner) leans it toward the grab. */
export function foldGeometry(progress: number, tilt: number, width: number, height: number): FoldGeometry {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  const k = 0.85 * tilt * Math.abs(tilt) * Math.sqrt(1 - p);
  const len = Math.sqrt(1 + k * k);
  const radius = width * (0.075 - 0.025 * p);
  // The fold runs just ahead of the finger; past the roll the page lies flipped over, back up.
  const fold = width + 1 + (Math.abs(k) * height) / 2 - width * p - ((Math.PI * radius) / 2) * Math.min(1, p / 0.08);
  return { origin: [fold, height / 2], dir: [1 / len, k / len], radius };
}
