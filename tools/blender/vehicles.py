# Vehicle kit: Imperial Guard Leman Russ battle tank (hull, tracks, turret, barrel as separate pieces).
# Same conventions as env.py: material slots are runtime texture IDs, AO is baked into vertex colours.
# Pieces have their own pivots (turret ring centre, barrel trunnion) so the game can traverse / recoil them.
# The track piece carries its own UVs (u runs along the track loop) so the tread texture can scroll.
#   blender -b --factory-startup -P tools/blender/vehicles.py -- <out_dir> [--preview]
import bpy, bmesh, sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from kit import rbox, cyl, sphere, extrude, lathe, xf, copy, join_bm, set_active, setup_cycles

argv = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(argv[0])
preview = '--preview' in argv
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
MATS = ['paint', 'metal', 'rust', 'brass', 'glass', 'lamp', 'hazard', 'sandbag', 'wood', 'scrap', 'red', 'track']
for m in MATS:
    bpy.data.materials.new(m)


def obj_from(name, parts):
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


def side_prism(pts_yz, x_center, width):
    """Prism from a side-profile polygon [(y, z)] extruded across X (width) at x_center."""
    b = extrude(pts_yz, width)          # profile in XZ, extruded along Y
    xf(b, rot=(0, 0, 90))               # x -> y, y -> -x
    xf(b, (x_center, 0, 0))
    return b


def rivet_line(a, b, spacing, normal, r=0.032, mat='metal'):
    """Rivet heads along a straight line from a to b, sitting on a surface with the given normal."""
    a, b, n = Vector(a), Vector(b), Vector(normal).normalized()
    L = (b - a).length
    k = max(1, int(L / spacing))
    parts = []
    # rotate the Z-axis cylinder so it points along the surface normal
    q = Vector((0, 0, 1)).rotation_difference(n).to_euler()
    rot = tuple(math.degrees(x) for x in q)
    for i in range(k + 1):
        p = a + (b - a) * (i / k)
        c = cyl(r, 0.035, seg=6, r2=r * 0.6)
        xf(c, tuple(p + n * 0.012), rot=rot)
        parts.append((c, mat))
    return parts


# ------------------------------------------------------------------ track loop (rounded rhomboid)
WHEEL_R = 0.38          # inner radius of the band around each corner wheel
BAND = 0.11             # band thickness
CORNERS = [(-3.35, 1.72), (-2.55, 0.42 + 0.0), (2.65, 0.42), (3.25, 1.72)]   # (y, z): front-top, front-bottom, rear-bottom, rear-top
for i, (y, z) in enumerate(CORNERS):
    CORNERS[i] = (y, z if i in (0, 3) else WHEEL_R + BAND)   # bottom wheels: band touches the ground
TRACK_X = 1.60          # track centre line
TRACK_W = 0.95


def loop_path(offset, seg=10):
    """Points (y, z) of the loop around the four corner circles at radius `offset`, counter-clockwise, with arc length."""
    n = len(CORNERS)
    normals = []
    for i in range(n):
        (y0, z0), (y1, z1) = CORNERS[i], CORNERS[(i + 1) % n]
        dy, dz = y1 - y0, z1 - z0
        L = math.hypot(dy, dz)
        normals.append((dz / L, -dy / L))     # outward normal of edge i -> i+1 (counter-clockwise loop)
    pts = []
    for i in range(n):
        cy, cz = CORNERS[i]
        a0 = math.atan2(normals[i - 1][1], normals[i - 1][0])
        a1 = math.atan2(normals[i][1], normals[i][0])
        while a1 < a0:
            a1 += 2 * math.pi
        for k in range(seg + 1):
            a = a0 + (a1 - a0) * k / seg
            pts.append((cy + math.cos(a) * offset, cz + math.sin(a) * offset, math.cos(a), math.sin(a)))
    return pts


