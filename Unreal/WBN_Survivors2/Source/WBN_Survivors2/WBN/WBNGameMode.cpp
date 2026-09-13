// WBN Survivors 2 — GameMode (Implementierung).
#include "WBNGameMode.h"
#include "WBNEnemyNPC.h"
#include "WBNPlayerCharacter.h"
#include "WBNPlayerController.h"
#include "WBNWaveSpawner.h"
#include "Variant_TwinStick/TwinStickPlayerController.h"
#include "Engine/World.h"
#include "EngineUtils.h"

AWBNGameMode::AWBNGameMode()
{
	DefaultPawnClass = AWBNPlayerCharacter::StaticClass();
	PlayerControllerClass = AWBNPlayerController::StaticClass();
	NPCCap = 50;
}

void AWBNGameMode::BeginPlay()
{
	Super::BeginPlay();

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	bool bHasSpawner = false;
	for (TActorIterator<AWBNWaveSpawner> It(World); It; ++It)
	{
		bHasSpawner = true;
		break;
	}
	if (!bHasSpawner)
	{
		World->SpawnActor<AWBNWaveSpawner>(AWBNWaveSpawner::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator);
		UE_LOG(LogTemp, Display, TEXT("WBNGameMode: WaveSpawner ergaenzt"));
	}

	// Live-Probe (-wbnliverun): Snapshot-Log alle 3 s, Auto-Exit nach ~2 Wellen.
	if (FParse::Param(FCommandLine::Get(), TEXT("wbnliverun")))
	{
		GetWorldTimerManager().SetTimer(ProbeTimer, this, &AWBNGameMode::ProbeSnapshot, 3.f, true);
		GetWorldTimerManager().SetTimer(ProbeExitTimer, this, &AWBNGameMode::ProbeExit, 60.f, false);
		UE_LOG(LogTemp, Display, TEXT("WBNProbe: Live-Run aktiv (Snapshots+Auto-Exit)"));
	}
}

void AWBNGameMode::ProbeSnapshot()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	int32 Alive = 0, Elite = 0;
	for (TActorIterator<AWBNEnemyNPC> It(World); It; ++It)
	{
		++Alive;
		if (It->IsElite())
		{
			++Elite;
		}
	}
	int32 Wave = 0, TotalSpawned = 0;
	for (TActorIterator<AWBNWaveSpawner> S(World); S; ++S)
	{
		Wave = S->GetCurrentWave();
		TotalSpawned = S->GetTotalSpawned();
	}
	UE_LOG(LogTemp, Display, TEXT("WBNProbe: t=%.1f Welle=%d Spawns=%d Alive=%d Elite=%d"),
		World->GetTimeSeconds(), Wave, TotalSpawned, Alive, Elite);
}

void AWBNGameMode::ProbeExit()
{
	UE_LOG(LogTemp, Display, TEXT("WBNProbe: DONE"));
	FGenericPlatformMisc::RequestExit(false);
}