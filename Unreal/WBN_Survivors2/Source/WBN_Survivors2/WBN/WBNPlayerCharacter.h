// WBN Survivors 2 — spielbarer Charakter: TwinStick-Basis + Assembler + Waffe + Game Feel.
// Charakterwahl = nur DataAsset tauschen (Details siehe UWBNCharacterData).
#pragma once

#include "CoreMinimal.h"
#include "TwinStickCharacter.h"
#include "WBNPlayerCharacter.generated.h"

class UWBNCharAssembler;
class UWBNCharacterData;
class UWBNWeaponComponent;
class UInputMappingContext;

UCLASS()
class WBN_SURVIVORS2_API AWBNPlayerCharacter : public ATwinStickCharacter
{
	GENERATED_BODY()

public:
	AWBNPlayerCharacter();

	/** Gewählter Charakter (Skin/Stats/Ability/Synergie). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Char")
	TObjectPtr<UWBNCharacterData> CharacterData;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Char")
	TObjectPtr<UWBNCharAssembler> Assembler;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Weapon")
	TObjectPtr<UWBNWeaponComponent> WeaponComponent;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;
	virtual void NotifyControllerChanged() override;
	virtual void SetupPlayerInputComponent(UInputComponent* InInputComponent) override;
	virtual void DoShoot() override;
	virtual void HandleDamage(float Damage, const FVector& DamageDirection) override;

	/** Kameraruck beim Schießen/Getroffenwerden (Game Feel). */
	UPROPERTY(VisibleAnywhere, Category = "WBN|Feel")
	float CameraKick = 0.f;

	void LoadDefaultInputs();
};