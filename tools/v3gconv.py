# 用户给的模型（OBJ / DAE / BLEND / FBX / USD）先在 Blender 里转成 GLB，再交给 tools/v3gbake.js 烘焙成游戏用的 js/mdl/<键>.js。
# 这一步只搬几何：顶点、法线、UV、材质槽的名字和材质里的颜色数值原样导出，不导出贴图——
#   贴图在烘焙时按 tools/v3gmodels.json 直接读原文件（字节不变），OBJ 缺 MTL、贴图路径是作者电脑上的绝对路径也不怕。
# 用法（Blender 4.x 无头运行；--disable-autoexec：不执行 .blend 里带的脚本）：
#   blender -b --disable-autoexec --factory-startup --python tools/v3gconv.py -- <源文件> <输出.glb> [只导出的对象名，逗号分隔]
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
only = [s for s in args[2].split(',') if s] if len(args) > 2 else []
ext = os.path.splitext(src)[1].lower()

bpy.ops.wm.read_factory_settings(use_empty=True)
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False, use_scripts=False)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=src)
elif ext == '.dae':
    bpy.ops.wm.collada_import(filepath=src)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=src)
elif ext in ('.usd', '.usda', '.usdc', '.usdz'):
    bpy.ops.wm.usd_import(filepath=src)
elif ext in ('.glb', '.gltf'):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    raise SystemExit('不认识的格式：' + ext)

# 相机、灯、文字（样品展示用的）不要；指定了对象名就只留这些
for o in list(bpy.context.scene.objects):
    if o.type not in ('MESH', 'EMPTY') or (only and o.type == 'MESH' and o.name not in only):
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.context.scene.objects:
    o.select_set(o.type == 'MESH')
# 指定了对象：搬到原点（导弹组合里每枚弹在场景里摆开放着）
if only:
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.parent is None:
            o.location = (0, 0, 0)

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True,
    export_apply=True, export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='NONE',
    export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False, export_extras=False, export_yup=True)
print('V3GCONV OK', out)
