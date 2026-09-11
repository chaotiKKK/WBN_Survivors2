// WBN Survivors 2 — Gegner-Daten, Felder aus E() (src/data.js).
// Spezialwerte je KI-Typ; unbenutzte bleiben 0/leer.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "WBNEnemyData.generated.h"

/** KI-Typen (ai-Feld in ENEMIES). */
UENUM(BlueprintType)
enum class EWBNEnemyAI : uint8
{
	Chase     UMETA(DisplayName = "Verfolgen"),
	Orbit     UMETA(DisplayName = "Umkreisen"),
	Ranged    UMETA(DisplayName = "Fernkampf"),
	Exploder  UMETA(DisplayName = "Explosion"),
	Charger   UMETA(DisplayName = "Ansturm"),
	Healer    UMETA(DisplayName = "Heiler"),
	Aura      UMETA(DisplayName = "Aura"),
	Summoner  UMETA(DisplayName = "Beschwörer"),
	Shielded  UMETA(DisplayName = "Schild"),
	Teleport  UMETA(DisplayName = "Teleporter"),
	Spiral    UMETA(DisplayName = "Spirale"),
	Mortar    UMETA(DisplayName = "Mörser"),
	Weaver    UMETA(DisplayName = "Weber"),
	Sentinel  UMETA(DisplayName = "Wächter"),
	Leech     UMETA(DisplayName = "Blutegel"),
	Bomber    UMETA(DisplayName = "Bomber"),
	Mirror    UMETA(DisplayName = "Spiegel"),
	Juggernaut UMETA(DisplayName = "Juggernaut"),
	Siren     UMETA(DisplayName = "Sirene")
};

/** Optionale Spezialwerte (shot/boom/heal/aura/summon/split/blink/lob/web/beam/drain/mine/slam/wail/...). */
USTRUCT(BlueprintType)
struct FWBNEnemySpecial
{
	GENERATED_BODY()

	// Fernkampf (shot)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShotDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShotSpeed = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShotCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShotRange = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FLinearColor ShotColor = FLinearColor::White;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShotPoison = 0.f;
	// Explosion (boom)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BoomDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BoomRadius = 0.f;
	// Heilung (heal)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HealAmount = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HealCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HealRadius = 0.f;
	// Aura (aura)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float AuraArmor = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float AuraRadius = 0.f;
	// Beschwörung (summon)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SummonId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 SummonCount = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SummonCooldown = 0.f;
	// Teilung (split)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString SplitId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 SplitCount = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 SplitDepth = 0;
	// Schild (shieldArc), Teleport (blink), Vampir (vamp), Radial (radial)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float ShieldArc = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BlinkCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BlinkMin = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BlinkMax = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Vamp = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RadialCount = 0;
	// Mörser (lob)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LobDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LobCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LobRange = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LobRadius = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LobFlight = 0.f;
	// Netz (web)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WebCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WebRadius = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WebSlow = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WebLife = 0.f;
	// Strahl (beam)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BeamDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BeamCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BeamWarn = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BeamRange = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BeamWidth = 0.f;
	// Saugen (drain), Minen (mine), Reflektieren (reflect)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float DrainDps = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float DrainCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float DrainHeal = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MineCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MineFuse = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MineRadius = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MineDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Reflect = 0.f;
	// Boden-Slam (slam), Heulen (wail)
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SlamCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SlamRadius = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SlamDmg = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SlamWarn = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WailCooldown = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WailRadius = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WailSpd = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WailDuration = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WailCdPenalty = 0.f;
};

/** Ein Gegnertyp (ENEMIES-Eintrag). */
UCLASS(BlueprintType)
class UWBNEnemyData : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") FString EnemyId;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") FText Name;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Hp = 10.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Dmg = 5.f;
	/** Tempo in px/s (Web-Einheiten, Umrechnung beim Spawnen). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Speed = 100.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Radius = 12.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") FLinearColor Color = FLinearColor::White;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Armor = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") int32 Xp = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") int32 Material = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") EWBNEnemyAI AI = EWBNEnemyAI::Chase;
	/** Debug-Form (shape: tri/dot/box/diamond/...). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") FString Shape = TEXT("dot");
	/** Erste Welle mit diesem Gegner (minW, 999 = nur per Split/Summon). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") int32 MinWave = 1;
	/** Spawn-Gewicht (w). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") float Weight = 10.f;
	/** Rudelgröße (pack). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") int32 Pack = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") bool bFly = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") bool bPhase = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") bool bNoKnock = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Enemy") FWBNEnemySpecial Special;
};
