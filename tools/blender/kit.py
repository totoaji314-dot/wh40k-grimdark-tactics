# Character toolkit for Blender 5.x (background mode).
# Geometry builders, part merging + skin weights, a shared humanoid rig with IK controls,
# animation authoring in armature space, procedural PBR materials, atlas baking, LODs, glTF export.
#
# Conventions (Blender space): Z up, character faces -Y, character's left = +X.
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler, Quaternion

RAD = math.pi / 180


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler([a * RAD for a in rot], 'XYZ'), Vector(scale))


# ----------------------------------------------------------------------------- geometry
def xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    bmesh.ops.transform(bm, matrix=M(loc, rot, scale), verts=bm.verts)
    return bm


def bevel(bm, off, seg=2, prof=0.5):
    if off > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=off, segments=seg, profile=prof, affect='EDGES', clamp_overlap=True)
    return bm


def rbox(sx, sy, sz, bev=0.0, seg=2, taper=None, taper_y=None, shear=0.0):
    """Box centred at origin. taper=(kx,ky) scales the top (z>0) face; shear moves the top in -Y."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= sx; v.co.y *= sy; v.co.z *= sz
        if taper and top:
            v.co.x *= taper[0]; v.co.y *= taper[1]
        if taper_y and v.co.y < 0:  # front face scale
            v.co.x *= taper_y[0]; v.co.z *= taper_y[1]
        if shear and top:
            v.co.y -= shear
    return bevel(bm, bev, seg)


def cyl(r1, depth, seg=16, r2=None, cap=True, bev=0.0):
    """Cylinder / cone along Z centred at origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r1 if r2 is None else r2, depth=depth)
    if bev > 0:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.z - e.link_faces[1].normal.z) > 0.5]
        bmesh.ops.bevel(bm, geom=edges, offset=bev, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def sphere(r, u=16, v=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return bm


def ellipsoid(rx, ry, rz, u=16, v=10):
    return xf(sphere(1.0, u, v), scale=(rx, ry, rz))


def cut(bm, co, no, keep='above'):
    """Bisect and keep one side of a plane (point co, normal no). keep='above' keeps the side the normal points to."""
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), clear_inner=(keep == 'above'), clear_outer=(keep != 'above'))
    return bm


def fill_holes(bm):
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    return bm


