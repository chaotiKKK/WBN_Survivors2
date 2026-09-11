// WBN Survivors 2 — Charakter-Daten, Felder 1:1 aus CHARS (src/data.js).
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "WBNStats.h"
#include "WBNCharacterData.generated.h"

/** Skin-Bausteine (skin: { build, head, hat, prop, chest }). */
USTRUCT(BlueprintType)
struct FWBNCharSkin
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Build = TEXT("normal");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Head = TEXT("#f2d5b0");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Hat = TEXT("none");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Prop = TEXT("none");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Chest = TEXT("#ffffff");
};

/** Spezialfähigkeit (ability: { id, name, cd, desc }). */
USTRUCT(BlueprintType)
struct FWBNCharAbility
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString AbilityId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FText Name;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, meta = (Units = "s")) float Cooldown = 10.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FText Desc;
};

/** Klassen-Synergie (synergy: { cls, need, stats, text }). */
USTRUCT(BlueprintType)
struct FWBNSynergy
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Class = TEXT("gun");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Need = 2;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FWBNStats Stats;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FText Text;
};

/** Freischaltbedingung (unlock: { key, need, text } oder leer = frei). */
USTRUCT(BlueprintType)
struct FWBNUnlock
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Key;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Need = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FText Text;
};

/** Ein spielbarer Charakter (CHARS-Eintrag). */
UCLASS(BlueprintType)
class UWBNCharacterData : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FString CharId;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FText Name;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FText Role;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FLinearColor Color = FLinearColor::White;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FLinearColor Color2 = FLinearColor::White;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char", meta = (MultiLine = true)) FText Desc;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FWBNCharSkin Skin;
	/** Optionales Sprite-Sheet-Set (models/sheets/<id>_{idle,walk,punch}.png), leer = Skin-Render. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FString Sprite;
	/** 3D-Meshes (Source of Truth für den Assembler; Fallback: dessen Maps). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char|Meshes") TSoftObjectPtr<USkeletalMesh> BodyMesh;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char|Meshes") TSoftObjectPtr<USkeletalMesh> HatMesh;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char|Meshes") TSoftObjectPtr<USkeletalMesh> PropMesh;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FWBNStats Stats;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FString StartWeapon;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FWBNCharAbility Ability;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FWBNSynergy Synergy;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char") FWBNUnlock Unlock;
};
