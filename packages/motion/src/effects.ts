import { Matrix4, Uniform, Vector3 } from 'three';
import type { Camera } from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

const blurShader = /* glsl */ `
uniform mat4 previousViewProjection;
uniform mat4 inverseViewProjection;
uniform float shutter;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 world = inverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  world /= world.w;
  vec4 previous = previousViewProjection * world;
  vec2 velocity = (uv - (previous.xy / previous.w * 0.5 + 0.5)) * shutter;
  float pixels = length(velocity / texelSize);
  if (pixels > MAX_PIXELS) velocity *= MAX_PIXELS / pixels;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float f = float(i) / float(SAMPLES - 1) - 0.5;
    sum += texture2D(inputBuffer, uv + velocity * f);
  }
  outputColor = sum / float(SAMPLES);
}
`;

/** Velocity motion blur: each pixel's screen velocity comes from its depth reprojected with last frame's camera. */
export class VelocityBlurEffect extends Effect {
  constructor(samples: number, shutter = 0.5) {
    super('VelocityBlurEffect', blurShader, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      defines: new Map([['SAMPLES', String(Math.max(2, samples))], ['MAX_PIXELS', '48.0']]),
      uniforms: new Map<string, Uniform>([
        ['previousViewProjection', new Uniform(new Matrix4())],
        ['inverseViewProjection', new Uniform(new Matrix4())],
        ['shutter', new Uniform(shutter)],
      ]),
    });
  }

  /** Sets the camera one frame ago and now, so the blur depends only on t and the frame interval. */
  track(previous: Camera, current: Camera): void {
    (this.uniforms.get('previousViewProjection')!.value as Matrix4).copy(viewProjection(previous));
    (this.uniforms.get('inverseViewProjection')!.value as Matrix4).copy(viewProjection(current)).invert();
  }
}

function viewProjection(camera: Camera): Matrix4 {
  camera.updateMatrixWorld();
  return new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

const finishShader = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
uniform float grain;
uniform float frame;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * gain + lift * (1.0 - inputColor.rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  vec2 d = uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.7;
  c += (hash(vec3(floor(uv * resolution), frame)) - 0.5) * grain;
  outputColor = vec4(c, inputColor.a);
}
`;

/** The finish: a lift/gain grade, saturation, vignette and grain seeded by frame number. */
export class FinishEffect extends Effect {
  constructor({ lift = new Vector3(0.02, 0.0, 0.05), gain = new Vector3(1.05, 1.0, 0.95), saturation = 1.1, grain = 0.06 } = {}) {
    super('FinishEffect', finishShader, {
      uniforms: new Map<string, Uniform>([
        ['lift', new Uniform(lift)],
        ['gain', new Uniform(gain)],
        ['saturation', new Uniform(saturation)],
        ['grain', new Uniform(grain)],
        ['frame', new Uniform(0)],
      ]),
    });
  }

  /** Grain is seeded by frame time, never by a counter. */
  set frame(ms: number) {
    this.uniforms.get('frame')!.value = ms;
  }
}
