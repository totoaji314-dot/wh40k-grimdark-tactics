"""Holy Terra landmarks, modelled from code: the Eternity Gate, palace walls and towers, the Golden Throne and its hall,
the palace skyline, banners, braziers, servo-skulls, pilgrims and a Rhino transport. Plus the downloaded statue scans
(SMK / Smithsonian, public domain / CC0) cleaned, scaled and decimated into the same file.

    blender -b --factory-startup -P tools/blender/terra_landmarks.py -- --assets D:/01_BoltgunReference/Downloaded_Assets
        --out local_only/terra_build [--only gate,throne] [--previews]

Every piece is built three times at falling detail (LOD0 full, LOD1 medium, LOD2 silhouette) rather than decimated,
so the low levels keep clean architectural edges. Objects are named <piece>__L<n>. Materials are tiling ambientCG PBR
sets (CC0) with world-scale box UVs; a vertex-colour pass darkens the bottom few metres (grime) and down-facing faces.
Writes <out>/palace_src.glb, <out>/palace_anchors.json (statue niches, braziers, banner hooks, NPC posts in glTF
coordinates), <out>/palace_src.blend and, with --previews, rendered previews in <out>/previews/.

Blender axes: X right, Y = the piece's front (north, toward the enemy), Z up. glTF export turns +Y into -Z.
"""
import bpy
import bmesh
import json
import math
import random
import sys
import time
from pathlib import Path
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
ASSETS = Path(arg("--assets", "D:/01_BoltgunReference/Downloaded_Assets"))
OUT = Path(arg("--out", "local_only/terra_build")).resolve()
ONLY = set(arg("--only").split(",")) if arg("--only") else None
PREVIEWS = "--previews" in argv
OUT.mkdir(parents=True, exist_ok=True)
TAU = math.pi * 2
random.seed(40000)

# ------------------------------------------------------------------ materials
# name, ambientCG set, metres per texture repeat, preview tint (the game applies the same tint at runtime),
# metallic (None = from map), emission colour
MATS = [
    ("stone", "Bricks108A", 3.2, (0.80, 0.78, 0.74), 0.0, None),
    ("stone_pale", "Bricks008", 2.6, (0.95, 0.93, 0.88), 0.0, None),
    ("stone_dark", "Granite005A", 2.4, (0.55, 0.54, 0.55), 0.0, None),
    ("marble", "Marble012", 2.0, (1.0, 1.0, 1.0), 0.0, None),
    ("gold", "Metal048A", 1.4, (1.0, 0.78, 0.36), 1.0, None),
    ("bronze", "Metal008", 1.6, (0.85, 0.62, 0.42), 1.0, None),
    ("iron", "MetalPlates006", 1.8, (0.42, 0.42, 0.44), 1.0, None),
    ("roof", "RoofingTiles006", 3.0, (0.40, 0.42, 0.46), 0.0, None),
    ("cloth", "Fabric030", 1.2, (0.55, 0.05, 0.04), 0.0, None),
    ("glow", None, 4.0, (0.10, 0.06, 0.03), 0.0, (1.0, 0.52, 0.20)),
    ("paving", "PavingStones126A", 3.0, (0.92, 0.9, 0.86), 0.0, None),
    ("paint", "MetalPlates013", 2.0, (0.13, 0.25, 0.62), 0.0, None),
    ("robe", "Fabric061", 0.8, (0.36, 0.28, 0.21), 0.0, None),
    ("bone", "Travertine009", 0.35, (0.93, 0.88, 0.76), 0.0, None),
    ("glow_red", None, 1.0, (0.1, 0.0, 0.0), 0.0, (1.0, 0.07, 0.02)),
    ("floor", "Tiles074", 3.0, (0.9, 0.9, 0.9), 0.0, None),
    ("cable", "Rust009", 1.0, (0.30, 0.27, 0.25), 1.0, None),
]
MI = {m[0]: i for i, m in enumerate(MATS)}
TILE = [m[2] for m in MATS]
STONE, PALE, DARK, MARBLE, GOLD, BRONZE, IRON, ROOF, CLOTH, GLOW, PAVING, PAINT, ROBE, BONE, GLOWR, FLOOR, CABLE = range(len(MATS))
GRIME_FACTOR = {STONE: 1, PALE: 1, DARK: 1, MARBLE: 0.6, GOLD: 0.35, BRONZE: 0.5, IRON: 0.6, ROOF: 0.3, CLOTH: 0.4, GLOW: 0,
                PAVING: 0.8, PAINT: 0.6, ROBE: 0.5, BONE: 0.2, GLOWR: 0, FLOOR: 0.5, CABLE: 0.4}
_mats = []


def acg(set_id, kind):
    d = ASSETS / "ambientcg" / set_id
    for p in d.glob(f"{set_id}_*_{kind}.jpg"):
        return str(p)
    return None


def build_materials():
    for name, set_id, tile, tint, metal, emit in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        if emit:
            bsdf.inputs["Base Color"].default_value = (*tint, 1)
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
            bsdf.inputs["Emission Strength"].default_value = 6.0
            bsdf.inputs["Roughness"].default_value = 0.6
        else:
            col = acg(set_id, "Color")
            if col:
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = bpy.data.images.load(col, check_existing=True)
                t.name = "base"
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                mix.inputs[7].default_value = (*tint, 1)
                mix.name = "tint"
                nt.links.new(t.outputs["Color"], mix.inputs[6])
                nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
            r = acg(set_id, "Roughness")
            if r:
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = bpy.data.images.load(r, check_existing=True)
                t.image.colorspace_settings.name = "Non-Color"
                nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
            mt = acg(set_id, "Metalness")
            if mt and metal > 0:
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = bpy.data.images.load(mt, check_existing=True)
                t.image.colorspace_settings.name = "Non-Color"
                nt.links.new(t.outputs["Color"], bsdf.inputs["Metallic"])
            else:
                bsdf.inputs["Metallic"].default_value = metal
            n = acg(set_id, "NormalGL")
            if n:
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = bpy.data.images.load(n, check_existing=True)
                t.image.colorspace_settings.name = "Non-Color"
                nm = nt.nodes.new("ShaderNodeNormalMap")
                nt.links.new(t.outputs["Color"], nm.inputs["Color"])
                nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        # vertex-colour grime multiplies the base colour (glTF COLOR_0)
        _mats.append(m)


def tint_nodes(on):
    """Previews show the tints; the exported glTF links the texture straight in (the game tints at runtime)."""
    for m in _mats:
        nt = m.node_tree
        if "tint" not in nt.nodes:
            continue
        bsdf = nt.nodes["Principled BSDF"]
        base, mix = nt.nodes["base"], nt.nodes["tint"]
        for l in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(l)
        nt.links.new((mix.outputs[2] if on else base.outputs["Color"]), bsdf.inputs["Base Color"])


# ------------------------------------------------------------------ geometry builder

def newell(vs):
    n = Vector((0, 0, 0))
    k = len(vs)
    for i in range(k):
        a, b = vs[i].co, vs[(i + 1) % k].co
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class G:
    """bmesh with an OpenGL-style matrix stack; faces are oriented by an expected outward direction."""
    def __init__(self):
        self.bm = bmesh.new()
        self.M = Matrix.Identity(4)
        self.st = []

    def push(self, t=(0, 0, 0), rz=0.0, rx=0.0, ry=0.0, sc=1.0):
        self.st.append(self.M.copy())
        s = sc if isinstance(sc, (tuple, list)) else (sc, sc, sc)
        self.M = self.M @ Matrix.Translation(Vector(t)) @ Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1.0))

    def pop(self):
        self.M = self.st.pop()

    def v(self, p):
        return self.bm.verts.new(self.M @ Vector(p))

    def face(self, vs, mi, out=None, smooth=False):
        if len(vs) < 3 or len(set(vs)) < 3:
            return None
        if out is not None:
            o = self.M.to_3x3().inverted_safe().transposed() @ Vector(out)
            if newell(vs).dot(o) < 0:
                vs = vs[::-1]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mi
        f.smooth = smooth
        return f


def box(g, c, s, mi, bottom=True, top=True, smooth=False):
    x, y, z = c
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    P = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                P[(sx, sy, sz)] = g.v((x + sx * hx, y + sy * hy, z + sz * hz))
    F = [((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1), (1, 0, 0)),
         ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, 0, 0)),
         ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1), (0, 1, 0)),
         ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), (0, -1, 0)),
         ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1), (0, 0, 1)),
         ((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (0, 0, -1))]
    for *corners, out in F:
        if out == (0, 0, -1) and not bottom:
            continue
        if out == (0, 0, 1) and not top:
            continue
        g.face([P[c_] for c_ in corners], mi, out, smooth)


def area2(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def clean(poly):
    out = []
    for p in poly:
        if not out or (abs(p[0] - out[-1][0]) > 1e-5 or abs(p[1] - out[-1][1]) > 1e-5):
            out.append(p)
    if len(out) > 2 and abs(out[0][0] - out[-1][0]) < 1e-5 and abs(out[0][1] - out[-1][1]) < 1e-5:
        out.pop()
    return out


def prism(g, poly, y0, y1, mi, front=True, back=True, side_mi=None, sides=True):
    """Polygon in the XZ plane extruded along Y from y0 to y1 (front face at y1)."""
    poly = clean(poly)
    if area2(poly) < 0:
        poly = poly[::-1]
    f = [g.v((x, y1, z)) for x, z in poly]
    b = [g.v((x, y0, z)) for x, z in poly]
    if front:
        g.face(f, mi, (0, 1, 0))
    if back:
        g.face(b, mi, (0, -1, 0))
    if sides:
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            dx, dz = poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]
            g.face([b[i], b[j], f[j], f[i]], mi if side_mi is None else side_mi, (dz, 0, -dx))


def prism_x(g, poly_yz, x0, x1, mi, caps=True):
    """Polygon in the YZ plane extruded along X."""
    g.push(rz=-math.pi / 2)        # local X -> world -Y, local Y -> world X
    prism(g, [(-y, z) for y, z in poly_yz], x0, x1, mi, front=caps, back=caps)
    g.pop()


