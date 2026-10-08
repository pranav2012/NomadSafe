import { CITIES, LEGS, arcPath, moonIllumination, project, sunVector, toVector, viewMatrix, type Frame, type Mat3 } from "./geo";

// A port of the app's Home globe shader (src/features/home/components/aura/globe/Globe.tsx) to WebGL2:
// day imagery on the sunlit side, city lights on the night side, split by the real sun, with the
// atmosphere tinted in the brand aurora colours. Clouds and lightning are left out.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uSky;
uniform vec2 uCenter;
uniform float uRadius;
uniform mat3 uViewToWorld;
uniform vec3 uSun;
uniform vec3 uSunView;
uniform vec3 uGlowDir;
uniform float uMoon;
uniform float uTime;
uniform float uSkyShift;
out vec4 outColor;

const float PI = 3.14159265;
const vec3 TEAL = vec3(0.133, 0.78, 0.722);
const vec3 INDIGO = vec3(0.357, 0.424, 1.0);
const vec3 VIOLET = vec3(0.608, 0.482, 1.0);

vec3 aurora(float angle) {
  float t = 0.5 + 0.5 * sin(angle * 1.0 + uTime * 0.12);
  return t < 0.5 ? mix(TEAL, INDIGO, t * 2.0) : mix(INDIGO, VIOLET, t * 2.0 - 1.0);
}

// Equirectangular lookup with mip gradients taken from whichever of two u parameterisations is
// continuous here (Tarini), so the antimeridian seam doesn't pick the blurriest mip.
vec3 sphereTex(sampler2D tex, vec2 uv) {
  vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec2 dx2 = dFdx(uv2);
  vec2 dy2 = dFdy(uv2);
  if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
  return textureGrad(tex, uv, dx, dy).rgb;
}

