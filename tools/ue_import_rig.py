# Importiert models/fbx/leonidas_{body,hat_helmet}.fbx nach /Game/WBN/Chars/Leonidas.
# Der Hut bekommt danach das Body-Skeleton zugewiesen (MasterPose-faehig).
# Aufruf headless:
#   UnrealEditor-Cmd.exe <uproject> -run=pythonscript -script="tools/ue_import_rig.py"
import os
import unreal


def try_set(obj, name, value):
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as e:  # fehlende Props bei API-Drift: melden, weiter
        unreal.log_warning(f'[wbn_import] Prop fehlt ({name}): {e}')
        return False


OUT = os.path.join(os.path.dirname(__file__), 'import_rig_out.txt')
LINES = []


def note(msg):
    LINES.append(msg)
    unreal.log(f'[wbn_import] {msg}')


def import_fbx(fbx, dest, skeleton=None):
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', fbx)
    task.set_editor_property('destination_path', dest)
    task.set_editor_property('save', True)
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', True)
    opts = unreal.FbxImportUI()
    try_set(opts, 'import_mesh', True)
    try_set(opts, 'import_materials', False)
    try_set(opts, 'import_textures', False)
    try_set(opts, 'import_animations', False)
    try_set(opts, 'import_as_skeletal', True)
    try:
        opts.set_editor_property('mesh_type_to_import',
                                 unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    except Exception as e:
        unreal.log_warning(f'[wbn_import] mesh_type_to_import: {e}')
    if skeleton is not None:
        try_set(opts, 'skeleton', skeleton)
    skel = opts.get_editor_property('skeletal_mesh_import_data')
    if skel:
        try_set(skel, 'use_t0_as_ref_pose', True)
        try_set(skel, 'update_skeleton_reference_pose', False)
    try_set(opts, 'create_physics_asset', False)
    task.set_editor_property('options', opts)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property('imported_object_paths'))
    for p in paths:
        note(f'importiert: {p}')
    return paths


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    dest = '/Game/WBN/Chars/Leonidas'
    try:
        body_paths = import_fbx(os.path.join(root, 'models', 'fbx', 'leonidas_body.fbx'), dest)
        body = next((p for p in body_paths if 'Skeleton' not in p), None)
        if not body:
            raise RuntimeError(f'Body-Import leer: {body_paths}')
        body_mesh = unreal.load_asset(body)
        body_skel = body_mesh.get_editor_property('skeleton')
        note(f'Body-Skeleton: {body_skel.get_path_name()}')
        hat_paths = import_fbx(os.path.join(root, 'models', 'fbx', 'leonidas_hat_helmet.fbx'),
                               dest, skeleton=body_skel)
        hat = next((p for p in hat_paths if 'Skeleton' not in p), None)
        if not hat:
            raise RuntimeError(f'Hut-Import leer: {hat_paths}')
        note('OK: Body+Hut teilen das Body-Skeleton')
    except Exception as e:
        unreal.log_error(f'[wbn_import] FEHLER: {e}')
        note(f'FEHLER: {e}')
    finally:
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write('\n'.join(LINES) + '\n')


main()