def lathe(profile, seg=20, arc=360.0):
    """Surface of revolution around Z. profile: [(r, z)] from bottom to top. r == 0 makes a pole."""
    bm = bmesh.new()
    full = abs(arc - 360) < 1e-3
    n = seg if full else seg + 1
    rings = []
    for (r, z) in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for i in range(n):
            a = (i / seg) * arc * RAD
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        m = seg if full else seg
        for i in range(m):
            j = (i + 1) % n if full else i + 1
            if len(A) == 1 and len(B) > 1:
                bm.faces.new((A[0], B[j], B[i]))
            elif len(B) == 1 and len(A) > 1:
                bm.faces.new((A[i], A[j], B[0]))
            elif len(A) > 1:
                bm.faces.new((A[i], A[j], B[j], B[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def torus(R, r, seg=24, seg2=8, arc=360.0):
    prof = []
    bm = bmesh.new()
    full = abs(arc - 360) < 1e-3
    n = seg if full else seg + 1
    rings = []
    for i in range(n):
        a = (i / seg) * arc * RAD
        c = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for j in range(seg2):
            b = j / seg2 * 2 * math.pi
            p = c * (R + r * math.cos(b)) + Vector((0, 0, r * math.sin(b)))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(seg if full else seg):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(seg2):
            k = (j + 1) % seg2
            bm.faces.new((A[j], B[j], B[k], A[k]))
    if not full:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    del prof
    return bm


def extrude(pts, depth, bev=0.0, seg=1):
    """Prism from a 2D polygon in the XZ plane (x right, z up), extruded along Y and centred."""
    bm = bmesh.new()
    a = [bm.verts.new((x, -depth / 2, z)) for (x, z) in pts]
    b = [bm.verts.new((x, depth / 2, z)) for (x, z) in pts]
    n = len(pts)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bev > 0:
        bevel(bm, bev, seg)
    return bm


def tube(points, r, seg=8, r_end=None):
    """Swept tube along a polyline of 3D points."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        s = d.cross(up).normalized(); u = s.cross(d).normalized()
        rr = r if r_end is None else r + (r_end - r) * i / (len(pts) - 1)
        ring = [bm.verts.new(p + (s * math.cos(a) + u * math.sin(a)) * rr) for a in [k / seg * 2 * math.pi for k in range(seg)]]
        rings.append(ring)
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(seg):
            k = (j + 1) % seg
            bm.faces.new((A[j], A[k], B[k], B[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def perm_yzx(bm):
    """Rotate axes (x, y, z) -> (y, z, x): turns an extruded XZ profile into an upright blade along +y."""
    for v in bm.verts:
        v.co = Vector((v.co.y, v.co.z, v.co.x))
    return bm


def copy(bm):
    out = bmesh.new()
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me); out.from_mesh(me)
    bpy.data.meshes.remove(me)
    return out


def mirror_x(bm):
    c = copy(bm)
    for v in c.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(c, faces=c.faces)
    return c


def join_bm(*bms):
    out = bmesh.new()
    me = bpy.data.meshes.new('tmp')
    for b in bms:
        b.to_mesh(me); out.from_mesh(me)
    bpy.data.meshes.remove(me)
    return out


def array(bm, n, step, rot_step=(0, 0, 0)):
    parts = []
    for i in range(n):
        c = copy(bm)
        xf(c, loc=tuple(s * i for s in step), rot=tuple(r * i for r in rot_step))
        parts.append(c)
    return join_bm(*parts)


def radial(bm, n, axis='z', offset_deg=0.0):
    parts = []
    for i in range(n):
        c = copy(bm)
        a = offset_deg + i * 360.0 / n
        rot = (0, 0, a) if axis == 'z' else (0, a, 0) if axis == 'y' else (a, 0, 0)
        xf(c, rot=rot)
        parts.append(c)
    return join_bm(*parts)


def jitter(bm, amount, seed=1):
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    return bm


def subdivide(bm, levels=1):
    """Catmull-Clark through a temporary modifier, returns a new bmesh."""
    me = bpy.data.meshes.new('sd'); bm.to_mesh(me)
    ob = bpy.data.objects.new('sd', me); bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('s', 'SUBSURF'); md.levels = levels; md.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new(); out.from_mesh(me2)
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); bpy.data.meshes.remove(me2)
    return out


# ----------------------------------------------------------------------------- parts -> skinned mesh
class Part:
    __slots__ = ('bm', 'mat', 'bind', 'subd', 'sharp', 'name')

    def __init__(self, bm, mat, bind, subd=0, sharp=38.0, name=''):
        self.bm, self.mat, self.bind, self.subd, self.sharp, self.name = bm, mat, bind, subd, sharp, name


def P(bm, mat, bind, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), subd=0, sharp=38.0, name=''):
    xf(bm, loc, rot, scale)
    return Part(bm, mat, bind, subd, sharp, name)


def P2(bm, mat, bind_l, loc, rot=(0, 0, 0), scale=(1, 1, 1), subd=0, sharp=38.0):
    """A left/right mirrored pair. bind_l uses '.L' names which are swapped to '.R' for the mirror."""
    xf(bm, loc, rot, scale)
    r = mirror_x(bm)
    return [Part(bm, mat, bind_l, subd, sharp), Part(r, mat, swap_side(bind_l), subd, sharp)]


def swap_side(bind):
    if isinstance(bind, str):
        return bind.replace('.L', '.__').replace('.R', '.L').replace('.__', '.R')
    if isinstance(bind, (list, tuple)):
        return [(swap_side(b), w) for (b, w) in bind]
    if callable(bind):
        def f(co, _b=bind):
            m = _b(Vector((-co.x, co.y, co.z)))
            return [(swap_side(b), w) for (b, w) in m]
        return f
    return bind


def mark_sharp(bm, angle_deg):
    lim = angle_deg * RAD
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) > lim:
            e.smooth = False


def build_mesh(name, parts, bone_names, mat_names):
    """Merge parts into one mesh object with vertex groups (one per bone) and material slots."""
    total = bmesh.new()
    weights = []  # per vertex: list of (group_index, w)
    gi = {b: i for i, b in enumerate(bone_names)}
    mi = {m: i for i, m in enumerate(mat_names)}
    tmp = bpy.data.meshes.new('tmp')
    for p in parts:
        bm = p.bm
        if p.subd:
            sb = subdivide(bm, p.subd); bm.free(); bm = sb
        mark_sharp(bm, p.sharp)
        bm.to_mesh(tmp)
        nv0 = len(total.verts); nf0 = len(total.faces)
        total.from_mesh(tmp)
        total.verts.ensure_lookup_table(); total.faces.ensure_lookup_table()
        for f in total.faces[nf0:]:
            f.material_index = mi[p.mat]
        for v in total.verts[nv0:]:
            b = p.bind
            if isinstance(b, str):
                ws = [(b, 1.0)]
            elif callable(b):
                ws = b(v.co)
            else:
                ws = b
            s = sum(w for _, w in ws) or 1.0
            weights.append([(gi[n], w / s) for (n, w) in ws if w > 1e-4])
        bm.free()
    bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new(name)
    total.to_mesh(me); total.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for b in bone_names:
        ob.vertex_groups.new(name=b)
    groups = ob.vertex_groups
    for vi, ws in enumerate(weights):
        for (g, w) in ws:
            groups[g].add([vi], w, 'REPLACE')
    for m in mat_names:
        ob.data.materials.append(bpy.data.materials.get(m) or bpy.data.materials.new(m))
    return ob


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length, t


def blend(rig, bones, radius=0.08, power=2.0):
    """Smooth weights between listed bones by distance to their rest segments."""
    def f(co, _bones=bones):
        out = []
        for b in _bones:
            h, t = rig.rest[b]
            d, _ = seg_dist(co, h, t)
            out.append((b, 1.0 / (max(d, 0.004) / radius) ** power))
        out.sort(key=lambda x: -x[1])
        out = out[:3]
        s = sum(w for _, w in out)
        return [(b, w / s) for b, w in out]
    return f


def along(b0, b1, z0, z1):
    """Weight that slides from bone b0 (at z0) to bone b1 (at z1) by vertex height (for coats, skirts, sleeves)."""
    def f(co):
        t = max(0.0, min(1.0, (co.z - z0) / (z1 - z0)))
        t = t * t * (3 - 2 * t)
        return [(b0, 1 - t), (b1, t)]
    return f


# ----------------------------------------------------------------------------- rig
DEFORM = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
          'clavicle.L', 'upper_arm.L', 'forearm.L', 'hand.L',
          'clavicle.R', 'upper_arm.R', 'forearm.R', 'hand.R',
          'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R',
          'weapon', 'offhand', 'muzzle', 'muzzle2',
          'pauldron.L', 'pauldron.R', 'tasset.L', 'tasset.R']


class Body:
    """Skeleton proportions (metres)."""

    def __init__(self, **k):
        self.hip_h = 0.95; self.knee_h = 0.50; self.ankle_h = 0.085; self.hip_w = 0.10
        self.spine_z = 1.04; self.chest_z = 1.22; self.neck_z = 1.47; self.head_z = 1.57; self.top_z = 1.76
        self.head_y = -0.01; self.neck_y = 0.0
        self.sh_w = 0.19; self.sh_z = 1.43; self.ua = 0.29; self.fa = 0.27; self.hand = 0.085; self.arm_out = 9.0
        self.foot = 0.22
        self.grip_r = (-0.11, -0.26, 1.30)     # weapon bone head (rest, aim pose)
        self.w_yaw = 25.0                       # weapon rest yaw (deg, + = muzzle toward the left)
        self.w_pitch = 0.0                      # weapon rest pitch (deg, + = muzzle up)
        self.offhand = (0.16, -0.30, 1.30)
        self.o_yaw = -8.0
        self.o_pitch = 0.0
        self.muzzle = (0.0, 0.55, 0.07)        # gun-space muzzle point of the main weapon
        self.muzzle2 = (0.0, 0.22, 0.065)      # gun-space muzzle point of the off-hand weapon
        self.__dict__.update(k)

    def gun_matrix(self, which='weapon'):
        """Gun modelling space -> armature space. Gun space: x right, y toward the muzzle, z up, origin at the grip."""
        if which == 'weapon':
            h, yaw, pitch = self.grip_r, self.w_yaw, self.w_pitch
        else:
            h, yaw, pitch = self.offhand, self.o_yaw, self.o_pitch
        return Matrix.Translation(Vector(h)) @ Matrix.Rotation((180 + yaw) * RAD, 4, 'Z') @ Matrix.Rotation(pitch * RAD, 4, 'X')


class Rig:
    def __init__(self, body: Body, name='Armature'):
        self.b = body
        self.rest = {}
        arm = bpy.data.armatures.new(name)
        self.ob = bpy.data.objects.new(name, arm)
        bpy.context.scene.collection.objects.link(self.ob)
        bpy.context.view_layer.objects.active = self.ob
        self.ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        eb = arm.edit_bones
        b = body
        V = Vector

        def add(n, h, t, parent=None, deform=True, roll=0.0, connect=False):
            e = eb.new(n); e.head = V(h); e.tail = V(t); e.roll = roll * RAD
            if parent:
                e.parent = eb[parent]; e.use_connect = connect
            e.use_deform = deform
            return e

        add('root', (0, 0, 0), (0, 0, 0.2))
        add('hips', (0, 0, b.hip_h + 0.03), (0, 0, b.spine_z), 'root')
        add('spine', (0, 0, b.spine_z), (0, 0, b.chest_z), 'hips', connect=True)
        add('chest', (0, 0, b.chest_z), (0, b.neck_y, b.neck_z), 'spine', connect=True)
        add('neck', (0, b.neck_y, b.neck_z), (0, b.head_y, b.head_z), 'chest', connect=True)
        add('head', (0, b.head_y, b.head_z), (0, b.head_y, b.top_z), 'neck', connect=True)
        a = b.arm_out * RAD
        for s, sx in (('L', 1), ('R', -1)):
            sh = V((sx * b.sh_w, 0.0, b.sh_z))
            el = sh + V((sx * math.sin(a) * b.ua, 0.03, -math.cos(a) * b.ua))
            wr = el + V((sx * math.sin(a * 0.6) * b.fa, -0.05, -math.cos(a * 0.6) * b.fa))
            hd = wr + V((0, -0.01, -b.hand))
            add('clavicle.' + s, (sx * 0.03, 0.0, b.sh_z - 0.03), tuple(sh), 'chest')
            add('upper_arm.' + s, tuple(sh), tuple(el), 'clavicle.' + s, connect=True)
            add('forearm.' + s, tuple(el), tuple(wr), 'upper_arm.' + s, connect=True)
            add('hand.' + s, tuple(wr), tuple(hd), 'forearm.' + s, connect=True)
            hip = V((sx * b.hip_w, 0, b.hip_h)); kn = V((sx * b.hip_w, -0.02, b.knee_h)); an = V((sx * b.hip_w, 0.015, b.ankle_h))
            toe = V((sx * b.hip_w, -b.foot * 0.72, 0.025))
            add('thigh.' + s, tuple(hip), tuple(kn), 'hips')
            add('shin.' + s, tuple(kn), tuple(an), 'thigh.' + s, connect=True)
            add('foot.' + s, tuple(an), tuple(toe), 'shin.' + s, connect=True)
        gm = b.gun_matrix('weapon')
        add('weapon', tuple(gm.translation), tuple(gm @ V((0, 0.3, 0))), 'chest')
        om = b.gun_matrix('offhand')
        add('offhand', tuple(om.translation), tuple(om @ V((0, 0.2, 0))), 'chest')
        # muzzle markers: unweighted joints whose animated positions tell the game where shots start
        mz = gm @ V(b.muzzle)
        add('muzzle', tuple(mz), tuple(gm @ (V(b.muzzle) + V((0, 0.05, 0)))), 'weapon')
        mz2 = om @ V(b.muzzle2)
        add('muzzle2', tuple(mz2), tuple(om @ (V(b.muzzle2) + V((0, 0.05, 0)))), 'offhand')
        # follower bones: rigid armour that turns part-way with the arm / leg (pauldrons, thigh plates, coat flaps)
        for s in ('L', 'R'):
            for fb, src, par in (('pauldron.', 'upper_arm.', 'clavicle.'), ('tasset.', 'thigh.', None)):
                u = eb[src + s]
                e = eb.new(fb + s); e.head = u.head.copy(); e.tail = u.head + (u.tail - u.head).normalized() * 0.12; e.roll = u.roll
                e.parent = eb[par + s] if par else eb['hips']; e.use_deform = True
        # --- controls (not exported)
        for s, sx in (('L', 1), ('R', -1)):
            an = eb['foot.' + s].head.copy(); toe = eb['foot.' + s].tail.copy()
            add('ik_foot.' + s, tuple(an), tuple(an + (toe - an).normalized() * 0.15), 'root', deform=False)
            add('pole_knee.' + s, (sx * b.hip_w, -1.2, b.knee_h + 0.1), (sx * b.hip_w, -1.3, b.knee_h + 0.1), 'root', deform=False)
            add('pole_elbow.' + s, (sx * (b.sh_w + 0.45), 0.55, b.sh_z - 0.45), (sx * (b.sh_w + 0.45), 0.65, b.sh_z - 0.45), 'chest', deform=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        for bn in arm.bones:
            self.rest[bn.name] = (bn.head_local.copy(), bn.tail_local.copy())
        self.hand_targets = {}

    def grip(self, side, which, pos_g, fwd_g, up_g):
        """IK hand target given in gun space of `which` ('weapon' / 'offhand')."""
        gm = self.b.gun_matrix(which)
        r = gm.to_3x3()
        self.hand_target(side, which, tuple(gm @ Vector(pos_g)), tuple(r @ Vector(fwd_g)), tuple(r @ Vector(up_g)))

    def to_bone(self, bm, bone, extra=None):
        """Place a bmesh modelled in a bone's local rest frame (y along the bone)."""
        m = self.ob.data.bones[bone].matrix_local
        if extra is not None:
            m = m @ extra
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        return bm

    def limb(self, bone):
        """Limb space: origin at the bone head, y along the bone, z toward the character's front."""
        h, t = self.rest[bone]
        y = (t - h).normalized()
        ref = Vector((0, -1, 0)) if abs(y.y) < 0.85 else Vector((0, 0, 1))
        z = (ref - y * ref.dot(y)).normalized()
        x = y.cross(z)
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = h
        return m

    def L(self, bm, bone, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        """Model in limb space of `bone` (y along the bone in metres from its head, z = front)."""
        bmesh.ops.transform(bm, matrix=self.limb(bone) @ M(loc, rot, scale), verts=bm.verts)
        return bm

    def bone_len(self, bone):
        h, t = self.rest[bone]
        return (t - h).length

    def to_gun(self, bm, which='weapon'):
        bmesh.ops.transform(bm, matrix=self.b.gun_matrix(which), verts=bm.verts)
        return bm

    def hand_target(self, side, parent, pos, fwd, up):
        """Create an IK hand target as a child of `parent` (weapon/offhand) at armature-space pos.
        fwd = finger direction, up = back-of-hand direction (armature space, rest pose)."""
        bpy.context.view_layer.objects.active = self.ob
        bpy.ops.object.mode_set(mode='EDIT')
        eb = self.ob.data.edit_bones
        n = 'ik_hand.' + side
        e = eb.get(n) or eb.new(n)
        e.parent = eb[parent]; e.use_deform = False
        y = Vector(fwd).normalized(); z = Vector(up)
        x = y.cross(z).normalized(); z = x.cross(y).normalized()
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = Vector(pos)
        e.length = 0.08
        e.matrix = m
        e.length = 0.08
        bpy.ops.object.mode_set(mode='OBJECT')
        b = self.ob.data.bones[n]
        self.rest[n] = (b.head_local.copy(), b.tail_local.copy())

    def constrain(self, hand_rot=True, pauldron=0.15, tasset=0.5):
        pb = self.ob.pose.bones
        for s in ('L', 'R'):
            for fb, src, inf in (('pauldron.', 'upper_arm.', pauldron), ('tasset.', 'thigh.', tasset)):
                c = pb[fb + s].constraints.new('COPY_ROTATION')
                c.target = self.ob; c.subtarget = src + s
                c.target_space = 'LOCAL'; c.owner_space = 'LOCAL'; c.mix_mode = 'REPLACE'; c.influence = inf
            c = pb['shin.' + s].constraints.new('IK')
            c.target = self.ob; c.subtarget = 'ik_foot.' + s; c.pole_target = self.ob; c.pole_subtarget = 'pole_knee.' + s
            c.pole_angle = -90 * RAD; c.chain_count = 2
            r = pb['foot.' + s].constraints.new('COPY_ROTATION')
            r.target = self.ob; r.subtarget = 'ik_foot.' + s
            if 'ik_hand.' + s in pb:
                c = pb['forearm.' + s].constraints.new('IK')
                c.target = self.ob; c.subtarget = 'ik_hand.' + s; c.pole_target = self.ob; c.pole_subtarget = 'pole_elbow.' + s
                c.pole_angle = -90 * RAD; c.chain_count = 2
                if hand_rot:
                    r = pb['hand.' + s].constraints.new('COPY_ROTATION')
                    r.target = self.ob; r.subtarget = 'ik_hand.' + s
        for p in pb:
            p.rotation_mode = 'QUATERNION'
        self.tune_poles()

    def tune_poles(self):
        """Pick the IK pole angle per arm that reaches the grip with the least twist (smallest total rotation)."""
        pb = self.ob.pose.bones
        bones = self.ob.data.bones
        for s in ('L', 'R'):
            c = next((c for c in pb['forearm.' + s].constraints if c.type == 'IK'), None)
            if not c:
                continue

            def cost(a):
                c.pole_angle = a * RAD
                bpy.context.view_layer.update()
                tot = 0.0
                for n in ('upper_arm.' + s, 'forearm.' + s):
                    d = pb[n].matrix.to_quaternion() @ bones[n].matrix_local.to_quaternion().inverted()
                    tot += d.angle
                return tot
            best = min(range(-180, 180, 10), key=cost)
            fine = min([best + k for k in range(-9, 10, 1)], key=cost)
            cost(fine)
            print('POLE', self.ob.name, s, fine)

    def bind(self, ob):
        ob.parent = self.ob
        md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = self.ob


# ----------------------------------------------------------------------------- animation
class Pose(dict):
    """bone -> {'r': (rx, ry, rz) degrees in armature axes (relative to parent's posed frame), 'l': (x, y, z) metres}"""

    def r(self, bone, rx=0.0, ry=0.0, rz=0.0):
        e = self.setdefault(bone, {})
        o = e.get('r', (0, 0, 0)); e['r'] = (o[0] + rx, o[1] + ry, o[2] + rz)
        return self

    def l(self, bone, x=0.0, y=0.0, z=0.0):
        e = self.setdefault(bone, {})
        o = e.get('l', (0, 0, 0)); e['l'] = (o[0] + x, o[1] + y, o[2] + z)
        return self


def write_clip(rig, name, frames, pose_fn, loop=True, meta=None):
    """Create an action named `name`, keying every frame from pose_fn(t in [0,1), frame index) -> Pose."""
    ob = rig.ob
    ob.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ob.animation_data.action = act
    pb = ob.pose.bones
    rest_q = {b.name: b.matrix_local.to_quaternion() for b in ob.data.bones}
    rest_m3 = {b.name: b.matrix_local.to_3x3().normalized() for b in ob.data.bones}
    keyed = set()
    n = frames + (1 if loop else 0)
    for f in range(n):
        t = (f / frames) if loop else (f / max(1, frames - 1))
        pose = pose_fn(t % 1.0 if loop else min(t, 1.0), f)
        for p in pb:
            e = pose.get(p.name)
            R = rest_q[p.name]
            if e and 'r' in e:
                rx, ry, rz = e['r']
                Q = Euler((rx * RAD, ry * RAD, rz * RAD), 'XYZ').to_quaternion()
                p.rotation_quaternion = R.inverted() @ Q @ R
            else:
                p.rotation_quaternion = Quaternion()
            if e and 'l' in e:
                p.location = rest_m3[p.name].inverted() @ Vector(e['l'])
            else:
                p.location = Vector()
            if p.name in keyed or e:
                p.keyframe_insert('rotation_quaternion', frame=f + 1)
                p.keyframe_insert('location', frame=f + 1)
                keyed.add(p.name)
    # bones never touched still need a key so switching actions resets them
    for p in pb:
        if p.name not in keyed:
            p.rotation_quaternion = Quaternion(); p.location = Vector()
            p.keyframe_insert('rotation_quaternion', frame=1); p.keyframe_insert('location', frame=1)
    act['loop'] = 1 if loop else 0
    if meta:
        for k, v in meta.items():
            act[k] = v
    return act


# ----------------------------------------------------------------------------- materials
def mat_node_setup(name, base, rough=0.6, metal=0.0, edge=None, grime=0.35, noise_scale=18.0, bump=0.25,
                   emit=None, emit_strength=6.0, camo=None, scratches=0.0, clearcoat=0.0, seed=0.0, hue_var=0.04, checker=None):
    """Procedural PBR material used only for baking. Colours are linear RGB tuples."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    N = nt.nodes; L = nt.links
    out = N.new('ShaderNodeOutputMaterial'); out.location = (900, 0)
    bsdf = N.new('ShaderNodeBsdfPrincipled'); bsdf.location = (600, 0)
    L.new(bsdf.outputs[0], out.inputs[0])
    tc = N.new('ShaderNodeTexCoord')
    # large-scale variation
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = noise_scale * 0.25; nz.inputs['Detail'].default_value = 6
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    # fine grain
    nf = N.new('ShaderNodeTexNoise'); nf.inputs['Scale'].default_value = noise_scale * 6; nf.inputs['Detail'].default_value = 8
    L.new(tc.outputs['Object'], nf.inputs['Vector'])
    col = N.new('ShaderNodeMix'); col.data_type = 'RGBA'; col.blend_type = 'MULTIPLY'
    base_rgb = N.new('ShaderNodeRGB'); base_rgb.outputs[0].default_value = (*base, 1)
    src = base_rgb.outputs[0]
    if camo:
        # camo: three colour blobs from two noise fields
        c1 = N.new('ShaderNodeTexNoise'); c1.inputs['Scale'].default_value = camo[3]; c1.inputs['Detail'].default_value = 2; c1.inputs['Roughness'].default_value = 0.4
        L.new(tc.outputs['Object'], c1.inputs['Vector'])
        r1 = N.new('ShaderNodeValToRGB'); r1.color_ramp.interpolation = 'CONSTANT'
        r1.color_ramp.elements[0].position = 0.0; r1.color_ramp.elements[0].color = (*camo[0], 1)
        r1.color_ramp.elements[1].position = 0.5; r1.color_ramp.elements[1].color = (*camo[1], 1)
        e3 = r1.color_ramp.elements.new(0.6); e3.color = (*camo[2], 1)
        L.new(c1.outputs['Fac'], r1.inputs['Fac'])
        src = r1.outputs['Color']
    if checker:
        ck = N.new('ShaderNodeTexChecker'); ck.inputs['Scale'].default_value = checker[2]
        ck.inputs['Color1'].default_value = (*checker[0], 1); ck.inputs['Color2'].default_value = (*checker[1], 1)
        L.new(tc.outputs['Object'], ck.inputs['Vector'])
        src = ck.outputs['Color']
    # hue/value variation
    var = N.new('ShaderNodeMapRange'); var.inputs['To Min'].default_value = 1 - hue_var * 4; var.inputs['To Max'].default_value = 1 + hue_var * 4
    L.new(nz.outputs['Fac'], var.inputs['Value'])
    vcol = N.new('ShaderNodeMix'); vcol.data_type = 'RGBA'; vcol.blend_type = 'MULTIPLY'; vcol.inputs['Factor'].default_value = 1.0
    L.new(src, vcol.inputs['A'])
    comb = N.new('ShaderNodeCombineXYZ')
    for k in range(3):
        L.new(var.outputs[0], comb.inputs[k])
    L.new(comb.outputs[0], vcol.inputs['B'])
    cur = vcol.outputs['Result']
    # grime in cavities (AO) + dirt noise toward the bottom
    ao = N.new('ShaderNodeAmbientOcclusion'); ao.samples = 16; ao.inputs['Distance'].default_value = 0.06
    gr = N.new('ShaderNodeMix'); gr.data_type = 'RGBA'; gr.blend_type = 'MULTIPLY'
    inv = N.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    L.new(ao.outputs['AO'], inv.inputs[1])
    gmul = N.new('ShaderNodeMath'); gmul.operation = 'MULTIPLY'; gmul.inputs[1].default_value = grime * 1.6
    L.new(inv.outputs[0], gmul.inputs[0])
    gclamp = N.new('ShaderNodeClamp'); L.new(gmul.outputs[0], gclamp.inputs['Value'])
    L.new(gclamp.outputs[0], gr.inputs['Factor'])
    L.new(cur, gr.inputs['A'])
    dirt = N.new('ShaderNodeRGB'); dirt.outputs[0].default_value = (0.05, 0.04, 0.03, 1)
    L.new(dirt.outputs[0], gr.inputs['B'])
    cur = gr.outputs['Result']
    rough_v = N.new('ShaderNodeValue'); rough_v.outputs[0].default_value = rough
    rough_s = rough_v.outputs[0]
    metal_v = N.new('ShaderNodeValue'); metal_v.outputs[0].default_value = metal
    metal_s = metal_v.outputs[0]
    if edge:
        # convex edge wear: AO 'inside' highlights edges -> lighter worn colour
        ae = N.new('ShaderNodeAmbientOcclusion'); ae.inside = True; ae.samples = 16; ae.inputs['Distance'].default_value = 0.015
        er = N.new('ShaderNodeMath'); er.operation = 'SUBTRACT'; er.inputs[0].default_value = 1.0
        L.new(ae.outputs['AO'], er.inputs[1])
        en = N.new('ShaderNodeMath'); en.operation = 'MULTIPLY'
        L.new(er.outputs[0], en.inputs[0]); L.new(nf.outputs['Fac'], en.inputs[1])
        eramp = N.new('ShaderNodeMapRange'); eramp.inputs['From Min'].default_value = edge[1]; eramp.inputs['From Max'].default_value = edge[1] + 0.12
        L.new(en.outputs[0], eramp.inputs['Value'])
        em = N.new('ShaderNodeMix'); em.data_type = 'RGBA'
        L.new(eramp.outputs[0], em.inputs['Factor']); L.new(cur, em.inputs['A'])
        ec = N.new('ShaderNodeRGB'); ec.outputs[0].default_value = (*edge[0], 1); L.new(ec.outputs[0], em.inputs['B'])
        cur = em.outputs['Result']
        # worn edges are bare metal: more metallic, smoother
        mm = N.new('ShaderNodeMix'); mm.data_type = 'FLOAT'
        L.new(eramp.outputs[0], mm.inputs['Factor']); L.new(metal_s, mm.inputs['A']); mm.inputs['B'].default_value = max(metal, 0.85)
        metal_s = mm.outputs['Result']
        rm = N.new('ShaderNodeMix'); rm.data_type = 'FLOAT'
        L.new(eramp.outputs[0], rm.inputs['Factor']); L.new(rough_s, rm.inputs['A']); rm.inputs['B'].default_value = 0.35
        rough_s = rm.outputs['Result']
    # roughness variation by noise
    rv = N.new('ShaderNodeMath'); rv.operation = 'MULTIPLY_ADD'; rv.inputs[1].default_value = 0.25
    L.new(nf.outputs['Fac'], rv.inputs[0]); L.new(rough_s, rv.inputs[2])
    rsub = N.new('ShaderNodeMath'); rsub.operation = 'SUBTRACT'; rsub.inputs[1].default_value = 0.12; rsub.use_clamp = True
    L.new(rv.outputs[0], rsub.inputs[0])
    L.new(cur, bsdf.inputs['Base Color'])
    L.new(rsub.outputs[0], bsdf.inputs['Roughness'])
    L.new(metal_s, bsdf.inputs['Metallic'])
    # micro bump
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = 0.004
    hb = nf.outputs['Fac']
    if scratches > 0:
        sv = N.new('ShaderNodeTexVoronoi'); sv.feature = 'DISTANCE_TO_EDGE'; sv.inputs['Scale'].default_value = noise_scale * 2.2
        L.new(tc.outputs['Object'], sv.inputs['Vector'])
        sr = N.new('ShaderNodeMapRange'); sr.inputs['From Min'].default_value = 0.0; sr.inputs['From Max'].default_value = 0.025 * scratches
        L.new(sv.outputs['Distance'], sr.inputs['Value'])
        sm = N.new('ShaderNodeMath'); sm.operation = 'MULTIPLY'
        L.new(sr.outputs[0], sm.inputs[0]); L.new(nf.outputs['Fac'], sm.inputs[1])
        hb = sm.outputs[0]
    L.new(hb, bp.inputs['Height'])
    L.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    m['bake_rough'] = rough; m['bake_metal'] = metal
    m['emit'] = list(emit) if emit else [0, 0, 0]
    return m


def srgb(hexv):
    """hex sRGB -> linear tuple"""
    r = ((hexv >> 16) & 255) / 255; g = ((hexv >> 8) & 255) / 255; b = (hexv & 255) / 255

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


# ----------------------------------------------------------------------------- UV + bake
def set_active(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def unwrap(ob, tile, grid, margin=0.004):
    """Smart-project ob and squeeze its islands into atlas tile `tile` (index) of a grid x grid atlas."""
    set_active(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=60 * RAD, island_margin=0.006, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    tx, ty = tile % grid, tile // grid
    s = 1.0 / grid
    uv = ob.data.uv_layers.active.data
    for d in uv:
        u, v = d.uv
        d.uv = (tx * s + margin + u * (s - 2 * margin), 1 - (ty + 1) * s + margin + v * (s - 2 * margin))


def new_image(name, size, non_color=False, alpha=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def _target(ob, img):
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        n = nt.nodes.get('__bake') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake'; n.image = img
        for x in nt.nodes:
            x.select = False
        n.select = True; nt.nodes.active = n


def _rewire_emission(ob, mode):
    """Temporarily route a value into Emission so it can be baked with type EMIT. mode: 'orm' | 'emit'."""
    saved = []
    for slot in ob.material_slots:
        m = slot.material; nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        link = out.inputs['Surface'].links[0]
        saved.append((m, link.from_socket))
        em = nt.nodes.new('ShaderNodeEmission'); em.name = '__em'
        if mode == 'albedo':
            bl = bsdf.inputs['Base Color'].links
            if bl:
                nt.links.new(bl[0].from_socket, em.inputs['Color'])
            else:
                em.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
        elif mode == 'orm':
            comb = nt.nodes.new('ShaderNodeCombineColor'); comb.name = '__comb'
            comb.inputs[0].default_value = 1.0
            rl = bsdf.inputs['Roughness'].links; ml = bsdf.inputs['Metallic'].links
            if rl:
                nt.links.new(rl[0].from_socket, comb.inputs[1])
            else:
                comb.inputs[1].default_value = bsdf.inputs['Roughness'].default_value
            if ml:
                nt.links.new(ml[0].from_socket, comb.inputs[2])
            else:
                comb.inputs[2].default_value = bsdf.inputs['Metallic'].default_value
            nt.links.new(comb.outputs[0], em.inputs['Color'])
        else:
            c = bsdf.inputs['Emission Color'].default_value; s = bsdf.inputs['Emission Strength'].default_value
            k = min(1.0, s / 6.0)
            em.inputs['Color'].default_value = (c[0] * k, c[1] * k, c[2] * k, 1)
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return saved


def _restore(saved):
    for m, sock in saved:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        nt.links.new(sock, out.inputs['Surface'])
        for n in [n for n in nt.nodes if n.name.startswith('__em') or n.name.startswith('__comb')]:
            nt.nodes.remove(n)


def setup_cycles(samples=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU setup failed, using CPU', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = False


def bake_atlas(objs, size, out_dir, prefix):
    """Bake albedo (with AO), ORM (AO, roughness, metallic), tangent normal and emissive for objs into shared images."""
    sc = bpy.context.scene
    imgs = {
        'albedo': new_image(prefix + '_albedo', size),
        'ao': new_image(prefix + '_ao', size, True),
        'orm': new_image(prefix + '_orm', size, True),
        'normal': new_image(prefix + '_normal', size, True),
        'emissive': new_image(prefix + '_emissive', size),
    }
    imgs['normal'].generated_color = (0.5, 0.5, 1.0, 1.0)
    imgs['orm'].generated_color = (1.0, 0.7, 0.0, 1.0)
    imgs['albedo'].generated_color = (0.2, 0.2, 0.2, 1.0)
    imgs['emissive'].generated_color = (0, 0, 0, 1)
    imgs['ao'].generated_color = (1, 1, 1, 1)

    def bake(kind, img, samples, **kw):
        sc.cycles.samples = samples
        for ob in objs:
            set_active(ob)
            _target(ob, img)
            bpy.ops.object.bake(type=kind, margin=6, use_clear=False, **kw)

    for ob in objs:
        saved = _rewire_emission(ob, 'albedo')
        set_active(ob); _target(ob, imgs['albedo']); sc.cycles.samples = 24
        bpy.ops.object.bake(type='EMIT', margin=6, use_clear=False)
        _restore(saved)
    bake('AO', imgs['ao'], 64)
    bake('NORMAL', imgs['normal'], 8, normal_space='TANGENT')
    for ob in objs:
        saved = _rewire_emission(ob, 'orm')
        set_active(ob); _target(ob, imgs['orm']); sc.cycles.samples = 16
        bpy.ops.object.bake(type='EMIT', margin=6, use_clear=False)
        _restore(saved)
    for ob in objs:
        saved = _rewire_emission(ob, 'emit')
        set_active(ob); _target(ob, imgs['emissive']); sc.cycles.samples = 1
        bpy.ops.object.bake(type='EMIT', margin=6, use_clear=False)
        _restore(saved)
    # combine AO: darken albedo cavities, store AO in ORM.r
    import numpy as np
    n = size * size * 4
    a = np.empty(n, dtype=np.float32); imgs['albedo'].pixels.foreach_get(a)
    o = np.empty(n, dtype=np.float32); imgs['ao'].pixels.foreach_get(o)
    r = np.empty(n, dtype=np.float32); imgs['orm'].pixels.foreach_get(r)
    a4 = a.reshape(-1, 4); o4 = o.reshape(-1, 4); r4 = r.reshape(-1, 4)
    aof = 0.35 + 0.65 * o4[:, 0:1]
    a4[:, :3] *= aof
    r4[:, 0] = o4[:, 0]
    imgs['albedo'].pixels.foreach_set(a); imgs['orm'].pixels.foreach_set(r)
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for k in ('albedo', 'orm', 'normal', 'emissive'):
        img = imgs[k]
        img.filepath_raw = os.path.join(out_dir, f'{prefix}_{k}.png')
        img.file_format = 'PNG'
        img.save()
        paths[k] = img.filepath_raw
    return imgs


def final_material(name, imgs):
    """glTF-friendly material that uses the baked textures."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
    ta = N.new('ShaderNodeTexImage'); ta.image = imgs['albedo']
    L.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    to = N.new('ShaderNodeTexImage'); to.image = imgs['orm']
    sep = N.new('ShaderNodeSeparateColor')
    L.new(to.outputs['Color'], sep.inputs[0])
    L.new(sep.outputs[1], bsdf.inputs['Roughness'])
    L.new(sep.outputs[2], bsdf.inputs['Metallic'])
    tn = N.new('ShaderNodeTexImage'); tn.image = imgs['normal']
    nm = N.new('ShaderNodeNormalMap')
    L.new(tn.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    te = N.new('ShaderNodeTexImage'); te.image = imgs['emissive']
    L.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


def collapse_materials(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.material_index = 0


def lod(ob, ratio, name):
    me = ob.data.copy()
    o2 = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o2)
    o2.parent = ob.parent
    for g in ob.vertex_groups:
        if g.name not in o2.vertex_groups:
            o2.vertex_groups.new(name=g.name)
    # vertex groups data lives on the mesh, so the copy keeps weights
    d = o2.modifiers.new('dec', 'DECIMATE'); d.ratio = ratio; d.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o2.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o2.modifiers.clear()
    o2.data = me2
    a = o2.modifiers.new('Armature', 'ARMATURE'); a.object = ob.parent
    return o2


def export_glb(path, objs, rig):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs + [rig.ob]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig.ob
    rig.ob.animation_data.action = None
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_def_bones=True, export_optimize_animation_size=False, export_anim_slide_to_zero=False,
        export_image_format='WEBP', export_image_quality=88, export_yup=True,
        export_skins=True, export_all_influences=False, export_extras=True,
        export_apply=False,
    )


def stats(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.vertices), len(me.loop_triangles)
