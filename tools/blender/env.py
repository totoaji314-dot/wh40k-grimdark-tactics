# Battlefield environment kit: Imperial gothic / industrial ruins, fortifications and props.
# Output: one GLB with one mesh per piece (material slots = tileable texture IDs, AO baked into vertex colour),
# plus env.json with footprints for navigation / cover.
#   blender -b --factory-startup -P tools/blender/env.py -- <out_dir> [--preview]
import bpy, bmesh, sys, os, json, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
from kit import rbox, cyl, sphere, ellipsoid, cut, fill_holes, lathe, torus, extrude, tube, copy, join_bm, array, jitter, xf, perm_yzx, set_active, setup_cycles

argv = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(argv[0])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
RAD = math.pi / 180
MATS = ['ferrocrete', 'stone', 'metal', 'rust', 'brass', 'glass', 'sandbag', 'wood', 'hazard', 'rubble', 'roof', 'lamp', 'scrap', 'red', 'bone']
for m in MATS:
    bpy.data.materials.new(m)

rnd = random.Random(7)


def obj_from(name, parts):
    """parts: list of (bmesh, material). Returns a mesh object."""
    total = bmesh.new()
    tmp = bpy.data.meshes.new('t')
    for bm, mat in parts:
        for f in bm.faces:
            f.smooth = False
        bm.to_mesh(tmp)
        n0 = len(total.faces)
        total.from_mesh(tmp)
        total.faces.ensure_lookup_table()
        for f in total.faces[n0:]:
            f.material_index = MATS.index(mat)
        bm.free()
    bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new(name)
    total.to_mesh(me); total.free()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    for m in MATS:
        me.materials.append(bpy.data.materials[m])
    return ob


def boolean(base, cutters, op='DIFFERENCE'):
    """Exact boolean on bmeshes via a temporary modifier."""
    me = bpy.data.meshes.new('b'); base.to_mesh(me)
    ob = bpy.data.objects.new('b', me); sc.collection.objects.link(ob)
    cobs = []
    for c in cutters:
        cm = bpy.data.meshes.new('c'); c.to_mesh(cm)
        co = bpy.data.objects.new('c', cm); sc.collection.objects.link(co); co.hide_render = True
        cobs.append(co)
        md = ob.modifiers.new('x', 'BOOLEAN'); md.operation = op; md.object = co; md.solver = 'EXACT'
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    outb = bmesh.new(); outb.from_mesh(me2)
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); bpy.data.meshes.remove(me2)
    for co in cobs:
        m = co.data; bpy.data.objects.remove(co); bpy.data.meshes.remove(m)
    return outb


def arch(w, h, d, seg=10):
    """Gothic pointed-arch prism (opening) standing on z=0, width w, total height h, depth d (along y)."""
    r = w * 0.75
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, h - r * 0.66)]
    spring = h - r * 0.66
    for i in range(1, seg):
        a = i / seg
        # right arc centred at (-w/2 + r, spring)
        ang = a * math.acos((r - w / 2) / r) if r > w / 2 else a * math.pi / 2
        pts.append((-w / 2 + r - r * math.cos(ang) * 1.0 if False else w / 2 - (r - r * math.cos(ang * 1.0)) * 0 + 0, 0))
    # simpler: build pointed arch from two circle arcs
    pts = [(-w / 2, 0), (w / 2, 0)]
    cx_r = -w / 2 + r  # centre for the right side arc is on the left
    for i in range(seg + 1):
        t = i / seg
        x = w / 2 - t * (w / 2)
        dx = x - cx_r
        z = spring + math.sqrt(max(0, r * r - dx * dx))
        pts.append((x, z))
    for i in range(1, seg + 1):
        t = i / seg
        x = -t * (w / 2)
        dx = x + cx_r * -1
        z = spring + math.sqrt(max(0, r * r - (x - (w / 2 - r)) ** 2))
        pts.append((x, z))
    pts.append((-w / 2, spring))
    # dedupe near points
    clean = []
    for p in pts:
        if not clean or (abs(clean[-1][0] - p[0]) > 1e-4 or abs(clean[-1][1] - p[1]) > 1e-4):
            clean.append(p)
    return extrude(clean, d)


