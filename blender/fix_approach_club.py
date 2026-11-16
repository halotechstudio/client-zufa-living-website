"""Client correction (13 Nov 2026), applied to the built ZUFA_Site scene:
  1. The approach road to the project runs 90 deg anticlockwise from the old boulevard heading
     (old: leaves the gate toward the west; new: bends just outside the gate and runs south).
  2. The clubhouse faces the opposite direction (rotated 180 deg about its centre).
Run headless:  D:\\Blender\\blender.exe -b D:\\Zufa\\blender\\zufa_assets.blend --python D:\\Zufa\\blender\\fix_approach_club.py
build_site.py now builds the same geometry from scratch (approach_ctrl / club rotation)."""
import bpy, bmesh, math, json, random
from mathutils import Vector, Matrix

S = json.load(open(r"D:\Zufa\blender\site.json"))
site = bpy.data.scenes["ZUFA_Site"]
E = S['entrance']
ex, ey, erz = E['pos'][0], E['pos'][1], E['rotZ']
gate = Vector((ex, ey, 0))


def approach_ctrl():
    """Boulevard control points in world space: short stub out of the gate, then a sweeping bend
    into the new heading (old heading rotated +90 deg about Z = anticlockwise seen from above)."""
    d0 = Matrix.Rotation(erz, 3, 'Z') @ Vector((0, -1, 0))      # old outward heading
    d1 = Vector((-d0.y, d0.x, 0))                                # rotated 90 deg anticlockwise
    pts = [(-18, 0), (0, 0), (34, 0), (62, 18), (78, 70), (86, 160), (92, 330), (100, 600), (110, 900)]
    return [gate + d0 * a + d1 * b for a, b in pts], d0, d1


old = bpy.data.objects.get("Boulevard")
old_pts = [tuple((old.matrix_world @ v.co).xy) for v in old.data.vertices][::6] if old else []
for o in list(site.objects):
    if o.name.startswith(("Boulevard", "BPalm")):
        bpy.data.objects.remove(o, do_unlink=True)

ctrl, d0, d1 = approach_ctrl()
G = bpy.data.collections["Site_Ground"]
asphalt = bpy.data.materials.get("ZUFA_Asphalt") or next(m for m in bpy.data.materials if 'sphalt' in m.name)
kerb = bpy.data.materials.get("ZUFA_Kerb") or next(m for m in bpy.data.materials if 'erb' in m.name)

cu = bpy.data.curves.new("BoulevardPath", 'CURVE'); cu.dimensions = '3D'
sp = cu.splines.new('POLY'); sp.points.add(len(ctrl) - 1)
for i, p in enumerate(ctrl):
    sp.points[i].co = (p.x, p.y, 0.05, 1)
sp.type = 'NURBS'; sp.order_u = 4; sp.use_endpoint_u = True; sp.resolution_u = 24
path = bpy.data.objects.new("BoulevardPath", cu); G.objects.link(path)
dg = bpy.context.evaluated_depsgraph_get()
me = path.evaluated_get(dg).to_mesh(); pts = [v.co.copy() for v in me.vertices]; path.evaluated_get(dg).to_mesh_clear()
dense = []
for i in range(len(pts) - 1):
    a, b = pts[i], pts[i + 1]
    k = max(1, int((b - a).length / 3))
    for j in range(k):
        dense.append(a.lerp(b, j / k))
dense.append(pts[-1])


def strip(name, half_in, half_out, z, mat):
    bm = bmesh.new(); A, B = [], []
    for i, p in enumerate(dense):
        t = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        n = Vector((-t.y, t.x, 0))
        A.append(bm.verts.new(p + n * half_in + Vector((0, 0, z))))
        B.append(bm.verts.new(p + n * half_out + Vector((0, 0, z))))
    for i in range(len(dense) - 1):
        bm.faces.new((A[i], B[i], B[i + 1], A[i + 1]))
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(name, m); o.data.materials.append(mat); G.objects.link(o)
    return o

strip("Boulevard", -9.5, 9.5, 0.1, asphalt)
strip("BoulevardLine-1", -8.7, -8.9, 0.115, kerb)
strip("BoulevardLine1", 8.7, 8.9, 0.115, kerb)

# palms along the boulevard (same rule as build_site.py)
V = bpy.data.collections["Site_Avenues"]
palm = bpy.data.collections.get("Tree_Palm")
rnd = random.Random(5)
for i in range(4, len(dense) - 1, 5):
    p, t = dense[i], (dense[i + 1] - dense[i - 1]).normalized()
    if (p.xy - gate.xy).length > 260:
        break
    nrm = Vector((-t.y, t.x, 0))
    for s in (-1, 1):
        q = p + nrm * s * 12.5
        e = bpy.data.objects.new(f"BPalm{i}{s}", None)
        e.instance_type = 'COLLECTION'; e.instance_collection = palm
        e.location = (q.x, q.y, 0.0); e.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
        sc_ = rnd.uniform(0.95, 1.15); e.scale = (sc_, sc_, sc_)
        V.objects.link(e)

# forest: clear the new road corridor, replant the old one
fo = bpy.data.objects.get("Forest")
if fo:
    newp = [tuple(p.xy) for p in dense][::2]
    def near(x, y, pl):
        lim = 40 if math.hypot(x - ex, y - ey) < 250 else 16
        return any(math.hypot(x - a, y - b) < lim for a, b in pl)
    mesh = fo.data
    xs = [v.co.copy() for v in mesh.vertices]
    sc_attr = [a.value for a in mesh.attributes["sc"].data]
    k_attr = [a.value for a in mesh.attributes["kind"].data]
    keep = [i for i, c in enumerate(xs) if not near(c.x, c.y, newp)]
    removed = len(xs) - len(keep)
    verts = [tuple(xs[i]) for i in keep]; scs = [sc_attr[i] for i in keep]; ks = [k_attr[i] for i in keep]
    outline = [tuple(p) for p in S['outline']]
    def inside(p, poly):
        x, y = p; c = False; j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]; xj, yj = poly[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
            j = i
        return c
    added = 0
    for a, b in old_pts:
        for _ in range(3):
            x, y = a + rnd.uniform(-30, 30), b + rnd.uniform(-30, 30)
            if inside((x, y), outline) or near(x, y, newp) or rnd.random() > 0.45:
                continue
            verts.append((x, y, 0)); scs.append(rnd.uniform(0.75, 1.35)); ks.append(rnd.randrange(4)); added += 1
    nm = bpy.data.meshes.new("ForestPoints")
    nm.from_pydata(verts, [], [])
    nm.attributes.new("sc", 'FLOAT', 'POINT').data.foreach_set("value", scs)
    nm.attributes.new("kind", 'INT', 'POINT').data.foreach_set("value", ks)
    oldm = fo.data; fo.data = nm; bpy.data.meshes.remove(oldm)
    print("forest removed", removed, "added", added)

# clubhouse faces the opposite way
club = bpy.data.objects.get("Clubhouse")
if club:
    club.rotation_euler.z += math.pi
    print("club rotZ", club.rotation_euler.z)

bpy.ops.wm.save_mainfile()
print("fix done", len(dense))
