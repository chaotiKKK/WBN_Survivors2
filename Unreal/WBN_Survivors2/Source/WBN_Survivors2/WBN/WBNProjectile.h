// WBN Survivors 2 — Projektil mit HP-Schaden und optionalem Piercing.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WBNProjectile.generated.h"

class USphereComponent;
class UStaticMeshComponent;
class UProjectileMovementComponent;

UCLASS()
class WBN_SURVIVORS2_API AWBNProjectile : public AActor
{
	GENERATED_BODY()

public:
	AWBNProjectile();

	/** Bewegung starten (Geschwindigkeit/Damage/Pierce). */
	UFUNCTION(BlueprintCallable, Category = "WBN|Combat")
	void Launch(const FVector& Velocity, float InDamage, int32 InPierce);

	virtual void NotifyHit(class UPrimitiveComponent* MyComp, AActor* Other, class UPrimitiveComponent* OtherComp,
		bool bSelfMoved, FVector HitLocation, FVector HitNormal, FVector NormalImpulse, const FHitResult& Hit) override;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Combat")
	TObjectPtr<USphereComponent> CollisionSphere;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Combat")
	TObjectPtr<UStaticMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Combat")
	TObjectPtr<UProjectileMovementComponent> ProjectileMovement;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Combat")
	float Damage = 10.f;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "WBN|Combat")
	int32 PierceLeft = 0;

	TSet<TObjectPtr<AActor>> HitSet;
};