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

public:
	/** XP gutschreiben (inkl. Mehrfach-Level-Ups, Formel aus PWA xpFor). */
	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	void AddXp(int32 Amount);

	/** Kill-Gutschrift vom Gegner (nennt AddXp mit dessen Xp-Wert). */
	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	void GrantKill(class UWBNEnemyData* Data);

	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	int32 GetWbnLevel() const { return Level; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	int32 GetXp() const { return Xp; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	int32 GetXpNext() const { return XpNext; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Xp")
	float GetDamageMult() const { return DamageMult; }

public:
	int32 XpFor(int32 L) const { return FMath::FloorToInt(5 + L * 4 + L * L * 0.85f); }

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Xp")
	int32 Level = 1;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Xp")
	int32 Xp = 0;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Xp")
	int32 XpNext = 9;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Xp")
	int32 PendingLevels = 0;

	/** Schadens-Skalierung: +10 % pro Level (einfacher Ersatz fuer PWA-recalc). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Xp")
	float DamageMult = 1.f;

	void OnLevelUp();

	/** Kameraruck beim Schießen/Getroffenwerden (Game Feel). */
	UPROPERTY(VisibleAnywhere, Category = "WBN|Feel")
	float CameraKick = 0.f;

	void LoadDefaultInputs();
};