// WBN Survivors 2 — Gegner-Implementierung.
#include "WBNEnemyNPC.h"
#include "Components/StaticMeshComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "WBNEnemyData.h"
#include "WBNFloatingNumber.h"
#include "Variant_TwinStick/TwinStickCharacter.h"
#include "Variant_TwinStick/TwinStickGameMode.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"
#include "TimerManager.h"

AWBNEnemyNPC::AWBNEnemyNPC()
{
	GetCapsuleComponent()->SetCapsuleRadius(50.f);

	BodyVis = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	BodyVis->SetupAttachment(RootComponent);
	BodyVis->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeMesh.Succeeded())
	{
		BodyVis->SetStaticMesh(CubeMesh.Object);
	}

	GetCharacterMovement()->MaxAcceleration = 4000.f;
	GetCharacterMovement()->MaxWalkSpeed = 150.f;
	GetCharacterMovement()->RotationRate = FRotator(0.f, 720.f, 0.f);
}

void AWBNEnemyNPC::FetchData(UWBNEnemyData* InData)
{
	if (!InData)
	{
		return;
	}

	MaxHp = InData->Hp;
	Hp = MaxHp;
	DamageOnHit = InData->Dmg;
	bElite = false;

	const float R = FMath::Max(20.f, InData->Radius * SizeUUPerPx);
	GetCapsuleComponent()->SetCapsuleRadius(R);
	GetCapsuleComponent()->SetCapsuleHalfHeight(R * 1.2f);

	BaseScale = (2.f * R) / 100.f;
	BodyVis->SetRelativeScale3D(FVector(BaseScale, BaseScale / 1.4f, BaseScale * 1.4f));

	GetCharacterMovement()->MaxWalkSpeed = FMath::Max(60.f, InData->Speed * SpeedUUPerPx);

	if (UMaterialInterface* BaseMat = BodyVis->GetMaterial(0))
	{
		if (UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(BaseMat, this))
		{
			MID->SetVectorParameterValue(TEXT("Color"), InData->Color);
			BodyVis->SetMaterial(0, MID);
		}
	}
}

void AWBNEnemyNPC::SetElite(bool bIn)
{
	bElite = bIn;
	if (bIn)
	{
		MaxHp *= 5.f;
		Hp = MaxHp;
		DamageOnHit *= 2.f;
		BodyVis->SetRelativeScale3D(BodyVis->GetRelativeScale3D() * 1.6f);
		if (UMaterialInstanceDynamic* MID = Cast<UMaterialInstanceDynamic>(BodyVis->GetMaterial(0)))
		{
			MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.35f, 0.1f, 0.1f));
		}
	}
}

bool AWBNEnemyNPC::ApplyDamage(float Amount, const FVector& PushDir)
{
	if (bHit)
	{
		return false;
	}

	Hp -= Amount;

	// Treffer-Pop: kurz aufziehen (Game-Feel), dann zurück.
	PopStrength = 0.35f;
	BodyVis->SetRelativeScale3D(BodyVis->GetRelativeScale3D() * (1.f + PopStrength));
	GetWorld()->GetTimerManager().SetTimer(PopTimer, [this]()
	{
		BodyVis->SetRelativeScale3D(BodyVis->GetRelativeScale3D() / (1.f + PopStrength));
		PopStrength = 0.f;
	}, 0.05f, false);

	// Rückstoß.
	FVector Push = PushDir.GetSafeNormal();
	Push.Z = 0.f;
	LaunchCharacter(Push * 250.f, true, true);

	if (Hp <= 0.f)
	{
		Die();
		return true;
	}
	return false;
}

void AWBNEnemyNPC::Die()
{
	if (bHit)
	{
		return;
	}
	bHit = true;
	GetCharacterMovement()->Deactivate();
	SetActorEnableCollision(false);

	if (ATwinStickGameMode* GM = Cast<ATwinStickGameMode>(GetWorld()->GetAuthGameMode()))
	{
		GM->ScoreUpdate(1);
	}

	// Hit-Stop: kurz die Zeit einfrieren (Game-Feel).
	UGameplayStatics::SetGlobalTimeDilation(GetWorld(), 0.08f);
	FTimerHandle StopTimer;
	GetWorld()->GetTimerManager().SetTimer(StopTimer, [World = GetWorld()]()
	{
		if (World)
		{
			UGameplayStatics::SetGlobalTimeDilation(World, 1.f);
		}
	}, 0.05f, false);

	AWBNFloatingNumber::Spawn(GetWorld(), GetActorLocation(), FString::Printf(TEXT("+%d"), FMath::RoundToInt(DamageOnHit * 2.f)), FLinearColor(1.f, 0.65f, 0.15f));

	FTimerHandle DieTimer;
	GetWorld()->GetTimerManager().SetTimer(DieTimer, [this]()
	{
		if (IsValid(this))
		{
			Destroy();
		}
	}, 0.1f, false);
}

void AWBNEnemyNPC::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (bHit || !GetCharacterMovement())
	{
		return;
	}

	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}

	const FVector ToPlayer = Player->GetActorLocation() - GetActorLocation();
	const float DistSq = ToPlayer.SizeSquared();
	if (DistSq > 900.f)
	{
		SetActorRotation(ToPlayer.GetSafeNormal2D().Rotation());
		AddMovementInput(GetActorForwardVector(), 1.f);
	}
}

void AWBNEnemyNPC::NotifyHit(UPrimitiveComponent* MyComp, AActor* Other, UPrimitiveComponent* OtherComp,
	bool bSelfMoved, FVector HitLocation, FVector HitNormal, FVector NormalImpulse, const FHitResult& Hit)
{
	Super::NotifyHit(MyComp, Other, OtherComp, bSelfMoved, HitLocation, HitNormal, NormalImpulse, Hit);

	if (ATwinStickCharacter* Player = Cast<ATwinStickCharacter>(Other))
	{
		Player->HandleDamage(DamageOnHit, GetActorForwardVector());
	}
}