def lathe(g, prof, seg, mi, rot0=0.0, cap_top=True, cap_bot=False, smooth=False, sx=1.0, sy=1.0):
    ang = [rot0 + TAU * i / seg for i in range(seg)]
    rings = []
    for r, z in prof:
        if r < 1e-6:
            c = g.v((0, 0, z))
            rings.append([c] * seg)
        else:
            rings.append([g.v((r * math.cos(a) * sx, r * math.sin(a) * sy, z)) for a in ang])
    for k in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[k], prof[k + 1]
        dz, dr = z1 - z0, r1 - r0
        for i in range(seg):
            j = (i + 1) % seg
            am = rot0 + TAU * (i + 0.5) / seg
            out = (dz * math.cos(am), dz * math.sin(am), -dr)
            if r0 < 1e-6:
                g.face([rings[k][0], rings[k + 1][i], rings[k + 1][j]], mi, out, smooth)
            elif r1 < 1e-6:
                g.face([rings[k][i], rings[k][j], rings[k + 1][0]], mi, out, smooth)
            else:
                g.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], mi, out, smooth)
    if cap_top and prof[-1][0] > 1e-6:
        g.face(list(rings[-1]), mi, (0, 0, 1))
    if cap_bot and prof[0][0] > 1e-6:
        g.face(list(rings[0]), mi, (0, 0, -1))


def tube(g, pts, r, seg, mi, caps=False, smooth=True):
    pts = [Vector(p) for p in pts]
    if len(pts) < 2:
        return
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(a).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n
        b = t.cross(n)
        rings.append([g.v(p + (n * math.cos(TAU * k / seg) + b * math.sin(TAU * k / seg)) * r) for k in range(seg)])
    for i in range(len(pts) - 1):
        for k in range(seg):
            q = [rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]]
            c = (pts[i] + pts[i + 1]) / 2
            f = g.face(q, mi, None, smooth)
            if f:
                f.normal_update()
                wc = g.M @ c
                if f.normal.dot(f.calc_center_median() - wc) < 0:
                    f.normal_flip()
    if caps:
        g.face(list(rings[0]), mi, tuple(pts[0] - pts[1]))
        g.face(list(rings[-1]), mi, tuple(pts[-1] - pts[-2]))


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


# ------------------------------------------------------------------ gothic vocabulary

def arch_curve(a, R, s, off=0.0, n=10):
    """Pointed arch over the span -a..a springing at height s (two arcs of radius R), offset outward by off."""
    cx = R - a                   # the left arc's centre sits at x = -a + R, the right one mirrored
    Rr = R + off
    th1 = math.acos(max(-1.0, min(1.0, -cx / Rr)))     # angle where the left arc reaches the apex (x = 0)
    angs = [math.pi + (th1 - math.pi) * i / n for i in range(n + 1)]
    left = [(cx + Rr * math.cos(t), s + Rr * math.sin(t)) for t in angs]
    left[-1] = (0.0, left[-1][1])
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return left + right


def arch_band(a, R, s, t0, t1, zb, n=10):
    outer = [(-a - t1, zb)] + arch_curve(a, R, s, t1, n) + [(a + t1, zb)]
    inner = [(-a - t0, zb)] + arch_curve(a, R, s, t0, n) + [(a + t0, zb)]
    return outer + inner[::-1]


def arch_fill(a, R, s, zb, n=10):
    return [(-a, zb)] + arch_curve(a, R, s, 0, n) + [(a, zb)]


def apex(a, R, s, off=0.0):
    return s + math.sqrt(max((R + off) ** 2 - (R - a) ** 2, 0))


def shift(poly, dx=0.0, dz=0.0):
    return [(x + dx, z + dz) for x, z in poly]


def lancet(g, cx, z0, w, h, lod, frame_mi=PALE, depth=0.35, pane=GLOW):
    """Pointed window on a wall whose face is the local y=0 plane, normal +Y."""
    a = w / 2
    R = w * 0.9
    s = z0 + h - (apex(a, R, 0))
    n = (8, 5, 3)[lod]
    prism(g, shift(arch_fill(a, R, s, z0, n), cx), 0.0, 0.04, pane, back=False, sides=False)
    if lod == 2:
        return
    fw = max(0.25, w * 0.12)
    prism(g, shift(arch_band(a, R, s, 0, fw, z0, n), cx), 0.0, depth, frame_mi, back=False)
    box(g, (cx, depth / 2 + 0.05, z0 - 0.18), (w + 2 * fw + 0.3, depth + 0.1, 0.36), frame_mi)
    if lod == 0:
        box(g, (cx, 0.08, (z0 + s) / 2), (w * 0.07, 0.16, s - z0), frame_mi, bottom=False)
        sa = a / 2 - w * 0.03
        for sx_ in (-1, 1):
            prism(g, shift(arch_band(sa, sa * 1.8, s - 0.1 * h, 0, w * 0.035, s - 0.25 * h, 4), cx + sx_ * a / 2), 0.0, 0.12, frame_mi, back=False)
        rr = a * 0.42
        cz = apex(a, R, s) - rr * 1.25
        for k in range(8):
            t = TAU * k / 8
            box(g, (cx + math.cos(t) * rr, 0.07, cz + math.sin(t) * rr), (w * 0.05, 0.14, w * 0.05), frame_mi)


def pinnacle(g, x, y, z, w, hs, hp, lod, mi=PALE, tip=GOLD):
    box(g, (x, y, z + hs / 2), (w, w, hs), mi, bottom=False)
    if lod < 2:
        for k in range(4):
            g.push(t=(x, y, z + hs * 0.72), rz=k * math.pi / 2)
            prism(g, [(-w / 2, 0), (w / 2, 0), (0, w * 0.8)], w / 2, w / 2 + 0.12 * w, mi)
            g.pop()
    g.push(t=(x, y, 0))
    lathe(g, [(w * 0.72, z + hs), (0, z + hs + hp)], 4, mi, rot0=math.pi / 4, cap_top=False)
    if lod == 0:
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            for j in range(1, 4):
                f = j / 4
                rr = w * 0.72 * (1 - f) + 0.05
                box(g, (math.cos(a) * rr, math.sin(a) * rr, z + hs + hp * f), (w * 0.16, w * 0.16, w * 0.22), mi)
    if lod < 2:
        zt = z + hs + hp
        lathe(g, [(0, zt - 0.1), (w * 0.24, zt + w * 0.2), (0, zt + w * 0.62)], 6, tip, cap_top=False)
    g.pop()


def merlons(g, x0, x1, y, z, thick, h, mw, gap, mi):
    L = x1 - x0
    n = max(1, int((L + gap) / (mw + gap)))
    span = n * mw + (n - 1) * gap
    s0 = x0 + (L - span) / 2
    for i in range(n):
        box(g, (s0 + i * (mw + gap) + mw / 2, y, z + h / 2), (mw, thick, h), mi, bottom=False)


def buttress(g, x, w, stages, lod, mi=STONE, pin=True):
    """Stepped buttress on a face at local y=0 (normal +Y). stages = [(z_top, depth), ...] from the ground up."""
    z0 = 0.0
    for zt, d in stages:
        box(g, (x, d / 2, (z0 + zt) / 2), (w, d, zt - z0), mi, bottom=False)
        if lod < 2:
            nd = None
            g.push(t=(x, 0, 0))
            prism_x(g, [(0, zt), (d, zt), (0, zt + d * 0.75)], -w / 2, w / 2, PALE)
            g.pop()
        z0 = zt
    if pin and lod < 2:
        d = stages[-1][1]
        pinnacle(g, x, d / 2, z0, w * 0.6, w * 1.5, w * 1.8, lod)


def feather(base, ang, L, w):
    a = math.radians(ang)
    dx, dz = math.cos(a), math.sin(a)
    nx, nz = -dz, dx
    bx, bz = base
    return [(bx + nx * w / 2, bz + nz * w / 2), (bx + dx * L * 0.8 + nx * w * 0.42, bz + dz * L * 0.8 + nz * w * 0.42),
            (bx + dx * L, bz + dz * L), (bx + dx * L * 0.8 - nx * w * 0.42, bz + dz * L * 0.8 - nz * w * 0.42),
            (bx - nx * w / 2, bz - nz * w / 2)]


def aquila(g, W, lod, mi=GOLD, depth=1.0):
    """The double-headed Imperial eagle as a layered relief on the local y=0 plane, facing +Y. W = wingspan."""
    k = W / 2

    def lay(pts, d):
        prism(g, [(x * k, z * k) for x, z in pts], 0, d * k * depth, mi, back=False)

    lay([(0, 0.30), (0.12, 0.20), (0.15, -0.02), (0.10, -0.26), (0, -0.36), (-0.10, -0.26), (-0.15, -0.02), (-0.12, 0.20)], 0.16)
    tails = [-90, -73, -107, -57, -123] if lod < 2 else [-90]
    for i, a in enumerate(tails):
        lay(feather((0, -0.27), a, 0.33 - 0.04 * (i > 0) - 0.03 * (i > 2), 0.08), 0.06 + 0.004 * i)
    for sd in (1, -1):
        up = [(0.10, 0.16), (0.30, 0.30), (0.55, 0.42), (0.80, 0.52), (0.98, 0.62)]
        lo = [(0.94, 0.48), (0.74, 0.30), (0.52, 0.15), (0.30, 0.03), (0.12, -0.05)]
        lay([(sd * x, z) for x, z in up + lo], 0.10)
        nf = (9, 6, 0)[lod]
        for j in range(nf):
            t = j / max(1, nf - 1)
            bx, bz = 0.17 + 0.74 * t, 0.0 + 0.42 * t
            a = -96 + 68 * t
            L = 0.43 - 0.17 * t
            pts = feather((bx, bz), a, L, 0.095)
            lay([(sd * x, z) for x, z in pts], 0.05 + 0.003 * j)
        if lod == 0:
            for j in range(6):
                t = j / 5
                pts = feather((0.22 + 0.62 * t, 0.15 + 0.36 * t), -88 + 60 * t, 0.2, 0.08)
                lay([(sd * x, z) for x, z in pts], 0.125 + 0.002 * j)
        lay([(sd * x, z) for x, z in [(0.02, 0.22), (0.10, 0.19), (0.22, 0.44), (0.14, 0.49)]], 0.13)
        head = [(0.21 + 0.075 * math.cos(t), 0.50 + 0.075 * math.sin(t)) for t in [math.pi * (0.5 + i / 6) for i in range(7)]]
        head = head + [(0.27, 0.45), (0.37, 0.47), (0.285, 0.535)]
        lay([(sd * x, z) for x, z in head], 0.14)


