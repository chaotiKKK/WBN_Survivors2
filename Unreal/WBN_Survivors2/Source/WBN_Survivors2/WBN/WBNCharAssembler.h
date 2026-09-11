// WBN Survivors 2 — datengetriebener Charakter-Aufbau (T1 Modular-Char).
// Nimmt UWBNCharacterData::Skin (build/head/hat/prop/chest) und assembliert:
// Body-Mesh in den Character-Mesh-Slot + Attachments (Hut/Prop) als
// MasterPose-Follower. Farben -> "TintPrimary/Secondary/Skin"-Parameter
// (stilles No-Op falls das Material sie nicht hat; Master-Material folgt in T3).
// MeshYawOffset korrigiert das Blender-Facing (Figur schaut Blender -Y).
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "WBNCharAssembler.generated.h"

class UWBNCharacterData;
class USkeletalMeshComponent;

UCLASS(Blueprintable, meta = (BlueprintSpawnableComponent))
class UWBNCharAssembler : public UActorComponent
{
	GENERATED_BODY()

public:
	UWBNCharAssembler();

	/** Body-Key = Skin.Build (kid/normal/giant). */
	UPROPERTY(EditAnywhere, Category = "WBN|Assembly")
	TMap<FString, TSoftObjectPtr<USkeletalMesh>> BodyMeshes;

	/** Attachment-Key = Hat-/Prop-ID aus Skin (z.B. fire, guitar). */
	UPROPERTY(EditAnywhere, Category = "WBN|Assembly")
	TMap<FString, TSoftObjectPtr<USkeletalMesh>> Attachments;

	/** Bone für Hut-Attachments (Fallback, falls kein Socket existiert). */
	UPROPERTY(EditAnywhere, Category = "WBN|Assembly")
	FName HatBone = TEXT("head");

	/** Bone für Prop-Attachments. */
	UPROPERTY(EditAnywhere, Category = "WBN|Assembly")
	FName PropBone = TEXT("hand.R");

	/** Yaw-Korrektur Blender-Facing -> UE-Front. */
	UPROPERTY(EditAnywhere, Category = "WBN|Assembly", meta = (ClampMin = -180, ClampMax = 180, Units = "deg"))
	float MeshYawOffset = 0.f;

	/** Baut den Charakter aus Data auf (alter Aufbau wird abgeräumt). */
	UFUNCTION(BlueprintCallable, Category = "WBN|Assembly")
	bool Assemble(const UWBNCharacterData* Data);

	/** Body-Slot (für AnimBP-Binding). */
	UFUNCTION(BlueprintPure, Category = "WBN|Assembly")
	USkeletalMeshComponent* GetBodyMesh() const { return BodySlot; }

protected:
	UPROPERTY(Transient) TObjectPtr<USkeletalMeshComponent> BodySlot = nullptr;
	UPROPERTY(Transient) TArray<TObjectPtr<USkeletalMeshComponent>> AttachmentSlots;

	void ClearAttachments();
	USkeletalMeshComponent* SpawnFollower(USkeletalMesh* Mesh, FName Bone);
	void ApplyTints(USkeletalMeshComponent* Comp, const UWBNCharacterData* Data) const;
};
