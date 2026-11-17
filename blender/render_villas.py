"""Villa turntables for the website: each villa concept on a lawn plot ringed by trees, golden hour, 72 frames
round the house (5 degrees apart). Uses the ZUFA_Site film rig for sun and sky (frozen at its 17:45 shot).
  assets/villa3d/<kind>/v##.webp  and  assets/villa3d/villa3d.json
Headless:  D:\\Blender\\blender.exe -b D:\\Zufa\\blender\\zufa_assets.blend --python D:\\Zufa\\blender\\render_villas.py
Env: V3_OUT (D:\\Zufa\\assets\\villa3d)  V3_W (1600)  V3_SAMPLES (48)  V3_ONLY ("sanctuary:0,18" test frames)"""
import bpy, os, json, math, random
from mathutils import Vector, Matrix

OUT = os.environ.get("V3_OUT", r"D:\Zufa\assets\villa3d")
W = int(os.environ.get("V3_W", 1600)); H = W * 9 // 16
ONLY = os.environ.get("V3_ONLY", "")
N = 72
VILLAS = {"sanctuary": ("Sanctuary_Villa", 13.0), "estate": ("Estate_Villa", 14.6)}

site = bpy.data.scenes["ZUFA_Site"]
FRAME = 526                                     # the film's golden-hour shot (17:45)
site.frame_set(FRAME)

old = bpy.data.scenes.get("ZUFA_VillaStudio")
if old:
    bpy.data.scenes.remove(old)
sc = bpy.data.scenes.new("ZUFA_VillaStudio")
sc.world = site.world
sc.render.engine = 'CYCLES'
for k in ("view_transform", "look", "exposure", "gamma"):
    setattr(sc.view_settings, k, getattr(site.view_settings, k))
sc.collection.children.link(bpy.data.collections["Site_Lighting"])
sc.frame_set(FRAME)
for idb in [sc, site, sc.world.node_tree] + list(bpy.data.collections["Site_Lighting"].all_objects) + [o.data for o in bpy.data.collections["Site_Lighting"].all_objects]:
    ad = getattr(idb, "animation_data", None)
    if ad and ad.action:
        ad.action = None
bpy.context.window.scene = sc

cy = sc.cycles
cy.samples = int(os.environ.get("V3_SAMPLES", 48)); cy.use_denoising = True
cy.max_bounces = 6
prefs = bpy.context.preferences.addons["cycles"].preferences
for dt in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = dt; prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == dt
        cy.device = 'GPU'; break
    except Exception:
        pass
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = 84
sc.render.use_persistent_data = True

S = bpy.data.collections.new("Studio"); sc.collection.children.link(S)


def inst(name, coll, loc, rz=0.0, s=1.0):
    e = bpy.data.objects.new(name, None)
    e.instance_type = 'COLLECTION'; e.instance_collection = bpy.data.collections[coll]
    e.location = loc; e.rotation_euler = (0, 0, rz); e.scale = (s, s, s)
    S.objects.link(e); return e


def disc(name, r, z, mat):
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=r, fill_type='NGON', location=(0, 0, z))
    o = bpy.context.active_object; o.name = name
    for c in o.users_collection:
        c.objects.unlink(o)
    S.objects.link(o); o.data.materials.append(bpy.data.materials[mat]); return o


disc("Lawn", 70, 0.0, "ZUFA_Lawn_Film")
disc("Fields", 1500, -0.05, "ZUFA_Farmland")
rnd = random.Random(11)
kinds = [c.name for c in bpy.data.collections["Film_Trees"].children]
for i in range(70):                                   # a soft ring of trees: the forest hug
    a = rnd.uniform(0, 2 * math.pi); r = rnd.uniform(46, 110)
    inst(f"T{i}", rnd.choice(kinds), (math.cos(a) * r, math.sin(a) * r, 0), rnd.uniform(0, 6.3), rnd.uniform(0.8, 1.25))
for i in range(10):                                   # palms and garden trees closer in
    a = 2 * math.pi * i / 10 + rnd.uniform(-.2, .2); r = rnd.uniform(26, 34)
    inst(f"P{i}", "Tree_Palm" if i % 2 else "Tree_Garden", (math.cos(a) * r, math.sin(a) * r, 0), rnd.uniform(0, 6.3), rnd.uniform(.95, 1.2))

cam = bpy.data.objects.new("VillaCam", bpy.data.cameras.new("VillaCam")); S.objects.link(cam); sc.camera = cam
cam.data.sensor_fit = 'HORIZONTAL'; cam.data.angle = math.radians(46); cam.data.clip_start = .5; cam.data.clip_end = 5000


def place(dist, elev, az, tz):
    T = Vector((0, 0, tz))
    P = T + Vector((math.cos(elev) * math.cos(az), math.cos(elev) * math.sin(az), math.sin(elev))) * dist
    f = (T - P).normalized(); up = (Vector((0, 0, 1)) - f * f.z).normalized(); right = f.cross(up)
    cam.matrix_world = Matrix(((right.x, up.x, -f.x, P.x), (right.y, up.y, -f.y, P.y), (right.z, up.z, -f.z, P.z), (0, 0, 0, 1)))


meta = {"w": W, "h": H, "frames": N, "villas": list(VILLAS)}
want = {}
if ONLY:
    k, fr = ONLY.split(":"); want[k] = {int(x) for x in fr.split(",")}
for kind, (coll, half) in VILLAS.items():
    if want and kind not in want:
        continue
    os.makedirs(os.path.join(OUT, kind), exist_ok=True)
    v = inst("Villa", coll, (0, 0, 0.02), 0.0)
    for i in range(N):
        if want and i not in want[kind]:
            continue
        # start from the garden side, three-quarter view (model +X faces the road)
        place(half * 3.5, math.radians(14), math.radians(205 + 5 * i), 2.6)
        sc.render.filepath = os.path.join(OUT, kind, f"v{i:02d}.webp")
        bpy.ops.render.render(write_still=True, scene=sc.name)
        print(kind, i, flush=True)
    bpy.data.objects.remove(v, do_unlink=True)
if not ONLY:
    json.dump(meta, open(os.path.join(OUT, "villa3d.json"), "w"))
print("done", flush=True)