def annulus(g, cx, cz, r0, r1, n, y0, y1, mi):
    for i in range(n):
        a0, a1 = TAU * i / n, TAU * (i + 1) / n
        prism(g, [(cx + r0 * math.cos(a0), cz + r0 * math.sin(a0)), (cx + r1 * math.cos(a0), cz + r1 * math.sin(a0)),
                  (cx + r1 * math.cos(a1), cz + r1 * math.sin(a1)), (cx + r0 * math.cos(a1), cz + r0 * math.sin(a1))], y0, y1, mi, back=False)


def disc(g, cx, cz, r, n, y0, y1, mi):
    prism(g, [(cx + r * math.cos(TAU * i / n), cz + r * math.sin(TAU * i / n)) for i in range(n)], y0, y1, mi, back=False)


def face_frame(g, x, y, z, rz):
    """Enter the local frame of a wall face at (x, y) whose outward normal points at angle rz+90deg."""
    g.push(t=(x, y, z), rz=rz)


# ------------------------------------------------------------------ pieces
ANCHORS = {}
REC = [True]       # anchors are recorded while building LOD0 only


def anchor(piece, kind, p, yaw=0.0, **extra):
    if not REC[0]:
        return
    ANCHORS.setdefault(piece, {}).setdefault(kind, []).append({"p": [round(p[0], 3), round(p[2], 3), round(-p[1], 3)], "yaw": round(yaw, 4), **extra})


def build_gate(g, lod):
    """The Eternity Gate: twin towers with spires, a pointed portal with gilded archivolts and open bronze doors,
    a gabled front crowned by the aquila, saints in niches."""
    A, S, R, D, X1, TH = 13.0, 18.0, 20.0, 14.0, 37.0, 52.0
    n = (14, 8, 5)[lod]
    TOP = apex(A, R, S)
    box(g, (0, 0, -0.1), (2 * A, 2 * D, 0.3), PAVING, bottom=False)
    # the portal: gallery over the arch, archivolts in front
    prism(g, arch_curve(A, R, S, 0, n) + [(A, TH), (-A, TH)], -D, D, STONE)
    bands = [(0, 0.9, 0.6, GOLD, 0), (0.9, 2.4, 1.3, MARBLE, 0), (2.4, 4.2, 0.8, PALE, 5)] if lod < 2 else [(0, 3.0, 1.0, MARBLE, 0)]
    for t0, t1, dp, mi, zb in bands:
        prism(g, arch_band(A, R, S, t0, t1, zb, n), D, D + dp, mi, back=False)
    prism(g, arch_band(A, R, S, 0, 1.6, 0, n), -D - 0.8, -D, MARBLE, front=False)
    if lod < 2:
        for sx in (-1, 1):
            box(g, (sx * (A + 2.1), D + 0.75, S - 0.3), (4.6, 1.6, 1.2), GOLD)
    if lod == 0:
        for yy in (-6.0, 6.0):
            prism(g, arch_band(A, R, S, -0.7, 0, 0, n), yy - 0.6, yy + 0.6, MARBLE)
    # gable with the great aquila
    GB, GT = TOP + 1.8, TOP + 26.0
    prism(g, [(-19.5, GB), (19.5, GB), (0, GT)], D, D + 0.9, PALE, back=False)
    if lod < 2:
        tube(g, [(-19.8, D + 1.0, GB - 0.2), (0, D + 1.0, GT + 0.2), (19.8, D + 1.0, GB - 0.2)], 0.38, 6 if lod == 0 else 4, GOLD)
        g.push(t=(0, D + 0.9, (GB + GT) / 2 - 2.4))
        aquila(g, 21.0, lod)
        g.pop()
        g.push(t=(0, D + 0.5, 0))
        lathe(g, [(0, GT - 0.3), (1.1, GT + 0.8), (0.55, GT + 2.2), (0, GT + 4.4)], 8, GOLD, cap_top=False)
        g.pop()
    else:
        g.push(t=(0, D + 0.9, (GB + GT) / 2 - 2.4))
        aquila(g, 21.0, 2)
        g.pop()
    if lod == 0:
        for sx in (-1, 1):
            for j in range(1, 9):
                f = j / 9
                box(g, (sx * 19.5 * (1 - f), D + 1.0, GB + (GT - GB) * f + 0.5), (0.7, 0.7, 0.9), GOLD)
    # gallery parapet
    merlons(g, -A, A, D - 0.45, TH + 0.8, 0.9, 3.0, 1.6, 1.0, STONE)
    merlons(g, -A, A, -D + 0.45, TH + 0.8, 0.9, 3.0, 1.6, 1.0, STONE)
    # the doors: two bronze leaves swung open into the passage
    if lod < 2:
        LW = A - 0.8
        half = [p for p in arch_curve(A, R, S, -0.8, n) if p[0] >= -1e-6]
        leaf = [(0, 0), (LW, 0)] + half[::-1]
        leaf = [(min(x, LW), z) for x, z in leaf]
        for sx in (1, -1):
            g.push(sc=(sx, 1, 1))
            g.push(t=(LW, 7.0, 0), rz=math.radians(84))
            g.push(t=(-LW, 0, 0))
            prism(g, leaf, -0.6, 0.6, BRONZE)
            box(g, (0.35, 0.68, S / 2 + 1), (0.5, 0.2, S + 2), GOLD)
            box(g, (LW - 0.35, 0.68, S / 2), (0.5, 0.2, S), GOLD)
            box(g, (LW / 2, 0.68, 0.4), (LW, 0.2, 0.6), GOLD)
            tube(g, [(x, 0.75, z - 0.25) for x, z in half[::-1]], 0.22, 4, GOLD)
            for cx in (LW * 0.27, LW * 0.73):
                for cz in (2.8, 8.4, 14.0):
                    box(g, (cx, 0.75, cz), (LW * 0.38, 0.3, 4.4), BRONZE)
                    if lod == 0:
                        g.push(t=(cx, 0.9, cz), rx=math.pi / 2)
                        lathe(g, [(0, -0.05), (0.5, 0.0), (0.3, 0.25), (0, 0.32)], 6, GOLD, cap_top=False)
                        g.pop()
            g.push(t=(LW / 2, 0.6, S + 5.0))
            aquila(g, 8.6, lod, depth=0.6)
            g.pop()
            g.pop(); g.pop(); g.pop()
    # towers (the left one is the right one mirrored)
    for sx in (1, -1):
        g.push(sc=(sx, 1, 1))
        cx = (A + X1) / 2
        box(g, (cx, 0, 2.5), (X1 - A + 1.2, 2 * D + 1.2, 5), DARK, bottom=False)
        if lod < 2:
            g.push(t=(cx, 0, 0))
            prism_x(g, [(D + 0.6, 5), (D, 5), (D, 6.2)], -(X1 - A + 1.2) / 2, (X1 - A + 1.2) / 2, DARK, caps=False)
            prism_x(g, [(-D - 0.6, 5), (-D, 6.2), (-D, 5)], -(X1 - A + 1.2) / 2, (X1 - A + 1.2) / 2, DARK, caps=False)
            g.pop()
        box(g, (cx, 0, (5 + TH) / 2), (X1 - A, 2 * D, TH - 5), STONE, bottom=False, top=True)
        # string courses
        for z in ((17.0, 33.0) if lod < 2 else ()):
            box(g, (cx, D + 0.3, z), (X1 - A + 0.6, 0.6, 0.9), PALE)
            box(g, (cx, -D - 0.3, z), (X1 - A + 0.6, 0.6, 0.9), PALE)
            box(g, (X1 + 0.3, 0, z), (0.6, 2 * D + 0.6, 0.9), PALE)
        if lod < 2:
            box(g, (A - 0.3, 0, 17.0), (0.6, 2 * D, 0.9), PALE)
        box(g, (cx, 0, TH + 0.4), (X1 - A + 1.6, 2 * D + 1.6, 0.8), PALE)
        if lod == 0:
            for x in [A + 1.2 + i * 2.0 for i in range(12)]:
                box(g, (x, D + 0.55, TH - 0.7), (0.7, 1.1, 1.2), PALE)
                box(g, (x, -D - 0.55, TH - 0.7), (0.7, 1.1, 1.2), PALE)
        # parapet
        merlons(g, A + 0.4, X1 + 0.4, D + 0.35, TH + 0.8, 0.9, 3.2, 1.7, 1.1, STONE)
        merlons(g, A + 0.4, X1 + 0.4, -D - 0.35, TH + 0.8, 0.9, 3.2, 1.7, 1.1, STONE)
        g.push(t=(X1 + 0.35, 0, 0), rz=math.pi / 2)
        merlons(g, -D, D, 0, TH + 0.8, 0.9, 3.2, 1.7, 1.1, STONE)
        g.pop()
        # niches with saints, windows above, front buttress
        for xn in (19.2, 30.8):
            if lod < 2:
                box(g, (xn, D + 0.9, 18.0), (3.6, 1.8, 0.8), PALE)
                box(g, (xn, D + 0.5, 17.2), (2.4, 1.0, 0.8), PALE)
                na, nR = 1.9, 2.2
                ns = 27.6 - apex(na, nR, 0)
                prism(g, shift(arch_fill(na, nR, ns, 18.4, n), xn), D, D + 0.04, DARK, back=False, sides=False)
                prism(g, shift(arch_band(na, nR, ns, 0, 0.5, 18.4, n), xn), D, D + 1.0, MARBLE, back=False)
                prism(g, [(xn - 2.7, 27.9), (xn + 2.7, 27.9), (xn, 31.4)], D, D + 1.2, PALE, back=False)
                if lod == 0:
                    for s2 in (-1, 1):
                        pinnacle(g, xn + s2 * 2.75, D + 0.6, 26.6, 0.6, 1.9, 1.7, lod)
            if sx == 1:
                anchor("eternity_gate", "niche", (xn, D + 0.9, 18.4), 0.0, h=6.6)
                anchor("eternity_gate", "niche", (-xn, D + 0.9, 18.4), 0.0, h=6.6)
            g.push(t=(xn, D, 0))
            lancet(g, 0, 35.0, 3.2, 13.0, lod)
            g.pop()
            g.push(t=(xn, -D, 0), rz=math.pi)
            lancet(g, 0, 35.0, 3.2, 13.0, lod)
            if lod < 2:
                lancet(g, 0, 20.0, 2.6, 9.0, lod)
            g.pop()
        g.push(t=(X1, 0, 0), rz=-math.pi / 2)
        for xw in (-7.5, 7.5):
            lancet(g, xw, 35.0, 3.0, 12.0, lod)
            if lod < 2:
                lancet(g, xw, 20.0, 2.4, 8.0, lod)
        g.pop()
        g.push(t=(0, D, 0))
        buttress(g, X1 - 1.4, 2.8, [(16, 3.6), (32, 2.6), (48, 1.6)], lod)
        g.pop()
        g.push(t=(0, -D, 0), rz=math.pi)
        buttress(g, -(X1 - 1.4), 2.8, [(16, 3.0), (32, 2.0), (48, 1.4)], lod)
        g.pop()
        g.push(t=(X1, 0, 0), rz=-math.pi / 2)
        buttress(g, 0, 3.0, [(18, 3.0), (36, 2.0)], lod)
        g.pop()
        # crown: corner pinnacles, turret and spire
        if lod < 2:
            for px in (A + 1.3, X1 - 1.3):
                for py in (D - 1.3, -D + 1.3):
                    pinnacle(g, px, py, TH + 0.8, 2.0, 5.5, 6.0, lod)
        g.push(t=(cx, 0, 0))
        lathe(g, [(7.2, TH + 0.8), (7.2, TH + 12.0)], 8, PALE, rot0=math.pi / 8)
        lathe(g, [(7.2, TH + 12.0), (7.9, TH + 12.0), (7.9, TH + 13.2), (6.7, TH + 13.2)], 8, PALE, rot0=math.pi / 8, cap_top=False)
        if lod < 2:
            for k in range(8):
                g.push(rz=k * math.pi / 4 - math.pi / 2)
                g.push(t=(0, 7.2 * math.cos(math.pi / 8), 0))
                lancet(g, 0, TH + 3.0, 1.6, 6.5, lod)
                g.pop(); g.pop()
        lathe(g, [(6.6, TH + 13.2), (0.25, TH + 44.0)], 8, ROOF, rot0=math.pi / 8, cap_top=False)
        if lod == 0:
            for k in range(8):
                a = math.pi / 8 + k * math.pi / 4
                tube(g, [(6.7 * math.cos(a), 6.7 * math.sin(a), TH + 13.2), (0.3 * math.cos(a), 0.3 * math.sin(a), TH + 44.0)], 0.16, 4, GOLD)
            for k in range(4):
                g.push(rz=k * math.pi / 2)
                g.push(t=(4.4, 0, TH + 22.0), rz=-math.pi / 2)
                box(g, (0, 0.3, 1.2), (2.0, 1.6, 2.4), PALE)
                prism(g, [(-1.1, 2.4), (1.1, 2.4), (0, 4.0)], -0.5, 1.1, ROOF)
                lancet(g, 0, 0.3, 0.9, 1.8, 1)
                g.pop(); g.pop()
        if lod < 2:
            lathe(g, [(0, TH + 43.6), (0.9, TH + 44.6), (0.9, TH + 45.0), (0.2, TH + 45.6), (0.7, TH + 46.6), (0, TH + 49.0)], 8, GOLD, cap_top=False)
        g.pop()
        g.pop()
    for sx in (-1, 1):
        anchor("eternity_gate", "brazier", (sx * 9.5, D + 7.0, 0))
        anchor("eternity_gate", "sentinel", (sx * 6.8, D + 3.2, 0), 0.0)
        anchor("eternity_gate", "sentinel", (sx * 10.8, -2.0, 0), sx * math.pi / 2)
        anchor("eternity_gate", "banner", (sx * 25.0, D + 0.7, TH - 0.6), 0.0, len=13.0)
        anchor("eternity_gate", "sentry", (sx * 25.0, 0.0, TH + 0.8), 0.0)


