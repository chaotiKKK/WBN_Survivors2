// WBN Survivors 2 — spielbarer Charakter: TwinStick-Basis + Char-Assembler.
// Charakterwahl = nur DataAsset tauschen (Details siehe UWBNCharacterData).
#pragma once

#include "CoreMinimal.h"
#include "TwinStickCharacter.h"
#include "WBNPlayerCharacter.generated.h"

class UWBNCharAssembler;
class UWBNCharacterData;

UCLASS()
class AWBNPlayerCharacter : public ATwinStickCharacter
{
	GENERATED_BODY()

public:
	AWBNPlayerCharacter();

	/** Gewählter Charakter (Skin/Stats/Ability/Synergie). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char")
	TObjectPtr<UWBNCharacterData> CharacterData;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Char")
	TObjectPtr<UWBNCharAssembler> Assembler;

protected:
	virtual void BeginPlay() override;
};
