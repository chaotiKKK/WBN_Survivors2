// WBN Survivors 2 — Waffen-Verhalten (Implementierung).
#include "WBNWeaponComponent.h"
#include "WBNProjectile.h"
#include "WBNEnemyNPC.h"
#include "WBNFloatingNumber.h"
#include "TwinStickCharacter.h"
#include "Engine/World.h"
#include "EngineUtils.h"

UWBNWeaponComponent::UWBNWeaponComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void UWBNWeaponComponent::SetWeapon(UWBNWeaponData* InWeapon, int32 InTier)
{
	WeaponData = InWeapon;
	TierIndex = FMath::Max(0, InTier);
}

int32 UWBNWeaponComponent::RollCrit(float CritChance, float CritMult)
{
	return (FMath::FRand() < FMath::Clamp(CritChance, 0.f, 1.f)) ? FMath::RoundToInt(CritMult * 100.f) : 100;
}

void UWBNWeaponComponent::ShowNumber(UWorld* World, const FVector& At, float Value, bool bCrit)
{
	const FString S = bCrit ? FString::Printf(TEXT("%d!"), FMath::RoundToInt(Value)) : FString::Printf(TEXT("%d"), FMath::RoundToInt(Value));
	AWBNFloatingNumber::Spawn(World, At, S, bCrit ? FLinearColor(1.f, 0.95f, 0.3f) : FLinearColor::White);
}

void UWBNWeaponComponent::FireAt(const FVector& AimDir)
{
	if (!WeaponData || WeaponData->Tiers.Num() == 0 || !GetOwner())
	{
		if (!WeaponData)
		{
			UE_LOG(LogTemp, Warning, TEXT("WBNWeapon: keine Waffe gesetzt"));
		}
		return;
	}

	UWorld* World = GetWorld();
	const double Now = World ? World->GetTimeSeconds() : 0.0;
	const int32 Tier = FMath::Clamp(TierIndex, 0, WeaponData->Tiers.Num() - 1);
	const FWBNWeaponTier& T = WeaponData->Tiers[Tier];
	if (Now < NextFireTime)
	{
		return;
	}

	const int32 CritPct = RollCrit(T.CritChance, T.CritMult);
	const float Damage = T.Damage * (CritPct / 100.f);
	const FVector SafeDir = AimDir.GetSafeNormal2D();

	switch (WeaponData->Type)
	{
	case EWBNWeaponType::Projectile:
	{
		const int32 Pellets = FMath::Max(1, (int32)T.ExtraOpts.FindRef(TEXT("pellets")));
		const float Spread = T.ExtraOpts.FindRef(TEXT("spread"));
		for (int32 i = 0; i < Pellets; ++i)
		{
			float Angle = (Pellets > 1) ? ((i / (float)(Pellets - 1)) - 0.5f) * Spread : 0.f;
			Angle += FMath::RandRange(-Spread * 0.15f, Spread * 0.15f);
			FireProjectile(SafeDir.RotateAngleAxis(Angle, FVector::UpVector), Damage, T);
		}
		break;
	}
	case EWBNWeaponType::Hitscan:
		FireTrace(SafeDir, Damage, T, false, false);
		break;
	case EWBNWeaponType::Cone:
		FireTrace(SafeDir, Damage, T, true, false);
		break;
	case EWBNWeaponType::Chain:
		FireTrace(SafeDir, Damage, T, false, true);
		break;
	case EWBNWeaponType::Aura:
		FireAura(Damage, T);
		break;
	case EWBNWeaponType::Melee:
		FireMelee(SafeDir, Damage, T);
		break;
	case EWBNWeaponType::Charge:
		NextFireTime = Now + FMath::Max(T.AttackInterval * 3.f, 1.f);
		FireTrace(SafeDir, Damage * 2.5f, T, false, false);
		break;
	default:
		break;
	}
}

void UWBNWeaponComponent::FireProjectile(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier)
{
	UWorld* World = GetWorld();
	AActor* Owner = GetOwner();
	if (!World || !Owner)
	{
		return;
	}

	const int32 Pierce = FMath::Max(0, (int32)Tier.ExtraOpts.FindRef(TEXT("pierce")));
	const float Speed = Tier.ExtraOpts.FindRef(TEXT("speed")) > 0.f ? Tier.ExtraOpts.FindRef(TEXT("speed")) : 2400.f;
	const float LifeSec = FMath::Max(200.f, Tier.Range) / Speed;

	const FTransform Muzzle = Owner->GetActorTransform();
	const FVector Loc = Muzzle.GetLocation() + Muzzle.GetRotation().RotateVector(FVector::ForwardVector * 80.f);

	if (AWBNProjectile* P = World->SpawnActor<AWBNProjectile>(AWBNProjectile::StaticClass(), Loc, AimDir.Rotation()))
	{
		P->Launch(AimDir * Speed, Damage, Pierce);
		P->InitialLifeSpan = FMath::Max(LifeSec, 0.2f);
	}
}

