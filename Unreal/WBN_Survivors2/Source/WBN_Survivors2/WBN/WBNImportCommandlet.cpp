// WBN Survivors 2 — JSON→DataAsset-Import (Chars/Weapons/Enemies/Bosses/Arenas).
#include "WBNImportCommandlet.h"
#include "WBNCharacterData.h"
#include "WBNWeaponData.h"
#include "WBNEnemyData.h"
#include "WBNBossData.h"
#include "WBNArenaData.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Animation/Skeleton.h"
#include "HAL/FileManager.h"
#include "WBNWaveDirector.h"
#include "UObject/SavePackage.h"
#include "Misc/PackageName.h"

UWBNImportCommandlet::UWBNImportCommandlet()
{
	IsClient = false;
	IsEditor = true;
	IsServer = false;
	LogToConsole = true;
}

namespace WBNImport
{
	static FString JStr(const TSharedPtr<FJsonObject>& O, const FString& K, const FString& Def = FString())
	{
		FString V = Def;
		if (O.IsValid()) O->TryGetStringField(K, V);
		return V;
	}
	static double JNum(const TSharedPtr<FJsonObject>& O, const FString& K, double Def = 0.0)
	{
		double V = Def;
		if (O.IsValid()) O->TryGetNumberField(K, V);
		return V;
	}
	static bool JBool(const TSharedPtr<FJsonObject>& O, const FString& K, bool Def = false)
	{
		bool V = Def;
		if (O.IsValid()) O->TryGetBoolField(K, V);
		return V;
	}
	static FLinearColor JColor(const TSharedPtr<FJsonObject>& O, const FString& K)
	{
		FString Hex = JStr(O, K, TEXT("#ffffff"));
		Hex.RemoveFromStart(TEXT("#"));
		return FLinearColor(FColor::FromHex(Hex));
	}
	static void ApplyStats(FWBNStats& S, const TSharedPtr<FJsonObject>& O)
	{
		if (!O.IsValid()) return;
		S.MaxHp = JNum(O, TEXT("maxHp")); S.HpRegen = JNum(O, TEXT("hpRegen")); S.Lifesteal = JNum(O, TEXT("lifesteal"));
		S.DmgP = JNum(O, TEXT("dmgP")); S.Melee = JNum(O, TEXT("melee")); S.Ranged = JNum(O, TEXT("ranged"));
		S.Elem = JNum(O, TEXT("elem")); S.AtkSpd = JNum(O, TEXT("atkSpd")); S.Crit = JNum(O, TEXT("crit"));
		S.CritDmg = JNum(O, TEXT("critDmg")); S.Eng = JNum(O, TEXT("eng")); S.Range = JNum(O, TEXT("range"));
		S.Armor = JNum(O, TEXT("armor")); S.Dodge = JNum(O, TEXT("dodge")); S.Speed = JNum(O, TEXT("speed"));
		S.Luck = JNum(O, TEXT("luck")); S.Harvest = JNum(O, TEXT("harvest")); S.XpGain = JNum(O, TEXT("xpGain"));
		S.ExpSize = JNum(O, TEXT("expSize")); S.Pierce = JNum(O, TEXT("pierce")); S.Bounce = JNum(O, TEXT("bounce"));
		S.Knock = JNum(O, TEXT("knock")); S.AbilityRank = JNum(O, TEXT("abilityRank")); S.AbilityCdMod = JNum(O, TEXT("abilityCdMod"));
	}
	static void ApplyUnlock(FWBNUnlock& U, const TSharedPtr<FJsonObject>& O)
	{
		if (!O.IsValid()) return;
		U.Key = JStr(O, TEXT("key"));
		U.Need = (int32)JNum(O, TEXT("need"));
		U.Text = FText::FromString(JStr(O, TEXT("text")));
	}
	static EWBNEnemyAI AIType(const FString& S)
	{
		static const TMap<FString, EWBNEnemyAI> M = {
			{TEXT("chase"), EWBNEnemyAI::Chase}, {TEXT("orbit"), EWBNEnemyAI::Orbit},
			{TEXT("ranged"), EWBNEnemyAI::Ranged}, {TEXT("exploder"), EWBNEnemyAI::Exploder},
			{TEXT("charger"), EWBNEnemyAI::Charger}, {TEXT("healer"), EWBNEnemyAI::Healer},
			{TEXT("aura"), EWBNEnemyAI::Aura}, {TEXT("summoner"), EWBNEnemyAI::Summoner},
			{TEXT("shielded"), EWBNEnemyAI::Shielded}, {TEXT("teleport"), EWBNEnemyAI::Teleport},
			{TEXT("spiral"), EWBNEnemyAI::Spiral}, {TEXT("mortar"), EWBNEnemyAI::Mortar},
			{TEXT("weaver"), EWBNEnemyAI::Weaver}, {TEXT("sentinel"), EWBNEnemyAI::Sentinel},
			{TEXT("leech"), EWBNEnemyAI::Leech}, {TEXT("bomber"), EWBNEnemyAI::Bomber},
			{TEXT("mirror"), EWBNEnemyAI::Mirror}, {TEXT("juggernaut"), EWBNEnemyAI::Juggernaut},
			{TEXT("siren"), EWBNEnemyAI::Siren}
		};
		const EWBNEnemyAI* F = M.Find(S.ToLower());
		return F ? *F : EWBNEnemyAI::Chase;
	}
	static EWBNWeaponType WeaponType(const FString& S)
	{
		if (S == TEXT("hitscan")) return EWBNWeaponType::Hitscan;
		if (S == TEXT("cone")) return EWBNWeaponType::Cone;
		if (S == TEXT("chain")) return EWBNWeaponType::Chain;
		if (S == TEXT("charge")) return EWBNWeaponType::Charge;
		if (S == TEXT("aura")) return EWBNWeaponType::Aura;
		if (S == TEXT("melee")) return EWBNWeaponType::Melee;
		return EWBNWeaponType::Projectile;
	}
	static void ApplySpecial(FWBNEnemySpecial& Sp, const TSharedPtr<FJsonObject>& O)
	{
		if (!O.IsValid()) return;
		const TSharedPtr<FJsonObject>* Sub = nullptr;
		if (O->TryGetObjectField(TEXT("shot"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.ShotDmg = JNum(*Sub, TEXT("dmg")); Sp.ShotSpeed = JNum(*Sub, TEXT("spd"));
			Sp.ShotCooldown = JNum(*Sub, TEXT("cd")); Sp.ShotRange = JNum(*Sub, TEXT("range"));
			Sp.ShotColor = JColor(*Sub, TEXT("col")); Sp.ShotPoison = JNum(*Sub, TEXT("poison"));
		}
		if (O->TryGetObjectField(TEXT("boom"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.BoomDmg = JNum(*Sub, TEXT("dmg")); Sp.BoomRadius = JNum(*Sub, TEXT("r"));
		}
		if (O->TryGetObjectField(TEXT("heal"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.HealAmount = JNum(*Sub, TEXT("amt")); Sp.HealCooldown = JNum(*Sub, TEXT("cd"));
			Sp.HealRadius = JNum(*Sub, TEXT("r"));
		}
		if (O->TryGetObjectField(TEXT("aura"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.AuraArmor = JNum(*Sub, TEXT("armor")); Sp.AuraRadius = JNum(*Sub, TEXT("r"));
		}
		if (O->TryGetObjectField(TEXT("summon"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.SummonId = JStr(*Sub, TEXT("id")); Sp.SummonCount = (int32)JNum(*Sub, TEXT("n"));
			Sp.SummonCooldown = JNum(*Sub, TEXT("cd"));
		}
		if (O->TryGetObjectField(TEXT("split"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.SplitId = JStr(*Sub, TEXT("id")); Sp.SplitCount = (int32)JNum(*Sub, TEXT("n"));
			Sp.SplitDepth = (int32)JNum(*Sub, TEXT("depth"));
		}
		if (O->TryGetObjectField(TEXT("blink"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.BlinkCooldown = JNum(*Sub, TEXT("cd")); Sp.BlinkMin = JNum(*Sub, TEXT("min"));
			Sp.BlinkMax = JNum(*Sub, TEXT("max"));
		}
		if (O->TryGetObjectField(TEXT("lob"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.LobDmg = JNum(*Sub, TEXT("dmg")); Sp.LobCooldown = JNum(*Sub, TEXT("cd"));
			Sp.LobRange = JNum(*Sub, TEXT("range")); Sp.LobRadius = JNum(*Sub, TEXT("r"));
			Sp.LobFlight = JNum(*Sub, TEXT("flight"));
		}
		if (O->TryGetObjectField(TEXT("web"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.WebCooldown = JNum(*Sub, TEXT("cd")); Sp.WebRadius = JNum(*Sub, TEXT("r"));
			Sp.WebSlow = JNum(*Sub, TEXT("slow")); Sp.WebLife = JNum(*Sub, TEXT("life"));
		}
		if (O->TryGetObjectField(TEXT("beam"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.BeamDmg = JNum(*Sub, TEXT("dmg")); Sp.BeamCooldown = JNum(*Sub, TEXT("cd"));
			Sp.BeamWarn = JNum(*Sub, TEXT("warn")); Sp.BeamRange = JNum(*Sub, TEXT("range"));
			Sp.BeamWidth = JNum(*Sub, TEXT("w"));
		}
		if (O->TryGetObjectField(TEXT("drain"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.DrainDps = JNum(*Sub, TEXT("dps")); Sp.DrainCooldown = JNum(*Sub, TEXT("cd"));
			Sp.DrainHeal = JNum(*Sub, TEXT("heal"));
		}
		if (O->TryGetObjectField(TEXT("mine"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.MineCooldown = JNum(*Sub, TEXT("cd")); Sp.MineFuse = JNum(*Sub, TEXT("fuse"));
			Sp.MineRadius = JNum(*Sub, TEXT("r")); Sp.MineDmg = JNum(*Sub, TEXT("dmg"));
		}
		if (O->TryGetObjectField(TEXT("slam"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.SlamCooldown = JNum(*Sub, TEXT("cd")); Sp.SlamRadius = JNum(*Sub, TEXT("r"));
			Sp.SlamDmg = JNum(*Sub, TEXT("dmg")); Sp.SlamWarn = JNum(*Sub, TEXT("warn"));
		}
		if (O->TryGetObjectField(TEXT("wail"), Sub) && Sub && (*Sub).IsValid())
		{
			Sp.WailCooldown = JNum(*Sub, TEXT("cd")); Sp.WailRadius = JNum(*Sub, TEXT("r"));
			Sp.WailSpd = JNum(*Sub, TEXT("spd")); Sp.WailDuration = JNum(*Sub, TEXT("dur"));
			Sp.WailCdPenalty = JNum(*Sub, TEXT("cdPenalty"));
		}
		Sp.ShieldArc = JNum(O, TEXT("shieldArc"));
		Sp.Vamp = JNum(O, TEXT("vamp"));
		Sp.RadialCount = (int32)JNum(O, TEXT("radial"));
		Sp.Reflect = JNum(O, TEXT("reflect"));
	}
	static TArray<TSharedPtr<FJsonValue>> JArr(const TSharedPtr<FJsonObject>& O, const FString& K)
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (O.IsValid() && O->TryGetArrayField(K, A) && A) return *A;
		return TArray<TSharedPtr<FJsonValue>>();
	}
	static bool SaveAsset(UPackage* Pkg, UObject* Asset)
	{
		FAssetRegistryModule::AssetCreated(Asset);
		Pkg->MarkPackageDirty();
		FSavePackageArgs Args;
		Args.TopLevelFlags = RF_Public | RF_Standalone;
		const FString File = FPackageName::LongPackageNameToFilename(Pkg->GetName(), FPackageName::GetAssetPackageExtension());
		return UPackage::SavePackage(Pkg, Asset, *File, Args);
	}
	template<typename T>
	static T* GetOrCreate(const FString& LongPkg, const FString& AssetName)
	{
		// Zuerst VOLLSTÄNDIG laden (Referenzen bleiben gültig). FindObject allein
		// reicht nicht: Die Registry hält ggf. nur teilgeladene Pakete vor, und
		// SavePackage crasht dann ("nur teilweise geladen").
		if (T* Loaded = LoadObject<T>(nullptr, *LongPkg)) return Loaded;
		UPackage* Pkg = CreatePackage(*LongPkg);
		T* A = FindObject<T>(Pkg, *AssetName);
		if (!A) A = NewObject<T>(Pkg, *AssetName, RF_Public | RF_Standalone);
		return A;
	}
	// Soft-Ref setzen, falls das Asset als Datei existiert (Registry-unabhängig).
	// Pfad von Hand gebaut: LongPackageNameToFilename wirft Fatal bei noch
	// nicht gescannten Content-Pfaden.
	static bool SetMeshRefIfExists(TSoftObjectPtr<USkeletalMesh>& Field, const FString& LongPkg)
	{
		if (!LongPkg.StartsWith(TEXT("/Game/"))) return false;
		const FString File = FPaths::ProjectDir() + TEXT("Content") + LongPkg.RightChop(5) + TEXT(".uasset");
		if (!FPaths::FileExists(File)) return false;
		Field = TSoftObjectPtr<USkeletalMesh>(FSoftObjectPath(LongPkg));
		return true;
	}
	// Erstes <prefix>*-Mesh im Char-Ordner suchen (Platten-Scan, kein Registry-Timing).
	static FString FindPrefixedMesh(const FString& CharFolder, const FString& Prefix)
	{
		const FString Dir = FPaths::ProjectDir() + TEXT("Content/WBN/Chars/") + FPaths::GetPathLeaf(CharFolder) + TEXT("/");
		TArray<FString> Files;
		IFileManager::Get().FindFiles(Files, *(Dir + Prefix + TEXT("*.uasset")), true, false);
		if (Files.Num() == 0) return FString();
		return CharFolder + TEXT("/") + FPaths::GetBaseFilename(Files[0]);
	}
	static TArray<TSharedPtr<FJsonValue>> ReadJsonArray(const FString& Path, bool& bOk)
	{
		bOk = false;
		FString Json;
		if (!FFileHelper::LoadFileToString(Json, *Path)) return {};
		TSharedPtr<FJsonValue> Root;
		TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(Json);
		if (!FJsonSerializer::Deserialize(R, Root) || !Root.IsValid() || Root->Type != EJson::Array) return {};
		bOk = true;
		return Root->AsArray();
	}
	// Modus -testwaves: Wellen 1..30 gegen UWBNWaveDirector rechnen, Tabelle schreiben.
	static bool TestWaves(const FString& DataDir)
	{
		bool bOkE = false, bOkD = false;
		const auto Enemies = ReadJsonArray(DataDir + TEXT("enemies.json"), bOkE);
		const auto Dangers = ReadJsonArray(DataDir + TEXT("dangers.json"), bOkD);
		if (!bOkE || !bOkD) { UE_LOG(LogTemp, Error, TEXT("WBNImport: enemies/dangers.json fehlt")); return false; }
		TArray<FWBNEnemyPick> Pool;
		TMap<FString, int32> MinW;
		for (const auto& V : Enemies)
		{
			const auto O = V->AsObject(); if (!O.IsValid()) continue;
			FWBNEnemyPick P;
			P.EnemyId = JStr(O, TEXT("id"));
			P.MinWave = (int32)JNum(O, TEXT("minW"), 1.0);
			P.Weight = (float)JNum(O, TEXT("w"), 10.0);
			Pool.Add(P);
			MinW.Add(P.EnemyId, P.MinWave);
		}
		auto CntFor = [&](int32 N) -> float
		{
			for (const auto& V : Dangers)
			{
				const auto O = V->AsObject();
				if (O.IsValid() && (int32)JNum(O, TEXT("n"), -1.0) == N) return (float)JNum(O, TEXT("cnt"), 1.0);
			}
			return 1.f;
		};
		FString Out = TEXT("# Wellen-Test (Seed 1234, Formel aus engine-run.js, ohne Wetten/Mods)\n");
		Out += TEXT("# Welle Gefahr Gruppen Spawns Eliten MaxMinW Top3-Mix\n");
		const int32 Waves[] = { 1, 2, 3, 5, 10, 15, 20, 25, 30 };
		const int32 Dng[] = { 0, 2, 5 };
		for (int32 W : Waves) for (int32 D : Dng) for (int32 Coop = 0; Coop < 2; Coop++)
		{
			if (Coop == 1 && !(W == 20 && D == 2)) continue; // eine Koop-Probe reicht
			const auto Groups = UWBNWaveDirector::BuildWave(W, CntFor(D), D, Coop == 1, Pool, 1234);
			int32 Spawns = 0, Elites = 0, MaxMin = 0;
			TMap<FString, int32> Mix;
			for (const auto& G : Groups) for (const auto& E : G.Entries)
			{
				Spawns++;
				if (E.bElite) Elites++;
				if (const int32* M = MinW.Find(E.EnemyId)) MaxMin = FMath::Max(MaxMin, *M);
				Mix.FindOrAdd(E.EnemyId)++;
			}
			Mix.ValueSort([](int32 A, int32 B) { return A > B; });
			TArray<FString> Top;
			int32 k = 0;
			for (const auto& KV : Mix) { if (k++ >= 3) break; Top.Add(FString::Printf(TEXT("%s:%d"), *KV.Key, KV.Value)); }
			Out += FString::Printf(TEXT("W%02d D%d%s groups=%d spawns=%d elites=%d maxminW=%d %s\n"),
				W, D, Coop ? TEXT("+koop") : TEXT(""), Groups.Num(), Spawns, Elites, MaxMin, *FString::Join(Top, TEXT(",")));
		}
		FString File = FPaths::Combine(FPaths::ProjectDir(), TEXT("../../tools/waves_test.txt"));
		FPaths::CollapseRelativeDirectories(File);
		FFileHelper::SaveStringToFile(Out, *File);
		UE_LOG(LogTemp, Display, TEXT("WBNImport: Wellen-Test -> %s"), *File);
		return true;
	}
}

int32 UWBNImportCommandlet::Main(const FString& Params)
{
	using namespace WBNImport;
	// Modus -dumpbones: Skelett-Hierarchie nach tools/skeleton_bones.txt dumpen
	// (Bone-Namen sind per Python nicht lesbar). Aufruf: -run=WBNImport -dumpbones
	if (Params.Contains(TEXT("dumpbones")))
	{
		const USkeleton* Skel = LoadObject<USkeleton>(nullptr,
			TEXT("/Game/WBN/Chars/Leonidas/leonidas_body_Skeleton.leonidas_body_Skeleton"));
		if (!Skel) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Skeleton nicht ladbar")); return 1; }
		FString Out = TEXT("# Leonidas-Skeleton (Index Name Parent) - fuer IK-Retargeter-Mapping\n");
		const FReferenceSkeleton& Ref = Skel->GetReferenceSkeleton();
		for (int32 i = 0; i < Ref.GetNum(); i++)
			Out += FString::Printf(TEXT("%d %s %d\n"), i, *Ref.GetBoneName(i).ToString(), Ref.GetParentIndex(i));
		FString File = FPaths::Combine(FPaths::ProjectDir(), TEXT("../../tools/skeleton_bones.txt"));
		FPaths::CollapseRelativeDirectories(File);
		FFileHelper::SaveStringToFile(Out, *File);
		UE_LOG(LogTemp, Display, TEXT("WBNImport: %d Bones -> %s"), Ref.GetNum(), *File);
		return 0;
	}
	// JSONs liegen im Repo unter Unreal/Data (== ProjectDir/../Data).
	FString DataDir = FPaths::Combine(FPaths::ProjectDir(), TEXT("../Data/"));
	FPaths::CollapseRelativeDirectories(DataDir);
	if (!FPaths::DirectoryExists(DataDir))
	{
		DataDir = FPaths::Combine(FPaths::ProjectDir(), TEXT("Unreal/Data/"));
	}
	// Modus -testwaves: Wellen-Tabelle rechnen statt importieren.
	if (Params.Contains(TEXT("testwaves")))
		return TestWaves(DataDir) ? 0 : 1;
	int32 Total = 0, Failed = 0;

	auto LoadArr = [&](const FString& File) -> TArray<TSharedPtr<FJsonValue>>
	{
		FString Json;
		if (!FFileHelper::LoadFileToString(Json, *(DataDir + File))) { UE_LOG(LogTemp, Error, TEXT("WBNImport: fehlt: %s"), *(DataDir + File)); Failed++; return {}; }
		TSharedPtr<FJsonValue> Root;
		TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(Json);
		if (!FJsonSerializer::Deserialize(R, Root) || !Root.IsValid() || Root->Type != EJson::Array) { UE_LOG(LogTemp, Error, TEXT("WBNImport: JSON-Fehler: %s"), *File); Failed++; return {}; }
		return Root->AsArray();
	};

	// ---- Charaktere ----
	for (const auto& V : LoadArr(TEXT("chars.json")))
	{
		const auto O = V->AsObject(); if (!O.IsValid()) continue;
		const FString Id = JStr(O, TEXT("id"));
		UWBNCharacterData* A = GetOrCreate<UWBNCharacterData>(TEXT("/Game/WBN/Data/Chars/DA_Char_") + Id, TEXT("DA_Char_") + Id);
		A->CharId = Id;
		A->Name = FText::FromString(JStr(O, TEXT("name")));
		A->Role = FText::FromString(JStr(O, TEXT("role")));
		A->Color = JColor(O, TEXT("col"));
		A->Color2 = JColor(O, TEXT("col2"));
		A->Desc = FText::FromString(JStr(O, TEXT("desc")));
		const TSharedPtr<FJsonObject>* Skin = nullptr;
		if (O->TryGetObjectField(TEXT("skin"), Skin) && Skin && (*Skin).IsValid())
		{
			A->Skin.Build = JStr(*Skin, TEXT("build"), TEXT("normal"));
			A->Skin.Head = JStr(*Skin, TEXT("head")); A->Skin.Hat = JStr(*Skin, TEXT("hat"));
			A->Skin.Prop = JStr(*Skin, TEXT("prop")); A->Skin.Chest = JStr(*Skin, TEXT("chest"));
		}
		A->Sprite = JStr(O, TEXT("sprite"));
		const TSharedPtr<FJsonObject>* St = nullptr;
		if (O->TryGetObjectField(TEXT("stats"), St) && St) ApplyStats(A->Stats, *St);
		A->StartWeapon = JStr(O, TEXT("startWeapon"));
		const TSharedPtr<FJsonObject>* Ab = nullptr;
		if (O->TryGetObjectField(TEXT("ability"), Ab) && Ab && (*Ab).IsValid())
		{
			A->Ability.AbilityId = JStr(*Ab, TEXT("id"));
			A->Ability.Name = FText::FromString(JStr(*Ab, TEXT("name")));
			A->Ability.Cooldown = JNum(*Ab, TEXT("cd"), 10.0);
			A->Ability.Desc = FText::FromString(JStr(*Ab, TEXT("desc")));
		}
		const TSharedPtr<FJsonObject>* Sy = nullptr;
		if (O->TryGetObjectField(TEXT("synergy"), Sy) && Sy && (*Sy).IsValid())
		{
			A->Synergy.Class = JStr(*Sy, TEXT("cls"));
			A->Synergy.Need = (int32)JNum(*Sy, TEXT("need"), 2.0);
			const TSharedPtr<FJsonObject>* SySt = nullptr;
			if ((*Sy)->TryGetObjectField(TEXT("stats"), SySt) && SySt) ApplyStats(A->Synergy.Stats, *SySt);
			A->Synergy.Text = FText::FromString(JStr(*Sy, TEXT("text")));
		}
		const TSharedPtr<FJsonObject>* Un = nullptr;
		if (O->TryGetObjectField(TEXT("unlock"), Un) && Un) ApplyUnlock(A->Unlock, *Un);
		// 3D-Meshes: Konvention /Game/WBN/Chars/<CapId>/<id>_body, Hut exakt sonst Scan.
		const FString CapId = Id.Left(1).ToUpper() + Id.Mid(1);
		const FString CharFolder = TEXT("/Game/WBN/Chars/") + CapId;
		SetMeshRefIfExists(A->BodyMesh, CharFolder + TEXT("/") + Id + TEXT("_body"));
		if (!SetMeshRefIfExists(A->HatMesh, CharFolder + TEXT("/") + Id + TEXT("_hat_") + A->Skin.Hat)
			&& !A->Skin.Hat.IsEmpty() && A->Skin.Hat != TEXT("none"))
			SetMeshRefIfExists(A->HatMesh, FindPrefixedMesh(CharFolder, Id + TEXT("_hat_")));
		if (!SaveAsset(A->GetOutermost(), A)) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Save fehlgeschlagen: %s"), *Id); Failed++; }
		else Total++;
	}

	// ---- Waffen ----
	for (const auto& V : LoadArr(TEXT("weapons.json")))
	{
		const auto O = V->AsObject(); if (!O.IsValid()) continue;
		const FString Id = JStr(O, TEXT("id"));
		UWBNWeaponData* A = GetOrCreate<UWBNWeaponData>(TEXT("/Game/WBN/Data/Weapons/DA_Weapon_") + Id, TEXT("DA_Weapon_") + Id);
		A->WeaponId = Id;
		A->Name = FText::FromString(JStr(O, TEXT("name")));
		A->Classes.Reset();
		for (const auto& C : JArr(O, TEXT("cls"))) A->Classes.Add(C->AsString());
		A->Type = WeaponType(JStr(O, TEXT("type"), TEXT("projectile")));
		A->Color = JColor(O, TEXT("col"));
		const TSharedPtr<FJsonObject>* Sc = nullptr;
		if (O->TryGetObjectField(TEXT("scaling"), Sc) && Sc) ApplyStats(A->Scaling, *Sc);
		A->bUnlockDefault = JBool(O, TEXT("unlockDefault"), true);
		A->Tiers.Reset();
		for (const auto& TierVal : JArr(O, TEXT("tiers")))
		{
			const auto& TA = TierVal->AsArray();
			if (TA.Num() < 6) continue;
			FWBNWeaponTier Tier;
			Tier.Damage = TA[0]->AsNumber(); Tier.AttackInterval = TA[1]->AsNumber();
			Tier.Range = TA[2]->AsNumber(); Tier.CritChance = TA[3]->AsNumber();
			Tier.CritMult = TA[4]->AsNumber(); Tier.Price = (int32)TA[5]->AsNumber();
			if (TA.Num() > 6 && TA[6]->Type == EJson::Object)
			{
				const TSharedPtr<FJsonObject>& Opts = TA[6]->AsObject();
				for (const auto& KV : Opts->Values)
				{
					// UE 5.8: Values-Keys sind FSharedString, nicht FString.
					const FString K(FStringView(*KV.Key, KV.Key.Len()));
					const float OptV = KV.Value.IsValid() ? (float)KV.Value->AsNumber() : 0.f;
					Tier.ExtraOpts.Add(K, OptV);
				}
			}
			A->Tiers.Add(Tier);
		}
		A->Special = FText::FromString(JStr(O, TEXT("special")));
		const TSharedPtr<FJsonObject>* Un = nullptr;
		if (O->TryGetObjectField(TEXT("unlock"), Un) && Un) ApplyUnlock(A->Unlock, *Un);
		if (!SaveAsset(A->GetOutermost(), A)) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Save fehlgeschlagen: %s"), *Id); Failed++; }
		else Total++;
	}

	// ---- Gegner ----
	for (const auto& V : LoadArr(TEXT("enemies.json")))
	{
		const auto O = V->AsObject(); if (!O.IsValid()) continue;
		const FString Id = JStr(O, TEXT("id"));
		UWBNEnemyData* A = GetOrCreate<UWBNEnemyData>(TEXT("/Game/WBN/Data/Enemies/DA_Enemy_") + Id, TEXT("DA_Enemy_") + Id);
		A->EnemyId = Id;
		A->Name = FText::FromString(JStr(O, TEXT("name")));
		A->Hp = JNum(O, TEXT("hp"), 10.0); A->Dmg = JNum(O, TEXT("dmg"));
		A->Speed = JNum(O, TEXT("spd"), 100.0); A->Radius = JNum(O, TEXT("r"), 12.0);
		A->Color = JColor(O, TEXT("col")); A->Armor = JNum(O, TEXT("armor"));
		A->Xp = (int32)JNum(O, TEXT("xp"), 1.0); A->Material = (int32)JNum(O, TEXT("mat"), 1.0);
		A->AI = AIType(JStr(O, TEXT("ai"), TEXT("chase")));
		A->Shape = JStr(O, TEXT("shape"), TEXT("dot"));
		A->MinWave = (int32)JNum(O, TEXT("minW"), 1.0);
		A->Weight = JNum(O, TEXT("w"), 10.0);
		A->Pack = (int32)JNum(O, TEXT("pack"));
		A->bFly = JBool(O, TEXT("fly")); A->bPhase = JBool(O, TEXT("phase")); A->bNoKnock = JBool(O, TEXT("noKnock"));
		ApplySpecial(A->Special, O);
		if (!SaveAsset(A->GetOutermost(), A)) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Save fehlgeschlagen: %s"), *Id); Failed++; }
		else Total++;
	}

	// ---- Bosse ----
	for (const auto& V : LoadArr(TEXT("bosses.json")))
	{
		const auto O = V->AsObject(); if (!O.IsValid()) continue;
		const FString Id = JStr(O, TEXT("id"));
		UWBNBossData* A = GetOrCreate<UWBNBossData>(TEXT("/Game/WBN/Data/Bosses/DA_Boss_") + Id, TEXT("DA_Boss_") + Id);
		A->BossId = Id;
		A->Name = FText::FromString(JStr(O, TEXT("name")));
		A->Arena = JStr(O, TEXT("arena"));
		A->Hp = JNum(O, TEXT("hp"), 3000.0); A->Radius = JNum(O, TEXT("r"), 48.0);
		A->Color = JColor(O, TEXT("col")); A->Speed = JNum(O, TEXT("spd"), 50.0);
		A->Dmg = JNum(O, TEXT("dmg")); A->Armor = JNum(O, TEXT("armor"));
		A->Material = (int32)JNum(O, TEXT("mat")); A->Xp = (int32)JNum(O, TEXT("xp"));
		A->Phases.Reset();
		for (const auto& P : JArr(O, TEXT("phases")))
		{
			const auto PO = P->AsObject(); if (!PO.IsValid()) continue;
			FWBNBossPhase Ph;
			Ph.At = JNum(PO, TEXT("at"), 1.0); Ph.Speed = JNum(PO, TEXT("spd"), 50.0);
			Ph.Pattern = JStr(PO, TEXT("pattern")); Ph.Cooldown = JNum(PO, TEXT("cd"), 2.0);
			Ph.Count = (int32)JNum(PO, TEXT("n"), 10.0);
			Ph.BulletSpeed = JNum(PO, TEXT("bs"), 200.0); Ph.BulletDmg = JNum(PO, TEXT("bd"), 12.0);
			Ph.SummonId = JStr(PO, TEXT("summon"));
			A->Phases.Add(Ph);
		}
		if (!SaveAsset(A->GetOutermost(), A)) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Save fehlgeschlagen: %s"), *Id); Failed++; }
		else Total++;
	}

	// ---- Arenen ----
	for (const auto& V : LoadArr(TEXT("arenas.json")))
	{
		const auto O = V->AsObject(); if (!O.IsValid()) continue;
		const FString Id = JStr(O, TEXT("id"));
		UWBNArenaData* A = GetOrCreate<UWBNArenaData>(TEXT("/Game/WBN/Data/Arenas/DA_Arena_") + Id, TEXT("DA_Arena_") + Id);
		A->ArenaId = Id;
		A->Name = FText::FromString(JStr(O, TEXT("name")));
		A->Width = JNum(O, TEXT("w"), 1000.0); A->Height = JNum(O, TEXT("h"), 850.0);
		A->Ground = JColor(O, TEXT("ground")); A->Grid = JColor(O, TEXT("grid")); A->Accent = JColor(O, TEXT("accent"));
		A->Theme = JStr(O, TEXT("theme"), TEXT("offen"));
		A->Buildings = (int32)JNum(O, TEXT("buildings")); A->Cover = (int32)JNum(O, TEXT("cover"));
		A->Poison = (int32)JNum(O, TEXT("poison")); A->SpeedField = (int32)JNum(O, TEXT("speedField"));
		A->MovingWalls = (int32)JNum(O, TEXT("movingWalls"));
		A->Desc = FText::FromString(JStr(O, TEXT("desc")));
		if (!SaveAsset(A->GetOutermost(), A)) { UE_LOG(LogTemp, Error, TEXT("WBNImport: Save fehlgeschlagen: %s"), *Id); Failed++; }
		else Total++;
	}

	UE_LOG(LogTemp, Display, TEXT("WBNImport: %d Assets geschrieben, %d Fehler"), Total, Failed);
	return Failed == 0 ? 0 : 1;
}
