// WBN Survivors 2 — GameMode (Implementierung).
#include "WBNGameMode.h"
#include "WBNPlayerCharacter.h"
#include "WBNWaveSpawner.h"
#include "Variant_TwinStick/TwinStickPlayerController.h"
#include "Engine/World.h"
#include "EngineUtils.h"

AWBNGameMode::AWBNGameMode()
{
	DefaultPawnClass = AWBNPlayerCharacter::StaticClass();
	PlayerControllerClass = ATwinStickPlayerController::StaticClass();
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
}