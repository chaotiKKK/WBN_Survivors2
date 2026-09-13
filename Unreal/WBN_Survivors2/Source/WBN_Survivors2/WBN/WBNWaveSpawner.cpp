// WBN Survivors 2 — Wellen-Spawner (Implementierung).
#include "WBNWaveSpawner.h"
#include "WBNEnemyNPC.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "TimerManager.h"

AWBNWaveSpawner::AWBNWaveSpawner()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AWBNWaveSpawner::BuildLibrary()
{
	// Direkter Dateisystem-Scan statt AssetRegistry: deterministisch in Editor UND -game/Standalone
	// (Standalone-Registry findet Content-Assets zuverlässig erst nach Cook/FullGather).
	const FString EnemyDir = FPaths::ProjectContentDir() + TEXT("WBN/Data/Enemies");
	UE_LOG(LogTemp, Display, TEXT("WBNWaveSpawner: Scan %s (Content=%s)"), *EnemyDir, *FPaths::ProjectContentDir());
	TArray<FString> Files;
	IFileManager::Get().FindFilesRecursive(Files, *EnemyDir, TEXT("*.uasset"), true, false);
	int32 Loaded = 0;
	for (const FString& File : Files)
	{
		const FString Short = FPaths::GetBaseFilename(File);
		if (!Short.StartsWith(TEXT("DA_Enemy_")))
		{
			continue;
		}
		const FString PkgPath = FString(TEXT("/Game/WBN/Data/Enemies/")) + Short;
		UWBNEnemyData* D = LoadObject<UWBNEnemyData>(nullptr, *PkgPath);
		if (!D)
		{
			continue;
		}
		ById.Add(D->EnemyId, D);
		FWBNEnemyPick Pick;
		Pick.EnemyId = D->EnemyId;
		Pick.MinWave = D->MinWave;
		Pick.Weight = D->Weight;
		Pool.Add(Pick);
		++Loaded;
	}
	UE_LOG(LogTemp, Display, TEXT("WBNWaveSpawner: %d Gegnertypen geladen (%d Dateien)"), Loaded, Files.Num());
}

void AWBNWaveSpawner::BeginPlay()
{
	Super::BeginPlay();
	BuildLibrary();
	StartRun(1);
}

void AWBNWaveSpawner::EndPlay(EEndPlayReason::Type EndPlayReason)
{
	UWorld* World = GetWorld();
	if (World)
	{
		World->GetTimerManager().ClearTimer(WaveTimer);
		World->GetTimerManager().ClearTimer(GroupTimer);
	}
	Super::EndPlay(EndPlayReason);
}

void AWBNWaveSpawner::StartRun(int32 StartWave)
{
	if (CurrentWave > 0)
	{
		return;
	}
	CurrentWave = FMath::Max(1, StartWave) - 1;
	GetWorld()->GetTimerManager().SetTimer(WaveTimer, this, &AWBNWaveSpawner::StartNextWave, UWBNWaveDirector::WaveDuration, true);
	StartNextWave();
}

void AWBNWaveSpawner::StartNextWave()
{
	++CurrentWave;
	DangerLevel = CurrentWave >= 10 ? 5 : (CurrentWave >= 5 ? 2 : 0);

	PendingGroups = UWBNWaveDirector::BuildWave(CurrentWave, 1.f, DangerLevel, bCoop, Pool, CurrentWave * 7919 + 1);
	DueTimes.Reset();
	for (const FWBNSpawnGroup& G : PendingGroups)
	{
		DueTimes.Add(G.Time + UWBNWaveDirector::SpawnAnnounce);
	}
	WaveStartTime = GetWorld()->GetTimeSeconds();

	UE_LOG(LogTemp, Display, TEXT("WBNWave: Welle %d (D%d) -> %d Gruppen"), CurrentWave, DangerLevel, PendingGroups.Num());

	if (!GroupTimer.IsValid())
	{
		GetWorld()->GetTimerManager().SetTimer(GroupTimer, this, &AWBNWaveSpawner::TickGroups, 0.25f, true);
	}
}

void AWBNWaveSpawner::TickGroups()
{
	if (PendingGroups.Num() == 0)
	{
		GetWorld()->GetTimerManager().ClearTimer(GroupTimer);
		return;
	}

	const double Elapsed = GetWorld()->GetTimeSeconds() - WaveStartTime;

	// NPC-Limit: live zählen (einfach und robust).
	int32 Alive = 0;
	for (TActorIterator<AWBNEnemyNPC> It(GetWorld()); It; ++It)
	{
		++Alive;
	}

	for (int32 i = PendingGroups.Num() - 1; i >= 0; --i)
	{
		if (DueTimes[i] > Elapsed)
		{
			continue;
		}
		if (Alive >= MaxSimultaneous)
		{
			// Limit: Gruppe nachschieben.
			DueTimes[i] = Elapsed + 0.5f;
			continue;
		}
		SpawnGroup(PendingGroups[i]);
		PendingGroups.RemoveAt(i);
		DueTimes.RemoveAt(i);
		--Alive;
	}
}

void AWBNWaveSpawner::SpawnGroup(const FWBNSpawnGroup& Group)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	FVector Center = UGameplayStatics::GetPlayerPawn(this, 0)
		? UGameplayStatics::GetPlayerPawn(this, 0)->GetActorLocation()
		: GetActorLocation();
	Center.Z = 0.f;

	for (int32 i = 0; i < Group.Entries.Num(); ++i)
	{
		const FWBNSpawnEntry& Entry = Group.Entries[i];
		UWBNEnemyData* Data = ById.FindRef(Entry.EnemyId);
		if (!Data)
		{
			UE_LOG(LogTemp, Warning, TEXT("WBNWave: unbekannter Gegner '%s'"), *Entry.EnemyId);
			continue;
		}

		const float Angle = (Group.Dir * 90.f + FMath::RandRange(-8.f, 8.f)) * PI / 180.f;
		const FVector DirVec(FMath::Cos(Angle), FMath::Sin(Angle), 0.f);
		FVector Pos = Center + DirVec * SpawnRadius;
		Pos.X = FMath::Clamp(Pos.X, -ArenaHalf, ArenaHalf);
		Pos.Y = FMath::Clamp(Pos.Y, -ArenaHalf, ArenaHalf);
		Pos.Z = 90.f;

		FTimerHandle EntryTimer;
		World->GetTimerManager().SetTimer(EntryTimer, [World, Pos, Data, Entry, this]()
		{
			if (!IsValid(this) || !World)
			{
				return;
			}
			FActorSpawnParameters SP;
			SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
			if (AWBNEnemyNPC* E = World->SpawnActor<AWBNEnemyNPC>(AWBNEnemyNPC::StaticClass(), Pos, FRotator::ZeroRotator, SP))
			{
				E->FetchData(Data);
				if (Entry.bElite)
				{
					E->SetElite(true);
				}
				++TotalSpawned;
			}
		}, 0.08f * i, false);
	}
}