void main() {
  vec2 q = (gl_FragCoord.xy - uCenter) / uRadius;
  float r = length(q);
  vec3 atmo = aurora(atan(q.y, q.x));

  float facing = dot(normalize(q + 1e-4), normalize(uSunView.xy + 1e-4));
  float haloLight = 0.5 + 0.5 * smoothstep(-0.6, 0.8, facing);
  float d = max(r - 1.0, 0.0);
  float fade = smoothstep(1.25, 1.06, r);
  float halo = (exp(-d * 24.0) * 0.65 + exp(-d * 7.0) * 0.2) * haloLight * fade;
  vec3 skyCol = texture(uSky, q * vec2(0.32, -0.32) + vec2(0.5 + uSkyShift, 0.5)).rgb;
  float skyA = fade * 0.5;
  vec3 outside = pow(skyCol, vec3(1.2)) * skyA + atmo * halo;
  float outsideA = clamp(skyA * 0.8 + halo, 0.0, 1.0);
  if (r > 1.0) { outColor = vec4(outside, outsideA); return; }

  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 v = vec3(q, z);
  vec3 w = uViewToWorld * v;
  float lat = asin(clamp(w.y, -1.0, 1.0));
  float lng = atan(w.x, w.z);
  vec2 uv = vec2((lng + PI) / (2.0 * PI), (PI * 0.5 - lat) / PI);
  vec3 dayTex = sphereTex(uDay, uv);
  vec3 nightTex = sphereTex(uNight, uv);

  float sunDot = dot(w, uSun);
  float lit = smoothstep(-0.1, 0.1, sunDot);
  float diffuse = smoothstep(-0.08, 0.7, sunDot);
  vec3 dayCol = pow(dayTex, vec3(0.9)) * (0.2 + diffuse);
  float warm = (nightTex.r + nightTex.g) * 0.5 - nightTex.b * 0.8;
  float lights = smoothstep(0.02, 0.5, warm) * (0.35 + 0.65 * smoothstep(0.3, 0.9, warm));
  vec3 nightCol = min(nightTex, vec3(0.35)) * (0.25 + 0.3 * uMoon) + vec3(1.0, 0.74, 0.4) * lights * 1.7;
  float tripLight = smoothstep(0.95, 0.995, dot(w, uGlowDir));
  vec3 moonLand = mix(vec3(dot(dayTex, vec3(0.3, 0.59, 0.11))), dayTex, 0.35) * vec3(0.62, 0.72, 0.95) * (0.3 + 0.15 * uMoon);
  nightCol += moonLand * tripLight;
  vec3 col = mix(nightCol, dayCol, lit);

  float water = smoothstep(0.05, 0.15, dayTex.b - dayTex.r);
  vec3 refl = reflect(-uSunView, v);
  col += vec3(1.0, 0.95, 0.85) * pow(max(refl.z, 0.0), 40.0) * water * lit * 0.4;

  float twilight = exp(-pow((sunDot - 0.02) / 0.07, 2.0));
  col *= mix(vec3(1.0), vec3(1.25, 0.86, 0.62), twilight * 0.6);

  float fresnel = pow(1.0 - z, 3.0);
  col += atmo * fresnel * 0.8 * (0.35 + 0.65 * smoothstep(-0.25, 0.4, sunDot));

  float edge = smoothstep(1.0, 1.0 - 1.5 / uRadius, r);
  outColor = mix(vec4(outside, outsideA), vec4(col, 1.0), edge);
}`;

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SWAY_PERIOD_S = 40;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function texture(gl: WebGL2RenderingContext, img: HTMLImageElement, unit: number, mipmaps: boolean) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mipmaps ? gl.CLAMP_TO_EDGE : gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export interface GlobeOptions {
  canvas: HTMLCanvasElement;
  overlay: SVGSVGElement;
  surface: HTMLElement;
  frame: Frame;
  view: { lat: number; lng: number };
  sway: number;
  still: boolean;
  /** Fixed clock for the sun, e.g. when capturing the fallback image. */
  now?: () => Date;
  onFirstFrame: () => void;
}

/** Starts the live globe; resolves to a dispose function, or null when WebGL2 isn't available. */
export async function startGlobe(options: GlobeOptions): Promise<(() => void) | null> {
  const { canvas, overlay, surface, still, frame, view, sway: swayDeg, onFirstFrame } = options;
  const now = options.now ?? (() => new Date());
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: "low-power" });
  if (!gl) return null;

  const [day, night, sky] = await Promise.all(
    ["/globe/earth-day.webp", "/globe/earth-night.webp", "/globe/milky-way.webp"].map(loadImage),
  );

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const textures = [texture(gl, day, 0, true), texture(gl, night, 1, true), texture(gl, sky, 2, false)];
  const u = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(u("uDay"), 0);
  gl.uniform1i(u("uNight"), 1);
  gl.uniform1i(u("uSky"), 2);
  const uniforms = {
    center: u("uCenter"),
    radius: u("uRadius"),
    viewToWorld: u("uViewToWorld"),
    sun: u("uSun"),
    sunView: u("uSunView"),
    glow: u("uGlowDir"),
    moon: u("uMoon"),
    time: u("uTime"),
    skyShift: u("uSkyShift"),
  };
  const lisbon = CITIES.find((c) => c.id === "lisbon")!;
  const prague = CITIES.find((c) => c.id === "prague")!;
  gl.uniform3fv(uniforms.glow, toVector((lisbon.lat + prague.lat) / 2, (lisbon.lng + prague.lng) / 2));

  const arcs = LEGS.map((leg) => ({
    from: CITIES.find((c) => c.id === leg.from)!,
    to: CITIES.find((c) => c.id === leg.to)!,
    paths: overlay.querySelectorAll<SVGPathElement>(`[data-leg="${leg.from}-${leg.to}"]`),
  }));
  const pins = CITIES.map((city) => ({
    vector: toVector(city.lat, city.lng),
    node: overlay.querySelector<SVGGElement>(`[data-city="${city.id}"]`),
  }));

  let scale = Math.min(window.devicePixelRatio || 1, 2);
  let userLng = 0;
  let userLat = 0;
  let velocity = 0;
  let dragging = false;
  let swayTime = 0;
  let lastFrame = 0;
  let raf = 0;
  let visible = true;
  let firstFrame = true;
  let slowFrames = 0;
  const start = performance.now();

  // Sized from the on-screen box, so a canvas inside a CSS-scaled phone still gets sharp pixels.
  function resize() {
    const box = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(time: number) {
    resize();
    const sway = still ? 0 : Math.sin((swayTime / SWAY_PERIOD_S) * Math.PI * 2) * swayDeg;
    const lng = view.lng + sway + userLng;
    const lat = Math.max(-10, Math.min(75, view.lat + Math.sin((swayTime / SWAY_PERIOD_S) * Math.PI * 4) * (still ? 0 : 2) + userLat));
    const m: Mat3 = viewMatrix(lat, lng);
    const sun = sunVector(now());
    const sunView = [m[0] * sun[0] + m[1] * sun[1] + m[2] * sun[2], m[3] * sun[0] + m[4] * sun[1] + m[5] * sun[2], m[6] * sun[0] + m[7] * sun[1] + m[8] * sun[2]];

    gl!.viewport(0, 0, canvas.width, canvas.height);
    const k = canvas.width / frame.width;
    gl!.uniform2f(uniforms.center, frame.cx * k, canvas.height - frame.cy * k);
    gl!.uniform1f(uniforms.radius, frame.r * k);
    // Row-major world→view is the column-major view→world (its transpose), which is what the shader wants.
    gl!.uniformMatrix3fv(uniforms.viewToWorld, false, m);
    gl!.uniform3fv(uniforms.sun, sun);
    gl!.uniform3fv(uniforms.sunView, sunView);
    gl!.uniform1f(uniforms.moon, moonIllumination(now()));
    gl!.uniform1f(uniforms.time, (time - start) / 1000);
    gl!.uniform1f(uniforms.skyShift, -lng / 1440);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    for (const arc of arcs) {
      const d = arcPath(m, arc.from, arc.to, frame);
      arc.paths.forEach((path) => path.setAttribute("d", d));
    }
    for (const pin of pins) {
      if (!pin.node) continue;
      const p = project(m, pin.vector, frame);
      pin.node.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      pin.node.setAttribute("opacity", String(Math.max(0, Math.min(1, (p.z - 0.08) / 0.2))));
    }

    if (firstFrame) {
      firstFrame = false;
      onFirstFrame();
    }
  }

  function onFrame(time: number) {
    raf = 0;
    const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0;
    // Drop to 1× pixels if the GPU can't keep up (a long run of frames over ~22 ms).
    if (dt > 0.022 && scale > 1) {
      if (++slowFrames > 45) scale = 1;
    } else slowFrames = Math.max(0, slowFrames - 1);
    lastFrame = time;
    if (!dragging) {
      swayTime += dt;
      userLng += velocity * dt;
      velocity *= Math.pow(0.04, dt);
    }
    draw(time);
    schedule();
  }

  function schedule() {
    if (still || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(onFrame);
  }

  function redraw() {
    if (still) draw(performance.now());
    else schedule();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    lastFrame = 0;
    schedule();
  });
  observer.observe(canvas);
  const onVisibility = () => {
    lastFrame = 0;
    schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onResize = () => redraw();
  window.addEventListener("resize", onResize);

  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  const degPerPx = () => 180 / Math.PI / ((canvas.getBoundingClientRect().width * frame.r) / frame.width);
  const onDown = (e: PointerEvent) => {
    if (pointerId !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointerId = e.pointerId;
    dragging = true;
    velocity = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    surface.setPointerCapture(e.pointerId);
    surface.classList.add("is-dragging");
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const dt = Math.max(1, e.timeStamp - lastT) / 1000;
    userLng -= dx * degPerPx();
    // Touch drags only reach here horizontally (touch-action: pan-y), so tilt is a mouse/pen nicety.
    userLat += dy * degPerPx();
    userLat = Math.max(-40, Math.min(30, userLat));
    velocity = (-dx * degPerPx()) / dt;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    redraw();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    dragging = false;
    if (e.timeStamp - lastT > 80) velocity = 0;
    velocity = Math.max(-120, Math.min(120, velocity));
    surface.classList.remove("is-dragging");
    lastFrame = 0;
    schedule();
  };
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onMove);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointercancel", onUp);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    userLng += e.key === "ArrowLeft" ? -8 : 8;
    redraw();
  };
  surface.addEventListener("keydown", onKey);

  // If the browser drops the GPU context anyway, stop and let the still image show again.
  const onLost = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    visible = false;
    surface.classList.remove("is-live");
  };
  canvas.addEventListener("webglcontextlost", onLost);

  draw(performance.now());
  schedule();

  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    cancelAnimationFrame(raf);
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
    surface.removeEventListener("pointerdown", onDown);
    surface.removeEventListener("pointermove", onMove);
    surface.removeEventListener("pointerup", onUp);
    surface.removeEventListener("pointercancel", onUp);
    surface.removeEventListener("keydown", onKey);
    // Free our resources but keep the context: the same canvas gets it back when the globe restarts,
    // and a lost context can't be restored, which left the Trip tab blank.
    textures.forEach((tex) => gl.deleteTexture(tex));
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}
