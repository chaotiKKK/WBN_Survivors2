// WBN Survivors 2 — Gegner aus UWBNEnemyData (HP/Dmg/Speed, Chase-Steering).
// Web-Umrechnung: Karte PX2UU=5, Tempo/Fühlen langsam (Faktor 2.0).
#pragma once

#include "CoreMinimal.h"
#include "Variant_TwinStick/AI/TwinStickNPC.h"
#include "WBNEnemyNPC.generated.h"

class UStaticMeshComponent;
class UWBNEnemyData;

UCLASS()
class WBN_SURVIVORS2_API AWBNEnemyNPC : public ATwinStickNPC
{
	GENERATED_BODY()

public:
	AWBNEnemyNPC();

	/** Werte aus DataAsset übernehmen. */
	UFUNCTION(BlueprintCallable, Category = "WBN|Enemy")
	void FetchData(class UWBNEnemyData* InData);

	/** Schaden; true = getötet. */
	UFUNCTION(BlueprintCallable, Category = "WBN|Enemy")
	bool ApplyDamage(float Amount, const FVector& PushDir);

	UFUNCTION(BlueprintCallable, Category = "WBN|Enemy")
	float GetHp() const { return Hp; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Enemy")
	float GetMaxHp() const { return MaxHp; }

	UFUNCTION(BlueprintCallable, Category = "WBN|Enemy")
	void SetElite(bool bIn);

	virtual void Tick(float DeltaTime) override;
	virtual void NotifyHit(class UPrimitiveComponent* MyComp, AActor* Other, class UPrimitiveComponent* OtherComp,
		bool bSelfMoved, FVector HitLocation, FVector HitNormal, FVector NormalImpulse, const FHitResult& Hit) override;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Enemy")
	TObjectPtr<UStaticMeshComponent> BodyVis;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Enemy")
	float Hp = 10.f;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Enemy")
	float MaxHp = 10.f;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Enemy")
	float DamageOnHit = 5.f;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Enemy")
	bool bElite = false;

	/** Karte-Pixel -> cm (Maps mit PX2UU=5). */
	static constexpr float SizeUUPerPx = 5.f;
	/** Tempo-Faktor für Gameplay (bewusst langsamer als Karte). */
	static constexpr float SpeedUUPerPx = 2.f;

	float BaseScale = 1.f;
	float PopStrength = 0.f;
	FTimerHandle PopTimer;

	void Die();
};