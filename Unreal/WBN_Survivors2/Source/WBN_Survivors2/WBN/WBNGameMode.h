// WBN Survivors 2 — GameMode für Runs: WBN-Spawner + Spieler, NPC-Cap 50.
#pragma once

#include "CoreMinimal.h"
#include "Variant_TwinStick/TwinStickGameMode.h"
#include "WBNGameMode.generated.h"

UCLASS()
class WBN_SURVIVORS2_API AWBNGameMode : public ATwinStickGameMode
{
	GENERATED_BODY()

public:
	AWBNGameMode();

protected:
	virtual void BeginPlay() override;
};