def jagged_top(w, d, base_z, amp, seed):
    """Prism removing a jagged top: a zig-zag polygon above base_z."""
    r = random.Random(seed)
    pts = [(-w / 2 - 1, base_z + 20), (w / 2 + 1, base_z + 20), (w / 2 + 1, base_z)]
    n = 9
    for i in range(n, -1, -1):
        x = -w / 2 + w * i / n
        pts.append((x, base_z + r.uniform(-amp, amp * 0.4)))
    pts.append((-w / 2 - 1, base_z))
    return extrude(pts, d + 2)


def rubble(n, spread, seed, size=0.6, mat='rubble'):
    r = random.Random(seed)
    parts = []
    for i in range(n):
        s = size * r.uniform(0.35, 1.0)
        b = rbox(s * r.uniform(0.8, 1.6), s * r.uniform(0.6, 1.3), s * r.uniform(0.3, 0.8), bev=0.02)
        jitter(b, s * 0.08, seed + i)
        xf(b, (r.uniform(-spread, spread), r.uniform(-spread * 0.6, spread * 0.6), s * 0.2), rot=(r.uniform(-20, 20), r.uniform(-20, 20), r.uniform(0, 180)))
        parts.append((b, mat if r.random() > 0.25 else 'ferrocrete'))
    return parts


PIECES = {}
FOOT = {}


def piece(name, footprint, cover=0.0, block=True, height=0.0):
    def deco(fn):
        PIECES[name] = fn
        FOOT[name] = dict(w=footprint[0], d=footprint[1], cover=cover, block=block, h=height)
        return fn
    return deco


# ------------------------------------------------------------------ gothic wall (intact + ruined)
def gothic_wall(w=8.0, h=10.0, t=1.0, ruined=False, seed=1):
    wall = rbox(w, t, h)
    xf(wall, (0, 0, h / 2))
    cutters = []
    for x in (-w / 4, w / 4):
        a = arch(1.9, 5.6, t + 1.0)
        xf(a, (x, 0, 2.2))
        cutters.append(a)
    if ruined:
        cutters.append(jagged_top(w, t, h * 0.62, h * 0.28, seed))
    wall = boolean(wall, cutters)
    parts = [(wall, 'stone')]
    parts.append((xf(rbox(w + 0.3, t + 0.5, 1.2, bev=0.06), (0, 0, 0.6)), 'stone'))
    zc = h * 0.70
    if not ruined:
        parts.append((xf(rbox(w + 0.2, t + 0.35, 0.45, bev=0.05), (0, 0, zc)), 'stone'))
        parts.append((xf(rbox(w + 0.3, t + 0.5, 0.6, bev=0.06), (0, 0, h - 0.3)), 'stone'))
        for x in (-w / 4, w / 4):
            parts.append((xf(rbox(0.3, t * 0.4, 0.3, bev=0.04), (x, -t / 2 - 0.05, 7.95)), 'brass'))
    for x in (-w / 2 + 0.4, w / 2 - 0.4):
        ph = h if not ruined else h * random.Random(seed + int(x * 10)).uniform(0.55, 0.9)
        parts.append((xf(rbox(0.8, t + 0.7, ph, bev=0.06, taper=(0.85, 0.85)), (x, 0, ph / 2)), 'stone'))
    for x in (-w / 4, w / 4):
        sill = rbox(2.2, t + 0.3, 0.25, bev=0.04)
        parts.append((xf(sill, (x, 0, 2.15)), 'stone'))
        grill = array(rbox(0.06, 0.08, 4.2), 4, (0.42, 0, 0))
        parts.append((xf(grill, (x - 0.63, 0, 4.3)), 'metal'))
        gl = arch(1.85, 5.55, 0.04)
        parts.append((xf(gl, (x, 0.12, 2.25)), 'glass'))
    if ruined:
        parts += rubble(14, w * 0.45, seed, 0.8)
    return parts


@piece('wall', (8, 1.2), cover=0.7, height=10)
def p_wall():
    return gothic_wall(ruined=False)


@piece('wall_ruin', (8, 1.2), cover=0.6, height=7)
def p_wall_ruin():
    return gothic_wall(ruined=True, seed=3)


@piece('wall_ruin2', (8, 1.2), cover=0.6, height=6)
def p_wall_ruin2():
    return gothic_wall(ruined=True, seed=11)


