// WBN Survivors 2 — PlayerCharacter (Implementierung).
#include "WBNPlayerCharacter.h"
#include "WBNCharAssembler.h"
#include "WBNCharacterData.h"
#include "WBNWeaponComponent.h"
#include "WBNWeaponData.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/PlayerController.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/World.h"

namespace
{
	UInputAction* LoadActionAsset(const TCHAR* Path)
	{
		return LoadObject<UInputAction>(nullptr, Path);
	}
}

AWBNPlayerCharacter::AWBNPlayerCharacter()
{
	Assembler = CreateDefaultSubobject<UWBNCharAssembler>(TEXT("CharAssembler"));
	WeaponComponent = CreateDefaultSubobject<UWBNWeaponComponent>(TEXT("Weapon"));
}

void AWBNPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();
	if (CharacterData)
	{
		Assembler->Assemble(CharacterData);
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("WBNPlayer: kein CharacterData gesetzt"));
	}

	if (WeaponComponent && !WeaponComponent->GetWeapon())
	{
		if (UWBNWeaponData* Pistol = LoadObject<UWBNWeaponData>(nullptr, TEXT("/Game/WBN/Data/Weapons/DA_Weapon_pistol.DA_Weapon_pistol")))
		{
			WeaponComponent->SetWeapon(Pistol, 0);
			UE_LOG(LogTemp, Display, TEXT("WBNPlayer: Startwaffe 'Dienstpistole' (Tier 0)"));
		}
	}
}

void AWBNPlayerCharacter::LoadDefaultInputs()
{
	MoveAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_Move.IA_Move"));
	StickAimAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_AimStick.IA_AimStick"));
	MouseAimAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_MouseAim.IA_MouseAim"));
	DashAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_Dash.IA_Dash"));
	ShootAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_Shoot.IA_Shoot"));
	AoEAction = LoadActionAsset(TEXT("/Game/WBN/Input/IA_AoE.IA_AoE"));
}

void AWBNPlayerCharacter::NotifyControllerChanged()
{
	Super::NotifyControllerChanged();

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (ULocalPlayer* LP = PC->GetLocalPlayer())
		{
			if (UEnhancedInputLocalPlayerSubsystem* Sub = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(LP))
			{
				if (UInputMappingContext* IMC = LoadObject<UInputMappingContext>(nullptr, TEXT("/Game/WBN/Input/IMC_WBN.IMC_WBN")))
				{
					Sub->AddMappingContext(IMC, 0);
				}
			}
		}
	}
}

void AWBNPlayerCharacter::SetupPlayerInputComponent(UInputComponent* InInputComponent)
{
	LoadDefaultInputs();
	Super::SetupPlayerInputComponent(InInputComponent);
}

void AWBNPlayerCharacter::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	USpringArmComponent* SA = GetSpringArm();
	if (!SA)
	{
		return;
	}

	if (CameraKick > 0.001f)
	{
		CameraKick = FMath::Max(0.f, CameraKick - DeltaTime * 3.5f);
		const double T = GetWorld()->GetTimeSeconds();
		SA->SetRelativeRotation(FRotator(
			-50.f + FMath::Sin(T * 42.f) * 7.f * CameraKick,
			FMath::Cos(T * 37.f) * 6.f * CameraKick,
			FMath::Sin(T * 29.f) * 4.f * CameraKick));
	}
	else if (CameraKick == 0.f)
	{
		SA->SetRelativeRotation(FRotator(-50.f, 0.f, 0.f));
	}
}

void AWBNPlayerCharacter::DoShoot()
{
	CameraKick = FMath::Min(CameraKick + 0.55f, 1.f);
	if (WeaponComponent && WeaponComponent->GetWeapon())
	{
		WeaponComponent->FireAt(GetActorForwardVector());
	}
	else
	{
		Super::DoShoot();
	}
}

void AWBNPlayerCharacter::HandleDamage(float Damage, const FVector& DamageDirection)
{
	Super::HandleDamage(Damage, DamageDirection);
	CameraKick = 1.f;
}