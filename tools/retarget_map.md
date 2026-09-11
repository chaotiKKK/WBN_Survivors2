# T2 Retarget-Mapping: Leonidas-Rig -> Manny (UE5)
Quelle: `tools/skeleton_bones.txt` (per `-run=WBNImport -dumpbones` erzeugt).
Hinweis: UE-FBX-Import benennt `.L`/`.R` zu `_L`/`_R` um und hängt einen
`Rig`-Rootknochen davor (Index 0). Counts: wir 21, Manny ~80+.

| Wir            | Manny            | Chain      |
|----------------|------------------|------------|
| pelvis         | pelvis           | Spine      |
| spine          | spine_01         | Spine      |
| chest          | spine_03         | Spine      |
| neck           | neck_01          | Spine      |
| head           | head             | Head       |
| clavicle_L/R   | clavicle_l/r     | Clavicle   |
| upperarm_L/R   | upperarm_l/r     | Arm links/rechts |
| forearm_L/R    | lowerarm_l/r     | Arm        |
| hand_L/R       | hand_l/r         | Arm        |
| thigh_L/R      | thigh_l/r        | Leg links/rechts |
| shin_L/R       | calf_l/r         | Leg        |
| foot_L/R       | foot_l/r         | Leg (+Fuß) |
| root/Rig       | root (Spezialfall, Translation) | Root |

Zehen-/Finger-Bones haben wir nicht — Retargeter toleriert das (Kettenende).

## Editor-Klickpfad (ca. 10 Min, manuell)
1. Content Browser -> Rechtsklick `WBN/Chars/Leonidas` -> Animation ->
   **IK Rig** (`IKR_Leonidas`, Skeleton: `leonidas_body_Skeleton`).
2. Gleiches für Manny (`IKR_Manny`, Quelle: Engine-Mannequin-Skeleton).
3. **IK Retargeter** (`RTG_Manny_Leonidas`): Source = IKR_Manny, Target = IKR_Leonidas.
4. Chains per Tabelle prüfen (Auto-Align, Root-Motion aus für Top-down).
5. Manny-Locomotion (Walk/Jog) -> **Retarget**, Ablage `WBN/Chars/Leonidas/Anims/`.
6. `ABP_WBNCharacter`: Locomotion-BlendSpace + Punch-Slot, Mesh = Body.