@piece('pillar', (1.8, 1.8), cover=0.6, height=13)
def p_pillar():
    p = [(xf(rbox(1.8, 1.8, 1.4, bev=0.08), (0, 0, 0.7)), 'stone'),
         (xf(rbox(1.4, 1.4, 10.5, bev=0.08, taper=(0.82, 0.82)), (0, 0, 6.6)), 'stone'),
         (xf(rbox(1.5, 1.5, 0.4, bev=0.05), (0, 0, 4.5)), 'stone'),
         (xf(rbox(1.3, 1.3, 0.4, bev=0.05), (0, 0, 8.5)), 'stone'),
         (xf(cyl(0.65, 2.2, seg=4, r2=0.0), (0, 0, 13.0), rot=(0, 0, 45)), 'stone')]
    wing = [(0.0, 0.0), (0.3, 0.15), (0.7, 0.35), (1.0, 0.4), (0.8, 0.2), (1.0, 0.1), (0.6, -0.05), (0.3, -0.15), (0.0, -0.1)]
    full = wing + [(-x, z) for (x, z) in reversed(wing)][1:-1]
    aq = extrude([(x * 0.7, z * 0.7) for (x, z) in full], 0.12)
    p.append((xf(aq, (0, -0.74, 6.0)), 'brass'))
    p.append((xf(sphere(0.12, 8, 6), (0, -0.78, 6.15)), 'brass'))
    return p