def build_wall(g, lod):
    """Palace curtain wall, 24 m long, 26 m high: battered plinth, buttress, lancets, machicolated parapet."""
    HL, T, H = 12.0, 5.0, 26.0
    box(g, (0, 0, H / 2), (2 * HL, 2 * T, H), STONE, bottom=False)
    prism_x(g, [(T, 0), (T + 2.2, 0), (T, 5.5)], -HL, HL, DARK, caps=False)
    if lod < 2:
        for z in (6.0, 18.0):
            box(g, (0, T + 0.3, z), (2 * HL, 0.6, 0.9), PALE)
            box(g, (0, -T - 0.3, z), (2 * HL, 0.6, 0.9), PALE)
    box(g, (0, 0, H + 0.4), (2 * HL, 2 * T + 1.4, 0.8), PALE)
    if lod == 0:
        for i in range(12):
            x = -HL + 1.0 + i * 2.0
            box(g, (x, T + 0.55, H - 0.7), (0.7, 1.1, 1.2), PALE)
    merlons(g, -HL, HL, T + 0.3, H + 0.8, 0.8, 3.2, 1.8, 1.2, STONE)
    merlons(g, -HL, HL, -T - 0.3, H + 0.8, 0.8, 2.4, 1.8, 1.2, STONE)
    g.push(t=(0, T, 0))
    buttress(g, -HL, 3.0, [(14, 3.2), (24, 2.0)], lod)
    for x in (-6.0, 6.0):
        lancet(g, x, 10.5, 2.6, 9.5, lod)
    g.pop()
    g.push(t=(0, -T, 0), rz=math.pi)
    if lod < 2:
        for xc in (-8.0, 0.0, 8.0):
            prism(g, shift(arch_band(3.0, 3.6, 12.0, 0, 0.5, 2.0, (8, 5, 3)[lod]), xc), 0, 0.5, PALE, back=False)
            prism(g, shift(arch_fill(3.0, 3.6, 12.0, 2.0, (8, 5, 3)[lod]), xc), 0, 0.03, DARK, back=False, sides=False)
    g.pop()
    anchor("palace_wall", "banner", (0, T + 0.7, H - 0.4), 0.0, len=14.0)
    anchor("palace_wall", "sentry", (-6.0, 0.0, H + 0.8), 0.0)
    anchor("palace_wall", "sentry", (6.0, 0.0, H + 0.8), 0.0)


def build_tower(g, lod):
    """Octagonal palace tower: battered base, lancets, machicolations, corner pinnacles and a slate spire."""
    R, r0 = 12.0, math.pi / 8
    ap = R * math.cos(math.pi / 8)
    lathe(g, [(13.4, 0), (12.3, 6.0)], 8, DARK, rot0=r0, cap_top=False)
    lathe(g, [(12.0, 6.0), (12.0, 33.0)], 8, STONE, rot0=r0, cap_top=True)
    if lod < 2:
        for z in (6.0, 17.0):
            lathe(g, [(12.0, z - 0.45), (12.4, z - 0.45), (12.4, z + 0.45), (12.0, z + 0.45)], 8, PALE, rot0=r0, cap_top=False)
    lathe(g, [(12.0, 32.4), (13.0, 32.4), (13.0, 33.6), (9.6, 33.6)], 8, PALE, rot0=r0, cap_top=False)
    edge = 2 * R * math.sin(math.pi / 8)
    for k in range(8):
        g.push(rz=k * math.pi / 4 - math.pi / 2)
        g.push(t=(0, ap + 0.6, 0))
        merlons(g, -edge / 2 + 0.3, edge / 2 - 0.3, 0, 33.6, 0.8, 3.0, 1.6, 1.0, STONE)
        if lod == 0:
            for x in (-3.0, 0.0, 3.0):
                box(g, (x, -0.3, 31.6), (0.7, 1.0, 1.2), PALE)
        g.pop()
        if k % 2 == 0 or lod == 0:
            g.push(t=(0, ap, 0))
            if k % 2 == 0:
                lancet(g, 0, 19.0, 3.0, 10.0, lod)
            if lod == 0:
                lancet(g, 0, 8.0, 1.8, 6.0, lod)
            g.pop()
        g.pop()
    if lod < 2:
        for k in range(8):
            a = r0 + k * math.pi / 4
            pinnacle(g, 12.2 * math.cos(a), 12.2 * math.sin(a), 33.6, 1.6, 4.5, 4.5, lod)
    lathe(g, [(9.2, 33.6), (9.2, 35.5), (8.8, 35.5)], 8, PALE, rot0=r0, cap_top=False)
    lathe(g, [(8.8, 35.5), (0.2, 72.0)], 8, ROOF, rot0=r0, cap_top=False)
    if lod == 0:
        for k in range(8):
            a = r0 + k * math.pi / 4
            tube(g, [(8.9 * math.cos(a), 8.9 * math.sin(a), 35.5), (0.25 * math.cos(a), 0.25 * math.sin(a), 72.0)], 0.15, 4, GOLD)
        for k in range(4):
            g.push(rz=k * math.pi / 2)
            g.push(t=(6.2, 0, 44.0), rz=-math.pi / 2)
            box(g, (0, 0.3, 1.2), (2.2, 1.6, 2.4), PALE)
            prism(g, [(-1.2, 2.4), (1.2, 2.4), (0, 4.1)], -0.5, 1.1, ROOF)
            lancet(g, 0, 0.3, 1.0, 1.8, 1)
            g.pop(); g.pop()
    if lod < 2:
        lathe(g, [(0, 71.6), (0.9, 72.6), (0.9, 73.0), (0.2, 73.6), (0.65, 74.6), (0, 77.0)], 8, GOLD, cap_top=False)
    anchor("palace_tower", "banner", (0, ap + 0.7, 30.5), 0.0, len=12.0)


