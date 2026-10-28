# Build one faction: rigged + animated + baked unit variants -> GLB per variant, atlas PNGs, metadata JSON,
# and a preview contact sheet rendered in Blender.
#   blender -b --factory-startup -P tools/blender/build.py -- <faction> <out_dir> [--quick] [--only id,id] [--atlas 2048]
import bpy, sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, anims, factions
from kit import Rig, DEFORM, build_mesh, unwrap, setup_cycles, bake_atlas, final_material, collapse_materials, lod, write_clip, stats, set_active
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
fid = argv[0]
out = os.path.abspath(argv[1])
quick = '--quick' in argv
only = None
if '--only' in argv:
    only = set(argv[argv.index('--only') + 1].split(','))
atlas = int(argv[argv.index('--atlas') + 1]) if '--atlas' in argv else 2048
os.makedirs(out, exist_ok=True)
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
F = factions.FACTIONS[fid]
mats = F['materials']()
variants = [v for v in F['variants'] if not only or v['id'] in only]
grid = math.ceil(math.sqrt(len(F['variants'])))
style = anims.Style(**F['style'])

built = []
for v in F['variants']:
    if only and v['id'] not in only:
        continue
    i = F['variants'].index(v)
    body = F['body'](v['kind'])
    if 'style' in v:
        st = anims.Style(**{**F['style'], **v['style']})
    else:
        st = style
    rig = Rig(body, name=v['id'] + '_rig')
    parts = F['parts'](rig, v['kind'])
    rig.constrain()
    ob = build_mesh(v['id'], parts, DEFORM, mats)
    rig.bind(ob)
    rig.ob.location.x = i * 4.0  # keep variants apart so baked AO does not leak between them
    built.append(dict(v=v, rig=rig, ob=ob, body=body, tile=i, style=st))
    print('BUILT', v['id'], stats(ob), f'{time.time() - t0:.1f}s')

for B in built:
    unwrap(B['ob'], B['tile'], grid)

tex_prefix = fid
if not quick:
    setup_cycles()
    imgs = bake_atlas([B['ob'] for B in built], atlas, out, tex_prefix)
    fm = final_material(fid + '_baked', imgs)
    for B in built:
        collapse_materials(B['ob'], fm)
    print('BAKED', f'{time.time() - t0:.1f}s')

meta = dict(faction=fid, atlas=atlas, grid=grid, textures={k: f'{tex_prefix}_{k}' for k in ('albedo', 'orm', 'normal', 'emissive')}, variants={})

# ------------------------------------------------------------------ preview staging
def preview_setup():
    sc.render.engine = 'BLENDER_EEVEE'
    hi = '--hires' in argv
    sc.render.resolution_x = 600 if hi else 300; sc.render.resolution_y = 800 if hi else 400
    sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.11, 0.115, 0.13, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    for name, rot, e, col in (('key', (52, 0, 35), 4.5, (1, 0.95, 0.88)), ('rim', (60, 0, 200), 3.0, (0.7, 0.8, 1.0)), ('fill', (75, 0, -70), 1.2, (1, 1, 1))):
        L = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        sc.collection.objects.link(L)
        L.data.energy = e; L.data.color = col; L.rotation_euler = [a * math.pi / 180 for a in rot]
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    return cam


def look(cam, target, yaw, dist, h):
    y = yaw * math.pi / 180
    cam.location = Vector(target) + Vector((math.sin(y) * dist, -math.cos(y) * dist, h))
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()


def sheet(paths, cols, out_path):
    import numpy as np
    ims = [bpy.data.images.load(p) for p in paths]
    w, h = ims[0].size
    rows = math.ceil(len(ims) / cols)
    big = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    for k, im in enumerate(ims):
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a)
        r, c = k // cols, k % cols
        big[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a.reshape(h, w, 4)
    img = bpy.data.images.new('sheet', cols * w, rows * h)
    img.pixels.foreach_set(big.ravel())
    img.filepath_raw = out_path; img.file_format = 'PNG'; img.save()
    for im in ims:
        bpy.data.images.remove(im)


cam = preview_setup() if not quick or '--preview' in argv else None

for B in built:
    v, rig, ob, body, st = B['v'], B['rig'], B['ob'], B['body'], B['style']
    rig.ob.location.x = 0.0
    for other in built:
        hide = other is not B
        other['ob'].hide_render = hide
    l1 = lod(ob, 0.32, v['id'] + '_lod1')
    l2 = lod(ob, 0.10, v['id'] + '_lod2')
    clips = anims.build_clips(body, st, v['cls'], 'x')
    cm = {}
    for (name, frames, fn, loop, m) in clips:
        cname = name[2:]
        write_clip(rig, cname, frames, fn, loop=loop)
        cm[cname] = dict(frames=frames + (1 if loop else 0), loop=loop, **m)
    l1.hide_render = True; l2.hide_render = True
    # preview renders (in Blender, with the baked material)
    if cam is not None:
        shots = []
        tgt = (0, 0, body.top_z * 0.52)
        dist = body.top_z * 1.85
        rig.ob.animation_data.action = None if '--rest' in argv else bpy.data.actions['aim']
        if '--rest' in argv:
            for pb in rig.ob.pose.bones:
                pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
        for k, yaw in enumerate((0, 40, 140, 270)):
            sc.frame_set(1)
            look(cam, tgt, yaw, dist, body.top_z * 0.12)
            p = os.path.join(out, f'_pv_{v["id"]}_{k}.png'); sc.render.filepath = p
            bpy.ops.render.render(write_still=True); shots.append(p)
        for cname, frac in () if '--hires' in argv else (('idle', 0.3), ('walk', 0.25), ('run', 0.3), ('charge', 0.4), ('fire', 0.1), ('reload', 0.4),
                            ('melee_a', 0.45), ('melee_b', 0.4), ('cover', 0.2), ('command', 0.4), ('hit', 0.2), ('death_a', 1.0)):
            act = bpy.data.actions[cname]
            rig.ob.animation_data.action = act
            fr = 1 + int((cm[cname]['frames'] - 1) * frac)
            sc.frame_set(fr)
            look(cam, tgt, 35, dist, body.top_z * 0.12)
            p = os.path.join(out, f'_pv_{v["id"]}_{cname}.png'); sc.render.filepath = p
            bpy.ops.render.render(write_still=True); shots.append(p)
        sheet(shots, 4 if '--hires' in argv else 8, os.path.join(out, f'preview_{v["id"]}.png'))
        for p in shots:
            os.remove(p)
    # export
    path = os.path.join(out, v['id'] + '.glb')
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in (ob, l1, l2, rig.ob):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig.ob
    rig.ob.animation_data.action = None
    sc.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_def_bones=True, export_optimize_animation_size=False, export_anim_slide_to_zero=False,
        export_image_format='NONE', export_materials='PLACEHOLDER', export_yup=True, export_skins=True,
        export_all_influences=False, export_extras=False, export_apply=False, export_normals=True, export_tangents=False,
    )
    meta['variants'][v['id']] = dict(
        kind=v['kind'], cls=v['cls'], tile=B['tile'], height=round(body.top_z, 3),
        lods=[stats(ob)[1], stats(l1)[1], stats(l2)[1]], clips=cm, file=v['id'] + '.glb',
    )
    print('EXPORTED', v['id'], meta['variants'][v['id']]['lods'], f'{time.time() - t0:.1f}s')
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in (l1, l2):
        bpy.data.objects.remove(o)

with open(os.path.join(out, fid + '.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print('DONE', fid, f'{time.time() - t0:.1f}s')
