export default /* glsl */ `\
#version 300 es
#define SHADER_NAME sdf-marker-layer-fragment-shader

precision highp float;

in vec4 vFillColor;
in vec2 unitPosition;
in float outerRadiusPixels;

out vec4 fragColor;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdTriangleIsosceles(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)),
               vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdArrow(vec2 p) {
  float head = sdTriangleIsosceles(p - vec2(0.0, -0.5), vec2(0.6, 0.6));
  float shaft = sdBox(p - vec2(0.0, 0.30), vec2(0.2, 0.30));
  return min(head, shaft);
}

float sdPin(vec2 p) {
  p.y = -p.y;
  p.x = abs(p.x);

  const float cy = 0.3;
  const float cr = 0.65;
  const float tip = -0.9;
  const float sinA = 0.5416666666666667;
  const float cosA = 0.8405933750763339;
  const float edgeLen = 1.0087120500916007;

  vec2 tp = p - vec2(0.0, tip);
  float along = dot(tp, vec2(sinA, cosA));

  if (along < 0.0) return length(tp);
  if (along > edgeLen) return length(p - vec2(0.0, cy)) - cr;
  return dot(tp, vec2(cosA, -sinA));
}

void main(void) {
  geometry.uv = unitPosition;

  float d;
  float ramp = 1.0 / outerRadiusPixels;
  if (sdfMarker.shapeType == 1) {
    d = sdArrow(unitPosition);
  } else if (sdfMarker.shapeType == 2) {
    d = sdPin(unitPosition);
  } else {
    // Circle inscribes the quad (no padding needed for rotation/tip geometry),
    // halving overdraw vs the padded shapes. Half-pixel ramp so the AA edge
    // stays inside the quad's SMOOTH_EDGE_RADIUS margin.
    d = sdCircle(unitPosition, 1.0);
    ramp *= 0.5;
  }

  float alpha = 1.0 - smoothstep(-ramp, ramp, d);

  if (alpha < 0.01) {
    discard;
  }

  fragColor = vFillColor;
  fragColor.a *= alpha;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
