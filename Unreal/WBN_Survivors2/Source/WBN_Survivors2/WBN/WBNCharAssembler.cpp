// WBN Survivors 2 — Charakter-Assembler (Implementierung).
#include "WBNCharAssembler.h"
#include "WBNCharacterData.h"
#include "GameFramework/Character.h"
#include "Components/SkeletalMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"

UWBNCharAssembler::UWBNCharAssembler()
{
	PrimaryComponentTick.bCanEverTick = false;
}

bool UWBNCharAssembler::Assemble(const UWBNCharacterData* Data)
{
	if (!Data) { UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: keine Data")); return false; }
	ACharacter* Owner = Cast<ACharacter>(GetOwner());
	if (!Owner || !Owner->GetMesh()) { UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: Owner ist kein Character")); return false; }
	BodySlot = Owner->GetMesh();
	ClearAttachments();

	const TSoftObjectPtr<USkeletalMesh>* BodyRef = BodyMeshes.Find(Data->Skin.Build);
	if (!BodyRef || BodyRef->IsNull())
	{
		UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: kein Body für Build '%s' registriert"), *Data->Skin.Build);
		return false;
	}
	USkeletalMesh* Body = BodyRef->LoadSynchronous();
	if (!Body) { UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: Body-Load fehlgeschlagen: %s"), *Data->Skin.Build); return false; }
	BodySlot->SetSkeletalMesh(Body);
	BodySlot->SetRelativeRotation(FRotator(0.f, MeshYawOffset, 0.f));
	ApplyTints(BodySlot, Data);

	auto Attach = [&](const FString& Id, FName Bone)
	{
		if (Id.IsEmpty() || Id == TEXT("none")) return;
		const TSoftObjectPtr<USkeletalMesh>* Ref = Attachments.Find(Id);
		if (!Ref || Ref->IsNull()) { UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: Attachment '%s' nicht registriert"), *Id); return; }
		if (USkeletalMesh* M = Ref->LoadSynchronous()) SpawnFollower(M, Bone);
	};
	Attach(Data->Skin.Hat, HatBone);
	Attach(Data->Skin.Prop, PropBone);
	return true;
}

void UWBNCharAssembler::ClearAttachments()
{
	for (TObjectPtr<USkeletalMeshComponent>& C : AttachmentSlots)
		if (C) C->DestroyComponent();
	AttachmentSlots.Reset();
}

USkeletalMeshComponent* UWBNCharAssembler::SpawnFollower(USkeletalMesh* Mesh, FName Bone)
{
	AActor* Owner = GetOwner();
	if (!Owner || !BodySlot) return nullptr;
	USkeletalMeshComponent* C = NewObject<USkeletalMeshComponent>(Owner, USkeletalMeshComponent::StaticClass());
	C->SetupAttachment(BodySlot, Bone);
	C->RegisterComponent();
	C->SetSkeletalMesh(Mesh);
	if (BodySlot->GetSkeletalMeshAsset() && Mesh->GetSkeleton() == BodySlot->GetSkeletalMeshAsset()->GetSkeleton())
		C->SetMasterPoseComponent(BodySlot);
	else
		UE_LOG(LogTemp, Warning, TEXT("WBNAssembly: Skelett-Mismatch, MasterPose aus"));
	AttachmentSlots.Add(C);
	return C;
}

static FLinearColor FromHex(const FString& Hex)
{
	FString H = Hex;
	H.RemoveFromStart(TEXT("#"));
	return FLinearColor(FColor::FromHex(H));
}

void UWBNCharAssembler::ApplyTints(USkeletalMeshComponent* Comp, const UWBNCharacterData* Data) const
{
	if (!Comp || !Data) return;
	for (int32 i = 0; i < Comp->GetNumMaterials(); i++)
	{
		UMaterialInstanceDynamic* MID = Comp->CreateDynamicMaterialInstance(i);
		if (!MID) continue;
		MID->SetVectorParameterValue(TEXT("TintPrimary"), Data->Color);
		MID->SetVectorParameterValue(TEXT("TintSecondary"), Data->Color2);
		MID->SetVectorParameterValue(TEXT("TintSkin"), FromHex(Data->Skin.Head));
	}
}