def build_throne(g, lod):
    """The Golden Throne: gilded seat of the Emperor with a sunburst halo, aquila crest, machine pylons and cables."""
    seg = (12, 8, 6)[lod]
    box(g, (0, 0, 0.8), (10.0, 8.0, 1.6), GOLD)
    if lod < 2:
        box(g, (0, 4.03, 0.8), (8.4, 0.1, 1.0), MARBLE)
        for sx in (-1, 1):
            box(g, (sx * 5.03, 0, 0.8), (0.1, 6.4, 1.0), MARBLE)
    box(g, (0, 0.3, 3.0), (6.4, 4.6, 2.8), GOLD)
    box(g, (0, 0.5, 4.6), (6.0, 4.0, 0.4), CLOTH)
    if lod < 2:
        g.push(t=(0, 2.62, 2.9))
        aquila(g, 3.8, lod)
        g.pop()
    for sx in (-1, 1):
        box(g, (sx * 3.9, 0.3, 5.3), (1.6, 4.8, 1.8), GOLD)
        g.push(t=(sx * 3.9, 2.8, 6.2))
        lathe(g, [(0, 0), (0.55, 0.15), (0.7, 0.55), (0.5, 0.95), (0.18, 1.1), (0.22, 1.5), (0, 2.1)], seg, GOLD, smooth=True, cap_top=False)
        g.pop()
        if lod == 0:
            g.push(t=(sx * 4.71, 0.3, 0), rz=sx * -math.pi / 2)
            for xx in (-1.3, 1.3):
                prism(g, shift(arch_band(0.5, 0.6, 5.2, 0, 0.12, 4.6, 4), xx), 0, 0.12, PALE, back=False)
            g.pop()
    back = [(-4.4, 0), (4.4, 0), (4.4, 8.5), (2.8, 11.8), (0, 14.6), (-2.8, 11.8), (-4.4, 8.5)]
    prism(g, shift(back, 0, 4.4), -2.6, -1.2, GOLD)
    prism(g, shift([(x * 0.8, z * 0.86 + 0.6) for x, z in back], 0, 4.4), -1.2, -1.0, CLOTH, back=False)
    if lod < 2:
        rim = [(4.4, 0.4), (4.4, 8.5), (2.8, 11.8), (0, 14.6), (-2.8, 11.8), (-4.4, 8.5), (-4.4, 0.4)]
        tube(g, [(x * 0.97, -1.0, z + 4.4) for x, z in rim], 0.22, 5, GOLD)
    if lod == 0:
        for xx in (-1.7, 1.7):
            prism(g, shift(arch_band(1.0, 1.3, 13.0, 0, 0.14, 6.0, 6), xx), -1.0, -0.85, GOLD, back=False)
    # halo
    hc = 4.4 + 10.6
    nsp = (32, 16, 8)[lod]
    for i in range(nsp):
        a = TAU * i / nsp + math.pi / 2
        L = 9.6 if i % 2 == 0 else 6.6
        dx, dz = math.cos(a), math.sin(a)
        nx, nz = -dz, dx
        w = 0.55 if i % 2 == 0 else 0.4
        prism(g, [(dx * 3.4 + nx * w, hc + dz * 3.4 + nz * w), (dx * L, hc + dz * L), (dx * 3.4 - nx * w, hc + dz * 3.4 - nz * w)], -3.3, -2.9, GOLD, back=False)
    annulus(g, 0, hc, 3.0, 3.9, (24, 16, 10)[lod], -3.1, -2.6, GOLD)
    disc(g, 0, hc, 3.0, (24, 16, 10)[lod], -3.05, -2.95, GLOW)
    g.push(t=(0, -1.3, 4.4 + 16.3))
    aquila(g, 7.2, lod)
    g.pop()
    # machine pylons and cable bundles
    for sx in (-1, 1):
        g.push(t=(sx * 7.8, -1.0, 0))
        lathe(g, [(1.7, 0), (1.6, 0.6), (1.6, 9.5)], 8, IRON, rot0=math.pi / 8)
        lathe(g, [(1.95, 9.5), (1.95, 10.1), (0.2, 12.6)], 8, GOLD, rot0=math.pi / 8, cap_top=False)
        if lod < 2:
            for k in range(4):
                g.push(rz=k * math.pi / 2 + math.pi / 4)
                box(g, (0, 1.52, 5.0), (0.28, 0.12, 7.0), GLOW)
                g.pop()
            lathe(g, [(0, 12.4), (0.5, 12.8), (0, 13.6)], 6, GLOWR, cap_top=False)
        g.pop()
        if lod < 2:
            tube(g, bezier((sx * 6.3, -1.0, 7.6), (sx * 5.6, -1.4, 8.4), (sx * 5.0, -1.8, 8.2), (sx * 4.3, -2.0, 7.4), 5), 0.32, 6, CABLE)
            tube(g, bezier((sx * 6.3, -1.4, 3.0), (sx * 5.7, -2.2, 3.0), (sx * 5.0, -2.4, 3.5), (sx * 4.5, -2.0, 4.2), 5), 0.26, 6, GOLD)
    if lod < 2:
        nc = 10 if lod == 0 else 5
        for i in range(nc):
            x = -3.6 + 7.2 * i / (nc - 1)
            z0 = 6.0 + (i * 37 % 5) * 1.1
            r = 0.22 + 0.06 * (i % 3)
            pts = bezier((x, -2.7, z0), (x * 1.1, -6.0, z0 + 0.5), (x * 1.6, -8.0, 1.8), (x * 1.9, -10.0 - (i % 3) * 0.8, 0.15), 7 if lod == 0 else 4)
            tube(g, pts, r, 6 if lod == 0 else 4, CABLE)
    if lod == 0:
        for i in range(12):
            x = -4.6 + 9.2 * i / 11
            h = 0.5 + (i * 7 % 5) * 0.12
            g.push(t=(x, 4.25, 1.6))
            lathe(g, [(0.09, 0), (0.09, h)], 6, BONE)
            lathe(g, [(0, h), (0.05, h + 0.06), (0, h + 0.22)], 4, GLOW, cap_top=False)
            g.pop()
    anchor("golden_throne", "occupant", (0, 0.5, 4.8), 0.0, h=6.2)


def build_dais(g, lod):
    """Stepped octagonal dais of marble and gold, with a stair to the throne and candles."""
    r0 = math.pi / 8
    steps = [(15.0, 0.0, 1.2), (12.2, 1.2, 2.4), (9.4, 2.4, 3.6)]
    for r, z0, z1 in steps:
        lathe(g, [(r, z0), (r, z1)], 8, MARBLE, rot0=r0)
        if lod < 2:
            lathe(g, [(r, z1 - 0.32), (r + 0.12, z1 - 0.32), (r + 0.12, z1), (r, z1)], 8, GOLD, rot0=r0, cap_top=False)
    if lod < 2:
        lathe(g, [(6.4, 3.6), (6.4, 3.63), (5.8, 3.63)], 8, GOLD, rot0=r0, cap_top=False)
    for i in range(9):
        z = 0.4 * (i + 1)
        yf = 15.2 - 0.7 * i
        box(g, (0, (yf + 8.0) / 2, z / 2), (7.0, yf - 8.0, z), MARBLE, bottom=False)
    if lod == 0:
        for i in range(9):
            z = 0.4 * (i + 1)
            yf = 15.2 - 0.7 * i
            for sx in (-1, 1):
                g.push(t=(sx * 3.9, yf - 0.3, z))
                lathe(g, [(0.08, 0), (0.08, 0.5 + 0.1 * (i % 3))], 6, BONE)
                lathe(g, [(0, 0.5 + 0.1 * (i % 3)), (0.045, 0.56 + 0.1 * (i % 3)), (0, 0.72 + 0.1 * (i % 3))], 4, GLOW, cap_top=False)
                g.pop()
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        anchor("throne_dais", "brazier", (math.cos(a) * 8.0, math.sin(a) * 8.0, 3.6))
    anchor("throne_dais", "throne", (0, 0, 3.6), 0.0)


