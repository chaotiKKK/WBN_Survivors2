// WBN Survivors 2 — Wellen-Spawner im Level: UWBNWaveDirector -> Gegner-Spawns.
// Arena-Halbbreite fest (LVL_kurpark ~5500x?). Spawnring um den Spieler.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WBNEnemyData.h"
#include "WBNWaveDirector.h"
#include "WBNWaveSpawner.generated.h"

class UWBNEnemyData;

UCLASS()
class WBN_SURVIVORS2_API AWBNWaveSpawner : public AActor
{
	GENERATED_BODY()

public:
	AWBNWaveSpawner();

	UFUNCTION(BlueprintCallable, Category = "WBN|Wave")
	void StartRun(int32 StartWave);

	UFUNCTION(BlueprintCallable, Category = "WBN|Wave")
	int32 GetCurrentWave() const { return CurrentWave; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Wave")
	int32 GetTotalSpawned() const { return TotalSpawned; }

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(EEndPlayReason::Type EndPlayReason) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Wave")
	int32 CurrentWave = 0;

	/** Gefahrenstufe: 0 normal, 2 ab Welle 5, 5 ab Welle 10. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Wave")
	int32 DangerLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Wave")
	bool bCoop = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Wave", meta = (Units = "cm"))
	float SpawnRadius = 2600.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Wave")
	int32 MaxSimultaneous = 50;

	/** Gesamtzahl der in diesem Run gespawnten Gegner (für Proben/Analytics). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Wave")
	int32 TotalSpawned = 0;

	/** In die Maps eingebaute Arena-Halbbreite (PX2UU=5, Kurpark 1100px). */
	static constexpr float ArenaHalf = 2700.f;

	TArray<FWBNEnemyPick> Pool;
	TMap<FString, TObjectPtr<UWBNEnemyData>> ById;

	TArray<FWBNSpawnGroup> PendingGroups;
	TArray<float> DueTimes;
	double WaveStartTime = 0.0;

	FTimerHandle WaveTimer;
	FTimerHandle GroupTimer;

	void BuildLibrary();
	void StartNextWave();
	void TickGroups();
	void SpawnGroup(const FWBNSpawnGroup& Group);
};