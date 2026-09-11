// WBN Survivors 2 — Waffen-Daten, Felder aus WEAPONS + tierData() (src/data.js).
// Tier-Array: [dmg, as, range, critC, critM, price, opts].
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "WBNStats.h"
#include "WBNCharacterData.h"
#include "WBNWeaponData.generated.h"

/** Waffen-Typen (type: 'in:projectile,hitscan,cone,chain,charge,aura,melee'). */
UENUM(BlueprintType)
enum class EWBNWeaponType : uint8
{
	Projectile UMETA(DisplayName = "Projektil"),
	Hitscan    UMETA(DisplayName = "Hitscan"),
	Cone       UMETA(DisplayName = "Kegel"),
	Chain      UMETA(DisplayName = "Kette"),
	Charge     UMETA(DisplayName = "Aufladung"),
	Aura       UMETA(DisplayName = "Aura"),
	Melee      UMETA(DisplayName = "Nahkampf")
};

/** Eine Ausbaustufe (tiers[i]): Schaden, Intervall, Reichweite, Krit, Preis, Extra-Opts. */
USTRUCT(BlueprintType)
struct FWBNWeaponTier
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Damage = 10.f;
	/** Angriffsintervall in Sekunden (as). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, meta = (Units = "s")) float AttackInterval = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Range = 400.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, meta = (Units = "%")) float CritChance = 0.05f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float CritMult = 1.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 10;
	/** Typ-Sonderwerte: pellets, spread, pierce, lifesteal, ... (x in tierData). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) TMap<FString, float> ExtraOpts;
};

/** Eine Waffe (WEAPONS-Eintrag). */
UCLASS(BlueprintType)
class UWBNWeaponData : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") FString WeaponId;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") FText Name;
	/** Klassen für Synergien (cls: ['gun', 'precise', ...]). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") TArray<FString> Classes;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") EWBNWeaponType Type = EWBNWeaponType::Projectile;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") FLinearColor Color = FLinearColor::White;
	/** Stat-Skalierung (scaling: { ranged: .6 }). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") FWBNStats Scaling;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") bool bUnlockDefault = true;
	/** 4 Ausbaustufen (Normal → Legendär). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") TArray<FWBNWeaponTier> Tiers;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon", meta = (MultiLine = true)) FText Special;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon") FWBNUnlock Unlock;
};
