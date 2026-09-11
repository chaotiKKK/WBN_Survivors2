// WBN Survivors 2 — Wellen-Regie, pure Logik ohne Welt (headless testbar).
// Spiegelt engine-run.js: Budget -> Gruppen -> WeightedPick (+Elite-Regel).
// Einheiten: Zeiten in Sekunden, Gruppen über die Welle verteilt.
#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "WBNWaveDirector.generated.h"

/** Kandidat für WeightedPick (aus UWBNEnemyData: id/minW/weight). */
USTRUCT(BlueprintType)
struct FWBNEnemyPick
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString EnemyId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 MinWave = 1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Weight = 10.f;
};

/** Ein Spawn-Eintrag. */
USTRUCT(BlueprintType)
struct FWBNSpawnEntry
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString EnemyId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool bElite = false;
};

/** Eine Spawn-Gruppe (Richtung 0=Ost,1=Süd,2=West,3=Nord). */
USTRUCT(BlueprintType)
struct FWBNSpawnGroup
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Time = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Dir = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) TArray<FWBNSpawnEntry> Entries;
};

UCLASS()
class UWBNWaveDirector : public UObject
{
	GENERATED_BODY()

public:
	static constexpr float WaveDuration = 25.f;
	static constexpr float SpawnAnnounce = 0.3f;

	/** Baut die Spawn-Liste einer Welle. Seed -> deterministisch. */
	UFUNCTION(BlueprintCallable, Category = "WBN|Wave")
	static TArray<FWBNSpawnGroup> BuildWave(int32 Wave, float DangerCnt, int32 DangerLevel, bool bCoop, const TArray<FWBNEnemyPick>& Pool, int32 Seed);
};