def build_hall(g, lod):
    """The throne hall: open arcaded front under a gable with an oculus, rose window, side lancets, pitched roof."""
    W, YB, YF, H = 30.0, -24.0, 20.0, 36.0
    n = (12, 7, 4)[lod]
    box(g, (0, (YB + YF) / 2, 0.15), (2 * W, YF - YB, 0.3), FLOOR, bottom=False)
    box(g, (0, YB + 2, (H + 4) / 2), (2 * W, 4, H + 4), STONE, bottom=False)
    for sx in (-1, 1):
        box(g, (sx * (W - 2), (YB + 4 + YF - 4) / 2, H / 2), (4, YF - YB - 8, H), STONE, bottom=False)
        box(g, (sx * 9, YF - 2, H / 2), (3, 4, H), STONE, bottom=False)
        box(g, (sx * 21, YF - 2, H / 2), (3, 4, H), STONE, bottom=False)
        box(g, (sx * 26.25, YF - 2, H / 2), (7.5, 4, H), STONE, bottom=False)
    prism(g, arch_curve(7.5, 10.0, 16.0, 0, n) + [(7.5, H), (-7.5, H)], YF - 4, YF, STONE)
    for sx in (-1, 1):
        prism(g, shift(arch_curve(4.5, 6.0, 13.0, 0, n) + [(4.5, H), (-4.5, H)], sx * 15), YF - 4, YF, STONE)
    if lod < 2:
        prism(g, arch_band(7.5, 10.0, 16.0, 0, 0.8, 0, n), YF, YF + 0.6, GOLD, back=False)
        prism(g, arch_band(7.5, 10.0, 16.0, 0.8, 2.0, 0, n), YF, YF + 1.1, MARBLE, back=False)
        for sx in (-1, 1):
            prism(g, shift(arch_band(4.5, 6.0, 13.0, 0, 1.0, 0, n), sx * 15), YF, YF + 0.8, MARBLE, back=False)
    if lod == 0:
        for xx in (-10.6, -7.4, 7.4, 10.6, -22.6, -19.4, 19.4, 22.6):
            g.push(t=(xx, YF + 0.2, 0))
            lathe(g, [(0.5, 0), (0.5, H)], 10, PALE, smooth=True)
            g.pop()
    # front gable with oculus and aquila, pinnacles on the piers
    prism(g, [(-W, H), (W, H), (0, H + 16)], YF - 1.5, YF + 0.5, PALE)
    disc(g, 0, H + 6.2, 3.8, (20, 12, 8)[lod], YF + 0.5, YF + 0.55, GLOW)
    if lod < 2:
        annulus(g, 0, H + 6.2, 3.8, 4.7, (20, 12, 8)[lod], YF + 0.5, YF + 0.9, MARBLE)
        tube(g, [(-W - 0.3, YF + 0.7, H - 0.2), (0, YF + 0.7, H + 16.3), (W + 0.3, YF + 0.7, H - 0.2)], 0.32, 5, GOLD)
        g.push(t=(0, YF + 0.5, 29.8))
        aquila(g, 12.5, lod)
        g.pop()
        for px in (-29.0, -21.0, -9.0, 9.0, 21.0, 29.0):
            pinnacle(g, px, YF - 1.5, H, 2.0, 5.5, 7.0, lod)
        g.push(t=(0, YF - 0.5, 0))
        lathe(g, [(0, H + 15.6), (1.0, H + 16.6), (0.5, H + 18.0), (0, H + 20.5)], 8, GOLD, cap_top=False)
        g.pop()
    # roof
    prism(g, [(-W - 0.8, H), (W + 0.8, H), (0, H + 16)], YB, YF - 1.5, ROOF, front=False)
    if lod < 2:
        for sx in (-1, 1):
            g.push(t=(sx * (W - 0.4), 0, 0), rz=math.pi / 2)
            merlons(g, YB, YF - 2, 0, H, 0.8, 2.0, 1.4, 1.0, STONE)
            g.pop()
    if lod == 0:
        for i in range(12):
            y = YB + 2 + i * (YF - YB - 5) / 11
            g.push(t=(0, y, 0))
            lathe(g, [(0, H + 15.8), (0.35, H + 16.2), (0, H + 18.0)], 4, GOLD, cap_top=False)
            g.pop()
    # rose window on the back wall, lancets in the side walls
    rc = 26.0
    disc(g, 0, rc, 8.0, (28, 16, 10)[lod], YB + 4.0, YB + 4.05, GLOW)
    if lod < 2:
        annulus(g, 0, rc, 8.0, 9.2, (28, 16, 10)[lod], YB + 4.0, YB + 4.6, MARBLE)
        for k in range(12):
            a = TAU * k / 12
            g.push(t=(math.cos(a) * 4.8, YB + 4.2, rc + math.sin(a) * 4.8), ry=-a)
            box(g, (0, 0, 0), (6.4, 0.4, 0.35), MARBLE)
            g.pop()
        annulus(g, 0, rc, 1.6, 2.2, 12, YB + 4.0, YB + 4.5, MARBLE)
    for sx in (-1, 1):
        for y in (-12.0, -2.0, 8.0):
            g.push(t=(sx * (W - 4), y, 0), rz=sx * math.pi / 2)
            lancet(g, 0, 8.0, 3.4, 17.0, lod)
            g.pop()
            if lod < 2:
                g.push(t=(sx * W, y, 0), rz=-sx * math.pi / 2)
                lancet(g, 0, 8.0, 3.4, 17.0, lod)
                g.pop()
    if lod == 0:
        for y in (-10.0, 4.0):
            prism(g, arch_band(26.0, 27.0, 18.0, -1.0, 0, 0, 10), y - 0.6, y + 0.6, PALE)
    anchor("throne_hall", "dais", (0, -7.0, 0.3), 0.0)
    for sx in (-1, 1):
        for y in (12.0, 0.0, -12.0):
            anchor("throne_hall", "brazier", (sx * 16.0, y, 0.3))
        anchor("throne_hall", "banner", (sx * 15.0, YF + 0.7, H - 0.8), 0.0, len=12.0)