void UWBNWeaponComponent::FireTrace(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier, bool bCone, bool bChain)
{
	UWorld* World = GetWorld();
	AActor* Owner = GetOwner();
	if (!World || !Owner)
	{
		return;
	}

	const int32 Pellets = bCone ? FMath::Max(1, (int32)Tier.ExtraOpts.FindRef(TEXT("pellets"))) : 1;
	const float Spread = bCone ? FMath::Max(Tier.ExtraOpts.FindRef(TEXT("spread")), 12.f) : 0.f;
	const float Range = FMath::Max(200.f, Tier.Range);
	const float ChainRange = Tier.ExtraOpts.FindRef(TEXT("chainRange")) > 0.f ? Tier.ExtraOpts.FindRef(TEXT("chainRange")) : Range * 0.6f;

	const FTransform Muzzle = Owner->GetActorTransform();
	const FVector Start = Muzzle.GetLocation() + Muzzle.GetRotation().RotateVector(FVector::ForwardVector * 80.f);

	for (int32 i = 0; i < Pellets; ++i)
	{
		float Angle = (Pellets > 1) ? ((i / (float)(Pellets - 1)) - 0.5f) * Spread : 0.f;
		const FVector Dir = AimDir.RotateAngleAxis(Angle, FVector::UpVector);

		TArray<AWBNEnemyNPC*> HitNPCs;
		TArray<FVector> HitPoints;
		TSet<AWBNEnemyNPC*> Visited;
		FVector From = Start;
		FVector ScanDir = Dir;

		for (int32 Hop = 0; Hop < (bChain ? 6 : 1); ++Hop)
		{
			FHitResult OutHit;
			FCollisionQueryParams QP(FName(TEXT("WBNTrace")), true, Owner);
			QP.AddIgnoredActor(Owner);
			for (AWBNEnemyNPC* V : Visited)
			{
				QP.AddIgnoredActor(V);
			}
			const bool bGot = World->LineTraceSingleByObjectType(OutHit, From, From + ScanDir * Range,
				FCollisionObjectQueryParams(ECC_WorldDynamic), QP);
			AWBNEnemyNPC* NPC = Cast<AWBNEnemyNPC>(bGot ? OutHit.GetActor() : nullptr);
			if (!NPC)
			{
				break;
			}
			Visited.Add(NPC);
			HitNPCs.Add(NPC);
			HitPoints.Add(OutHit.ImpactPoint);
			if (!bChain)
			{
				break;
			}

			AWBNEnemyNPC* Next = nullptr;
			float BestSq = TNumericLimits<float>::Max();
			for (TActorIterator<AWBNEnemyNPC> It(World); It; ++It)
			{
				AWBNEnemyNPC* E = *It;
				if (!E || Visited.Contains(E))
				{
					continue;
				}
				const float D = (E->GetActorLocation() - OutHit.ImpactPoint).SizeSquared();
				if (D < BestSq)
				{
					BestSq = D;
					Next = E;
				}
			}
			if (!Next || BestSq > ChainRange * ChainRange)
			{
				break;
			}
			From = OutHit.ImpactPoint;
			ScanDir = (Next->GetActorLocation() - From).GetSafeNormal2D();
		}

		for (int32 k = 0; k < HitNPCs.Num(); ++k)
		{
			const float StepDamage = Damage / FMath::Max(1, HitNPCs.Num());
			AWBNEnemyNPC* N = HitNPCs[k];
			const FVector Push = N ? (N->GetActorLocation() - Owner->GetActorLocation()).GetSafeNormal() : FVector::ForwardVector;
			if (N)
			{
				N->ApplyDamage(StepDamage, Push);
			}
			ShowNumber(World, HitPoints[k], StepDamage, k > 0);
		}
	}
}

void UWBNWeaponComponent::FireAura(float Damage, const FWBNWeaponTier& Tier)
{
	UWorld* World = GetWorld();
	AActor* Owner = GetOwner();
	if (!World || !Owner)
	{
		return;
	}

	const float Radius = FMath::Max(200.f, Tier.Range);
	const float RadiusSq = Radius * Radius;
	for (TActorIterator<AWBNEnemyNPC> It(World); It; ++It)
	{
		AWBNEnemyNPC* NPC = *It;
		if (!NPC)
		{
			continue;
		}
		const FVector Delta = NPC->GetActorLocation() - Owner->GetActorLocation();
		if (Delta.SizeSquared() <= RadiusSq)
		{
			NPC->ApplyDamage(Damage, Delta.GetSafeNormal());
			ShowNumber(World, NPC->GetActorLocation() + FVector(0.f, 0.f, 60.f), Damage, false);
		}
	}

	AWBNFloatingNumber::Spawn(World, Owner->GetActorLocation() + FVector(0.f, 0.f, 80.f), TEXT("AURA"), FLinearColor(0.4f, 0.8f, 1.f));
}

void UWBNWeaponComponent::FireMelee(const FVector& AimDir, float Damage, const FWBNWeaponTier& Tier)
{
	UWorld* World = GetWorld();
	AActor* Owner = GetOwner();
	if (!World || !Owner)
	{
		return;
	}

	const float Range = FMath::Max(120.f, Tier.Range);
	const FVector Start = Owner->GetActorLocation();

	FHitResult OutHit;
	FCollisionQueryParams QP(FName(TEXT("WBNMelee")), true, Owner);
	QP.AddIgnoredActor(Owner);
	const bool bGot = World->LineTraceSingleByObjectType(OutHit, Start, Start + AimDir * Range,
		FCollisionObjectQueryParams(ECC_WorldDynamic), QP);
	if (AWBNEnemyNPC* NPC = Cast<AWBNEnemyNPC>(bGot ? OutHit.GetActor() : nullptr))
	{
		NPC->ApplyDamage(Damage, AimDir);
		ShowNumber(World, OutHit.ImpactPoint, Damage, false);
	}
}