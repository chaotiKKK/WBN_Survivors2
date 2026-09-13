// WBN Survivors 2 — Datengetriebene Waffen: WVBNWeaponType -> Verhalten.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "WBNWeaponData.h"
#include "WBNWeaponComponent.generated.h"

UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class WBN_SURVIVORS2_API UWBNWeaponComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWBNWeaponComponent();

	UFUNCTION(BlueprintCallable, Category = "WBN|Weapon")
	void SetWeapon(class UWBNWeaponData* InWeapon, int32 InTier);

	UFUNCTION(BlueprintCallable, Category = "WBN|Weapon")
	void FireAt(const FVector& AimDir);

	UFUNCTION(BlueprintCallable, Category = "WBN|Weapon")
	class UWBNWeaponData* GetWeapon() const { return WeaponData; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Weapon")
	void SetDamageScale(float InScale) { DamageScale = FMath::Max(0.f, InScale); }

	UFUNCTION(BlueprintCallable, Category = "WBN|Weapon")
	float GetDamageScale() const { return DamageScale; }

protected:
	/** Schadens-Skalierung des Spielers (Level-Up), wird auf jeden Feuer-Typ angewendet. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Weapon")
	float DamageScale = 1.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon")
	TObjectPtr<UWBNWeaponData> WeaponData;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "WBN|Weapon")
	int32 TierIndex = 0;

	double NextFireTime = 0.0;

	void FireProjectile(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier);
	void FireTrace(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier, bool bCone, bool bChain);
	void FireAura(float Damage, const FWBNWeaponTier& Tier);
	void FireMelee(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier);

	static void ShowNumber(UWorld* World, const FVector& At, float Value, bool bCrit);
	static int32 RollCrit(float CritChance, float CritMult);
};