def build_skyline(g, lod, variant):
    """Palace skyline block far behind the battlefield: a base of sanctums, four spired towers, and either a great
    spire or a gilded dome in the middle."""
    n = (16, 10, 6)[lod]
    box(g, (0, 0, 20), (80, 60, 40), STONE, bottom=False)
    box(g, (0, 0, 40.5), (82, 62, 1.0), PALE, bottom=False)
    g.push(t=(0, 30, 0))
    for z0 in ((8.0, 24.0) if lod < 2 else (14.0,)):
        for x in range(-34, 35, 8):
            lancet(g, x, z0, 2.6, 10.0 if z0 > 10 else 9.0, 2 if lod > 0 else 1)
    if lod < 2:
        for x in (-40, -20, 0, 20, 40):
            box(g, (x, 2.0, 18.0), (2.6, 4.0, 36.0), STONE, bottom=False)
            if lod == 0:
                pinnacle(g, x, 2.0, 41.0, 1.8, 4.0, 5.0, 1)
    g.pop()
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.push(t=(sx * 32, sy * 22, 0))
            lathe(g, [(7.0, 40.0), (7.0, 82.0)], 8, STONE, rot0=math.pi / 8)
            lathe(g, [(7.0, 81.2), (7.8, 81.2), (7.8, 82.6), (5.6, 82.6)], 8, PALE, rot0=math.pi / 8, cap_top=False)
            lathe(g, [(5.6, 82.6), (0, 118.0)], 8, ROOF, rot0=math.pi / 8, cap_top=False)
            if lod < 2:
                lathe(g, [(0, 117.6), (0.6, 118.4), (0, 121.0)], 6, GOLD, cap_top=False)
                for k in range(4):
                    g.push(rz=k * math.pi / 2 - math.pi / 2)
                    g.push(t=(0, 7.0 * math.cos(math.pi / 8), 0))
                    lancet(g, 0, 60.0, 1.8, 12.0, 2)
                    g.pop(); g.pop()
            g.pop()
            if lod == 0:
                tube(g, [(sx * 26, sy * 18, 70), (sx * 13.5, sy * 13.5, 96)], 1.0, 4, STONE, smooth=False)
    if variant == "a":
        box(g, (0, 0, 75), (26, 26, 70), PALE, bottom=False)
        for k in range(4):
            g.push(rz=k * math.pi / 2)
            g.push(t=(0, 13, 0))
            for x in (-6.0, 6.0):
                lancet(g, x, 70.0, 3.2, 28.0, 2 if lod else 1)
            if lod < 2:
                for x in (-13.0, 13.0):
                    box(g, (x, 1.5, 75.0), (2.4, 3.0, 70.0), PALE, bottom=False)
            g.pop(); g.pop()
        if lod < 2:
            for x in (-12.0, 12.0):
                for y in (-12.0, 12.0):
                    pinnacle(g, x, y, 110.0, 2.6, 7.0, 9.0, 1)
        lathe(g, [(10.0, 110.0), (10.0, 128.0)], 8, PALE, rot0=math.pi / 8)
        lathe(g, [(9.0, 128.0), (0.4, 190.0)], 8, ROOF, rot0=math.pi / 8, cap_top=False)
        if lod == 0:
            for k in range(8):
                a = math.pi / 8 + k * math.pi / 4
                tube(g, [(9.1 * math.cos(a), 9.1 * math.sin(a), 128.0), (0.45 * math.cos(a), 0.45 * math.sin(a), 190.0)], 0.3, 4, GOLD)
        lathe(g, [(0, 189.5), (1.6, 191.0), (0.4, 193.0), (1.0, 194.0), (0, 198.0)], 8, GOLD, cap_top=False)
    else:
        lathe(g, [(18.0, 40.0), (18.0, 62.0)], n * 2, PALE)
        if lod < 2:
            for k in range(12):
                g.push(rz=k * TAU / 12 - math.pi / 2)
                g.push(t=(0, 18.0 * math.cos(math.pi / (n * 2)), 0))
                lancet(g, 0, 46.0, 2.4, 12.0, 2)
                g.pop(); g.pop()
        prof = [(19.0 * math.cos(t), 62.0 + 21.0 * math.sin(t)) for t in [i * (math.pi / 2) / (n // 2 + 2) for i in range(n // 2 + 3)]]
        prof[-1] = (0.0, 83.0)
        lathe(g, [(18.0, 62.0), (19.0, 62.0)] + prof, n * 2, GOLD, smooth=True, cap_top=False)
        lathe(g, [(3.2, 82.4), (3.2, 89.0), (3.8, 89.0), (0, 96.0)], 8, PALE, cap_top=False)
        lathe(g, [(0, 95.6), (0.8, 96.6), (0, 101.0)], 6, GOLD, cap_top=False)


def build_banner(g, lod):
    """Imperial banner: crimson cloth with a gold border and aquila, hanging from a gilded crossbar."""
    nx, nz = (6, 4, 2)[lod], (14, 8, 3)[lod]
    L, hw = 14.0, 2.6
    tube(g, [(-3.3, 0.3, 0), (3.3, 0.3, 0)], 0.18, (8, 6, 4)[lod], GOLD, caps=True)
    if lod < 2:
        for sx in (-1, 1):
            g.push(t=(sx * 3.5, 0.3, -0.35))
            lathe(g, [(0, 0), (0.32, 0.2), (0.35, 0.4), (0.2, 0.6), (0, 0.9)], 6, GOLD, smooth=True, cap_top=False)
            g.pop()

    def wave(x, z):
        return 0.3 + (0.26 * math.sin(z * 0.45 + x * 0.6) if lod < 2 else 0.0)

    def zz(i, j):
        z = -L * j / nz
        if j == nz:
            z -= 1.6 * (1 - abs(2 * i / nx - 1))
        return z
    for side, dy, out in ((0, 0.02, (0, 1, 0)), (1, -0.02, (0, -1, 0))):
        V = [[g.v((-hw + 2 * hw * i / nx, wave(-hw + 2 * hw * i / nx, zz(i, j)) + dy, zz(i, j))) for j in range(nz + 1)] for i in range(nx + 1)]
        for i in range(nx):
            for j in range(nz):
                g.face([V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]], CLOTH, out)
    if lod < 2:
        edge = [(-hw + 0.25, zz(0, j) + (0.0 if j < nz else 0.6)) for j in range(nz + 1)]
        for sx in (-1, 1):
            tube(g, [(sx * (hw - 0.25), wave(sx * (hw - 0.25), z) + 0.09, z) for _, z in edge], 0.09, 4, GOLD)
        bottom = [(-hw + 2 * hw * i / nx, zz(i, nz) + 0.35) for i in range(nx + 1)]
        tube(g, [(x, wave(x, z) + 0.09, z) for x, z in bottom], 0.09, 4, GOLD)
        tube(g, [(-hw, 0.4, -0.5), (hw, 0.4, -0.5)], 0.09, 4, GOLD)
    g.push(t=(0, wave(0, -5.6) + 0.05, -5.6))
    aquila(g, 4.0, lod, depth=0.35)
    g.pop()


def build_brazier(g, lod):
    seg = (12, 8, 6)[lod]
    lathe(g, [(0.95, 0), (0.95, 0.25), (0.55, 0.42), (0.26, 0.62), (0.2, 2.15), (0.34, 2.3)], seg, BRONZE, smooth=lod < 2, cap_top=False)
    lathe(g, [(0.3, 2.28), (0.9, 2.5), (1.15, 2.85), (1.22, 3.02), (1.02, 3.0)], seg, GOLD, smooth=lod < 2, cap_top=False)
    lathe(g, [(1.03, 2.92), (0.0, 2.98)], seg, GLOW, cap_top=False)
    if lod == 0:
        for k in range(4):
            a = TAU * k / 4
            g.push(t=(math.cos(a) * 1.18, math.sin(a) * 1.18, 2.7))
            lathe(g, [(0, -0.15), (0.13, 0), (0, 0.15)], 6, GOLD, cap_top=False)
            g.pop()
    anchor("brazier", "fire", (0, 0, 3.1))


def build_servo_skull(g, lod):
    seg = (12, 8, 6)[lod]
    prof = [(0, 0.02), (0.12, 0.04), (0.2, 0.12), (0.23, 0.24), (0.21, 0.34), (0.13, 0.42), (0, 0.45)]
    lathe(g, prof, seg, BONE, smooth=True, cap_top=False, sy=1.15)
    box(g, (0, 0.17, 0.1), (0.28, 0.14, 0.15), BONE)
    for sx in (-1, 1):
        g.push(t=(sx * 0.085, 0.19, 0.22))
        lathe(g, [(0, -0.06), (0.06, 0), (0, 0.06)], 6, IRON, cap_top=False)
        g.pop()
    g.push(t=(0.085, 0.235, 0.22))
    lathe(g, [(0, -0.045), (0.05, 0), (0, 0.045)], 6, GLOWR, cap_top=False)
    g.pop()
    if lod < 2:
        box(g, (-0.09, 0.22, 0.25), (0.12, 0.05, 0.1), GOLD)
        lathe(g, [(0.235, 0.2), (0.255, 0.2), (0.255, 0.26), (0.235, 0.26)], seg, GOLD, cap_top=False, sy=1.15)
        tube(g, [(0.1, -0.1, 0.38), (0.18, -0.25, 0.75)], 0.012, 4, IRON)
        g.push(t=(0.18, -0.25, 0.76))
        lathe(g, [(0, -0.03), (0.03, 0), (0, 0.03)], 4, GLOWR, cap_top=False)
        g.pop()
        lathe(g, [(0.1, -0.12), (0.14, -0.05), (0.1, 0.03)], seg, IRON, cap_bot=True)
        lathe(g, [(0.09, -0.125), (0.0, -0.125)], seg, GLOWR, cap_top=False)


def build_pilgrim(g, lod, kneel):
    seg = (10, 7, 5)[lod]
    if not kneel:
        lathe(g, [(0.36, 0), (0.33, 0.4), (0.26, 0.9), (0.22, 1.2), (0.19, 1.38), (0.14, 1.45)], seg, ROBE, smooth=True, sy=0.82)
        g.push(t=(0, 0.02, 0))
        lathe(g, [(0.17, 1.36), (0.2, 1.5), (0.17, 1.66), (0.1, 1.75), (0, 1.78)], seg, ROBE, smooth=True, cap_top=False, sy=1.05)
        g.pop()
        box(g, (0, 0.16, 1.56), (0.14, 0.05, 0.17), DARK)
        if lod < 2:
            for sx in (-1, 1):
                tube(g, [(sx * 0.2, 0.0, 1.36), (sx * 0.17, 0.12, 1.16), (sx * 0.07, 0.22, 1.02)], 0.075, 5, ROBE)
            tube(g, [(0, 0.24, 1.0), (0, 0.24, 1.22)], 0.028, 5, BONE, caps=True)
            g.push(t=(0, 0.24, 1.22))
            lathe(g, [(0, 0), (0.025, 0.04), (0, 0.14)], 4, GLOW, cap_top=False)
            g.pop()
        if lod == 0:
            lathe(g, [(0.255, 0.92), (0.27, 0.92), (0.27, 0.97), (0.25, 0.97)], seg, BRONZE, cap_top=False, sy=0.82)
    else:
        lathe(g, [(0.42, 0), (0.40, 0.2), (0.31, 0.48), (0.22, 0.72), (0.18, 0.8)], seg, ROBE, smooth=True, sy=1.3)
        g.push(t=(0, 0.06, 0.68), rx=-0.5)
        lathe(g, [(0.2, 0), (0.18, 0.3), (0.13, 0.4)], seg, ROBE, smooth=True, sy=0.85)
        lathe(g, [(0.16, 0.36), (0.19, 0.5), (0.16, 0.64), (0.09, 0.72), (0, 0.75)], seg, ROBE, smooth=True, cap_top=False)
        box(g, (0, 0.14, 0.53), (0.13, 0.05, 0.15), DARK)
        if lod < 2:
            for sx in (-1, 1):
                tube(g, [(sx * 0.19, 0.0, 0.33), (sx * 0.14, 0.16, 0.18), (sx * 0.03, 0.28, 0.12)], 0.07, 5, ROBE)
        g.pop()


def build_rhino(g, lod):
    """Rhino armoured transport in palace blue: sloped glacis, track units, cupola with storm bolter, aquila."""
    seg = (10, 6, 4)[lod]
    hull = [(-3.4, 0.55), (3.15, 0.55), (3.55, 1.25), (2.0, 2.4), (-3.25, 2.4), (-3.45, 2.2)]
    prism_x(g, hull, -1.25, 1.25, PAINT)
    track = [(-3.45, 0.05), (3.35, 0.05), (3.75, 0.85), (3.3, 1.5), (-3.45, 1.5), (-3.75, 0.65)]
    for sx in (-1, 1):
        g.push(sc=(sx, 1, 1))
        prism_x(g, track, 1.25, 1.88, IRON)
        box(g, (1.6, -0.15, 1.6), (0.78, 6.6, 0.22), PAINT)
        if lod < 2:
            for i in range(5):
                g.push(t=(1.9, -2.6 + i * 1.3, 0.55), ry=math.pi / 2)
                lathe(g, [(0.36, -0.04), (0.36, 0.06)], seg, IRON, cap_top=True, cap_bot=False)
                g.pop()
        if lod == 0:
            for i in range(20):
                box(g, (1.565, -3.3 + i * 0.34, 1.53), (0.62, 0.16, 0.06), CABLE)
            box(g, (1.6, 0.6, 1.95), (0.5, 1.6, 0.5), PAINT)
            tube(g, [(1.0, -3.2, 1.9), (1.0, -3.25, 2.95)], 0.12, 6, IRON, caps=True)
            for k in range(3):
                tube(g, [(1.05 - k * 0.16, 2.3, 2.42), (1.05 - k * 0.16, 2.55, 2.75)], 0.07, 5, IRON, caps=True)
        g.pop()
    box(g, (0, -0.6, 2.55), (1.4, 1.5, 0.3), PAINT)
    if lod < 2:
        box(g, (0.35, -0.6, 2.75), (0.6, 1.2, 0.1), PAINT)
        box(g, (0, 0.1, 2.95), (0.26, 0.9, 0.26), IRON)
        for sx in (-1, 1):
            tube(g, [(sx * 0.06, 0.5, 2.98), (sx * 0.06, 1.1, 2.98)], 0.04, 4, IRON, caps=True)
        box(g, (0, -3.47, 1.45), (1.7, 0.08, 1.5), PAINT)
        for sx in (-1, 1):
            box(g, (sx * 0.85, 3.42, 1.35), (0.3, 0.12, 0.18), GLOW)
    g.push(t=(0, 2.85, 1.83), rx=math.atan2(1.55, 1.15) - math.pi / 2)
    aquila(g, 1.6, min(lod, 1), depth=0.5)
    g.pop()


def build_plinth(g, lod):
    box(g, (0, 0, 0.35), (3.4, 3.4, 0.7), DARK, bottom=False)
    box(g, (0, 0, 1.5), (2.6, 2.6, 1.6), MARBLE)
    box(g, (0, 0, 2.45), (3.1, 3.1, 0.3), PALE)
    if lod < 2:
        box(g, (0, 0, 2.12), (2.68, 2.68, 0.18), GOLD)
        g.push(t=(0, 1.3, 1.35))
        aquila(g, 1.9, lod, depth=0.5)
        g.pop()
    anchor("statue_plinth", "statue", (0, 0, 2.6), 0.0)


# ------------------------------------------------------------------ object assembly

def finish(g, name, grime=True):
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(g.bm, verts=g.bm.verts, dist=1e-4)
    g.bm.to_mesh(me)
    g.bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in _mats:
        me.materials.append(m)
    uv = me.uv_layers.new(name="UVMap")
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER") if grime else None
    if col:
        me.color_attributes.active_color = col
        me.color_attributes.render_color_index = 0
    for poly in me.polygons:
        nrm = poly.normal
        ax = max(range(3), key=lambda i: abs(nrm[i]))
        tile = TILE[poly.material_index]
        gf = GRIME_FACTOR.get(poly.material_index, 0.5)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = (co.y if nrm.x > 0 else -co.y), co.z
            elif ax == 1:
                u, v = (-co.x if nrm.y > 0 else co.x), co.z
            else:
                u, v = co.x, co.y
            uv.data[li].uv = (u / tile, v / tile)
            if col:
                h = max(0.0, min(1.0, co.z / 9.0))
                c = 1.0 - gf * 0.4 * (1 - h * h * (3 - 2 * h))
                if nrm.z < -0.5:
                    c *= 1 - 0.25 * gf
                col.data[li].color = (c, c, c, 1.0)
    me.validate()
    return ob


PIECES = {
    "eternity_gate": (build_gate, True),
    "palace_wall": (build_wall, True),
    "palace_tower": (build_tower, True),
    "throne_hall": (build_hall, True),
    "throne_dais": (build_dais, True),
    "golden_throne": (build_throne, False),
    "palace_spire_a": (lambda g, l: build_skyline(g, l, "a"), True),
    "palace_dome_b": (lambda g, l: build_skyline(g, l, "b"), True),
    "imperial_banner": (build_banner, False),
    "brazier": (build_brazier, False),
    "servo_skull": (build_servo_skull, False),
    "pilgrim_stand": (lambda g, l: build_pilgrim(g, l, False), False),
    "pilgrim_kneel": (lambda g, l: build_pilgrim(g, l, True), False),
    "rhino": (build_rhino, False),
    "statue_plinth": (build_plinth, True),
}

# downloaded statue scans: id -> (piece name, source folder, target height m, material, extra yaw, upright fix)
STATUES = {
    "saint_peter": ("smk/KAS2906_8", 6.6, MARBLE),
    "saint_james": ("smk/KAS2906_5", 6.6, MARBLE),
    "saint_thomas": ("smk/KAS2906_4", 6.6, MARBLE),
    "saint_bartholomew": ("smk/KAS2906_3", 6.6, MARBLE),
    "saint_george": ("smk/KAS82", 5.4, MARBLE),
    "saint_kunigunde": ("smk/KAS862", 5.2, MARBLE),
    "emperor_augustus": ("smk/KAS65", 5.6, MARBLE),
    "athena_shield": ("smk/KAS2128", 5.2, BRONZE),
    "victorious_soldier": ("smk/KMS5032", 5.4, BRONZE),
    "seated_prophet": ("smk/KAS243", 6.2, GOLD),
    "god_king": ("smk/KAS2100", 5.6, BRONZE),
    "hero_heracles": ("smk/KAS224", 5.6, MARBLE),
    "warrior_minerva": ("smk/KAS255", 5.6, MARBLE),
    "hero_apollo": ("smk/KAS353", 5.6, MARBLE),
    "emperor_enthroned": ("smithsonian/greenough_washington", 13.0, None),
    "equestrian_commander": ("smithsonian/jackson_zinc", 8.5, None),
}
STATUE_TRIS = (14000, 3600, 900)
STATUE_FIX = json.loads((Path(__file__).parent / "terra_statue_fix.json").read_text()) if (Path(__file__).parent / "terra_statue_fix.json").exists() else {}


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def import_statue(name, folder, height, mi):
    d = ASSETS / folder
    files = sorted(list(d.glob("*.glb")) + list(d.glob("*.gltf")) + list(d.glob("*.stl")))
    if not files:
        print("[statue] missing", folder)
        return None
    before = set(bpy.context.scene.objects)
    f = files[0]
    if f.suffix.lower() == ".stl":
        bpy.ops.wm.stl_import(filepath=str(f))
    else:
        bpy.ops.import_scene.gltf(filepath=str(f))
    new = [o for o in bpy.context.scene.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        if o.type != "MESH":
            o.select_set(False)
    select_only(meshes[0])
    for o in meshes:
        o.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in new:
        if o != ob and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # stand it up: the tallest axis becomes Z, the heavier end (the base) goes down
    me = ob.data
    import numpy as np
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ext = co.max(0) - co.min(0)
    fix = STATUE_FIX.get(name, {})
    R = Matrix.Identity(3)
    if "rot" in fix:
        R = Euler([math.radians(a) for a in fix["rot"]], "XYZ").to_matrix()
    elif ext[2] < max(ext[0], ext[1]) * 0.95:
        R = Euler((math.pi / 2, 0, 0) if ext[1] > ext[0] else (0, -math.pi / 2, 0), "XYZ").to_matrix()
    co = co @ np.array(R).T
    # the scans face -Y; the game's pieces face +Y, so turn them round unless the fix file says otherwise
    yaw = math.radians(fix.get("yaw", 180.0))
    if yaw:
        co = co @ np.array(Euler((0, 0, yaw)).to_matrix()).T
    lo, hi = co.min(0), co.max(0)
    s = height / (hi[2] - lo[2])
    co = (co - np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])) * s
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    if mi is not None:
        me.materials.clear()
        for m in _mats:
            me.materials.append(m)
        for p in me.polygons:
            p.material_index = mi
    else:
        for i, m in enumerate(me.materials):
            if m:
                m.name = f"scan_{name}_{i}"
    me.shade_smooth()
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    lods = []
    for lod, target in enumerate(STATUE_TRIS):
        c = ob.copy()
        c.data = me.copy()
        bpy.context.scene.collection.objects.link(c)
        c.name = f"{name}__L{lod}"
        if tris0 > target:
            mod = c.modifiers.new("dec", "DECIMATE")
            mod.ratio = target / tris0
            mod.use_collapse_triangulate = True
            select_only(c)
            bpy.ops.object.modifier_apply(modifier="dec")
        if mi is not None:
            box_uv_only(c)
        lods.append(c)
    bpy.data.objects.remove(ob, do_unlink=True)
    print(f"[statue] {name}: {tris0} tris -> {[len(l.data.polygons) for l in lods]} ({folder}, {height} m)", flush=True)
    return lods


def box_uv_only(ob):
    me = ob.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        nrm = poly.normal
        ax = max(range(3), key=lambda i: abs(nrm[i]))
        tile = TILE[poly.material_index]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = ((co.y, co.z) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y))
            uv.data[li].uv = (u / tile, v / tile)


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


