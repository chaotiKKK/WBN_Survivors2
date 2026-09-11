// WBN Survivors 2 — Boss-Daten, Felder aus BOSSES (src/data.js).
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "WBNBossData.generated.h"

/** Eine Boss-Phase (phases[]: at = HP-Schwelle 1.0 → 0). */
USTRUCT(BlueprintType)
struct FWBNBossPhase
{
	GENERATED_BODY()

	/** HP-Anteil, ab dem die Phase aktiv wird. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float At = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Speed = 50.f;
	/** Angriffsmuster (radial/charge/bulletHell/spiral/crossfire/shockwave/...). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Pattern;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Cooldown = 2.f;
	/** Projektilanzahl (n). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Count = 10;
	/** Projektiltempo (bs). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BulletSpeed = 200.f;
	/** Projektilschaden (bd). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BulletDmg = 12.f;
	/** Optional beschworener Gegner (summon). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SummonId;
};

/** Ein Boss (BOSSES-Eintrag). */
UCLASS(BlueprintType)
class UWBNBossData : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") FString BossId;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") FText Name;
	/** Heimat-Arena (arena, ref:arenas). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") FString Arena;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") float Hp = 3000.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") float Radius = 48.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") FLinearColor Color = FLinearColor::White;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") float Speed = 50.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") float Dmg = 20.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") float Armor = 10.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") int32 Material = 60;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") int32 Xp = 40;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Boss") TArray<FWBNBossPhase> Phases;
};
