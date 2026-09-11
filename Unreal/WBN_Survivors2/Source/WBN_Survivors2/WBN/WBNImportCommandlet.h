// WBN Survivors 2 — Editor-Commandlet: importiert Unreal/Data/*.json in DataAssets.
// Aufruf: UnrealEditor-Cmd.exe <uproject> -run=WBNImport
// Schreibt .uasset nach /Game/WBN/Data/{Chars,Weapons,Enemies,Bosses,Arenas}.
#pragma once

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "WBNImportCommandlet.generated.h"

UCLASS()
class UWBNImportCommandlet : public UCommandlet
{
	GENERATED_BODY()

public:
	UWBNImportCommandlet();

	virtual int32 Main(const FString& Params) override;
};