# ------------------------------------------------------------------ previews

def preview(objs, path, size=900, view=(1.0, 1.35, 0.55), light=True):
    sc = bpy.context.scene
    for o in sc.objects:
        o.hide_render = o not in objs
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.name == "ground":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    cam = sc.camera
    d = Vector(view).normalized()
    cam.location = c + d * r * 2.3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50
    cam.data.clip_end = r * 20
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def setup_preview_scene():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.32, 0.27, 0.24, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc.world = w
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    sun.color = (1.0, 0.82, 0.62)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(52), 0, math.radians(35))
    sc.collection.objects.link(so)
    cd = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    gm = bpy.data.meshes.new("ground")
    gb = bmesh.new()
    bmesh.ops.create_grid(gb, x_segments=1, y_segments=1, size=600)
    uvl = gb.loops.layers.uv.verify()
    for f in gb.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / TILE[PAVING], lp.vert.co.y / TILE[PAVING])
    gb.to_mesh(gm)
    ground = bpy.data.objects.new("ground", gm)
    gm.materials.append(_mats[PAVING])
    sc.collection.objects.link(ground)
    return ground


# ------------------------------------------------------------------ main

def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    stats = {}
    objs = {}
    for name, (fn, grime) in PIECES.items():
        if ONLY and name not in ONLY:
            continue
        objs[name] = []
        for lod in range(3):
            g = G()
            REC[0] = lod == 0
            fn(g, lod)
            ob = finish(g, f"{name}__L{lod}", grime)
            objs[name].append(ob)
        stats[name] = [tri_count(o) for o in objs[name]]
        dims = objs[name][0].dimensions
        print(f"[piece] {name:18s} tris {stats[name]}  size {dims.x:.1f} x {dims.y:.1f} x {dims.z:.1f} m", flush=True)
    for name, (folder, h, mi) in STATUES.items():
        if ONLY and name not in ONLY:
            continue
        lods = import_statue(name, folder, h, mi)
        if lods:
            objs[name] = lods
            stats[name] = [tri_count(o) for o in lods]
    # dedupe anchors (lod 0 only wrote them, but keep it safe)
    (OUT / "palace_anchors.json").write_text(json.dumps({"anchors": ANCHORS, "tris": stats}, indent=1), encoding="utf-8")
    tint_nodes(False)
    glb = OUT / "palace_src.glb"
    kw = dict(filepath=str(glb), export_format="GLB", use_selection=False, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO")
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print(f"[export] {glb} {glb.stat().st_size / 1e6:.1f} MB", flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str((OUT / "palace_src.blend").resolve()))
    if PREVIEWS:
        tint_nodes(True)
        prev = OUT / "previews"
        prev.mkdir(exist_ok=True)
        ground = setup_preview_scene()
        for name, lods in objs.items():
            for o in lods:
                o.location = (0, 0, 0)
            preview([lods[0], ground], prev / f"{name}.png")
            if name in ("eternity_gate", "golden_throne", "palace_tower"):
                for lod in (1, 2):
                    preview([lods[lod], ground], prev / f"{name}_L{lod}.png", size=600)
        print("[preview] done", flush=True)
    print(f"[done] {len(objs)} pieces in {time.time() - t0:.0f} s", flush=True)


main()