# ------------------------------------------------------------------ buildings
@piece('manufactorum', (28, 16), cover=0.8, height=14)
def p_manufactorum():
    W, D, H = 28.0, 16.0, 12.0
    parts = []
    # perimeter walls with arched windows, one side broken open
    for side in range(4):
        L = W if side % 2 == 0 else D
        wall = rbox(L, 0.8, H)
        xf(wall, (0, 0, H / 2))
        cuts = []
        n = int(L // 4.5)
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n
            a = arch(1.6, 4.8, 2.0); xf(a, (x, 0, 3.2)); cuts.append(a)
        if side == 0:
            door = rbox(6.0, 3.0, 6.5); xf(door, (0, 0, 3.0)); cuts.append(door)
        if side == 1:
            cuts.append(jagged_top(L, 0.8, H * 0.45, H * 0.3, 21))
        wall = boolean(wall, cuts)
        ang = [0, 90, 180, 270][side]
        off = [(0, -D / 2), (W / 2, 0), (0, D / 2), (-W / 2, 0)][side]
        xf(wall, rot=(0, 0, ang)); xf(wall, (off[0], off[1], 0))
        parts.append((wall, 'ferrocrete'))
        cor = rbox(L + 0.4, 1.2, 0.5, bev=0.06); xf(cor, (0, 0, H - 0.25)); xf(cor, rot=(0, 0, ang)); xf(cor, (off[0], off[1], 0))
        if side != 1:
            parts.append((cor, 'stone'))
        base = rbox(L + 0.4, 1.3, 1.0, bev=0.06); xf(base, (0, 0, 0.5)); xf(base, rot=(0, 0, ang)); xf(base, (off[0], off[1], 0))
        parts.append((base, 'stone'))
    for (x, y) in ((-W / 2, -D / 2), (W / 2, -D / 2), (W / 2, D / 2), (-W / 2, D / 2)):
        parts.append((xf(rbox(2.0, 2.0, H + 2, bev=0.1, taper=(0.85, 0.85)), (x, y, (H + 2) / 2)), 'stone'))
        parts.append((xf(cyl(0.9, 2.4, seg=4, r2=0.0), (x, y, H + 3.0), rot=(0, 0, 45)), 'stone'))
    # roof trusses (exposed girders) + partial corrugated roof
    for i in range(7):
        x = -W / 2 + 2 + i * (W - 4) / 6
        tr = rbox(0.35, D, 0.5); xf(tr, (x, 0, H + 0.2))
        parts.append((tr, 'rust'))
        for sgn in (-1, 1):
            r = rbox(0.3, D / 2 + 0.6, 0.35); xf(r, (0, sgn * D / 4, 0), rot=(sgn * -16, 0, 0)); xf(r, (x, 0, H + 2.2))
            parts.append((r, 'rust'))
    for i in range(3):
        rf = rbox(W / 3 - 0.6, D / 2 + 0.8, 0.12); xf(rf, (0, -D / 4, 0), rot=(16, 0, 0)); xf(rf, (-W / 2 + W / 6 + i * W / 3 if i != 1 else 0, 0, H + 2.4))
        if i != 1:
            parts.append((rf, 'roof'))
    # chimneys
    for (x, y) in ((W / 2 - 4, D / 2 - 3), (W / 2 - 9, D / 2 - 3)):
        parts.append((xf(cyl(1.2, 22, seg=16, r2=0.95), (x, y, 11)), 'ferrocrete'))
        for z in (8, 14, 19):
            parts.append((xf(torus(1.15 - (z - 8) * 0.012, 0.15, seg=16, seg2=5), (x, y, z)), 'rust'))
        parts.append((xf(cyl(1.15, 1.2, seg=16, r2=1.3), (x, y, 22.4)), 'rust'))
    # interior machinery + rubble
    parts.append((xf(rbox(6, 3, 4, bev=0.15), (-6, 2, 2)), 'metal'))
    parts.append((xf(cyl(1.4, 6, seg=16), (-6, 2, 5), rot=(0, 90, 0)), 'rust'))
    parts.append((xf(rbox(3, 3, 2.5, bev=0.1), (5, -2, 1.25)), 'hazard'))
    parts += rubble(30, 9, 5, 1.2)
    return parts


@piece('hab', (12, 12), cover=0.8, height=17)
def p_hab():
    S, H = 12.0, 16.0
    parts = []
    body = rbox(S, S, H); xf(body, (0, 0, H / 2))
    cuts = []
    for side in range(4):
        for f in range(4):
            for c in range(3):
                x = -S / 2 + 2.2 + c * 3.8
                z = 1.6 + f * 3.8
                win = rbox(1.6, 3.0, 2.2); xf(win, (x, -S / 2, z + 1.0))
                xf(win, rot=(0, 0, side * 90))
                cuts.append(win)
    big = jagged_top(S + 2, S + 2, H * 0.75, H * 0.25, 33)
    xf(big, rot=(0, 0, 45)); xf(big, (3, -3, 0))
    cuts.append(big)
    hollow = rbox(S - 1.2, S - 1.2, H + 4); xf(hollow, (0, 0, H / 2 + 0.6))
    cuts.append(hollow)
    body = boolean(body, cuts)
    parts.append((body, 'ferrocrete'))
    for f in range(1, 4):
        fl = rbox(S - 1.2, S - 1.2, 0.3); xf(fl, (0, 0, f * 3.8 + 0.2))
        fl = boolean(fl, [xf(rbox(7, 7, 2), (4, -4, f * 3.8))])
        parts.append((fl, 'ferrocrete'))
    for side in range(4):
        band = rbox(S + 0.3, 0.4, 0.35, bev=0.04); xf(band, (0, -S / 2, 0.8)); xf(band, rot=(0, 0, side * 90)); parts.append((band, 'stone'))
    parts.append((xf(rbox(3, 0.3, 1.2, bev=0.02), (-2, -S / 2 - 0.2, 3.5)), 'hazard'))
    parts += rubble(26, 7, 9, 1.0)
    return parts


@piece('chapel', (10, 16), cover=0.8, height=24)
def p_chapel():
    W, D, H = 10.0, 16.0, 11.0
    parts = []
    for side in range(4):
        L = W if side % 2 == 0 else D
        wall = rbox(L, 0.9, H); xf(wall, (0, 0, H / 2))
        cuts = []
        n = 1 if side % 2 == 0 else 3
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n
            a = arch(2.0, 7.0, 2.0); xf(a, (x, 0, 1.8)); cuts.append(a)
        if side == 2:
            cuts.append(jagged_top(L, 0.9, H * 0.5, H * 0.3, 41))
        wall = boolean(wall, cuts)
        ang = [0, 90, 180, 270][side]
        off = [(0, -D / 2), (W / 2, 0), (0, D / 2), (-W / 2, 0)][side]
        xf(wall, rot=(0, 0, ang)); xf(wall, (off[0], off[1], 0))
        parts.append((wall, 'stone'))
        for k in range(n + 1):
            x = -L / 2 + k * L / n
            bt = rbox(1.0, 1.6, H * 0.85, bev=0.08, taper=(0.7, 0.6)); xf(bt, (x, -0.8, H * 0.42)); xf(bt, rot=(0, 0, ang)); xf(bt, (off[0], off[1], 0))
            parts.append((bt, 'stone'))
    # spire tower at the front
    parts.append((xf(rbox(4.5, 4.5, 18, bev=0.1), (0, -D / 2 - 1.5, 9)), 'stone'))
    tw = boolean(rbox(4.6, 4.6, 3.5), [xf(arch(1.4, 3.0, 6.0), (0, 0, -1.4)), xf(xf(arch(1.4, 3.0, 6.0), rot=(0, 0, 90)), (0, 0, -1.4))])
    parts.append((xf(tw, (0, -D / 2 - 1.5, 15.5)), 'stone'))
    parts.append((xf(cyl(3.4, 7.5, seg=8, r2=0.1), (0, -D / 2 - 1.5, 21.2), rot=(0, 0, 22.5)), 'roof'))
    parts.append((xf(rbox(0.25, 0.25, 2.2), (0, -D / 2 - 1.5, 25.6)), 'brass'))
    parts.append((xf(rbox(1.4, 0.25, 0.25), (0, -D / 2 - 1.5, 25.9)), 'brass'))
    # roof frame (partly collapsed)
    for i in range(5):
        y = -D / 2 + 2 + i * (D - 4) / 4
        for sgn in (-1, 1):
            r = rbox(W / 2 + 0.8, 0.35, 0.35); xf(r, (sgn * W / 4, 0, 0), rot=(0, sgn * 35, 0)); xf(r, (0, y, H + 1.6))
            if not (i >= 3 and sgn > 0):
                parts.append((r, 'wood'))
    parts.append((xf(rbox(2.4, 1.4, 1.2, bev=0.08), (0, D / 2 - 2.5, 0.6)), 'stone'))
    parts.append((xf(rbox(2.6, 1.6, 0.2, bev=0.03), (0, D / 2 - 2.5, 1.3)), 'brass'))
    parts += rubble(22, 5, 13, 1.0)
    return parts


@piece('bunker', (8, 6), cover=0.9, height=3.4)
def p_bunker():
    body = rbox(8, 6, 3.2, bev=0.35, seg=3, taper=(0.85, 0.82)); xf(body, (0, 0, 1.6))
    slit = rbox(5.0, 2.0, 0.45); xf(slit, (0, -3.0, 2.0))
    hollow = rbox(6.4, 4.4, 2.4); xf(hollow, (0, 0, 1.3))
    door = rbox(1.4, 2.0, 2.0); xf(door, (0, 3.0, 1.0))
    body = boolean(body, [slit, hollow, door])
    p = [(body, 'ferrocrete'), (xf(rbox(8.6, 6.6, 0.4, bev=0.08), (0, 0, 0.2)), 'ferrocrete')]
    p.append((xf(rbox(5.4, 0.25, 0.2), (0, -2.95, 2.33)), 'metal'))
    p.append((xf(rbox(1.2, 0.3, 0.6, bev=0.05), (2.5, -2.6, 3.0)), 'hazard'))
    for x in (-2.0, 0.0, 2.0):
        p.append((xf(cyl(0.12, 0.9, seg=8), (x, 1.5, 3.4)), 'metal'))
    p.append((xf(rbox(1.0, 1.0, 0.25), (3, 2, 3.2)), 'metal'))
    return p


@piece('smokestack', (5, 5), cover=0.8, height=36)
def p_smokestack():
    p = [(xf(rbox(5, 5, 4, bev=0.15), (0, 0, 2)), 'ferrocrete'),
         (xf(cyl(2.0, 32, seg=20, r2=1.5), (0, 0, 20)), 'ferrocrete')]
    for z in (8, 15, 22, 29):
        p.append((xf(torus(2.0 - (z - 4) * 0.0156, 0.2, seg=20, seg2=5), (0, 0, z)), 'rust'))
    p.append((xf(cyl(1.6, 1.6, seg=20, r2=1.9), (0, 0, 36.6)), 'rust'))
    p.append((xf(array(rbox(0.12, 0.3, 0.12), 22, (0, 0, 1.25)), (0, -2.0, 6)), 'metal'))
    return p


@piece('watchtower', (3.6, 3.6), cover=0.3, height=11)
def p_watchtower():
    p = []
    for (x, y) in ((-1.5, -1.5), (1.5, -1.5), (1.5, 1.5), (-1.5, 1.5)):
        p.append((xf(rbox(0.3, 0.3, 9), (x, y, 4.5)), 'rust'))
    for z in (3, 6):
        for k in range(4):
            br = rbox(3.3, 0.18, 0.18); xf(br, (0, -1.5, z)); xf(br, rot=(0, 0, k * 90)); p.append((br, 'rust'))
    p.append((xf(rbox(4.0, 4.0, 0.25), (0, 0, 9.0)), 'metal'))
    for k in range(4):
        rl = rbox(4.0, 0.12, 1.1); xf(rl, (0, -2.0, 9.7)); xf(rl, rot=(0, 0, k * 90)); p.append((rl, 'hazard' if k == 0 else 'metal'))
    p.append((xf(rbox(4.2, 4.2, 0.2), (0, 0, 11.5)), 'roof'))
    p.append((xf(cyl(0.35, 0.5, seg=12), (0, -1.8, 10.6), rot=(70, 0, 0)), 'lamp'))
    return p


# ------------------------------------------------------------------ fortifications and props
@piece('sandbags', (4.2, 1.2), cover=0.65, block=True, height=1.2)
def p_sandbags():
    p = []
    r = random.Random(5)
    for row in range(3):
        n = 7 - (row % 2)
        for i in range(n):
            x = -1.8 + i * 0.6 + (0.3 if row % 2 else 0)
            b = ellipsoid(0.33, 0.24, 0.14, 10, 6)
            jitter(b, 0.015, r.randint(0, 999))
            ang = x * 4
            xf(b, (x, 0.08 * math.cos(x * 0.6) + r.uniform(-0.03, 0.03), 0.14 + row * 0.25), rot=(0, 0, ang + r.uniform(-6, 6)))
            p.append((b, 'sandbag'))
    return p


@piece('tank_trap', (2.2, 2.2), cover=0.25, height=1.6)
def p_tank_trap():
    p = []
    for rot in ((0, 45, 0), (45, 0, 90), (0, 0, 0)):
        beam = rbox(0.22, 0.22, 2.4, bev=0.02)
        if rot == (0, 0, 0):
            xf(beam, rot=(0, 90, 45))
        else:
            xf(beam, rot=rot)
        xf(beam, (0, 0, 0.85))
        p.append((beam, 'rust'))
    return p


@piece('barricade', (3.0, 0.8), cover=0.6, height=1.1)
def p_barricade():
    prof = [(-0.45, 0), (0.45, 0), (0.35, 0.25), (0.14, 0.4), (0.12, 1.05), (-0.12, 1.05), (-0.14, 0.4), (-0.35, 0.25)]
    b = extrude(prof, 3.0, bev=0.02); xf(b, rot=(0, 0, 90))
    return [(b, 'ferrocrete'), (xf(rbox(3.02, 0.26, 0.15), (0, 0, 0.85)), 'hazard')]


@piece('crates', (2.6, 2.0), cover=0.5, height=1.6)
def p_crates():
    p = []
    for (x, y, z, s, a) in ((-0.6, 0, 0.5, 1.0, 5), (0.55, 0.15, 0.45, 0.9, -12), (-0.4, 0.1, 1.3, 0.7, 20)):
        p.append((xf(rbox(s, s, s, bev=0.04), (x, y, z), rot=(0, 0, a)), 'wood'))
        p.append((xf(rbox(s + 0.02, s * 0.15, s + 0.02), (x, y, z), rot=(0, 0, a)), 'metal'))
    return p


@piece('barrels', (2.0, 2.0), cover=0.45, height=1.0)
def p_barrels():
    p = []
    for (x, y, rz) in ((-0.4, -0.3, 0), (0.35, -0.25, 30), (0.0, 0.4, 70), (0.9, 0.5, 15)):
        p.append((xf(cyl(0.32, 0.9, seg=14, bev=0.02), (x, y, 0.45), rot=(0, 0, rz)), 'red' if x < 0.5 else 'hazard'))
        for z in (0.22, 0.68):
            p.append((xf(torus(0.32, 0.025, seg=14, seg2=4), (x, y, z)), 'metal'))
    return p


@piece('pipeline', (12, 1.6), cover=0.5, height=2.4)
def p_pipeline():
    p = [(xf(cyl(0.6, 12, seg=18), (0, 0, 1.6), rot=(0, 90, 0)), 'rust')]
    for x in (-5, 0, 5):
        p.append((xf(torus(0.62, 0.08, seg=18, seg2=5), (x, 0, 1.6), rot=(0, 90, 0)), 'metal'))
        p.append((xf(rbox(0.3, 1.4, 1.1), (x, 0, 0.55)), 'metal'))
    p.append((xf(cyl(0.35, 1.0, seg=12), (2.5, 0, 2.4)), 'brass'))
    return p


@piece('lamp', (0.8, 0.8), cover=0.0, block=False, height=6)
def p_lamp():
    p = [(xf(cyl(0.12, 5.5, seg=8), (0, 0, 2.75)), 'metal'),
         (xf(rbox(0.5, 0.5, 0.5, bev=0.04), (0, 0, 0.25)), 'stone'),
         (xf(rbox(1.2, 0.12, 0.12), (0.5, 0, 5.4)), 'metal'),
         (xf(cyl(0.22, 0.5, seg=8, r2=0.12), (1.0, 0, 5.1)), 'metal'),
         (xf(sphere(0.18, 8, 6), (1.0, 0, 4.85)), 'lamp')]
    return p


@piece('monument', (4, 4), cover=0.6, height=9)
def p_monument():
    p = [(xf(rbox(4, 4, 1.0, bev=0.08), (0, 0, 0.5)), 'stone'),
         (xf(rbox(3, 3, 1.2, bev=0.08), (0, 0, 1.6)), 'stone'),
         (xf(rbox(1.6, 1.6, 4.0, bev=0.08, taper=(0.8, 0.8)), (0, 0, 4.2)), 'stone')]
    wing = [(0.0, 0.0), (0.4, 0.3), (1.0, 0.75), (1.7, 1.0), (2.2, 0.9), (1.8, 0.6), (2.1, 0.45), (1.6, 0.25), (1.8, 0.05), (1.2, -0.05), (0.6, -0.25), (0.0, -0.2)]
    full = wing + [(-x, z) for (x, z) in reversed(wing)][1:-1]
    p.append((xf(extrude(full, 0.3, bev=0.04), (0, 0, 6.8)), 'brass'))
    for sx in (-1, 1):
        p.append((xf(ellipsoid(0.3, 0.3, 0.38, 10, 8), (sx * 0.35, -0.1, 7.3)), 'brass'))
        p.append((xf(cyl(0.12, 0.35, seg=8, r2=0.0), (sx * 0.62, -0.1, 7.3), rot=(0, sx * 90, 0)), 'brass'))
    return p


@piece('wreck', (7, 3.6), cover=0.75, height=3.2)
def p_wreck():
    hull = rbox(6.4, 3.2, 1.8, bev=0.1, shear=0.0)
    xf(hull, (0, 0, 1.3))
    front = rbox(1.6, 3.0, 1.4, bev=0.08, taper=(1.0, 0.4)); xf(front, (-3.4, 0, 1.1), rot=(0, -30, 0))
    p = [(hull, 'metal'), (front, 'metal')]
    for sy in (-1, 1):
        tr = rbox(6.8, 0.6, 1.0, bev=0.15); xf(tr, (0, sy * 1.65, 0.55)); p.append((tr, 'rust'))
        for x in (-2.4, -0.8, 0.8, 2.4):
            p.append((xf(cyl(0.38, 0.62, seg=10), (x, sy * 1.65, 0.55), rot=(90, 0, 0)), 'metal'))
    p.append((xf(rbox(2.2, 2.0, 0.9, bev=0.1), (0.6, 0, 2.6), rot=(0, 0, 18)), 'metal'))
    p.append((xf(cyl(0.12, 2.6, seg=8), (-0.9, -0.4, 2.7), rot=(0, 80, 18)), 'metal'))
    p.append((xf(rbox(1.0, 0.1, 0.6), (1.2, -1.62, 1.6)), 'hazard'))
    p += [(b, 'rust') for b, _ in rubble(8, 3, 17, 0.5)]
    return p


@piece('trench_wall', (4, 0.6), cover=0.0, block=False, height=0.0)
def p_trench_wall():
    p = []
    for i in range(10):
        pl = rbox(0.38, 0.06, 1.8, bev=0.01); xf(pl, (-1.8 + i * 0.4, 0, -0.9), rot=(0, 0, rnd.uniform(-2, 2)))
        p.append((pl, 'wood'))
    for x in (-1.9, 0, 1.9):
        p.append((xf(rbox(0.14, 0.14, 2.3), (x, -0.08, -0.85)), 'wood'))
    sb = rbox(4.0, 0.7, 0.35, bev=0.12); jitter(sb, 0.03, 3); xf(sb, (0, 0.2, 0.1)); p.append((sb, 'sandbag'))
    return p


@piece('duckboard', (4, 1.2), cover=0.0, block=False, height=0.0)
def p_duckboard():
    p = [(xf(rbox(4.0, 0.12, 0.1), (0, y, 0.05)), 'wood') for y in (-0.45, 0.45)]
    for i in range(16):
        p.append((xf(rbox(0.16, 1.1, 0.05), (-1.9 + i * 0.25, 0, 0.12)), 'wood'))
    return p


@piece('wire', (4, 1.0), cover=0.05, block=False, height=1.0)
def p_wire():
    p = []
    for x in (-1.8, 0.0, 1.8):
        p.append((xf(rbox(0.06, 0.06, 1.2), (x, 0, 0.6), rot=(0, 8, 0)), 'metal'))
    for k in range(12):
        c = torus(0.42, 0.012, seg=12, seg2=3)
        xf(c, rot=(90, 0, 90 + rnd.uniform(-20, 20)))
        xf(c, (-1.65 + k * 0.3, 0, 0.45))
        p.append((c, 'metal'))
    return p


@piece('rubble', (4, 4), cover=0.35, block=False, height=1.0)
def p_rubble():
    return rubble(20, 2.2, 23, 1.0) + [(xf(rbox(3.0, 0.3, 0.3), (0.2, 0.3, 0.5), rot=(10, 20, 30)), 'rust')]


@piece('ork_barricade', (5, 1.2), cover=0.55, height=1.8)
def p_ork_barricade():
    p = []
    r = random.Random(31)
    for i in range(7):
        pl = rbox(r.uniform(0.7, 1.2), 0.08, r.uniform(1.2, 1.9), bev=0.02)
        jitter(pl, 0.03, i)
        xf(pl, (-2.2 + i * 0.72, r.uniform(-0.15, 0.15), 0.8), rot=(r.uniform(-8, 8), r.uniform(-12, 12), r.uniform(-8, 8)))
        p.append((pl, ['scrap', 'rust', 'red', 'hazard', 'rust', 'scrap', 'red'][i]))
    for x in (-2.0, 0.0, 2.0):
        p.append((xf(rbox(0.12, 0.6, 1.0), (x, 0.4, 0.4), rot=(30, 0, 0)), 'wood'))
    p.append((xf(cyl(0.05, 0.5, seg=6, r2=0.0), (-1.5, -0.1, 1.95)), 'bone'))
    return p


@piece('ork_totem', (1.5, 1.5), cover=0.1, block=False, height=6)
def p_ork_totem():
    p = [(xf(cyl(0.12, 6, seg=8), (0, 0, 3)), 'wood'),
         (xf(rbox(1.6, 0.06, 1.2, bev=0.02), (0.75, 0, 4.9)), 'red')]
    glyph = [(-0.35, -0.3), (0.0, -0.45), (0.35, -0.3), (0.3, 0.1), (0.12, 0.35), (-0.12, 0.35), (-0.3, 0.1)]
    p.append((xf(extrude(glyph, 0.05), (0.75, -0.06, 4.9)), 'bone'))
    p.append((xf(ellipsoid(0.25, 0.25, 0.3, 10, 8), (0, 0, 6.2)), 'bone'))
    return p


# ------------------------------------------------------------------ build all
objs = []
for name, fn in PIECES.items():
    parts = fn()
    ob = obj_from(name, parts)
    objs.append(ob)
    print('PIECE', name, len(ob.data.polygons))

# UVs: world-scale cube projection (1 UV unit = 2 m), AO baked into vertex colours
for i, ob in enumerate(objs):
    ob.location.x = i * 60.0
    set_active(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=2.0, scale_to_bounds=False, correct_aspect=True)
    # subdivide long edges a little so baked vertex AO has resolution
    bpy.ops.mesh.subdivide(number_cuts=1) if len(ob.data.polygons) < 600 else None
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.data.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
    ob.data.color_attributes.active_color = ob.data.color_attributes['AO']

setup_cycles(64)
sc.render.bake.target = 'VERTEX_COLORS'
gnd = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2000); bm.to_mesh(gnd.data); bm.free()
sc.collection.objects.link(gnd)
for ob in objs:
    set_active(ob)
    bpy.ops.object.bake(type='AO', use_clear=True, target='VERTEX_COLORS')
bpy.data.objects.remove(gnd)
for ob in objs:
    ob.location.x = 0.0
    ob.select_set(True)
for o in bpy.context.view_layer.objects:
    o.select_set(o in objs)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'env.glb'), export_format='GLB', use_selection=True, export_materials='EXPORT',
                          export_image_format='NONE', export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_animations=False)
with open(os.path.join(out, 'env.json'), 'w') as f:
    json.dump(FOOT, f, indent=1)
print('ENV DONE', len(objs))
