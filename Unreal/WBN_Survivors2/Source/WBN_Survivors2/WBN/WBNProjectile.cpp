// WBN Survivors 2 — Projektil-Implementierung.
#include "WBNProjectile.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "WBNEnemyNPC.h"
#include "TwinStickCharacter.h"
#include "Engine/World.h"

AWBNProjectile::AWBNProjectile()
{
	PrimaryActorTick.bCanEverTick = true;

	RootComponent = CollisionSphere = CreateDefaultSubobject<USphereComponent>(TEXT("Collision Sphere"));
	CollisionSphere->SetSphereRadius(22.f);
	CollisionSphere->SetNotifyRigidBodyCollision(true);
	CollisionSphere->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	CollisionSphere->SetCollisionObjectType(ECC_WorldDynamic);
	CollisionSphere->SetCollisionResponseToAllChannels(ECR_Block);
	CollisionSphere->SetCollisionResponseToChannel(ECC_GameTraceChannel1, ECR_Ignore);

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(RootComponent);
	Mesh->SetCollisionProfileName(TEXT("NoCollision"));
	Mesh->SetRelativeScale3D(FVector(0.35f, 0.35f, 0.35f));

	ProjectileMovement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("Projectile Movement"));
	ProjectileMovement->InitialSpeed = 2000.f;
	ProjectileMovement->MaxSpeed = 6000.f;
	ProjectileMovement->bRotationFollowsVelocity = true;
	ProjectileMovement->bRotationRemainsVertical = true;
	ProjectileMovement->ProjectileGravityScale = 0.f;
	ProjectileMovement->bShouldBounce = false;
}

void AWBNProjectile::Launch(const FVector& Velocity, float InDamage, int32 InPierce)
{
	Damage = InDamage;
	PierceLeft = InPierce;
	HitSet.Reset();
	if (ProjectileMovement)
	{
		ProjectileMovement->Velocity = Velocity;
	}
}

void AWBNProjectile::NotifyHit(UPrimitiveComponent* MyComp, AActor* Other, UPrimitiveComponent* OtherComp,
	bool bSelfMoved, FVector HitLocation, FVector HitNormal, FVector NormalImpulse, const FHitResult& Hit)
{
	Super::NotifyHit(MyComp, Other, OtherComp, bSelfMoved, HitLocation, HitNormal, NormalImpulse, Hit);

	// Spieler trifft sich nicht selbst, Wände nur stoppen.
	if (Other && (Other->IsA(ATwinStickCharacter::StaticClass()) || HitSet.Contains(Other)))
	{
		return;
	}
	if (AWBNEnemyNPC* NPC = Cast<AWBNEnemyNPC>(Other))
	{
		HitSet.Add(Other);
		NPC->ApplyDamage(Damage, HitNormal);
		if (PierceLeft > 0)
		{
			--PierceLeft;
			return;
		}
	}
	Destroy();
}