def track_band(x_center):
    """Closed band of track links around the loop; UV u = metres along the loop / 1.4, v = across the width."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    inner = loop_path(WHEEL_R)
    outer = loop_path(WHEEL_R + BAND)
    n = len(inner)
    x0, x1 = x_center - TRACK_W / 2, x_center + TRACK_W / 2
    # arc length along the outer path
    s = [0.0]
    for i in range(1, n + 1):
        a, b = outer[i - 1], outer[i % n]
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    TILE = 1.4
    rings = []
    for i in range(n):
        iy, iz = inner[i][0], inner[i][1]
        oy, oz = outer[i][0], outer[i][1]
        rings.append([bm.verts.new((x0, oy, oz)), bm.verts.new((x1, oy, oz)), bm.verts.new((x1, iy, iz)), bm.verts.new((x0, iy, iz))])
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        u0, u1 = s[i] / TILE, s[i + 1] / TILE
        quads = [
            ((A[0], A[1], B[1], B[0]), [(u0, 0.0), (u0, 1.0), (u1, 1.0), (u1, 0.0)]),          # outer tread
            ((A[3], B[3], B[2], A[2]), [(u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0)]),          # inner face
            ((A[1], A[2], B[2], B[1]), [(u0, 0.97), (u0, 1.0), (u1, 1.0), (u1, 0.97)]),       # side edges (link ends)
            ((A[0], B[0], B[3], A[3]), [(u0, 0.0), (u1, 0.0), (u1, 0.03), (u0, 0.03)]),
        ]
        for vs, uvs in quads:
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def inset_profile(d):
    """The rhomboid wheel quad grown by d (side armour panels sit inside the track band)."""
    pts = loop_path(d, seg=3)
    return [(p[0], p[1]) for p in pts]


# ------------------------------------------------------------------ hull
def hull_parts():
    p = []
    # side armour panels (outer + inner) inside the track loop, and the track unit body between them
    prof = inset_profile(0.30)
    for sx in (1, -1):
        p.append((side_prism(prof, sx * (TRACK_X + TRACK_W / 2 + 0.04), 0.1), 'paint'))
        p.append((side_prism(prof, sx * (TRACK_X - TRACK_W / 2 - 0.03), 0.08), 'paint'))
        core = side_prism(inset_profile(0.22), sx * TRACK_X, TRACK_W - 0.1)
        p.append((core, 'metal'))
        # raised armour plate on the outer panel with rivets round its border
        plate = side_prism([(-2.6, 0.75), (2.5, 0.75), (2.9, 1.6), (-2.95, 1.6)], sx * (TRACK_X + TRACK_W / 2 + 0.11), 0.05)
        p.append((plate, 'paint'))
        xo = sx * (TRACK_X + TRACK_W / 2 + 0.14)
        p += rivet_line((xo, -2.5, 0.82), (xo, 2.4, 0.82), 0.42, (sx, 0, 0))
        p += rivet_line((xo, -2.85, 1.53), (xo, 2.8, 1.53), 0.42, (sx, 0, 0))
        # headlamp on the track guard front
        lamp = cyl(0.11, 0.18, seg=10, bev=0.01); xf(lamp, (sx * (TRACK_X - 0.2), -3.55, 1.95), rot=(90, 0, 0)); p.append((lamp, 'metal'))
        lens = cyl(0.085, 0.02, seg=10); xf(lens, (sx * (TRACK_X - 0.2), -3.65, 1.95), rot=(90, 0, 0)); p.append((lens, 'lamp'))
        # sponson: armoured housing on the outer panel with twin heavy bolters
        sp = rbox(0.55, 1.1, 0.72, bev=0.06, taper=(0.85, 0.85))
        xf(sp, (sx * (TRACK_X + TRACK_W / 2 + 0.38), -0.25, 1.28)); p.append((sp, 'paint'))
        dome = sphere(0.36, 12, 8); xf(dome, (sx * (TRACK_X + TRACK_W / 2 + 0.4), -0.78, 1.28), scale=(0.8, 0.9, 0.9)); p.append((dome, 'paint'))
        for dz in (0.07, -0.07):
            bb = cyl(0.045, 0.8, seg=8); xf(bb, (sx * (TRACK_X + TRACK_W / 2 + 0.45), -1.3, 1.28 + dz), rot=(90, 0, 0)); p.append((bb, 'metal'))
            mz = cyl(0.06, 0.12, seg=8); xf(mz, (sx * (TRACK_X + TRACK_W / 2 + 0.45), -1.7, 1.28 + dz), rot=(90, 0, 0)); p.append((mz, 'scrap'))
        ammo = rbox(0.3, 0.5, 0.25, bev=0.02); xf(ammo, (sx * (TRACK_X + TRACK_W / 2 + 0.38), 0.45, 1.05)); p.append((ammo, 'metal'))
        # jerry cans on the rear of the track guard
        for k in range(2):
            jc = rbox(0.12, 0.34, 0.45, bev=0.02); xf(jc, (sx * (TRACK_X + TRACK_W / 2 + 0.17), 1.7 + k * 0.38, 1.12)); p.append((jc, 'red'))
        # exhaust stack rising behind the track unit
        ex = cyl(0.13, 1.0, seg=10); xf(ex, (sx * (TRACK_X - 0.25), 3.15, 2.35)); p.append((ex, 'rust'))
        cap = cyl(0.17, 0.12, seg=10, r2=0.13); xf(cap, (sx * (TRACK_X - 0.25), 3.15, 2.9)); p.append((cap, 'scrap'))
        elbow = cyl(0.13, 0.5, seg=10); xf(elbow, (sx * (TRACK_X - 0.25), 2.95, 1.95), rot=(70, 0, 0)); p.append((elbow, 'rust'))
    # central hull between the tracks
    hull = side_prism([(-3.05, 0.55), (-3.32, 1.08), (-2.35, 1.95), (2.75, 1.95), (3.15, 1.55), (3.0, 0.55)], 0, 2.24)
    p.append((hull, 'paint'))
    # glacis armour plate (slightly proud) and front lower plate
    gl = rbox(2.1, 1.28, 0.06, bev=0.02); xf(gl, (0, -2.84, 1.55), rot=(41.8, 0, 0)); p.append((gl, 'paint'))
    p += rivet_line((-0.95, -3.22, 1.15), (0.95, -3.22, 1.15), 0.24, (0, -0.67, 0.74))
    p += rivet_line((-0.95, -2.46, 1.86), (0.95, -2.46, 1.86), 0.24, (0, -0.67, 0.74))
    # hull lascannon in a ball mount on the glacis
    ball = sphere(0.3, 14, 10); xf(ball, (0, -2.92, 1.42)); p.append((ball, 'metal'))
    lc = cyl(0.075, 1.25, seg=10); xf(lc, (0, -3.75, 1.42), rot=(90, 0, 0)); p.append((lc, 'metal'))
    lcp = rbox(0.22, 0.55, 0.22, bev=0.02); xf(lcp, (0, -3.35, 1.42)); p.append((lcp, 'scrap'))
    lct = cyl(0.11, 0.14, seg=10); xf(lct, (0, -4.35, 1.42), rot=(90, 0, 0)); p.append((lct, 'brass'))
    # driver's vision block with an armoured hood
    hood = rbox(0.6, 0.35, 0.18, bev=0.02); xf(hood, (-0.55, -2.32, 2.02)); p.append((hood, 'paint'))
    slit = rbox(0.45, 0.04, 0.06); xf(slit, (-0.55, -2.5, 1.99)); p.append((slit, 'glass'))
    # Imperial aquila on the front plate
    wing = [(0.0, 0.0), (0.55, 0.18), (0.62, 0.3), (0.38, 0.26), (0.42, 0.36), (0.2, 0.3), (0.12, 0.42), (0.0, 0.34)]
    left = [(-x, z) for (x, z) in reversed(wing)]
    aq = extrude(wing + left[1:-1], 0.05)
    xf(aq, (0, 0, -0.2)); xf(aq, (0, -3.2, 0.86), rot=(24.4, 0, 0)); p.append((aq, 'brass'))
    skull = sphere(0.09, 10, 8); xf(skull, (0, -3.24, 0.83)); p.append((skull, 'brass'))
    # engine deck: raised grille, slats, tarp roll, rear hazard plate
    deck = rbox(1.9, 1.3, 0.14, bev=0.02); xf(deck, (0, 2.2, 2.02)); p.append((deck, 'metal'))
    for k in range(7):
        sl = rbox(1.75, 0.07, 0.05); xf(sl, (0, 1.68 + k * 0.17, 2.12)); p.append((sl, 'scrap'))
    tarp = cyl(0.2, 1.8, seg=10); xf(tarp, (0, 3.0, 2.15), rot=(0, 90, 0)); p.append((tarp, 'sandbag'))
    for sx in (0.6, -0.6):
        strap = cyl(0.21, 0.06, seg=10); xf(strap, (sx, 3.0, 2.15), rot=(0, 90, 0)); p.append((strap, 'wood'))
    rear = rbox(2.0, 0.05, 0.42, bev=0.01); xf(rear, (0, 3.13, 1.15), rot=(-20, 0, 0)); p.append((rear, 'hazard'))
    crate = rbox(0.75, 0.5, 0.4, bev=0.03); xf(crate, (0.55, 1.15, 2.15)); p.append((crate, 'wood'))
    hatch = cyl(0.3, 0.06, seg=12); xf(hatch, (-0.6, 1.15, 1.98)); p.append((hatch, 'metal'))
    p += rivet_line((-1.05, -2.2, 1.97), (-1.05, 2.6, 1.97), 0.4, (0, 0, 1))
    p += rivet_line((1.05, -2.2, 1.97), (1.05, 2.6, 1.97), 0.4, (0, 0, 1))
    # towing hooks
    for sx in (0.7, -0.7):
        hk = cyl(0.07, 0.25, seg=8); xf(hk, (sx, 3.2, 0.75), rot=(90, 0, 0)); p.append((hk, 'scrap'))
    return p


# ------------------------------------------------------------------ turret (pivot: ring centre on the hull roof)
TURRET_AT = (0.0, -0.45, 1.95)       # blender coords, on the hull
TURRET_SCALE = 1.1
TRUNNION = (0.0, -1.22 * TURRET_SCALE, 0.55 * TURRET_SCALE)        # blender coords, relative to the turret pivot


def turret_parts():
    p = []
    ring = cyl(0.98, 0.16, seg=24); xf(ring, (0, 0, 0.08)); p.append((ring, 'metal'))
    body = rbox(2.15, 2.45, 0.86, bev=0.07, seg=2, taper=(0.84, 0.8))
    xf(body, (0, 0.12, 0.58)); p.append((body, 'paint'))
    cheek = rbox(1.9, 0.5, 0.7, bev=0.05, taper=(0.9, 0.6)); xf(cheek, (0, -1.0, 0.52)); p.append((cheek, 'paint'))
    mant = rbox(0.95, 0.4, 0.62, bev=0.06); xf(mant, (0, -1.22, 0.55)); p.append((mant, 'metal'))
    bustle = rbox(1.7, 0.45, 0.5, bev=0.03); xf(bustle, (0, 1.5, 0.55)); p.append((bustle, 'paint'))
    p += rivet_line((-0.82, 1.73, 0.75), (0.82, 1.73, 0.75), 0.22, (0, 1, 0))
    p += rivet_line((-0.9, -0.9, 1.0), (-0.9, 1.25, 1.0), 0.3, (0, 0, 1))
    p += rivet_line((0.9, -0.9, 1.0), (0.9, 1.25, 1.0), 0.3, (0, 0, 1))
    # commander's cupola, open hatch, pintle heavy stubber
    cup = cyl(0.33, 0.26, seg=14); xf(cup, (0.5, 0.45, 1.12)); p.append((cup, 'paint'))
    lid = cyl(0.35, 0.06, seg=14); xf(lid, (0.5, 0.82, 1.42), rot=(-70, 0, 0)); p.append((lid, 'metal'))
    for k in range(4):
        a = k * 1.2 - 1.8
        vb = rbox(0.12, 0.06, 0.08); xf(vb, (0.5 + math.sin(a) * 0.33, 0.45 - math.cos(a) * 0.33, 1.2), rot=(0, 0, -math.degrees(a))); p.append((vb, 'glass'))
    post = cyl(0.03, 0.35, seg=6); xf(post, (0.5, 0.12, 1.4)); p.append((post, 'metal'))
    stub = rbox(0.12, 0.45, 0.14, bev=0.015); xf(stub, (0.5, 0.0, 1.6)); p.append((stub, 'metal'))
    sb = cyl(0.03, 0.6, seg=6); xf(sb, (0.5, -0.5, 1.62), rot=(90, 0, 0)); p.append((sb, 'metal'))
    box = rbox(0.12, 0.2, 0.16); xf(box, (0.62, 0.05, 1.55)); p.append((box, 'rust'))
    # searchlight, smoke launchers, aerial
    sl = cyl(0.14, 0.26, seg=12); xf(sl, (-0.82, -0.72, 0.98), rot=(90, 0, 0)); p.append((sl, 'metal'))
    sll = cyl(0.11, 0.02, seg=12); xf(sll, (-0.82, -0.86, 0.98), rot=(90, 0, 0)); p.append((sll, 'lamp'))
    for sx in (1, -1):
        for k in range(3):
            t = cyl(0.055, 0.28, seg=8); xf(t, (sx * (0.98 + k * 0.0), -0.55 + k * 0.16, 0.72 + k * 0.02), rot=(-60, sx * 25, 0)); p.append((t, 'scrap'))
    ant = cyl(0.016, 2.2, seg=5); xf(ant, (-0.75, 1.15, 2.1)); p.append((ant, 'metal'))
    antb = cyl(0.06, 0.12, seg=8); xf(antb, (-0.75, 1.15, 1.02)); p.append((antb, 'brass'))
    # brass eagle on each cheek
    for sx in (1, -1):
        e = rbox(0.04, 0.34, 0.2, bev=0.01, taper=(1, 0.5)); xf(e, (sx * 0.98, -0.2, 0.62)); p.append((e, 'brass'))
    for b, _ in p:
        xf(b, scale=(TURRET_SCALE,) * 3)
    return p


def barrel_parts():
    """Battle cannon, pivot at the trunnion, firing toward -Y."""
    p = []
    sleeve = cyl(0.2, 0.55, seg=16); xf(sleeve, (0, -0.2, 0), rot=(90, 0, 0)); p.append((sleeve, 'metal'))
    tube = cyl(0.15, 2.45, seg=16, r2=0.125); xf(tube, (0, -1.7, 0), rot=(90, 0, 0)); p.append((tube, 'metal'))
    fume = lathe([(0.0, 0.0), (0.13, 0.0), (0.19, 0.12), (0.19, 0.45), (0.13, 0.58), (0.0, 0.58)], seg=16)
    xf(fume, (0, -1.25, 0), rot=(90, 0, 0)); p.append((fume, 'paint'))
    brake = rbox(0.36, 0.42, 0.3, bev=0.04); xf(brake, (0, -3.05, 0)); p.append((brake, 'metal'))
    for sx in (1, -1):
        for k in range(3):
            v = rbox(0.02, 0.07, 0.2); xf(v, (sx * 0.18, -2.92 - k * 0.12, 0)); p.append((v, 'scrap'))
    bore = cyl(0.085, 0.02, seg=12); xf(bore, (0, -3.27, 0), rot=(90, 0, 0)); p.append((bore, 'scrap'))
    return p


pieces = {
    'lr_hull': hull_parts(),
    'lr_turret': turret_parts(),
    'lr_barrel': barrel_parts(),
}
objs = []
for name, parts in pieces.items():
    ob = obj_from(name, parts)
    objs.append(ob)
    print('PIECE', name, len(ob.data.polygons))
# tracks: a separate object so their own UVs survive
tb = join_bm(track_band(TRACK_X), track_band(-TRACK_X))
me = bpy.data.meshes.new('lr_track'); tb.to_mesh(me); tb.free()
trk = bpy.data.objects.new('lr_track', me); sc.collection.objects.link(trk)
for m in MATS:
    me.materials.append(bpy.data.materials[m])
for f in me.polygons:
    f.material_index = MATS.index('track')
objs.append(trk)
print('PIECE lr_track', len(me.polygons))

# turret and barrel stand in place for the AO bake (so the hull roof darkens under the turret), then go back to their pivots
tur = bpy.data.objects['lr_turret']; bar = bpy.data.objects['lr_barrel']
tur.location = TURRET_AT
bar.location = (TURRET_AT[0] + TRUNNION[0], TURRET_AT[1] + TRUNNION[1], TURRET_AT[2] + TRUNNION[2])
for ob in objs:
    ob.data.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
    ob.data.color_attributes.active_color = ob.data.color_attributes['AO']
setup_cycles(96)
w = bpy.data.worlds.new('w'); sc.world = w
w.light_settings.distance = 0.9
sc.render.bake.target = 'VERTEX_COLORS'
gnd = bpy.data.objects.new('ground', bpy.data.meshes.new('g'))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60); bm.to_mesh(gnd.data); bm.free()
sc.collection.objects.link(gnd)
for ob in objs:
    set_active(ob)
    bpy.ops.object.bake(type='AO', use_clear=True, target='VERTEX_COLORS')
bpy.data.objects.remove(gnd)

if preview:
    # quick look render (Eevee-free: Cycles, a few samples)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
    cam.location = (9.5, -10.5, 6.5)
    cam.rotation_euler = (math.radians(65), 0, math.radians(42))
    sc.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (0.7, 0.2, 0.9)
    sc.collection.objects.link(sun)
    cols = {'paint': (0.17, 0.2, 0.1), 'metal': (0.12, 0.12, 0.13), 'rust': (0.25, 0.12, 0.05), 'brass': (0.6, 0.45, 0.15), 'glass': (0.05, 0.03, 0.02),
            'lamp': (1, 0.85, 0.6), 'hazard': (0.6, 0.5, 0.05), 'sandbag': (0.35, 0.3, 0.2), 'wood': (0.25, 0.15, 0.08), 'scrap': (0.2, 0.18, 0.16), 'red': (0.4, 0.05, 0.03), 'track': (0.08, 0.07, 0.06)}
    for m in MATS:
        mat = bpy.data.materials[m]; mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*cols[m], 1)
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.36, 0.4, 1)
    sc.render.resolution_x, sc.render.resolution_y = 1100, 700
    sc.cycles.samples = 24
    sc.render.filepath = os.path.join(out, 'lr_preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam); bpy.data.objects.remove(sun)

tur.location = (0, 0, 0); bar.location = (0, 0, 0)
for o in bpy.context.view_layer.objects:
    o.select_set(o in objs)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'vehicles.glb'), export_format='GLB', use_selection=True, export_materials='EXPORT',
                          export_image_format='NONE', export_vertex_color='ACTIVE', export_yup=True, export_normals=True, export_animations=False,
                          export_texcoords=True)


def three(v):
    """blender (x, y, z) -> three.js (x, z, -y)"""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


meta = {
    'leman_russ': {
        'hull': 'lr_hull', 'track': 'lr_track', 'turret': 'lr_turret', 'barrel': 'lr_barrel',
        'turretAt': three(TURRET_AT),
        'barrelAt': three(TRUNNION),
        'muzzle': three((0, -3.3, 0)),                         # in barrel space
        'hullMuzzle': three((0, -4.42, 1.42)),                # hull lascannon tip, hull space
        'sponsons': [three((s * (TRACK_X + TRACK_W / 2 + 0.45), -1.78, 1.28)) for s in (1, -1)],
        'exhausts': [three((s * (TRACK_X - 0.25), 3.15, 2.98)) for s in (1, -1)],
        'trackTile': 1.4,
        'length': 7.0, 'width': 4.6, 'height': 3.2,
    }
}
with open(os.path.join(out, 'vehicles.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print('VEHICLES DONE')
